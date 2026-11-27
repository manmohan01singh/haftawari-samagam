import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { goBackOrTab } from '../../navigation/safeBack';
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
import type { RootStackParamList } from '../../navigation/types';
import { lightColors, spacing, typography } from '../../theme';
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
    const channel = subscribeToSessionList(() => void load());
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
    grouped.completed.sort((a, b) =>
      b.session.scheduled_start_at.localeCompare(a.session.scheduled_start_at),
    );
    const order: VisibleStatus[] = liveOnly
      ? ['now_playing']
      : ['now_playing', 'upcoming', 'completed'];
    return order
      .filter((status) => grouped[status].length > 0)
      .map((status) => ({ status, title: SECTION_TITLES[status], data: grouped[status] }));
  }, [items, nowMs, liveOnly]);

  const handlePressSession = useCallback(
    (sessionId: string) => navigation.navigate('SessionWatch', { sessionId }),
    [navigation],
  );

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
      </View>
    ),
    [],
  );

  // Every state of this screen renders under the same top bar. Before
  // this fix the screen had NO header and NO back button in any state:
  // users who arrived from Home (or a shared URL) had no on-screen way
  // out, and the error state told them to "pull down to retry" on a
  // non-scrollable surface with no retry control — a dead end.
  const topBar = (
    <View style={styles.topBar}>
      <Pressable
        onPress={() => goBackOrTab(navigation, 'Home')}
        hitSlop={10}
        accessibilityLabel="Back"
        accessibilityRole="button"
      >
        <MaterialIcons name="arrow-back" size={24} color={lightColors.text} />
      </Pressable>
      <Text style={styles.topBarTitle}>Samagam Sessions</Text>
      <View style={styles.topBarSpacer} />
    </View>
  );

  if (!isSupabaseConfigured) {
    return (
      <View style={styles.screen}>
        {topBar}
        <EmptyState
          title="Samagams are not available yet"
          message="The backend is not configured in this build, so no sessions can be shown."
        />
        <StackTabBar navigation={navigation} activeTab="Home" />
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
          <View style={styles.loadingRow}>
            <ActivityIndicator color={lightColors.text} />
            <Text style={styles.loadingLabel}>Loading Samagams…</Text>
          </View>
          <SkeletonCard variant="shelf" />
          <SkeletonCard variant="shelf" />
          <SkeletonCard variant="shelf" />
        </View>
        <StackTabBar navigation={navigation} activeTab="Home" />
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
        <StackTabBar navigation={navigation} activeTab="Home" />
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
      contentContainerStyle={sections.length === 0 ? styles.emptyContainer : styles.content}
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
      <StackTabBar navigation={navigation} activeTab="Home" />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: lightColors.background },
  topBar: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    backgroundColor: lightColors.background,
  },
  topBarTitle: { fontSize: 17, fontWeight: '600', color: lightColors.text },
  topBarSpacer: { width: 24 },
  list: { flex: 1, backgroundColor: lightColors.background },
  content: { paddingTop: spacing.lg, paddingBottom: spacing.xxl },
  emptyContainer: { flexGrow: 1 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: lightColors.background,
  },
  loadingPad: { flex: 1, backgroundColor: lightColors.background, paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingBottom: spacing.lg },
  loadingLabel: { ...typography.body, color: lightColors.textSecondary },
  sectionHeader: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
  },
  sectionTitle: {
    ...typography.sectionTitle,
    color: lightColors.text,
    letterSpacing: 0.3,
  },
  sectionTitlePlaying: { color: lightColors.accent },
});
