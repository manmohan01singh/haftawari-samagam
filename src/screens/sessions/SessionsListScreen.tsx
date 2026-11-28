import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { goBackOrTab } from '../../navigation/safeBack';
import { StackHeader } from '../../components/layout/StackHeader';
import { StackTabBar } from '../../components/layout/StackTabBar';
import { EmptyState } from '../../components/common/EmptyState';
import { SessionCard } from '../../features/sessions/components/SessionCard';
import { SkeletonCard } from '../../components/video/SkeletonCard';
import { useServerClock } from '../../features/sessions/hooks/useServerClock';
import {
  listSessionsWithVideos,
  subscribeToSessionList,
  unsubscribe,
  type SessionWithVideo,
} from '../../features/sessions/sessionService';
import { deriveStatus } from '../../features/sessions/stateMachine';
import { isSupabaseConfigured } from '../../lib/supabase';
import { useDockInset } from '../../features/playback/useDockInset';
import type { RootStackParamList } from '../../navigation/types';
import { spacing, typography, useTheme, type ThemeColors } from '../../theme';
import type { SessionStatus } from '../../types/database';

/**
 * Route contract for the sessions stream. These routes are registered
 * in the root navigator and folded into RootStackParamList
 * (src/navigation/types.ts); this alias is kept for the stream's
 * consumers.
 *   Sessions: undefined
 *   SessionWatch: { sessionId: string }
 */
export type SessionsRouteParamList = Pick<
  RootStackParamList,
  'Sessions' | 'SessionWatch'
>;

type Props = NativeStackScreenProps<RootStackParamList, 'Sessions'>;

type VisibleStatus = Exclude<SessionStatus, 'cancelled'>;

interface Section {
  status: VisibleStatus;
  title: string;
  data: SessionWithVideo[];
}

const SECTION_TITLES: Record<VisibleStatus, string> = {
  now_playing: 'NOW PLAYING',
  upcoming: 'UPCOMING',
  completed: 'COMPLETED',
};

/**
 * Samagam sessions list — real rows from the `sessions` table joined
 * with their recordings, grouped by the EFFECTIVE status derived from
 * the server clock (state machine), so every device groups identically.
 * Cancelled sessions are not promoted in the list.
 */
export function SessionsListScreen({ navigation, route }: Props) {
  const { colors } = useTheme();
  const dockInset = useDockInset();
  const styles = useMemo(() => createStyles(colors), [colors]);
  // Route param (Home "Live" tab / ?filter=live deep link): 'live' is
  // the ONLY recognised filter and it maps to the real NOW PLAYING
  // status vocabulary — there is no 'live' session status. Any other
  // value (or none) means the full, unfiltered list; an unexpected
  // param must never crash or blank this screen.
  const liveOnly = route.params?.filter === 'live';
  // 15s tick: labels on this screen are minute-granularity, but the
  // UPCOMING → NOW PLAYING flip itself must be SEEN by a user sitting
  // on this screen — the derived sections below re-compute from this
  // tick (server-clock corrected), so the flip lands within one tick
  // with no reload and no manual trigger.
  const { nowMs } = useServerClock(15_000);
  const [items, setItems] = useState<SessionWithVideo[]>([]);
  // When the backend is not configured there is nothing to load.
  const [loading, setLoading] = useState(isSupabaseConfigured);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadingRef = useRef(false);

  const load = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      const rows = await listSessionsWithVideos();
      setItems(rows);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load Samagams.');
    } finally {
      loadingRef.current = false;
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let cancelled = false;
    listSessionsWithVideos()
      .then((rows) => {
        if (!cancelled) {
          setItems(rows);
          setError(null);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Could not load Samagams.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    // Realtime is a refresh accelerator, never a screen dependency:
    // a subscription failure must degrade to the already-fetched
    // list, never blank the screen (P10 leftover fix — the old
    // fixed-topic subscribe could throw synchronously on remount;
    // see sessionService.uniqueTopic for the verified root cause).
    let channel: ReturnType<typeof subscribeToSessionList> | null = null;
    try {
      channel = subscribeToSessionList(() => void load());
    } catch {
      channel = null;
    }
    return () => {
      cancelled = true;
      void unsubscribe(channel);
    };
  }, [load]);

  const sections = useMemo<Section[]>(() => {
    const grouped: Record<VisibleStatus, SessionWithVideo[]> = {
      now_playing: [],
      upcoming: [],
      completed: [],
    };
    for (const item of items) {
      const effective = deriveStatus({
        storedStatus: item.session.status,
        scheduledStartAt: item.session.scheduled_start_at,
        scheduledEndAt: item.session.scheduled_end_at,
        durationSeconds: item.video?.duration_seconds ?? null,
        nowMs,
      });
      if (effective === 'cancelled') continue;
      grouped[effective].push(item);
    }
    // Completed repeats of the same video collapse to the EARLIEST
    // run (fault 30): the same recording scheduled over and over
    // (test sessions) filled the history with identical rows. A
    // finished samagam is history — it is shown once. Upcoming
    // repeats are NOT deduped: a future re-run is a real event.
    grouped.completed.sort((a, b) =>
      a.session.scheduled_start_at.localeCompare(b.session.scheduled_start_at),
    );
    const seenCompletedVideos = new Set<string>();
    grouped.completed = grouped.completed.filter((item) => {
      const videoId = item.session.video_id;
      if (!videoId) return true;
      if (seenCompletedVideos.has(videoId)) return false;
      seenCompletedVideos.add(videoId);
      return true;
    });
    // Deterministic in-section order: playing/upcoming soonest first
    // (the server query order is not relied on after grouping),
    // completed most-recent first.
    grouped.now_playing.sort((a, b) =>
      a.session.scheduled_start_at.localeCompare(b.session.scheduled_start_at),
    );
    grouped.upcoming.sort((a, b) =>
      a.session.scheduled_start_at.localeCompare(b.session.scheduled_start_at),
    );
    grouped.completed.sort((a, b) =>
      b.session.scheduled_start_at.localeCompare(a.session.scheduled_start_at),
    );
    const order: VisibleStatus[] = liveOnly
      ? ['now_playing']
      : ['now_playing', 'upcoming', 'completed'];
    // All three sections always render (fix round 4, Chat 2 #29):
    // with only finished sessions in the data, the page used to
    // show a lone COMPLETED heading and read as if nothing else
    // existed. Empty sections now render with an honest empty line
    // (see renderSectionFooter) — the page structure tells the
    // truth about what is live, what is coming, and what finished.
    if (liveOnly) {
      return grouped.now_playing.length > 0
        ? [{ status: 'now_playing' as VisibleStatus, title: SECTION_TITLES.now_playing, data: grouped.now_playing }]
        : [];
    }
    return order.map((status) => ({ status, title: SECTION_TITLES[status], data: grouped[status] }));
  }, [items, nowMs, liveOnly]);

  const handlePressSession = useCallback(
    (sessionId: string) => navigation.navigate('SessionWatch', { sessionId }),
    [navigation],
  );

  // Wide screens (audit sweep fix, 28 Nov 2026): SectionList has
  // no multi-column mode in this RN version, so the list instead
  // sits in a centred, width-capped column — session cards stop
  // stretching ~1900px wide with 650px-tall thumbnails. Phones
  // (under the cap) are untouched.
  const { width: windowWidth } = useWindowDimensions();
  const wideCap = windowWidth >= 900;

  const renderItem = useCallback(
    ({ item, section }: { item: SessionWithVideo; section: Section }) => (
      <SessionCard
        item={item}
        effectiveStatus={section.status}
        nowMs={nowMs}
        onPress={handlePressSession}
      />
    ),
    [nowMs, handlePressSession],
  );

  const renderSectionFooter = useCallback(
    ({ section }: { section: Section }) => {
      if (section.data.length > 0) return null;
      const line =
        section.status === 'now_playing'
          ? 'No samagam is playing right now.'
          : section.status === 'upcoming'
            ? 'No samagam is scheduled right now — new sessions appear here when they are announced.'
            : 'No finished samagams yet.';
      return (
        <View style={styles.sectionEmpty}>
          <Text style={styles.sectionEmptyText}>{line}</Text>
        </View>
      );
    },
    [styles],
  );

  const renderSectionHeader = useCallback(
    ({ section }: { section: Section }) => (
      <View style={styles.sectionHeader}>
        <Text
          style={[
            styles.sectionTitle,
            section.status === 'now_playing' && styles.sectionTitlePlaying,
          ]}
        >
          {section.title}
        </Text>
        {/* Real section size — a count of the rows actually in this
            group, never a stored or invented number. */}
        <Text style={styles.sectionCount}>{section.data.length}</Text>
      </View>
    ),
    [styles],
  );

  // Every state of this screen renders under the same top bar. Before
  // this fix the screen had NO header and NO back button in any state:
  // users who arrived from Home (or a shared URL) had no on-screen way
  // out, and the error state told them to "pull down to retry" on a
  // non-scrollable surface with no retry control — a dead end.
  // Bottom bar: activeTab is deliberately null in every state of
  // this screen — Sessions belongs to no main tab, so NO tab may
  // render selected here (P10 leftover fix; it previously passed
  // "Home", which lit the Home slot while the user was on Sessions).
  const topBar = (
    <StackHeader title="Samagam Sessions" onBack={() => goBackOrTab(navigation, 'Home')} />
  );

  if (!isSupabaseConfigured) {
    return (
      <View style={styles.screen}>
        {topBar}
        <EmptyState
          title="Samagams are not available yet"
          message="The backend is not configured in this build, so no sessions can be shown."
        />
        <StackTabBar navigation={navigation} activeTab={null} />
      </View>
    );
  }

  if (loading) {
    // Skeleton cards in the real list geometry (QA issue 16) — the
    // previous state was a lone spinner on an empty page.
    return (
      <View style={styles.screen}>
        {topBar}
        <View style={styles.loadingPad}>
          <SkeletonCard variant="shelf" />
          <SkeletonCard variant="shelf" />
          <SkeletonCard variant="shelf" />
        </View>
        <StackTabBar navigation={navigation} activeTab={null} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.screen}>
        {topBar}
        <EmptyState
          title="Could not load Samagams"
          message={error}
          actionLabel="Try again"
          onAction={() => {
            setLoading(true);
            void load();
          }}
        />
        <StackTabBar navigation={navigation} activeTab={null} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      {topBar}
    <SectionList
      sections={sections}
      keyExtractor={(item) => item.session.id}
      style={styles.list}
      contentContainerStyle={[sections.length === 0 ? styles.emptyContainer : wideCap ? [styles.content, styles.contentWide] : styles.content, dockInset ? { paddingBottom: dockInset + spacing.xxl } : null]}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            void load();
          }}
        />
      }
      renderSectionHeader={renderSectionHeader}
      renderSectionFooter={renderSectionFooter}
      renderItem={renderItem}
      windowSize={7}
      initialNumToRender={6}
      maxToRenderPerBatch={6}
      updateCellsBatchingPeriod={50}
      removeClippedSubviews
      ListEmptyComponent={
        liveOnly ? (
          <EmptyState
            title="No live Samagam right now"
            message="No Samagam Session is NOW PLAYING at the moment. Scheduled Samagams appear here as UPCOMING and start playing for everyone together at their scheduled time."
            actionLabel="View all sessions"
            onAction={() => navigation.setParams({ filter: undefined })}
          />
        ) : (
          <EmptyState
            title="No Samagams scheduled"
            message="Samagam Sessions are scheduled group playbacks of recordings — everyone watches together, starting at the same position. When one is scheduled it will appear here as UPCOMING, then NOW PLAYING while it runs. Until then, you can watch any recording from the home feed."
            actionLabel="Browse recordings"
            onAction={() => navigation.navigate('MainTabs', { screen: 'Home' })}
          />
        )
      }
      stickySectionHeadersEnabled={false}
    />
      <StackTabBar navigation={navigation} activeTab={null} />
    </View>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  list: { flex: 1, backgroundColor: colors.background },
  content: { paddingTop: spacing.lg, paddingBottom: spacing.xxl },
  contentWide: { width: '100%', maxWidth: 1100, alignSelf: 'center' },
  emptyContainer: { flexGrow: 1 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  loadingPad: { flex: 1, backgroundColor: colors.background, paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
  },
  sectionCount: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
    backgroundColor: colors.surfaceVariant,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 1,
    overflow: 'hidden',
  },
  sectionEmpty: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  sectionEmptyText: { fontSize: 13, lineHeight: 18, color: colors.textSecondary },
  sectionTitle: {
    ...typography.sectionTitle,
    color: colors.text,
    letterSpacing: 0.3,
  },
  sectionTitlePlaying: { color: colors.accent },
});
