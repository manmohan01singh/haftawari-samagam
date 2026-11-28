import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RealtimeChannel } from '@supabase/supabase-js';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { EmptyState } from '../../components/common/EmptyState';
import { Toast, useToast } from '../../components/common/Toast';
import { shareContent, shareFeedback } from '../../lib/share';
import { sessionShareUrl } from '../../navigation/linking';
import { goBackOrTab } from '../../navigation/safeBack';
import { StackHeader, BackButton } from '../../components/layout/StackHeader';
import { ChatPreviewCard, SessionChat } from '../../features/chat/components';
import { joinPresence, leavePresence } from '../../features/presence/presenceService';
import { useOfficialChannel } from '../../features/channel';
import { formatCount } from '../../lib/format';
import { SessionStatusBadge } from '../../features/sessions/components/SessionStatusBadge';
import {
  YouTubeEmbed,
  type YouTubeEmbedHandle,
} from '../../features/sessions/components/YouTubeEmbed';
import {
  HostedPlayer,
  type HostedPlayerHandle,
} from '../../components/video/HostedPlayer';
import {
  fetchHostedPlaybackUrl,
  HostedNotConfiguredError,
  reportVideoDurationIfMissing,
} from '../../features/hosted/hostedService';
import {
  formatCountdown,
  formatSessionDateTime,
  formatStartedAgo,
  formatStreamedAgo,
} from '../../features/sessions/format';
import { useServerClock } from '../../features/sessions/hooks/useServerClock';
import { serverClock } from '../../features/sessions/serverClock';
import {
  getCurrentSessionUser,
  getJoinedParticipantCount,
  getMyParticipantState,
  getSessionWithVideo,
  joinSession,
  leaveSession,
  subscribeToParticipants,
  subscribeToSession,
  unsubscribe,
  type SessionWithVideo,
} from '../../features/sessions/sessionService';
import { deriveOffsetSeconds, deriveStatus } from '../../features/sessions/stateMachine';
import { isSupabaseConfigured } from '../../lib/supabase';
import {
  layout,
  nativeApp,
  radii,
  spacing,
  typography,
  useTheme,
  type ThemeColors,
} from '../../theme';
import type { RootStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'SessionWatch'>;

/** Drift (seconds) tolerated before the player is re-seeked to the session position. */
const DRIFT_TOLERANCE_SECONDS = 5;
/**
 * Hosted (native) players seek precisely, so hosted sessions use the
 * tighter rule from the dual-source plan: check every 10 s, correct
 * at > 1.5 s. The YouTube embed keeps the looser rule above — its
 * seeks and time reports are not precise enough for 1.5 s.
 */
const HOSTED_DRIFT_TOLERANCE_SECONDS = 1.5;
const HOSTED_DRIFT_CHECK_MS = 10_000;

/**
 * Synchronized Samagam watch screen.
 *
 * Everyone watches the same prerecorded recording at the same position:
 * the position is DERIVED from the scheduled start + server clock, the
 * official YouTube embed starts at that offset (late joiners included),
 * the player's reported time is drift-checked against the derived
 * offset, and foreground/reconnect re-syncs the clock and re-seeks.
 *
 * The session is labelled UPCOMING / NOW PLAYING / COMPLETED — never
 * "LIVE": it is a scheduled group playback of a recording, not a newly
 * originated live broadcast.
 */
export function SessionWatchScreen({ route, navigation }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { sessionId } = route.params;
  // 5s tick (not the 1s default): this screen's labels are
  // minute-granularity and drift correction reads serverClock
  // directly, so a 1s tick only bought 5x whole-screen re-renders.
  const { nowMs } = useServerClock(5_000);

  const [item, setItem] = useState<SessionWithVideo | null>(null);
  // When the backend is not configured there is nothing to load.
  const [loading, setLoading] = useState(isSupabaseConfigured);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<{ userId: string; displayName: string | null } | null>(null);
  const [joined, setJoined] = useState(false);
  const [joinBusy, setJoinBusy] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joinedCount, setJoinedCount] = useState<number | null>(null);
  // Channel identity for the sheet's channel row (YouTube-live
  // parity, user request 27 Nov): catalogue sessions belong to the
  // official channel — the same source Watch uses for archive rows.
  const officialChannel = useOfficialChannel();
  const [presenceCount, setPresenceCount] = useState<number | null>(null);
  const [playerReady, setPlayerReady] = useState(false);
  // NOTE (UX perf pass): this screen passes the live offsetSeconds as
  // the embed's startSeconds, which changes on every clock tick. The
  // embed components freeze that value at mount (see YouTubeEmbed),
  // so the iframe/WebView source never changes after first render —
  // ongoing sync is the drift-correction seek's job, not the src's.
  const [chatOpen, setChatOpen] = useState(false);
  const { toast, showToast } = useToast();

  // Share (Phase 13): the link is THIS app's deep link for this
  // session (…/session/<id>), so sangat who tap it land in the app
  // on this Samagam — never a youtube.com URL. The shared title is
  // the session's own title (admin-set, else the recording's).
  const onShareSession = useCallback(() => {
    const shareTitle = item?.session.title ?? item?.video?.title ?? 'Samagam';
    void shareContent(shareTitle, sessionShareUrl(sessionId)).then((outcome) => {
      const feedback = shareFeedback(outcome);
      if (feedback) showToast(feedback);
    });
  }, [item, sessionId, showToast]);

  const embedRef = useRef<YouTubeEmbedHandle>(null);
  const hostedRef = useRef<HostedPlayerHandle>(null);
  // Hosted sessions mint their signed playback URL per video (member
  // session required — the r2-playback function rejects anonymous
  // callers, unlike the public YouTube embed).
  const [hostedPlayback, setHostedPlayback] = useState<
    | { videoId: string; kind: 'ready'; url: string }
    | { videoId: string; kind: 'error'; message: string }
    | null
  >(null);
  const playerTimeRef = useRef<number | null>(null);
  const presenceChannelRef = useRef<RealtimeChannel | null>(null);

  const session = item?.session ?? null;
  const video = item?.video ?? null;
  const durationSeconds = video?.duration_seconds ?? null;
  const isHosted = (video?.source ?? 'youtube') === 'hosted';
  // Unified seek/play dispatch: session sync talks to whichever
  // player is mounted for this video's source.
  const activeSeekTo = (seconds: number) => {
    if (isHosted) hostedRef.current?.seekTo(seconds);
    else embedRef.current?.seekTo(seconds);
  };
  const activePlay = () => {
    if (isHosted) hostedRef.current?.play();
    else embedRef.current?.play();
  };

  const status = useMemo(() => {
    if (!session) return null;
    return deriveStatus({
      storedStatus: session.status,
      scheduledStartAt: session.scheduled_start_at,
      scheduledEndAt: session.scheduled_end_at,
      durationSeconds,
      nowMs,
    });
  }, [session, durationSeconds, nowMs]);

  const offsetSeconds = useMemo(() => {
    if (!session) return 0;
    return deriveOffsetSeconds({
      scheduledStartAt: session.scheduled_start_at,
      durationSeconds,
      nowMs,
    });
  }, [session, durationSeconds, nowMs]);

  const refreshJoinedCount = useCallback(async () => {
    try {
      setJoinedCount(await getJoinedParticipantCount(sessionId));
    } catch {
      // Count is informational; a failed refresh must not break playback.
    }
  }, [sessionId]);

  // ── Load session + subscribe to its row and roster ──────────────────
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let cancelled = false;
    (async () => {
      try {
        const [loaded, me] = await Promise.all([
          getSessionWithVideo(sessionId),
          getCurrentSessionUser().catch(() => null),
        ]);
        if (cancelled) return;
        setItem(loaded);
        setUser(me);
        if (!loaded) setError('This Samagam could not be found.');
        if (me) {
          // Open in the user's REAL roster state, not always "not joined".
          const myState = await getMyParticipantState(sessionId, me.userId).catch(() => null);
          if (!cancelled && myState) setJoined(myState === 'joined');
        }
        void refreshJoinedCount();
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Could not load this Samagam.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    const sessionChannel = subscribeToSession(sessionId, (updated) => {
      setItem((prev) =>
        prev ? { ...prev, session: updated } : { session: updated, video: null },
      );
    });
    const rosterChannel = subscribeToParticipants(sessionId, () => {
      void refreshJoinedCount();
    });
    return () => {
      cancelled = true;
      void unsubscribe(sessionChannel);
      void unsubscribe(rosterChannel);
    };
  }, [sessionId, refreshJoinedCount]);

  // ── Presence: REAL count of signed-in viewers in this session room ──
  // Deps are the stable userId/displayName, NOT the user object
  // (perf3): AuthContext rebuilds that object on profile sync/retry,
  // and depending on it tore down + re-created the realtime channel
  // (websocket churn + count flicker) on every rebuild.
  const presenceUserId = user?.userId;
  const presenceDisplayName = user?.displayName;
  useEffect(() => {
    if (!presenceUserId) return;
    const channel = joinPresence(
      sessionId,
      {
        userId: presenceUserId,
        displayName: presenceDisplayName ?? '',
        onlineAt: new Date().toISOString(),
      },
      (snapshot) => setPresenceCount(snapshot.participantCount),
    );
    presenceChannelRef.current = channel;
    return () => {
      presenceChannelRef.current = null;
      void leavePresence(channel);
    };
  }, [sessionId, presenceUserId, presenceDisplayName]);

  // ── Keep my participant row fresh while joined ──────────────────────
  useEffect(() => {
    if (!joined || !user) return;
    const heartbeat = setInterval(() => {
      void joinSession(sessionId, user.userId).catch(() => undefined);
    }, 60_000);
    return () => clearInterval(heartbeat);
  }, [joined, sessionId, user]);

  // Viewer-scrubbed-back state (hosted live sessions): the viewer
  // may scrub back over the part already played; while they are
  // intentionally behind, drift correction and reconnect re-seeks
  // must NOT yank them forward — the LIVE pill in the player or the
  // Sync pill below is how they return to the group position.
  const [behindLive, setBehindLive] = useState(false);
  const behindLiveRef = useRef(false);
  useEffect(() => {
    behindLiveRef.current = behindLive;
  }, [behindLive]);
  // The live edge (seconds of the Samagam played so far), ticking
  // every 5 s while NOW PLAYING — the hosted player's seek cap.
  const [liveEdge, setLiveEdge] = useState(0);
  // Leaving NOW PLAYING (the Samagam ended) clears the behind state —
  // replay seeks the whole recording freely. Render-phase reset, the
  // React pattern for state that tracks another value.
  const [prevStatus, setPrevStatus] = useState(status);
  if (status !== prevStatus) {
    setPrevStatus(status);
    if (status !== 'now_playing') setBehindLive(false);
  }

  const seekToSessionPosition = useCallback((force = false) => {
    if (status !== 'now_playing') return;
    if (behindLiveRef.current && !force) return;
    const target = deriveOffsetSeconds({
      scheduledStartAt: session?.scheduled_start_at ?? '',
      durationSeconds,
      nowMs: serverClock.nowMs(),
    });
    activeSeekTo(target);
    playerTimeRef.current = target;
    // activeSeekTo is re-created per render and dispatches on isHosted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, session, durationSeconds, isHosted]);

  // ── Reconnect / foreground: re-sync clock (hook) + re-seek ──────────
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void serverClock.sync().then(() => seekToSessionPosition());
      }
    });
    // Web reconnect path: AppState does not fire for a network drop /
    // restore in the PWA, so the browser 'online' event re-syncs the
    // clock and re-seeks as well. Native reconnects surface through
    // AppState + the Realtime channels' own resubscription.
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const onOnline = () => {
        void serverClock.sync().then(() => seekToSessionPosition());
      };
      window.addEventListener('online', onOnline);
      return () => {
        sub.remove();
        window.removeEventListener('online', onOnline);
      };
    }
    return () => sub.remove();
  }, [seekToSessionPosition]);

  // ── Live edge ticker (hosted, NOW PLAYING) ─────────────────────────
  useEffect(() => {
    if (status !== 'now_playing' || !isHosted) return;
    const update = () =>
      setLiveEdge(
        deriveOffsetSeconds({
          scheduledStartAt: session?.scheduled_start_at ?? '',
          durationSeconds,
          nowMs: serverClock.nowMs(),
        }),
      );
    update();
    const timer = setInterval(update, 5000);
    return () => clearInterval(timer);
  }, [status, isHosted, session, durationSeconds]);

  // ── Drift correction while playing ──────────────────────────────────
  useEffect(() => {
    if (status !== 'now_playing' || !playerReady || behindLive) return;
    const tolerance = isHosted ? HOSTED_DRIFT_TOLERANCE_SECONDS : DRIFT_TOLERANCE_SECONDS;
    const checkMs = isHosted ? HOSTED_DRIFT_CHECK_MS : 5000;
    const timer = setInterval(() => {
      const reported = playerTimeRef.current;
      if (reported == null) return;
      const target = deriveOffsetSeconds({
        scheduledStartAt: session?.scheduled_start_at ?? '',
        durationSeconds,
        nowMs: serverClock.nowMs(),
      });
      if (Math.abs(target - reported) > tolerance) {
        activeSeekTo(target);
        playerTimeRef.current = target;
      }
    }, checkMs);
    return () => clearInterval(timer);
    // activeSeekTo dispatches on isHosted (in deps).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, playerReady, session, durationSeconds, isHosted, behindLive]);

  // ── Hosted playback URL (signed, short-lived, members only) ───────
  useEffect(() => {
    if (!isHosted || !video) return;
    const videoId = video.id;
    let active = true;
    fetchHostedPlaybackUrl(videoId)
      .then((url) => {
        if (active) setHostedPlayback({ videoId, kind: 'ready', url });
      })
      .catch((e: unknown) => {
        if (!active) return;
        setHostedPlayback({
          videoId,
          kind: 'error',
          message:
            e instanceof HostedNotConfiguredError
              ? 'Hosted playback is not configured yet, so this Samagam cannot be played yet.'
              : e instanceof Error
                ? e.message
                : 'This Samagam is not available right now.',
        });
      });
    return () => {
      active = false;
    };
  }, [isHosted, video]);

  const handlePlayerReady = useCallback(() => setPlayerReady(true), []);
  const handleTimeUpdate = useCallback((seconds: number) => {
    playerTimeRef.current = seconds;
  }, []);

  const onToggleJoin = useCallback(async () => {
    if (!user || joinBusy) return;
    setJoinBusy(true);
    setJoinError(null);
    try {
      if (joined) {
        await leaveSession(sessionId, user.userId);
        setJoined(false);
      } else {
        await joinSession(sessionId, user.userId);
        setJoined(true);
      }
      void refreshJoinedCount();
    } catch (e) {
      // Failure keeps the previous state — and now SAYS so. Before this
      // the error was swallowed and the button silently did nothing,
      // which read as "the app is stuck".
      setJoinError(
        e instanceof Error
          ? e.message
          : joined
            ? 'Could not leave this Samagam. Please try again.'
            : 'Could not join this Samagam. Please try again.',
      );
    } finally {
      setJoinBusy(false);
    }
  }, [joined, joinBusy, sessionId, user, refreshJoinedCount]);

  // Leave the participants roster on unmount if still joined.
  const joinedRef = useRef(joined);
  const userRef = useRef(user);
  useEffect(() => {
    joinedRef.current = joined;
    userRef.current = user;
  }, [joined, user]);
  useEffect(() => {
    return () => {
      if (joinedRef.current && userRef.current) {
        void leaveSession(sessionId, userRef.current.userId).catch(() => undefined);
      }
    };
  }, [sessionId]);

  // Web tab close / navigation away: React unmount cleanup does not
  // reliably run when the page itself is being torn down, so without
  // this a closed tab left its Presence entry (and a stale 'joined'
  // roster row) behind until the Realtime socket timed out — inflating
  // the "here now" count for everyone else. pagehide is the reliable
  // teardown signal on web (beforeunload as the older-browser
  // fallback); both fire the same best-effort deregistration.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const onPageHide = () => {
      if (presenceChannelRef.current) {
        void leavePresence(presenceChannelRef.current).catch(() => undefined);
        presenceChannelRef.current = null;
      }
      if (joinedRef.current && userRef.current) {
        void leaveSession(sessionId, userRef.current.userId).catch(() => undefined);
      }
    };
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('beforeunload', onPageHide);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('beforeunload', onPageHide);
    };
  }, [sessionId]);

  // Loading / error / unavailable states get the same back bar as the
  // loaded screen — before this they were bare full-screen messages
  // with no on-screen way out.
  const backBar = (
    <StackHeader title="Samagam Session" onBack={() => goBackOrTab(navigation, 'Home')} />
  );

  if (!isSupabaseConfigured) {
    return (
      <View style={styles.stateScreen}>
        {backBar}
        <EmptyState
          title="Samagams are not available yet"
          message="The backend is not configured in this build, so this session cannot be shown."
        />
      </View>
    );
  }
  if (loading) {
    // Skeleton in the real watch geometry (player block + sheet lines),
    // not a lone spinner — the layout must not jump when data arrives.
    return (
      <View style={styles.root}>
        <View style={styles.playerSkeleton}>
          <Text style={styles.playerSkeletonLabel}>Loading Samagam…</Text>
        </View>
        <View style={styles.sheetSkeleton}>
          <View style={[styles.skelLine, { width: '85%' }]} />
          <View style={[styles.skelLine, { width: '52%', marginTop: 8 }]} />
          <View style={[styles.skelPill, { marginTop: spacing.lg }]} />
          <View style={[styles.skelLine, { width: '92%', height: 14, marginTop: spacing.lg }]} />
          <View style={[styles.skelLine, { width: '78%', height: 14, marginTop: 6 }]} />
        </View>
      </View>
    );
  }
  if (error || !session) {
    return (
      <View style={styles.stateScreen}>
        {backBar}
        <EmptyState
          title="Samagam unavailable"
          message={error ?? undefined}
          actionLabel="Back to Sessions"
          onAction={() => navigation.navigate('Sessions')}
        />
      </View>
    );
  }

  const title = session.title ?? video?.title ?? 'Samagam';
  const thumbnailUrl =
    video?.thumbnail_url ??
    (video?.youtube_video_id
      ? `https://i.ytimg.com/vi/${video.youtube_video_id}/hqdefault.jpg`
      : null);
  const isPlaying = status === 'now_playing';
  const isCompleted = status === 'completed';
  const showEmbed = (isPlaying || isCompleted) && video;
  const hostedForThisVideo =
    hostedPlayback && video && hostedPlayback.videoId === video.id ? hostedPlayback : null;
  const hostedUrl = hostedForThisVideo?.kind === 'ready' ? hostedForThisVideo.url : null;
  const hostedError = hostedForThisVideo?.kind === 'error' ? hostedForThisVideo.message : null;
  // Player actions only work when a player is actually mounted: hosted
  // recordings mint a member-only signed URL, so for a signed-out guest
  // there is no player to seek/play — "Watch again" / "Sync" would
  // silently do nothing (hostedRef is null). YouTube embeds play for
  // everyone, so the gate is the embed's video id there. (Sweep round 4:
  // a guest saw "Watch again from the start" above the "Sign in to
  // watch" note; the note below already carries the sign-in message,
  // so the dead button is hidden instead of retargeted.)
  const canControlPlayer = isHosted ? hostedUrl != null : video?.youtube_video_id != null;

  return (
    <View style={styles.root}>
      {/* Player area (pinned at top, per reference) */}
      <View style={styles.playerArea}>
        {/* Phase 9: NOTHING of ours overlays the player (same rule as
            Watch, round-3). The back control lives in the sheet's
            header zone below — previously it was a dark circle over
            the player, the third back placement in the app. */}
        {showEmbed && isHosted ? (
          hostedUrl ? (
            <HostedPlayer
              key={`hosted-${video.id}-${isPlaying ? 'playing' : 'replay'}`}
              ref={hostedRef}
              uri={hostedUrl}
              startSeconds={isPlaying ? offsetSeconds : 0}
              autoplay={isPlaying}
              onReady={handlePlayerReady}
              onTimeUpdate={handleTimeUpdate}
              onDuration={(seconds) => void reportVideoDurationIfMissing(video.id, seconds)}
              onRefreshUri={async () => {
                try {
                  return await fetchHostedPlaybackUrl(video.id);
                } catch {
                  return null;
                }
              }}
              showScrubber
              liveEdgeSeconds={isPlaying ? liveEdge : null}
              lockRate={isPlaying}
              onUserSeek={(target) => {
                if (!isPlaying) return;
                const edge = deriveOffsetSeconds({
                  scheduledStartAt: session?.scheduled_start_at ?? '',
                  durationSeconds,
                  nowMs: serverClock.nowMs(),
                });
                setBehindLive(target < edge - 2);
              }}
            />
          ) : (
            <View style={styles.thumbnailWrap}>
              {thumbnailUrl ? (
                <Image source={{ uri: thumbnailUrl }} style={styles.thumbnail} contentFit="cover" cachePolicy="memory-disk" />
              ) : (
                <View style={[styles.thumbnail, styles.thumbnailEmpty]}>
                  <Image source={require('../../../assets/icon.png')} style={styles.thumbnailFallbackMark} contentFit="contain" />
                </View>
              )}
              {hostedError ? (
                <View style={styles.thumbnailBadge}>
                  <Text style={styles.hostedErrorText}>{hostedError}</Text>
                </View>
              ) : null}
            </View>
          )
        ) : showEmbed && video.youtube_video_id ? (
          <YouTubeEmbed
            key={`${video.youtube_video_id}-${isPlaying ? 'playing' : 'replay'}`}
            ref={embedRef}
            youtubeVideoId={video.youtube_video_id}
            startSeconds={isPlaying ? offsetSeconds : 0}
            autoplay={isPlaying}
            onReady={handlePlayerReady}
            onTimeUpdate={handleTimeUpdate}
          />
        ) : (
          <View style={styles.thumbnailWrap}>
            {thumbnailUrl ? (
              <Image source={{ uri: thumbnailUrl }} style={styles.thumbnail} contentFit="cover" cachePolicy="memory-disk" />
            ) : (
              <View style={[styles.thumbnail, styles.thumbnailEmpty]}>
                <Image source={require('../../../assets/icon.png')} style={styles.thumbnailFallbackMark} contentFit="contain" />
              </View>
            )}
            {status !== 'cancelled' ? (
              <View style={styles.thumbnailBadge}>
                <SessionStatusBadge status={status ?? 'upcoming'} />
              </View>
            ) : null}
          </View>
        )}
      </View>

      {/* White sheet overlapping the player's bottom edge (reference §5) */}
      <ScrollView style={styles.sheet} contentContainerStyle={styles.sheetContent}>
        <View style={styles.backRow}>
          <BackButton onPress={() => goBackOrTab(navigation, 'Home')} />
        </View>
        <Text style={styles.title} numberOfLines={2}>
          {title}
        </Text>

        {/* YouTube-live meta line: the red NOW PLAYING badge chip
            (SessionStatusBadge — red like YouTube's LIVE chip, words
            stay truthful) with the REAL presence count as
            "N watching" beside it, exactly where YouTube puts it. */}
        <View style={styles.metaRow}>
          {status && status !== 'cancelled' ? (
            <SessionStatusBadge status={status} />
          ) : (
            <Text style={styles.statusText}>CANCELLED</Text>
          )}
          {isPlaying && presenceCount != null ? (
            <Text style={styles.watchingText}>{presenceCount} watching</Text>
          ) : null}
        </View>

        {/* Presence vs roster, honestly side by side: "here now" is the
            REAL Realtime presence count (people in this room right
            now); "joined" is the REAL session_participants roster
            count (people who tapped Join). They measure different
            things and are never merged into one number. While NOW
            PLAYING the presence count already reads as "N watching"
            in the meta line, so its chip is not repeated here. */}
        {(!isPlaying && presenceCount != null) || joinedCount != null ? (
          <View style={styles.countsRow}>
            {!isPlaying && presenceCount != null ? (
              <View style={styles.countChip}>
                <View style={styles.presenceDot} />
                <Text style={styles.countChipText}>{presenceCount} here now</Text>
              </View>
            ) : null}
            {joinedCount != null ? (
              <View style={styles.countChip}>
                <MaterialIcons name="group" size={15} color={colors.textSecondary} />
                <Text style={styles.countChipText}>{joinedCount} joined</Text>
              </View>
            ) : null}
          </View>
        ) : null}

        <Text style={styles.scheduleLine}>
          {isPlaying
            ? formatStartedAgo(session.scheduled_start_at, nowMs)
            : status === 'upcoming'
              ? `${formatSessionDateTime(session.scheduled_start_at)} · ${formatCountdown(session.scheduled_start_at, nowMs)}`
              : isCompleted
                ? // YouTube's post-live wording: once the recording's
                  // own end has passed, it reads "Streamed … ago",
                  // measured from the effective end (start + the
                  // recording duration, else the scheduled end).
                  formatStreamedAgo(
                    new Date(
                      Date.parse(session.scheduled_start_at) +
                        (durationSeconds != null
                          ? durationSeconds * 1000
                          : session.scheduled_end_at
                            ? Date.parse(session.scheduled_end_at) -
                              Date.parse(session.scheduled_start_at)
                            : 0),
                    ).toISOString(),
                    nowMs,
                  )
                : formatSessionDateTime(session.scheduled_start_at)}
        </Text>

        {/* Channel row (YouTube-live parity): round-clipped avatar,
            channel name, real subscriber count; the whole row opens
            the Channel page — the live feels like it comes from this
            channel because in this app's catalogue it does (same
            official-channel source as the Watch screen). */}
        {officialChannel ? (
          <Pressable
            style={styles.channelRow}
            onPress={() => navigation.navigate('Channel', { channelId: officialChannel.channelId })}
            accessibilityRole="button"
            accessibilityLabel={`View channel ${officialChannel.title}`}
          >
            <View style={styles.channelAvatarClip}>
              {officialChannel.avatarUrl ? (
                <Image
                  source={{ uri: officialChannel.avatarUrl }}
                  style={styles.channelAvatar}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                />
              ) : (
                <View style={[styles.channelAvatar, styles.avatarFallback]}>
                  <Text style={styles.avatarInitial}>
                    {officialChannel.title.charAt(0).toUpperCase()}
                  </Text>
                </View>
              )}
            </View>
            <View style={styles.channelLines}>
              <Text style={styles.channelNameText} numberOfLines={1} ellipsizeMode="tail">
                {officialChannel.title}
              </Text>
              {officialChannel.subscriberCount != null ? (
                <Text style={styles.channelMeta} numberOfLines={1}>
                  {`${formatCount(officialChannel.subscriberCount)} subscribers`}
                </Text>
              ) : null}
            </View>
          </Pressable>
        ) : null}

        {/* Action row (YouTube-live parity): Share + Sync side by
            side as pills, not stacked full-width buttons. Share sends
            THIS app's session deep link — sangat opening it land in
            this same live Samagam. */}
        <View style={styles.liveActionRow}>
        <Pressable
          onPress={onShareSession}
          style={({ pressed }) => [styles.syncButton, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Share this Samagam"
        >
          <View style={styles.shareInner}>
            <MaterialIcons name="share" size={16} color={colors.text} />
            <Text style={styles.syncButtonText}>Share this Samagam</Text>
          </View>
        </Pressable>

        {isPlaying && canControlPlayer ? (
          <Pressable
            onPress={() => {
              setBehindLive(false);
              seekToSessionPosition(true);
            }}
            style={({ pressed }) => [styles.syncButton, pressed && styles.pressed]}
            accessibilityRole="button"
          >
            <Text style={styles.syncButtonText}>Sync to Samagam position</Text>
          </Pressable>
        ) : null}

        {isCompleted && canControlPlayer ? (
          <Pressable
            onPress={() => {
              activeSeekTo(0);
              playerTimeRef.current = 0;
              activePlay();
            }}
            style={({ pressed }) => [styles.syncButton, pressed && styles.pressed]}
            accessibilityRole="button"
          >
            <Text style={styles.syncButtonText}>Watch again from the start</Text>
          </Pressable>
        ) : null}
        </View>

        {/* Join / Leave — real session_participants rows. The pill is
            only offered while joining is meaningful (upcoming / now
            playing): a completed or cancelled session used to show a
            permanently disabled "Join Samagam" button. Signed-out
            users get a working Sign in button, not just a note. */}
        {status === 'cancelled' || isCompleted ? null : (
          <View style={styles.actionRow}>
            {user ? (
              <Pressable
                onPress={() => void onToggleJoin()}
                disabled={joinBusy}
                style={({ pressed }) => [
                  joined ? styles.joinedPill : styles.joinPill,
                  (pressed || joinBusy) && styles.pressed,
                ]}
                accessibilityRole="button"
              >
                <Text style={joined ? styles.joinedPillText : styles.joinPillText}>
                  {joinBusy ? 'Working…' : joined ? 'Joined — tap to leave' : 'Join Samagam'}
                </Text>
              </Pressable>
            ) : (
              <View>
                <Pressable
                  onPress={() => navigation.navigate('SignIn')}
                  style={styles.joinPill}
                  accessibilityRole="button"
                >
                  <Text style={styles.joinPillText}>Sign in to join</Text>
                </Pressable>
                <Text style={styles.signInExplain}>
                  You can watch this Samagam without an account. Joining
                  (so sangat can see you are here) and chatting need you
                  to sign in first.
                </Text>
              </View>
            )}
          </View>
        )}
        {joinError ? <Text style={styles.joinError}>{joinError}</Text> : null}

        {status === 'upcoming' ? (
          <Text style={styles.note}>
            This Samagam plays a recording together at the scheduled time. When it
            starts, playback begins for everyone at the same position.
          </Text>
        ) : null}
        {isCompleted ? (
          <Text style={styles.note}>
            {/* Round-3 sweep (27 Nov 2026): a signed-out guest on a
                HOSTED recording sees "Sign in to watch this
                recording." in the player area, so "watch the full
                recording above" contradicted it. Hosted playback is
                members-only; YouTube recordings play for guests. */}
            {isHosted && !user
              ? 'This Samagam has ended. Sign in to watch the full recording.'
              : 'This Samagam has ended. You can watch the full recording above.'}
          </Text>
        ) : null}
        {status === 'cancelled' ? (
          <Text style={styles.note}>This Samagam was cancelled.</Text>
        ) : null}

        {/* Live chat (chat stream): preview card on the sheet; tapping
            it opens the full SessionChat bottom sheet. The count is the
            REAL presence count when known, else the joined roster
            count — never invented. SessionChat self-resolves the
            current user (incl. admin role) from Supabase Auth. */}
        <View style={styles.chatCardWrap}>
          <ChatPreviewCard
            sessionId={sessionId}
            participantCount={presenceCount ?? joinedCount ?? undefined}
            onPress={() => setChatOpen(true)}
            // Signed-out taps open the SHEET (which shows its own
            // "Sign in to chat" state with the button) instead of
            // bouncing straight to the sign-in page — YouTube opens
            // the chat panel and prompts inside it (mobile sweep,
            // 27 Nov 2026). The sheet's button still navigates.
            onSignInPress={() => setChatOpen(true)}
            prominent={isPlaying}
          />
        </View>

        {/* Description BELOW the chat (user's standing preference:
            comments/chat first, description after — same as Watch). */}
        {video?.description ? (
          <View style={styles.descriptionBox}>
            <Text style={styles.descriptionText}>{video.description}</Text>
          </View>
        ) : null}
      </ScrollView>

      <Modal
        visible={chatOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setChatOpen(false)}
      >
        <View style={styles.chatBackdrop}>
          <Pressable
            style={styles.chatBackdropTap}
            onPress={() => setChatOpen(false)}
            accessibilityLabel="Close chat"
          />
          <View style={styles.chatSheetHost}>
            <SessionChat
              sessionId={sessionId}
              participantCount={presenceCount ?? joinedCount ?? undefined}
              hasJoined={joined}
              onJoinPress={() => void onToggleJoin()}
              onSignInPress={() => {
                setChatOpen(false);
                navigation.navigate('SignIn');
              }}
              onClose={() => setChatOpen(false)}
            />
          </View>
        </View>
      </Modal>
      <Toast message={toast} />
    </View>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.playerBackground },
  playerSkeleton: {
    width: '100%',
    aspectRatio: layout.thumbnailAspectRatio,
    backgroundColor: colors.surfaceVariant,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playerSkeletonLabel: { ...typography.metadata, color: colors.textSecondary },
  sheetSkeleton: {
    flex: 1,
    backgroundColor: colors.surface,
    borderTopLeftRadius: nativeApp.watchSheet.topRadius,
    borderTopRightRadius: nativeApp.watchSheet.topRadius,
    marginTop: 0,
    padding: spacing.lg,
  },
  skelLine: { height: 18, borderRadius: 4, backgroundColor: colors.surfaceVariant },
  skelPill: {
    width: 150,
    height: 40,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceVariant,
  },
  countsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
    flexWrap: 'wrap',
  },
  countChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
    backgroundColor: colors.surfaceVariant,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
  },
  presenceDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#2E7D32' },
  countChipText: { fontSize: 13, fontWeight: '600', color: colors.text },
  signInExplain: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.sm,
  },
  playerArea: { backgroundColor: colors.playerBackground },
  thumbnailWrap: { position: 'relative' },
  thumbnail: {
    width: '100%',
    aspectRatio: layout.thumbnailAspectRatio,
    backgroundColor: colors.playerBackground,
  },
  thumbnailEmpty: {
    backgroundColor: colors.surfaceVariant,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbnailFallbackMark: { width: 72, height: 72, opacity: 0.9 },
  thumbnailBadge: { position: 'absolute', left: spacing.sm, bottom: spacing.sm },
  hostedErrorText: { ...typography.body, color: '#FFFFFF', backgroundColor: 'rgba(0,0,0,0.65)', paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radii.badge, overflow: 'hidden' },
  sheet: {
    flex: 1,
    backgroundColor: colors.surface,
    borderTopLeftRadius: nativeApp.watchSheet.topRadius,
    borderTopRightRadius: nativeApp.watchSheet.topRadius,
    marginTop: 0,
  },
  sheetContent: { padding: spacing.lg, paddingBottom: spacing.xxl },
  backRow: { flexDirection: 'row', alignItems: 'center' },
  title: { ...typography.watchTitle, fontWeight: '600', color: colors.text },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.sm,
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  statusText: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.4,
    color: colors.textSecondary,
  },
  watchingText: { fontSize: 13, fontWeight: '600', color: colors.text },
  channelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.lg,
    gap: spacing.md,
  },
  channelAvatarClip: {
    width: 40,
    height: 40,
    borderRadius: 20,
    overflow: 'hidden',
  },
  channelAvatar: { width: 40, height: 40 },
  avatarFallback: {
    backgroundColor: colors.surfaceVariant,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: { fontSize: 16, fontWeight: '600', color: colors.textSecondary },
  channelLines: { flex: 1, minWidth: 0 },
  channelNameText: { fontSize: 15, fontWeight: '600', color: colors.text },
  channelMeta: { fontSize: 13, color: colors.textSecondary, marginTop: 1 },
  liveActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  scheduleLine: {
    ...typography.channelName,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  syncButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    minHeight: 44,
    justifyContent: 'center',
  },
  syncButtonText: { fontSize: 13, fontWeight: '600', color: colors.text },
  shareInner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  actionRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.lg },
  joinPill: {
    backgroundColor: colors.subscribeBackground,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm + 2,
    minHeight: 44,
    justifyContent: 'center',
  },
  joinPillText: { color: colors.subscribeText, fontSize: 14, fontWeight: '600' },
  joinedPill: {
    backgroundColor: colors.surfaceVariant,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm + 2,
    minHeight: 44,
    justifyContent: 'center',
  },
  joinedPillText: { color: colors.text, fontSize: 14, fontWeight: '600' },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.8 },
  signInNote: { ...typography.body, color: colors.textSecondary },
  stateScreen: { flex: 1, backgroundColor: colors.background },
  joinError: { fontSize: 13, color: colors.accent, marginTop: spacing.sm },
  note: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.lg,
  },
  descriptionBox: {
    backgroundColor: colors.surfaceVariant,
    borderRadius: radii.card,
    padding: spacing.md,
    marginTop: spacing.lg,
  },
  descriptionText: { ...typography.body, color: colors.text },
  chatCardWrap: { marginTop: spacing.lg },
  chatBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  chatBackdropTap: { flex: 1 },
  // Height is owned by SessionChat itself (72% default, 92% expanded,
  // round-2 ref-5) so the player stays visible above the sheet; the
  // host just anchors it to the bottom of the backdrop.
  chatSheetHost: { justifyContent: 'flex-end' },
});
