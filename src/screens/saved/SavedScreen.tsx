import React, { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { isSupabaseConfigured } from '../../lib/supabase';
import { lightColors, spacing } from '../../theme';
import { useCurrentUser, useSavedItems } from '../../features/library/hooks';
import { removeSavedVideo } from '../../features/library/libraryService';
import { formatDateLine } from '../../features/library/format';
import type { SavedItem } from '../../features/library/types';
import type { LibraryRootStackParamList } from '../../features/library/screenTypes';
import { ScreenLoading, ScreenMessage } from '../../features/library/components/ScreenMessage';
import { SwipeableRow } from '../../features/library/components/SwipeableRow';
import { VideoListRow } from '../../features/library/components/VideoListRow';

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
          metaLine={`Saved ${formatDateLine(item.entry.saved_at)}`}
          onPress={(video) => navigation.navigate('Watch', { videoId: video.id })}
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
      <View style={styles.topBar}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10} accessibilityLabel="Back" accessibilityRole="button">
          <MaterialIcons name="arrow-back" size={24} color={lightColors.text} />
        </Pressable>
        <Text style={styles.topBarTitle}>Saved</Text>
        <View style={styles.topBarSpacer} />
      </View>

      {!isSupabaseConfigured ? (
        <ScreenMessage
          title="Saved videos aren't available yet"
          message="The backend isn't configured in this build, so there is nothing saved to show."
        />
      ) : authLoading ? (
        <ScreenLoading label="Loading your saved recordings…" />
      ) : !user ? (
        <ScreenMessage
          title="Sign in to see your saved recordings"
          message="Saved recordings are kept with your account, so only you can see them."
        />
      ) : saved.loading && saved.data.length === 0 ? (
        <ScreenLoading label="Loading your saved recordings…" />
      ) : saved.error && saved.data.length === 0 ? (
        <ScreenMessage title="Could not load saved recordings" message={saved.error} actionLabel="Try again" onAction={saved.reload} />
      ) : (
        <FlatList
          data={saved.data}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          contentContainerStyle={styles.listPad}
          refreshControl={<RefreshControl refreshing={saved.refreshing} onRefresh={saved.refresh} />}
          ListHeaderComponent={actionError ? <Text style={styles.errorLine}>{actionError}</Text> : undefined}
          ListEmptyComponent={
            <ScreenMessage
              title="No saved recordings yet"
              message="Tap the bookmark on any samagam to keep it here."
            />
          }
          removeClippedSubviews
          initialNumToRender={8}
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
  topBarSpacer: { width: 24 },
  listPad: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, flexGrow: 1 },
  errorLine: { color: lightColors.accent, fontSize: 13, paddingBottom: spacing.sm },
});
