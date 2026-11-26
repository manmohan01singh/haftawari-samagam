import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RealtimeChannel } from '@supabase/supabase-js';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { EmptyState } from '../../components/common/EmptyState';
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
import type { SessionsRouteParamList } from './SessionsListScreen';

type Props = NativeStackScreenProps<SessionsRouteParamList, 'SessionWatch'>;

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
export function SessionWatchScreen({ route }: Props) {
  const { sessionId } = route.params;
  const { nowMs } = useServerClock();

  const [item, setItem] = useState<SessionWithVideo | null>(null);
  // When the backend is not configured there is nothing to load.
  const [loading, setLoading] = useState(isSupabaseConfigured);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<{ userId: string; displayName: string | null } | null>(null);
  const [joined, setJoined] = useState(false);
  const [joinBusy, setJoinBusy] = useState(false);
  const [joinedCount, setJoinedCount] = useState<number | null>(null);
  const [presenceCount, setPresenceCount] = useState<number | null>(null);
  const [playerReady, setPlayerReady] = useState(false);

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
  useEffect(() => {
    if (!user) return;
    const channel = joinPresence(
      sessionId,
      {
        userId: user.userId,
        displayName: user.displayName,
        onlineAt: new Date().toISOString(),
      },
      (snapshot) => setPresenceCount(snapshot.participantCount),
    );
    presenceChannelRef.current = channel;
    return () => {
      presenceChannelRef.current = null;
      void leavePresence(channel);
    };
  }, [sessionId, user]);

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

  const onToggleJoin = useCallback(async () => {
    if (!user || joinBusy) return;
    setJoinBusy(true);
    try {
      if (joined) {
        await leaveSession(sessionId, user.userId);
        setJoined(false);
      } else {
        await joinSession(sessionId, user.userId);
        setJoined(true);
      }
      void refreshJoinedCount();
    } catch {
      // Join/leave failure leaves the previous state in place.
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

  if (!isSupabaseConfigured) {
    return (
      <EmptyState
        title="Samagams are not available yet"
        message="The backend is not configured in this build, so this session cannot be shown."
      />
    );
  }
  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={lightColors.text} />
      </View>
    );
  }
  if (error || !session) {
    return <EmptyState title="Samagam unavailable" message={error ?? undefined} />;
  }

  const title = session.title ?? video?.title ?? 'Samagam';
  const thumbnailUrl =
    video?.thumbnail_url ??
    (video ? `https://i.ytimg.com/vi/${video.youtube_video_id}/hqdefault.jpg` : null);
  const isPlaying = status === 'now_playing';
  const isCompleted = status === 'completed';
  const showEmbed = (isPlaying || isCompleted) && video;

  const participantBits: string[] = [];
  if (presenceCount != null) {
    participantBits.push(
      `${presenceCount} here now`
    );
  }
  if (joinedCount != null) {
    participantBits.push(`${joinedCount} joined`);
  }

  return (
    <View style={styles.root}>
      {/* Player area (pinned at top, per reference) */}
      <View style={styles.playerArea}>
        {showEmbed ? (
          <YouTubeEmbed
            key={`${video.youtube_video_id}-${isPlaying ? 'playing' : 'replay'}`}
            ref={embedRef}
            youtubeVideoId={video.youtube_video_id}
            startSeconds={isPlaying ? offsetSeconds : 0}
            autoplay={isPlaying}
            onReady={() => setPlayerReady(true)}
            onTimeUpdate={(seconds) => {
              playerTimeRef.current = seconds;
            }}
          />
        ) : (
          <View style={styles.thumbnailWrap}>
            {thumbnailUrl ? (
              <Image source={{ uri: thumbnailUrl }} style={styles.thumbnail} resizeMode="cover" />
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
          {participantBits.length > 0 ? (
            <Text style={styles.metaText}> · {participantBits.join(' · ')}</Text>
          ) : null}
        </View>

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

        {/* Join / Leave — real session_participants rows */}
        <View style={styles.actionRow}>
          {user ? (
            <Pressable
              onPress={() => void onToggleJoin()}
              disabled={joinBusy || status === 'cancelled' || isCompleted}
              style={({ pressed }) => [
                joined ? styles.joinedPill : styles.joinPill,
                (pressed || joinBusy) && styles.pressed,
                (status === 'cancelled' || isCompleted) && styles.disabled,
              ]}
              accessibilityRole="button"
            >
              <Text style={joined ? styles.joinedPillText : styles.joinPillText}>
                {joined ? 'Joined — tap to leave' : 'Join Samagam'}
              </Text>
            </Pressable>
          ) : (
            <Text style={styles.signInNote}>Sign in to join this Samagam.</Text>
          )}
        </View>

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
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: lightColors.playerBackground },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: lightColors.background,
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
  metaText: { fontSize: 13, color: lightColors.textSecondary },
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
  },
  syncButtonText: { fontSize: 13, fontWeight: '600', color: lightColors.text },
  actionRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.lg },
  joinPill: {
    backgroundColor: lightColors.subscribeBackground,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm + 2,
  },
  joinPillText: { color: lightColors.subscribeText, fontSize: 14, fontWeight: '600' },
  joinedPill: {
    backgroundColor: lightColors.surfaceVariant,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm + 2,
  },
  joinedPillText: { color: lightColors.text, fontSize: 14, fontWeight: '600' },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.8 },
  signInNote: { ...typography.body, color: lightColors.textSecondary },
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
});
