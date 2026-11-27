import React, { useCallback, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { isSupabaseConfigured } from '../../lib/supabase';
import { lightColors, spacing } from '../../theme';
import { useCurrentUser, useSavedItems } from '../../features/library/hooks';
import { removeSavedVideo } from '../../features/library/libraryService';
import { formatDateLine } from '../../features/library/format';
import { OFFICIAL_CHANNEL } from '../../features/search/config';
import type { SavedItem } from '../../features/library/types';
import type { LibraryRootStackParamList } from '../../features/library/screenTypes';
import { ScreenMessage } from '../../features/library/components/ScreenMessage';
import { SkeletonCard } from '../../components/video/SkeletonCard';
import { goBackOrTab } from '../../navigation/safeBack';
import { StackHeader } from '../../components/layout/StackHeader';
import { StackTabBar } from '../../components/layout/StackTabBar';
import { SwipeableRow } from '../../features/library/components/SwipeableRow';
import { VideoListRow } from '../../features/library/components/VideoListRow';
import { ROW_LIST_PERF } from '../../lib/listPerf';

type Props = NativeStackScreenProps<LibraryRootStackParamList, 'Saved'>;

/**
 * Saved videos — the signed-in user's REAL saved_videos rows, newest
 * first. Tap opens the recording; tapping the filled bookmark (or
 * swiping left) unsaves it against the live backend. Pull-to-refresh
 * refetches. Honest empty states throughout — no placeholder rows.
 */
export function SavedScreen({ navigation }: Props) {
  const { user, loading: authLoading } = useCurrentUser();
  const saved = useSavedItems(user?.id ?? null);
  const [actionError, setActionError] = useState<string | null>(null);

  const reloadSaved = saved.reload;
  useFocusEffect(
    useCallback(() => {
      reloadSaved();
    }, [reloadSaved]),
  );

  const unsave = useCallback(
    async (item: SavedItem) => {
      if (!user) return;
      setActionError(null);
      saved.setData(saved.data.filter((s) => s.entry.video_id !== item.entry.video_id));
      try {
        await removeSavedVideo(user.id, item.entry.video_id);
      } catch (e) {
        setActionError(e instanceof Error ? e.message : 'Could not unsave that recording.');
        saved.reload();
      }
    },
    [saved, user],
  );

  const renderItem = useCallback(
    ({ item }: { item: SavedItem }) => (
      <SwipeableRow onRemove={() => unsave(item)} removeLabel="Unsave">
        <VideoListRow
          video={item.video}
          channelLine={OFFICIAL_CHANNEL.title}
          metaLine={`Saved ${formatDateLine(item.entry.saved_at)}`}
          onPress={(video) => navigation.navigate('Watch', { videoRowId: video.id })}
          actionIcon="bookmark"
          actionLabel="Remove from saved"
          onAction={() => unsave(item)}
        />
      </SwipeableRow>
    ),
    [navigation, unsave],
  );

  const keyExtractor = useCallback((item: SavedItem) => item.entry.video_id, []);

  return (
    <View style={styles.container}>
      <StackHeader title="Saved" onBack={() => goBackOrTab(navigation, 'Library')} />

      {!isSupabaseConfigured ? (
        <ScreenMessage
          title="Saved videos aren't available yet"
          message="The backend isn't configured in this build, so there is nothing saved to show."
        />
      ) : authLoading ? (
        <View style={styles.listPad}>
          <SkeletonCard variant="row" />
          <SkeletonCard variant="row" />
          <SkeletonCard variant="row" />
        </View>
      ) : !user ? (
        <ScreenMessage
          title="Sign in to see your saved recordings"
          message="Saved recordings are kept with your account, so only you can see them."
          actionLabel="Sign in"
          onAction={() => navigation.navigate('SignIn')}
        />
      ) : saved.loading && saved.data.length === 0 ? (
        <View style={styles.listPad}>
          <SkeletonCard variant="row" />
          <SkeletonCard variant="row" />
          <SkeletonCard variant="row" />
        </View>
      ) : saved.error && saved.data.length === 0 ? (
        <ScreenMessage title="Could not load saved recordings" message={saved.error} actionLabel="Try again" onAction={saved.reload} />
      ) : (
        <FlatList
          data={saved.data}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          contentContainerStyle={styles.listPad}
          refreshControl={<RefreshControl refreshing={saved.refreshing} onRefresh={saved.refresh} />}
          ListHeaderComponent={
            actionError || saved.error ? (
              <Text style={styles.errorLine}>{actionError ?? saved.error}</Text>
            ) : undefined
          }
          ListEmptyComponent={
            <ScreenMessage
              title="No saved recordings yet"
              message="Tap the bookmark on any samagam to keep it here."
              actionLabel="Browse samagams"
              onAction={() => navigation.navigate('MainTabs', { screen: 'Home' })}
            />
          }
          {...ROW_LIST_PERF}
        />
      )}
      <StackTabBar navigation={navigation} activeTab="Library" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: lightColors.background },
  listPad: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, flexGrow: 1 },
  errorLine: { color: lightColors.accent, fontSize: 13, paddingBottom: spacing.sm },
});
