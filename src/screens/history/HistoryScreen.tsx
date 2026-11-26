import React, { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { isSupabaseConfigured } from '../../lib/supabase';
import { lightColors, spacing } from '../../theme';
import { useCurrentUser, useHistory } from '../../features/library/hooks';
import { clearHistory, removeHistoryEntry } from '../../features/library/libraryService';
import { formatDateLine } from '../../features/library/format';
import type { HistoryItem } from '../../features/library/types';
import type { LibraryRootStackParamList } from '../../features/library/screenTypes';
import { ConfirmModal } from '../../features/library/components/ConfirmModal';
import { ScreenLoading, ScreenMessage } from '../../features/library/components/ScreenMessage';
import { SwipeableRow } from '../../features/library/components/SwipeableRow';
import { VideoListRow } from '../../features/library/components/VideoListRow';

type Props = NativeStackScreenProps<LibraryRootStackParamList, 'History'>;

/**
 * Watch history — the signed-in user's REAL watch_history rows, newest
 * first, joined with their recordings. Fully working controls:
 *  - tap a row → Watch screen (the stored position drives its resume UI)
 *  - swipe a row left (or tap its ✕) → remove that one entry
 *  - trash icon in the header → clear ALL history, after confirmation
 *  - pull-to-refresh refetches from the backend
 * Signed-out users and an unconfigured backend get honest messages —
 * never placeholder rows.
 */
export function HistoryScreen({ navigation }: Props) {
  const { user, loading: authLoading } = useCurrentUser();
  const history = useHistory(user?.id ?? null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const reloadHistory = history.reload;
  useFocusEffect(
    useCallback(() => {
      reloadHistory();
    }, [reloadHistory]),
  );

  const removeOne = useCallback(
    async (item: HistoryItem) => {
      if (!user) return;
      setActionError(null);
      history.setData(history.data.filter((h) => h.entry.video_id !== item.entry.video_id));
      try {
        await removeHistoryEntry(user.id, item.entry.video_id);
      } catch (e) {
        setActionError(e instanceof Error ? e.message : 'Could not remove that entry.');
        history.reload();
      }
    },
    [history, user],
  );

  const clearAll = useCallback(async () => {
    if (!user) return;
    setClearing(true);
    setActionError(null);
    try {
      await clearHistory(user.id);
      history.setData([]);
      setConfirmClear(false);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Could not clear your history.');
    } finally {
      setClearing(false);
    }
  }, [history, user]);

  const renderItem = useCallback(
    ({ item }: { item: HistoryItem }) => (
      <SwipeableRow onRemove={() => removeOne(item)} removeLabel="Remove">
        <VideoListRow
          video={item.video}
          metaLine={`Watched ${formatDateLine(item.entry.watched_at)}`}
          resumePositionSeconds={item.entry.last_position_seconds}
          onPress={(video) => navigation.navigate('Watch', { videoId: video.id })}
          actionIcon="close"
          actionLabel="Remove from history"
          onAction={() => removeOne(item)}
        />
      </SwipeableRow>
    ),
    [navigation, removeOne],
  );

  const keyExtractor = useCallback((item: HistoryItem) => item.entry.video_id, []);

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10} accessibilityLabel="Back" accessibilityRole="button">
          <MaterialIcons name="arrow-back" size={24} color={lightColors.text} />
        </Pressable>
        <Text style={styles.topBarTitle}>History</Text>
        {user && history.data.length > 0 ? (
          <Pressable
            onPress={() => setConfirmClear(true)}
            hitSlop={10}
            accessibilityLabel="Clear all watch history"
            accessibilityRole="button"
          >
            <MaterialIcons name="delete-outline" size={24} color={lightColors.text} />
          </Pressable>
        ) : (
          <View style={styles.topBarSpacer} />
        )}
      </View>

      {!isSupabaseConfigured ? (
        <ScreenMessage
          title="History isn't available yet"
          message="The backend isn't configured in this build, so there is no history to show."
        />
      ) : authLoading ? (
        <ScreenLoading label="Loading your history…" />
      ) : !user ? (
        <ScreenMessage
          title="Sign in to see your history"
          message="Watch history is kept with your account, so only you can see it."
        />
      ) : history.loading && history.data.length === 0 ? (
        <ScreenLoading label="Loading your history…" />
      ) : history.error && history.data.length === 0 ? (
        <ScreenMessage title="Could not load history" message={history.error} actionLabel="Try again" onAction={history.reload} />
      ) : (
        <FlatList
          data={history.data}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          contentContainerStyle={styles.listPad}
          refreshControl={<RefreshControl refreshing={history.refreshing} onRefresh={history.refresh} />}
          ListHeaderComponent={actionError ? <Text style={styles.errorLine}>{actionError}</Text> : undefined}
          ListEmptyComponent={
            <ScreenMessage
              title="No history yet"
              message="Recordings you watch while signed in will appear here."
            />
          }
          removeClippedSubviews
          initialNumToRender={8}
          windowSize={7}
        />
      )}

      <ConfirmModal
        visible={confirmClear}
        title="Clear watch history?"
        message="This removes every recording from your watch history. This cannot be undone."
        confirmLabel="Clear all"
        busy={clearing}
        onConfirm={clearAll}
        onCancel={() => setConfirmClear(false)}
      />
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
  topBarSpacer: { width: 24 },
  listPad: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, flexGrow: 1 },
  errorLine: { color: lightColors.accent, fontSize: 13, paddingBottom: spacing.sm },
});
