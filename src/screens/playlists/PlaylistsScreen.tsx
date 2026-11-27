import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { isSupabaseConfigured } from '../../lib/supabase';
import { spacing, useTheme, type ThemeColors } from '../../theme';
import { useCurrentUser, usePlaylistSummaries } from '../../features/library/hooks';
import { createPlaylist, deletePlaylist } from '../../features/library/libraryService';
import { CardActionSheet } from '../../components/common/CardActionSheet';
import { ConfirmModal } from '../../features/library/components/ConfirmModal';
import type { PlaylistSummary } from '../../features/library/types';
import type { LibraryRootStackParamList } from '../../features/library/screenTypes';
import { goBackOrTab } from '../../navigation/safeBack';
import { StackHeader } from '../../components/layout/StackHeader';
import { StackTabBar } from '../../components/layout/StackTabBar';
import { CreatePlaylistSheet } from '../../features/library/components/CreatePlaylistSheet';
import { PlaylistRow } from '../../features/library/components/PlaylistRow';
import { ScreenMessage } from '../../features/library/components/ScreenMessage';
import { SkeletonCard } from '../../components/video/SkeletonCard';
import { ROW_LIST_PERF } from '../../lib/listPerf';

type Props = NativeStackScreenProps<LibraryRootStackParamList, 'Playlists'>;

/**
 * All playlists — the signed-in user's own playlists first, then every
 * public playlist, each with its real item count and cover. Signed-in
 * users can create a playlist from here; tapping a row opens its
 * detail screen. Signed-out users see the public list only.
 */
export function PlaylistsScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { user, loading: authLoading } = useCurrentUser();
  const summaries = usePlaylistSummaries(user?.id ?? null);
  const [createOpen, setCreateOpen] = useState(false);
  const [menuFor, setMenuFor] = useState<PlaylistSummary | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<PlaylistSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const handleDelete = useCallback(async () => {
    if (!confirmDelete) return;
    const target = confirmDelete;
    setDeleting(true);
    setActionError(null);
    // Optimistic remove; restored below if the backend delete fails.
    summaries.setData(summaries.data.filter((s) => s.playlist.id !== target.playlist.id));
    try {
      await deletePlaylist(target.playlist.id);
      setConfirmDelete(null);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Could not delete that playlist.');
      summaries.reload();
      setConfirmDelete(null);
    } finally {
      setDeleting(false);
    }
  }, [confirmDelete, summaries]);

  const reload = summaries.reload;
  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  const openPlaylist = useCallback(
    (summary: PlaylistSummary) => navigation.navigate('Playlist', { playlistId: summary.playlist.id }),
    [navigation],
  );

  const handleCreate = useCallback(
    async (title: string, isPublic: boolean) => {
      if (!user) throw new Error('Sign in to create a playlist.');
      const playlist = await createPlaylist(user.id, title, isPublic);
      summaries.reload();
      // Open the playlist the user just made (YouTube does the same);
      // before this, the sheet closed and the user was left hunting
      // for their new playlist in a list that had not refreshed yet.
      navigation.navigate('Playlist', { playlistId: playlist.id });
    },
    [navigation, summaries, user],
  );

  const renderItem = useCallback(
    ({ item }: { item: PlaylistSummary }) => (
      <PlaylistRow summary={item} onPress={openPlaylist} onMenu={setMenuFor} />
    ),
    [openPlaylist],
  );

  const keyExtractor = useCallback((item: PlaylistSummary) => item.playlist.id, []);

  return (
    <View style={styles.container}>
      <StackHeader
        title="Playlists"
        onBack={() => goBackOrTab(navigation, 'Library')}
        right={
          user ? (
            <Pressable
              onPress={() => setCreateOpen(true)}
              hitSlop={10}
              accessibilityLabel="Create a new playlist"
              accessibilityRole="button"
            >
              <MaterialIcons name="add" size={26} color={colors.text} />
            </Pressable>
          ) : undefined
        }
      />

      {!isSupabaseConfigured ? (
        <ScreenMessage
          title="Playlists aren't available yet"
          message="The backend isn't configured in this build, so there are no playlists to show."
        />
      ) : authLoading || (summaries.loading && summaries.data.length === 0) ? (
        <View style={styles.listPad}>
          <SkeletonCard variant="row" />
          <SkeletonCard variant="row" />
          <SkeletonCard variant="row" />
        </View>
      ) : summaries.error && summaries.data.length === 0 ? (
        <ScreenMessage title="Could not load playlists" message={summaries.error} actionLabel="Try again" onAction={summaries.reload} />
      ) : (
        <FlatList
          data={summaries.data}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          contentContainerStyle={styles.listPad}
          refreshControl={<RefreshControl refreshing={summaries.refreshing} onRefresh={summaries.refresh} />}
          ListHeaderComponent={
            actionError || summaries.error ? (
              <Text style={styles.errorLine}>{actionError ?? summaries.error}</Text>
            ) : undefined
          }
          ListEmptyComponent={
            <ScreenMessage
              title="No playlists yet"
              message={
                user
                  ? 'Create your first playlist to group samagams together.'
                  : 'There are no public playlists yet. Sign in to create your own.'
              }
              actionLabel={user ? 'Create a playlist' : 'Sign in'}
              onAction={user ? () => setCreateOpen(true) : () => navigation.navigate('SignIn')}
            />
          }
          {...ROW_LIST_PERF}
        />
      )}

      <StackTabBar navigation={navigation} activeTab="Library" />
      <CreatePlaylistSheet visible={createOpen} onCreate={handleCreate} onClose={() => setCreateOpen(false)} />
      <CardActionSheet
        visible={menuFor != null}
        onClose={() => setMenuFor(null)}
        actions={[
          ...(menuFor
            ? [
                {
                  key: 'open',
                  label: 'Open playlist',
                  icon: 'playlist-play',
                  onPress: () => openPlaylist(menuFor),
                },
              ]
            : []),
          ...(menuFor?.isOwn
            ? [
                {
                  key: 'delete',
                  label: 'Delete playlist',
                  icon: 'delete-outline',
                  onPress: () => setConfirmDelete(menuFor),
                },
              ]
            : []),
        ]}
      />
      <ConfirmModal
        visible={confirmDelete != null}
        title="Delete this playlist?"
        message={`"${confirmDelete?.playlist.title ?? ''}" and its list of recordings will be removed. The recordings themselves stay in the catalogue. This cannot be undone.`}
        confirmLabel="Delete"
        busy={deleting}
        onConfirm={() => void handleDelete()}
        onCancel={() => setConfirmDelete(null)}
      />
    </View>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  listPad: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, flexGrow: 1 },
  errorLine: { color: colors.accent, fontSize: 13, paddingBottom: spacing.sm },
});
