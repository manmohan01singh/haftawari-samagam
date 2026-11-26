import React, { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { isSupabaseConfigured } from '../../lib/supabase';
import { lightColors, spacing } from '../../theme';
import { useCurrentUser, useHistory } from '../../features/library/hooks';
import { clearHistory, removeHistoryEntry } from '../../features/library/libraryService';
import { formatClock, formatDateLine } from '../../features/library/format';
import { OFFICIAL_CHANNEL } from '../../features/search/config';
import {
  clearLocalHistory,
  removeLocalHistoryEntry,
  useLocalHistory,
  type LocalHistoryEntry,
} from '../../features/library/localHistory';
import type { HistoryItem } from '../../features/library/types';
import type { LibraryRootStackParamList } from '../../features/library/screenTypes';
import { goBackOrTab } from '../../navigation/safeBack';
import { StackTabBar } from '../../components/layout/StackTabBar';
import { ConfirmModal } from '../../features/library/components/ConfirmModal';
import { ScreenMessage } from '../../features/library/components/ScreenMessage';
import { SkeletonCard } from '../../components/video/SkeletonCard';
import { SwipeableRow } from '../../features/library/components/SwipeableRow';
import { VideoListRow } from '../../features/library/components/VideoListRow';
import { ROW_LIST_PERF } from '../../lib/listPerf';

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
  // Device-local history (signed-out users, QA 78): recordings opened
  // while signed out are kept on this device and shown here, clearly
  // labelled, instead of pretending nothing was watched.
  const local = useLocalHistory();
  const [confirmClearLocal, setConfirmClearLocal] = useState(false);
  const reloadLocal = local.reload;
  useFocusEffect(
    useCallback(() => {
      reloadLocal();
    }, [reloadLocal]),
  );

  const [localError, setLocalError] = useState<string | null>(null);

  const removeLocal = useCallback(
    async (entry: LocalHistoryEntry) => {
      // Optimistic remove WITH rollback: local storage writes can fail
      // (storage blocked/full) — previously the failure was swallowed
      // and the row vanished until the next reload brought it back.
      const previous = local.entries;
      setLocalError(null);
      local.setEntries(previous.filter((e) => e.youtubeVideoId !== entry.youtubeVideoId));
      const persisted = await removeLocalHistoryEntry(entry.youtubeVideoId).catch(() => false);
      if (!persisted) {
        local.setEntries(previous);
        setLocalError('Could not remove that entry from this device. Please try again.');
      }
    },
    [local],
  );

  const clearLocal = useCallback(async () => {
    const persisted = await clearLocalHistory().catch(() => false);
    setConfirmClearLocal(false);
    if (persisted) {
      local.setEntries([]);
      setLocalError(null);
    } else {
      setLocalError('Could not clear the history on this device. Please try again.');
    }
  }, [local]);
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
          channelLine={OFFICIAL_CHANNEL.title}
          metaLine={`Watched ${formatDateLine(item.entry.watched_at)}`}
          resumePositionSeconds={item.entry.last_position_seconds}
          onPress={(video) => navigation.navigate('Watch', { videoRowId: video.id })}
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
        <Pressable onPress={() => goBackOrTab(navigation, 'Library')} hitSlop={10} accessibilityLabel="Back" accessibilityRole="button">
          <MaterialIcons name="arrow-back" size={24} color={lightColors.text} />
        </Pressable>
        <Text style={styles.topBarTitle}>History</Text>
        {!user && local.entries.length > 0 ? (
          <Pressable
            onPress={() => setConfirmClearLocal(true)}
            hitSlop={10}
            accessibilityLabel="Clear device history"
            accessibilityRole="button"
          >
            <MaterialIcons name="delete-outline" size={24} color={lightColors.text} />
          </Pressable>
        ) : user && history.data.length > 0 ? (
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
        <View style={styles.listPad}>
          <SkeletonCard variant="row" />
          <SkeletonCard variant="row" />
          <SkeletonCard variant="row" />
        </View>
      ) : !user && local.loading ? (
        <View style={styles.listPad}>
          <SkeletonCard variant="row" />
          <SkeletonCard variant="row" />
          <SkeletonCard variant="row" />
        </View>
      ) : !user && local.entries.length > 0 ? (
        <FlatList
          data={local.entries}
          keyExtractor={(e) => e.youtubeVideoId}
          contentContainerStyle={styles.listPad}
          refreshControl={<RefreshControl refreshing={local.refreshing} onRefresh={local.refresh} />}
          ListHeaderComponent={
            <View>
              <View style={styles.localBanner}>
                <Text style={styles.localBannerText}>
                  {"You're signed out, so this history is kept only on this device. Sign in to keep history with your account."}
                </Text>
                <Pressable onPress={() => navigation.navigate('SignIn')} hitSlop={8} accessibilityRole="button">
                  <Text style={styles.localBannerAction}>Sign in</Text>
                </Pressable>
              </View>
              {localError ? <Text style={styles.errorLine}>{localError}</Text> : null}
            </View>
          }
          renderItem={({ item }) => (
            <SwipeableRow onRemove={() => void removeLocal(item)} removeLabel="Remove">
              <Pressable
                style={styles.localRow}
                onPress={() =>
                  navigation.navigate(
                    'Watch',
                    item.videoRowId
                      ? { videoRowId: item.videoRowId }
                      : { youtubeVideoId: item.youtubeVideoId },
                  )
                }
                accessibilityRole="button"
                accessibilityLabel={item.title}
              >
                <View style={styles.localThumbWrap}>
                  {item.thumbnailUrl ? (
                    <Image
                      source={{ uri: item.thumbnailUrl }}
                      style={styles.localThumb}
                      contentFit="cover"
                      cachePolicy="memory-disk"
                      recyclingKey={item.youtubeVideoId}
                    />
                  ) : (
                    <View style={[styles.localThumb, styles.thumbEmpty]} />
                  )}
                  {item.durationSeconds != null ? (
                    <View style={styles.durationBadge} pointerEvents="none">
                      <Text style={styles.durationText}>{formatClock(item.durationSeconds)}</Text>
                    </View>
                  ) : null}
                </View>
                <View style={styles.localLines}>
                  <Text style={styles.localTitle} numberOfLines={2}>
                    {item.title}
                  </Text>
                  <Text style={styles.localMeta} numberOfLines={1}>
                    {OFFICIAL_CHANNEL.title}
                  </Text>
                  <Text style={styles.localMeta} numberOfLines={1}>
                    Watched {formatDateLine(item.watchedAt)} · On this device
                  </Text>
                </View>
                <Pressable
                  onPress={() => void removeLocal(item)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Remove from device history"
                  style={styles.localRemove}
                >
                  <MaterialIcons name="close" size={20} color={lightColors.textSecondary} />
                </Pressable>
              </Pressable>
            </SwipeableRow>
          )}
          {...ROW_LIST_PERF}
        />
      ) : !user ? (
        <ScreenMessage
          title="Sign in to see your history"
          message="Watch history is kept with your account, so only you can see it. Recordings you watch while signed out are kept on this device and will show here."
          actionLabel="Sign in"
          onAction={() => navigation.navigate('SignIn')}
        />
      ) : history.loading && history.data.length === 0 ? (
        <View style={styles.listPad}>
          <SkeletonCard variant="row" />
          <SkeletonCard variant="row" />
          <SkeletonCard variant="row" />
        </View>
      ) : history.error && history.data.length === 0 ? (
        <ScreenMessage title="Could not load history" message={history.error} actionLabel="Try again" onAction={history.reload} />
      ) : (
        <FlatList
          data={history.data}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          contentContainerStyle={styles.listPad}
          refreshControl={<RefreshControl refreshing={history.refreshing} onRefresh={history.refresh} />}
          ListHeaderComponent={
            actionError || history.error ? (
              <Text style={styles.errorLine}>{actionError ?? history.error}</Text>
            ) : undefined
          }
          ListEmptyComponent={
            <ScreenMessage
              title="No history yet"
              message="Recordings you watch while signed in will appear here."
              actionLabel="Browse samagams"
              onAction={() => navigation.navigate('MainTabs', { screen: 'Home' })}
            />
          }
          {...ROW_LIST_PERF}
        />
      )}

      <StackTabBar navigation={navigation} activeTab="Library" />
      <ConfirmModal
        visible={confirmClearLocal}
        title="Clear device history?"
        message="This removes the watch history kept on this device. This cannot be undone."
        confirmLabel="Clear all"
        onConfirm={() => void clearLocal()}
        onCancel={() => setConfirmClearLocal(false)}
      />
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
  localBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: lightColors.surfaceVariant,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    marginBottom: spacing.md,
  },
  localBannerText: { flex: 1, fontSize: 13, lineHeight: 18, color: lightColors.textSecondary },
  localBannerAction: { fontSize: 14, fontWeight: '700', color: lightColors.text },
  localRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, paddingVertical: spacing.sm },
  localThumbWrap: { width: '40%', maxWidth: 168, position: 'relative' },
  localThumb: { width: '100%', aspectRatio: 16 / 9, borderRadius: 12, backgroundColor: lightColors.playerBackground },
  durationBadge: {
    position: 'absolute',
    right: 6,
    bottom: 6,
    backgroundColor: 'rgba(0,0,0,0.8)',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  durationText: { color: '#FFFFFF', fontSize: 11, fontWeight: '600' },
  thumbEmpty: { backgroundColor: lightColors.surfaceVariant },
  localLines: { flex: 1, paddingTop: 2 },
  localTitle: { fontSize: 15, lineHeight: 20, fontWeight: '600', color: lightColors.text },
  localMeta: { fontSize: 13, color: lightColors.textSecondary, marginTop: 3 },
  localRemove: { padding: spacing.xs, marginTop: 2 },
});
