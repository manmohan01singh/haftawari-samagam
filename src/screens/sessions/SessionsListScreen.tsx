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
import { EmptyState } from '../../components/common/EmptyState';
import { SessionCard } from '../../features/sessions/components/SessionCard';
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
export function SessionsListScreen({ navigation }: Props) {
  const { nowMs } = useServerClock();
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
    const order: VisibleStatus[] = ['now_playing', 'upcoming', 'completed'];
    return order
      .filter((status) => grouped[status].length > 0)
      .map((status) => ({ status, title: SECTION_TITLES[status], data: grouped[status] }));
  }, [items, nowMs]);

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
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.screen}>
        {topBar}
        <View style={styles.center}>
          <ActivityIndicator color={lightColors.text} />
        </View>
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
      renderSectionHeader={({ section }) => (
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
      )}
      renderItem={({ item, section }) => (
        <SessionCard
          item={item}
          effectiveStatus={section.status}
          nowMs={nowMs}
          onPress={(sessionId) => navigation.navigate('SessionWatch', { sessionId })}
        />
      )}
      ListEmptyComponent={
        <EmptyState
          title="No Samagams scheduled"
          message="When a Samagam is scheduled it will appear here as UPCOMING."
        />
      }
      stickySectionHeadersEnabled={false}
    />
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
