import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { isSupabaseConfigured } from '../../lib/supabase';
import { layout, lightColors, radii, spacing } from '../../theme';
import { useCurrentUser, usePlaylistDetail } from '../../features/library/hooks';
import { removePlaylistItem } from '../../features/library/libraryService';
import { formatClock } from '../../features/library/format';
import type { PlaylistDetailItem } from '../../features/library/types';
import type { LibraryRootStackParamList } from '../../features/library/screenTypes';
import { ScreenLoading, ScreenMessage } from '../../features/library/components/ScreenMessage';
import { SwipeableRow } from '../../features/library/components/SwipeableRow';
import { VideoListRow } from '../../features/library/components/VideoListRow';
import { ROW_LIST_PERF } from '../../lib/listPerf';

type Props = NativeStackScreenProps<LibraryRootStackParamList, 'Playlist'>;

/**
 * Playlist detail — the playlist's REAL items in position order.
 * Owners (and admins, via RLS) can remove items by swiping left or
 * tapping ✕; everyone who can see the playlist can play any item.
 * A playlist that doesn't exist — or isn't visible to the caller —
 * gets an honest "not available" message.
 */
export function PlaylistScreen({ navigation, route }: Props) {
  const { playlistId } = route.params;
  const { user } = useCurrentUser();
  const detailState = usePlaylistDetail(playlistId);
  const { detail } = detailState;
  const [actionError, setActionError] = useState<string | null>(null);

  const reload = detailState.reload;
  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  const isOwner = Boolean(user && detail && detail.playlist.created_by === user.id);

  const totalSeconds = useMemo(
    () => (detail?.items ?? []).reduce((sum, i) => sum + (i.video.duration_seconds ?? 0), 0),
    [detail],
  );

  const removeItem = useCallback(
    async (row: PlaylistDetailItem) => {
      if (!detail) return;
      setActionError(null);
      detailState.setDetail({
        ...detail,
        items: detail.items.filter((i) => i.item.video_id !== row.item.video_id),
      });
      try {
        await removePlaylistItem(detail.playlist.id, row.item.video_id);
      } catch (e) {
        setActionError(e instanceof Error ? e.message : 'Could not remove that recording.');
        detailState.reload();
      }
    },
    [detail, detailState],
  );

  const renderItem = useCallback(
    ({ item }: { item: PlaylistDetailItem }) => {
      const row = (
        <VideoListRow
          video={item.video}
          metaLine={`#${item.item.position + 1}`}
          onPress={(video) => navigation.navigate('Watch', { videoRowId: video.id })}
          actionIcon={isOwner ? 'close' : undefined}
          actionLabel="Remove from playlist"
          onAction={isOwner ? () => removeItem(item) : undefined}
        />
      );
      return isOwner ? (
        <SwipeableRow onRemove={() => removeItem(item)} removeLabel="Remove">
          {row}
        </SwipeableRow>
      ) : (
        row
      );
    },
    [isOwner, navigation, removeItem],
  );

  const keyExtractor = useCallback((item: PlaylistDetailItem) => item.item.video_id, []);

  const header = detail ? (
    <View style={styles.header}>
      {detail.items[0]?.video.thumbnail_url ? (
        <Image
          source={{ uri: detail.items[0].video.thumbnail_url }}
          style={styles.cover}
          contentFit="cover"
          cachePolicy="memory-disk"
        />
      ) : (
        <View style={[styles.cover, styles.coverEmpty]}>
          <MaterialIcons name="playlist-play" size={40} color={lightColors.textSecondary} />
        </View>
      )}
      <Text style={styles.playlistTitle}>{detail.playlist.title}</Text>
      {detail.playlist.description ? (
        <Text style={styles.playlistDescription}>{detail.playlist.description}</Text>
      ) : null}
      <Text style={styles.playlistMeta}>
        {detail.playlist.is_public ? 'Public' : 'Private'} · {detail.items.length}{' '}
        {detail.items.length === 1 ? 'recording' : 'recordings'}
        {totalSeconds > 0 ? ` · ${formatClock(totalSeconds)} total` : ''}
      </Text>
      {actionError ? <Text style={styles.errorLine}>{actionError}</Text> : null}
    </View>
  ) : null;

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10} accessibilityLabel="Back" accessibilityRole="button">
          <MaterialIcons name="arrow-back" size={24} color={lightColors.text} />
        </Pressable>
        <Text style={styles.topBarTitle} numberOfLines={1}>
          {detail?.playlist.title ?? 'Playlist'}
        </Text>
        <View style={styles.topBarSpacer} />
      </View>

      {!isSupabaseConfigured ? (
        <ScreenMessage
          title="Playlists aren't available yet"
          message="The backend isn't configured in this build, so this playlist can't be shown."
        />
      ) : detailState.loading && !detail ? (
        <ScreenLoading label="Loading playlist…" />
      ) : detailState.error && !detail ? (
        <ScreenMessage title="Could not load this playlist" message={detailState.error} actionLabel="Try again" onAction={detailState.reload} />
      ) : detailState.notFound || !detail ? (
        <ScreenMessage
          title="Playlist not available"
          message="This playlist doesn't exist, or it is private and not shared with you."
        />
      ) : (
        <FlatList
          data={detail.items}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          contentContainerStyle={styles.listPad}
          refreshControl={<RefreshControl refreshing={detailState.refreshing} onRefresh={detailState.refresh} />}
          ListHeaderComponent={header ?? undefined}
          ListEmptyComponent={
            <ScreenMessage
              title="No recordings yet"
              message="This playlist is empty. Add recordings to it from any samagam's save menu."
            />
          }
          {...ROW_LIST_PERF}
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
    gap: spacing.md,
  },
  topBarTitle: { flex: 1, fontSize: 17, fontWeight: '600', color: lightColors.text },
  topBarSpacer: { width: 24 },
  listPad: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, flexGrow: 1 },
  header: { paddingBottom: spacing.md },
  cover: {
    width: '100%',
    aspectRatio: layout.thumbnailAspectRatio,
    borderRadius: radii.card,
    backgroundColor: lightColors.playerBackground,
  },
  coverEmpty: {
    backgroundColor: lightColors.surfaceVariant,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playlistTitle: { fontSize: 20, fontWeight: '700', color: lightColors.text, marginTop: spacing.md },
  playlistDescription: { fontSize: 14, lineHeight: 20, color: lightColors.textSecondary, marginTop: spacing.xs },
  playlistMeta: { fontSize: 13, color: lightColors.textSecondary, marginTop: spacing.xs },
  errorLine: { color: lightColors.accent, fontSize: 13, paddingTop: spacing.sm },
});
