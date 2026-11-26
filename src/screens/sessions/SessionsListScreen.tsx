import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
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

  if (!isSupabaseConfigured) {
    return (
      <EmptyState
        title="Samagams are not available yet"
        message="The backend is not configured in this build, so no sessions can be shown."
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

  if (error) {
    return (
      <EmptyState
        title="Could not load Samagams"
        message={`${error} Pull down to retry.`}
      />
    );
  }

  return (
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
  );
}

const styles = StyleSheet.create({
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
