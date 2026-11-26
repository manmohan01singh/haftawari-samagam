import React, { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { isSupabaseConfigured } from '../../lib/supabase';
import { lightColors, spacing } from '../../theme';
import { useCurrentUser, usePlaylistSummaries } from '../../features/library/hooks';
import { createPlaylist } from '../../features/library/libraryService';
import type { PlaylistSummary } from '../../features/library/types';
import type { LibraryRootStackParamList } from '../../features/library/screenTypes';
import { goBackOrTab } from '../../navigation/safeBack';
import { CreatePlaylistSheet } from '../../features/library/components/CreatePlaylistSheet';
import { PlaylistRow } from '../../features/library/components/PlaylistRow';
import { ScreenLoading, ScreenMessage } from '../../features/library/components/ScreenMessage';

type Props = NativeStackScreenProps<LibraryRootStackParamList, 'Playlists'>;

/**
 * All playlists — the signed-in user's own playlists first, then every
 * public playlist, each with its real item count and cover. Signed-in
 * users can create a playlist from here; tapping a row opens its
 * detail screen. Signed-out users see the public list only.
 */
export function PlaylistsScreen({ navigation }: Props) {
  const { user, loading: authLoading } = useCurrentUser();
  const summaries = usePlaylistSummaries(user?.id ?? null);
  const [createOpen, setCreateOpen] = useState(false);

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
    ({ item }: { item: PlaylistSummary }) => <PlaylistRow summary={item} onPress={openPlaylist} />,
    [openPlaylist],
  );

  const keyExtractor = useCallback((item: PlaylistSummary) => item.playlist.id, []);

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <Pressable onPress={() => goBackOrTab(navigation, 'Library')} hitSlop={10} accessibilityLabel="Back" accessibilityRole="button">
          <MaterialIcons name="arrow-back" size={24} color={lightColors.text} />
        </Pressable>
        <Text style={styles.topBarTitle}>Playlists</Text>
        {user ? (
          <Pressable
            onPress={() => setCreateOpen(true)}
            hitSlop={10}
            accessibilityLabel="Create a new playlist"
            accessibilityRole="button"
          >
            <MaterialIcons name="add" size={26} color={lightColors.text} />
          </Pressable>
        ) : (
          <View style={styles.topBarSpacer} />
        )}
      </View>

      {!isSupabaseConfigured ? (
        <ScreenMessage
          title="Playlists aren't available yet"
          message="The backend isn't configured in this build, so there are no playlists to show."
        />
      ) : authLoading || (summaries.loading && summaries.data.length === 0) ? (
        <ScreenLoading label="Loading playlists…" />
      ) : summaries.error && summaries.data.length === 0 ? (
        <ScreenMessage title="Could not load playlists" message={summaries.error} actionLabel="Try again" onAction={summaries.reload} />
      ) : (
        <FlatList
          data={summaries.data}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          contentContainerStyle={styles.listPad}
          refreshControl={<RefreshControl refreshing={summaries.refreshing} onRefresh={summaries.refresh} />}
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
          removeClippedSubviews
          initialNumToRender={8}
          windowSize={7}
        />
      )}

      <CreatePlaylistSheet visible={createOpen} onCreate={handleCreate} onClose={() => setCreateOpen(false)} />
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
  topBarSpacer: { width: 26 },
  listPad: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, flexGrow: 1 },
});
