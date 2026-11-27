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
import { goBackOrTab } from '../../navigation/safeBack';
import { ChatPreviewCard, SessionChat } from '../../features/chat/components';
import { joinPresence, leavePresence } from '../../features/presence/presenceService';
import { SessionStatusBadge } from '../../features/sessions/components/SessionStatusBadge';
import {
  YouTubeEmbed,
  type YouTubeEmbedHandle,
} from '../../features/sessions/components/YouTubeEmbed';
import {
  formatCountdown,
  formatSessionDateTime,
  formatStartedAgo,
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
import { SESSION_LABELS } from '../../features/sessions/types';
import { isSupabaseConfigured } from '../../lib/supabase';
import {
  layout,
  lightColors,
  nativeApp,
  radii,
  spacing,
  typography,
} from '../../theme';
import type { RootStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'SessionWatch'>;

/** Drift (seconds) tolerated before the player is re-seeked to the session position. */
const DRIFT_TOLERANCE_SECONDS = 5;

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
  const [presenceCount, setPresenceCount] = useState<number | null>(null);
  const [playerReady, setPlayerReady] = useState(false);
  // NOTE (UX perf pass): this screen passes the live offsetSeconds as
  // the embed's startSeconds, which changes on every clock tick. The
  // embed components freeze that value at mount (see YouTubeEmbed),
  // so the iframe/WebView source never changes after first render —
  // ongoing sync is the drift-correction seek's job, not the src's.
  const [chatOpen, setChatOpen] = useState(false);

  const embedRef = useRef<YouTubeEmbedHandle>(null);
  const playerTimeRef = useRef<number | null>(null);
  const presenceChannelRef = useRef<RealtimeChannel | null>(null);

  const session = item?.session ?? null;
  const video = item?.video ?? null;
  const durationSeconds = video?.duration_seconds ?? null;

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

  const seekToSessionPosition = useCallback(() => {
    if (status !== 'now_playing') return;
    const target = deriveOffsetSeconds({
      scheduledStartAt: session?.scheduled_start_at ?? '',
      durationSeconds,
      nowMs: serverClock.nowMs(),
    });
    embedRef.current?.seekTo(target);
    playerTimeRef.current = target;
  }, [status, session, durationSeconds]);

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

  // ── Drift correction while playing ──────────────────────────────────
  useEffect(() => {
    if (status !== 'now_playing' || !playerReady) return;
    const timer = setInterval(() => {
      const reported = playerTimeRef.current;
      if (reported == null) return;
      const target = deriveOffsetSeconds({
        scheduledStartAt: session?.scheduled_start_at ?? '',
        durationSeconds,
        nowMs: serverClock.nowMs(),
      });
      if (Math.abs(target - reported) > DRIFT_TOLERANCE_SECONDS) {
        embedRef.current?.seekTo(target);
        playerTimeRef.current = target;
      }
    }, 5000);
    return () => clearInterval(timer);
  }, [status, playerReady, session, durationSeconds]);

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
    <View style={styles.backBar}>
      <Pressable
        onPress={() => goBackOrTab(navigation, 'Home')}
        hitSlop={10}
        accessibilityLabel="Back"
        accessibilityRole="button"
      >
        <MaterialIcons name="arrow-back" size={24} color={lightColors.text} />
      </Pressable>
      <Text style={styles.backBarTitle}>Samagam Session</Text>
      <View style={styles.backBarSpacer} />
    </View>
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
    (video ? `https://i.ytimg.com/vi/${video.youtube_video_id}/hqdefault.jpg` : null);
  const isPlaying = status === 'now_playing';
  const isCompleted = status === 'completed';
  const showEmbed = (isPlaying || isCompleted) && video;

  return (
    <View style={styles.root}>
      {/* Player area (pinned at top, per reference) */}
      <View style={styles.playerArea}>
        {/* Back affordance over the player. This screen previously had
            NO back control at all — on the PWA the only way out was the
            browser's own back button. */}
        <Pressable
          onPress={() => goBackOrTab(navigation, 'Home')}
          style={styles.backOverlay}
          hitSlop={8}
          accessibilityLabel="Back"
          accessibilityRole="button"
        >
          <MaterialIcons name="arrow-back" size={22} color="#FFFFFF" />
        </Pressable>
        {showEmbed ? (
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
              <View style={[styles.thumbnail, styles.thumbnailEmpty]} />
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
        <Text style={styles.title} numberOfLines={2}>
          {title}
        </Text>

        <View style={styles.metaRow}>
          {status && status !== 'cancelled' ? (
            <Text
              style={[
                styles.statusText,
                isPlaying && styles.statusPlaying,
              ]}
            >
              {SESSION_LABELS[status]}
            </Text>
          ) : (
            <Text style={styles.statusText}>CANCELLED</Text>
          )}
        </View>

        {/* Presence vs roster, honestly side by side: "here now" is the
            REAL Realtime presence count (people in this room right
            now); "joined" is the REAL session_participants roster
            count (people who tapped Join). They measure different
            things and are never merged into one number. */}
        {presenceCount != null || joinedCount != null ? (
          <View style={styles.countsRow}>
            {presenceCount != null ? (
              <View style={styles.countChip}>
                <View style={styles.presenceDot} />
                <Text style={styles.countChipText}>{presenceCount} here now</Text>
              </View>
            ) : null}
            {joinedCount != null ? (
              <View style={styles.countChip}>
                <MaterialIcons name="group" size={15} color={lightColors.textSecondary} />
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
              : formatSessionDateTime(session.scheduled_start_at)}
        </Text>

        {isPlaying ? (
          <Pressable
            onPress={seekToSessionPosition}
            style={({ pressed }) => [styles.syncButton, pressed && styles.pressed]}
            accessibilityRole="button"
          >
            <Text style={styles.syncButtonText}>Sync to Samagam position</Text>
          </Pressable>
        ) : null}

        {isCompleted ? (
          <Pressable
            onPress={() => {
              embedRef.current?.seekTo(0);
              playerTimeRef.current = 0;
              embedRef.current?.play();
            }}
            style={({ pressed }) => [styles.syncButton, pressed && styles.pressed]}
            accessibilityRole="button"
          >
            <Text style={styles.syncButtonText}>Watch again from the start</Text>
          </Pressable>
        ) : null}

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
            This Samagam has ended. You can watch the full recording above.
          </Text>
        ) : null}
        {status === 'cancelled' ? (
          <Text style={styles.note}>This Samagam was cancelled.</Text>
        ) : null}

        {video?.description ? (
          <View style={styles.descriptionBox}>
            <Text style={styles.descriptionText}>{video.description}</Text>
          </View>
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
            onSignInPress={() => navigation.navigate('SignIn')}
            prominent={isPlaying}
          />
        </View>
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
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: lightColors.playerBackground },
  playerSkeleton: {
    width: '100%',
    aspectRatio: layout.thumbnailAspectRatio,
    backgroundColor: lightColors.surfaceVariant,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playerSkeletonLabel: { ...typography.metadata, color: lightColors.textSecondary },
  sheetSkeleton: {
    flex: 1,
    backgroundColor: lightColors.surface,
    borderTopLeftRadius: nativeApp.watchSheet.topRadius,
    borderTopRightRadius: nativeApp.watchSheet.topRadius,
    marginTop: -nativeApp.watchSheet.topRadius,
    padding: spacing.lg,
  },
  skelLine: { height: 18, borderRadius: 4, backgroundColor: lightColors.surfaceVariant },
  skelPill: {
    width: 150,
    height: 40,
    borderRadius: radii.pill,
    backgroundColor: lightColors.surfaceVariant,
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
    backgroundColor: lightColors.surfaceVariant,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
  },
  presenceDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#2E7D32' },
  countChipText: { fontSize: 13, fontWeight: '600', color: lightColors.text },
  signInExplain: {
    ...typography.body,
    color: lightColors.textSecondary,
    marginTop: spacing.sm,
  },
  playerArea: { backgroundColor: lightColors.playerBackground },
  thumbnailWrap: { position: 'relative' },
  thumbnail: {
    width: '100%',
    aspectRatio: layout.thumbnailAspectRatio,
    backgroundColor: lightColors.playerBackground,
  },
  thumbnailEmpty: { backgroundColor: lightColors.surfaceVariant },
  thumbnailBadge: { position: 'absolute', left: spacing.sm, bottom: spacing.sm },
  sheet: {
    flex: 1,
    backgroundColor: lightColors.surface,
    borderTopLeftRadius: nativeApp.watchSheet.topRadius,
    borderTopRightRadius: nativeApp.watchSheet.topRadius,
    marginTop: -nativeApp.watchSheet.topRadius,
  },
  sheetContent: { padding: spacing.lg, paddingBottom: spacing.xxl },
  title: { ...typography.watchTitle, fontWeight: '600', color: lightColors.text },
  metaRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.sm, flexWrap: 'wrap' },
  statusText: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.4,
    color: lightColors.textSecondary,
  },
  statusPlaying: { color: lightColors.accent },
  scheduleLine: {
    ...typography.channelName,
    color: lightColors.textSecondary,
    marginTop: spacing.xs,
  },
  syncButton: {
    alignSelf: 'flex-start',
    marginTop: spacing.md,
    borderWidth: 1,
    borderColor: lightColors.border,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    minHeight: 44,
    justifyContent: 'center',
  },
  syncButtonText: { fontSize: 13, fontWeight: '600', color: lightColors.text },
  actionRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.lg },
  joinPill: {
    backgroundColor: lightColors.subscribeBackground,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm + 2,
    minHeight: 44,
    justifyContent: 'center',
  },
  joinPillText: { color: lightColors.subscribeText, fontSize: 14, fontWeight: '600' },
  joinedPill: {
    backgroundColor: lightColors.surfaceVariant,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm + 2,
    minHeight: 44,
    justifyContent: 'center',
  },
  joinedPillText: { color: lightColors.text, fontSize: 14, fontWeight: '600' },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.8 },
  signInNote: { ...typography.body, color: lightColors.textSecondary },
  stateScreen: { flex: 1, backgroundColor: lightColors.background },
  backBar: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    backgroundColor: lightColors.background,
  },
  backBarTitle: { fontSize: 17, fontWeight: '600', color: lightColors.text },
  backBarSpacer: { width: 24 },
  backOverlay: {
    position: 'absolute',
    top: spacing.sm,
    left: spacing.sm,
    zIndex: 10,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  joinError: { fontSize: 13, color: lightColors.accent, marginTop: spacing.sm },
  note: {
    ...typography.body,
    color: lightColors.textSecondary,
    marginTop: spacing.lg,
  },
  descriptionBox: {
    backgroundColor: lightColors.surfaceVariant,
    borderRadius: radii.card,
    padding: spacing.md,
    marginTop: spacing.lg,
  },
  descriptionText: { ...typography.body, color: lightColors.text },
  chatCardWrap: { marginTop: spacing.lg },
  chatBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  chatBackdropTap: { flex: 1 },
  // Height is owned by SessionChat itself (72% default, 92% expanded,
  // round-2 ref-5) so the player stays visible above the sheet; the
  // host just anchors it to the bottom of the backdrop.
  chatSheetHost: { justifyContent: 'flex-end' },
});
