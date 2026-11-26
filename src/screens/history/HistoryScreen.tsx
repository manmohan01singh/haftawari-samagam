import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { EmptyState } from '../../components/common/EmptyState';
import { ShelfCard } from '../../components/video/ShelfCard';
import { SkeletonCard } from '../../components/video/SkeletonCard';
import { formatDateLine, supabaseCardData } from '../../components/video/cardData';
import { useAuth } from '../../features/auth';
import { useOfficialChannel } from '../../features/channel';
import { fetchWatchHistory, type HistoryItem } from '../../lib/videos';
import { lightColors, spacing } from '../../theme';
import type { RootStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'History'>;

/**
 * Watch history — the signed-in user's real `watch_history` rows
 * (recorded by the watch screen), newest first. Signed-out users are
 * told plainly that history needs an account.
 */
export function HistoryScreen({ navigation }: Props) {
  const { user, loading: authLoading } = useAuth();
  const channel = useOfficialChannel();
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Derived loading: waiting on auth, or signed in and not yet fetched.
  const loading = authLoading || (!!user && !done);

  useEffect(() => {
    if (authLoading || !user) return;
    let active = true;
    fetchWatchHistory(user.id)
      .then((rows) => {
        if (active) setItems(rows);
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : 'Could not load history.');
      })
      .finally(() => {
        if (active) setDone(true);
      });
    return () => {
      active = false;
    };
  }, [user, authLoading]);

  const renderItem = useCallback(
    ({ item }: { item: HistoryItem }) => {
      const data = supabaseCardData(item.video, channel?.avatarUrl ?? null);
      return (
        <ShelfCard
          data={{ ...data, metaLine: `Watched ${formatDateLine(item.entry.watched_at)}` }}
          onPress={() => navigation.navigate('Watch', { videoRowId: item.video.id })}
        />
      );
    },
    [channel, navigation],
  );

  const keyExtractor = useCallback((item: HistoryItem) => `${item.entry.video_id}-${item.entry.watched_at}`, []);

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10} accessibilityLabel="Back">
          <MaterialIcons name="arrow-back" size={24} color={lightColors.text} />
        </Pressable>
        <Text style={styles.topBarTitle}>History</Text>
        <View style={{ width: 24 }} />
      </View>
      {!user && !authLoading ? (
        <EmptyState
          title="Sign in to see your history"
          message="Watch history is kept with your account."
        />
      ) : loading ? (
        <View style={styles.listPad}>
          <SkeletonCard variant="shelf" />
          <SkeletonCard variant="shelf" />
        </View>
      ) : error ? (
        <EmptyState title="Could not load history" message={error} />
      ) : (
        <FlatList
          data={items}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          contentContainerStyle={styles.listPad}
          ListEmptyComponent={
            <EmptyState
              title="No history yet"
              message="Recordings you watch while signed in will appear here."
            />
          }
          removeClippedSubviews
          initialNumToRender={6}
          windowSize={7}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: lightColors.background },
  topBar: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
  },
  topBarTitle: { fontSize: 17, fontWeight: '600', color: lightColors.text },
  listPad: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
});
