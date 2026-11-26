import React, { useCallback, useState } from 'react';
import {
  Dimensions,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import type { CompositeScreenProps } from '@react-navigation/native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { isSupabaseConfigured } from '../../lib/supabase';
import { layout, lightColors, radii, spacing } from '../../theme';
import type { MainTabParamList } from '../../navigation/types';
import {
  useCurrentUser,
  useHistory,
  usePlaylistSummaries,
  useProfile,
  useSavedItems,
} from '../../features/library/hooks';
import { createPlaylist } from '../../features/library/libraryService';
import { resumeRatio } from '../../features/library/format';
import type { HistoryItem, PlaylistSummary } from '../../features/library/types';
import type { LibraryRootStackParamList } from '../../features/library/screenTypes';
import { CreatePlaylistSheet } from '../../features/library/components/CreatePlaylistSheet';
import { PlaylistRow } from '../../features/library/components/PlaylistRow';
import { VideoListRow } from '../../features/library/components/VideoListRow';

type Props = CompositeScreenProps<
  BottomTabScreenProps<MainTabParamList, 'Library'>,
  NativeStackScreenProps<LibraryRootStackParamList>
>;

/** Reference §4: History shelf cards ≈36% of the screen width. */
const HISTORY_CARD_WIDTH = Math.round(Dimensions.get('window').width * 0.36);

/**
 * "You" / Library page (reference §4): Accounts pill header, profile
 * block, History shelf, Library chips, then stacked rows for the
 * user's playlists and saved recordings. EVERY section is real data
 * from the live backend (watch_history, saved_videos, playlists);
 * signed-out visitors see public playlists plus honest sign-in
 * prompts — never fabricated rows. (The reference's Downloads/Liked
 * rows have no equivalent in this app's data model and are not
 * imitated.)
 */
export function LibraryScreen({ navigation }: Props) {
  const { user, loading: authLoading } = useCurrentUser();
  const { profile } = useProfile(user?.id ?? null);
  const history = useHistory(user?.id ?? null);
  const saved = useSavedItems(user?.id ?? null);
  const summaries = usePlaylistSummaries(user?.id ?? null);
  const [createOpen, setCreateOpen] = useState(false);

  const refreshing = history.refreshing || saved.refreshing || summaries.refreshing;
  const onRefresh = useCallback(() => {
    history.refresh();
    saved.refresh();
    summaries.refresh();
  }, [history, saved, summaries]);

  const openVideo = useCallback(
    (videoId: string) => navigation.navigate('Watch', { videoRowId: videoId }),
    [navigation],
  );

  const openPlaylist = useCallback(
    (summary: PlaylistSummary) =>
      navigation.navigate('Playlist', { playlistId: summary.playlist.id }),
    [navigation],
  );

  const handleCreate = useCallback(
    async (title: string, isPublic: boolean) => {
      if (!user) throw new Error('Sign in to create a playlist.');
      await createPlaylist(user.id, title, isPublic);
      summaries.reload();
    },
    [summaries, user],
  );

  const renderHistoryCard = useCallback(
    ({ item }: { item: HistoryItem }) => {
      const ratio = resumeRatio(item.entry.last_position_seconds, item.video.duration_seconds);
      return (
        <Pressable
          style={styles.historyCard}
          onPress={() => openVideo(item.video.id)}
          accessibilityRole="button"
          accessibilityLabel={item.video.title}
        >
          <View style={styles.historyThumbWrap}>
            {item.video.thumbnail_url ? (
              <Image source={{ uri: item.video.thumbnail_url }} style={styles.historyThumb} resizeMode="cover" />
            ) : (
              <View style={[styles.historyThumb, styles.thumbEmpty]} />
            )}
            {ratio != null ? (
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${Math.round(ratio * 100)}%` }]} />
              </View>
            ) : null}
          </View>
          <Text style={styles.historyTitle} numberOfLines={2}>
            {item.video.title}
          </Text>
        </Pressable>
      );
    },
    [openVideo ],
  );

  const displayName = profile?.display_name ?? null;
  const initial = (displayName ?? user?.email ?? '?').charAt(0).toUpperCase();
  const historyShelf = history.data.slice(0, 10);
  const savedPreview = saved.data.slice(0, 4);
  const playlistPreview = summaries.data.slice(0, 4);

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Pressable
          style={styles.accountsPill}
          onPress={() => navigation.navigate('Account')}
          accessibilityRole="button"
        >
          <Text style={styles.accountsText}>Accounts</Text>
          <MaterialIcons name="keyboard-arrow-down" size={20} color={lightColors.text} />
        </Pressable>
        <View style={styles.headerActions}>
          <Pressable onPress={() => navigation.navigate('Search')} hitSlop={8} accessibilityLabel="Search" accessibilityRole="button">
            <MaterialIcons name="search" size={24} color={lightColors.text} />
          </Pressable>
          <Pressable onPress={() => navigation.navigate('Settings')} hitSlop={8} accessibilityLabel="Settings" accessibilityRole="button">
            <MaterialIcons name="settings" size={24} color={lightColors.text} />
          </Pressable>
        </View>
      </View>

      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={styles.scrollContent}
      >
        {!isSupabaseConfigured ? (
          <Text style={styles.emptyLine}>
            The backend is not configured in this build, so your library cannot be loaded.
          </Text>
        ) : authLoading ? (
          <Text style={styles.emptyLine}>Loading…</Text>
        ) : user ? (
          <>
            <View style={styles.profileBlock}>
              <View style={styles.profileAvatar}>
                <Text style={styles.profileInitial}>{initial}</Text>
              </View>
              <View style={styles.profileLines}>
                <Text style={styles.profileName} numberOfLines={1}>
                  {displayName ?? 'Sangat member'}
                </Text>
                <Text style={styles.profileMeta} numberOfLines={1}>
                  {user.email ?? ''}
                </Text>
              </View>
            </View>
            <View style={styles.profileButtons}>
              <Pressable
                style={[styles.pillButton, styles.pillDark]}
                onPress={() => navigation.navigate('Playlists')}
                accessibilityRole="button"
              >
                <Text style={[styles.pillText, styles.pillTextDark]}>Your playlists</Text>
              </Pressable>
              <Pressable
                style={[styles.pillButton, styles.pillLight]}
                onPress={() => navigation.navigate('Saved')}
                accessibilityRole="button"
              >
                <Text style={[styles.pillText, styles.pillTextLight]}>Saved</Text>
              </Pressable>
            </View>
            {profile?.role === 'admin' ? (
              <Pressable
                style={styles.adminLink}
                onPress={() => navigation.navigate('Admin', { screen: 'AdminOverview' })}
                accessibilityRole="button"
              >
                <MaterialIcons name="dashboard" size={18} color={lightColors.text} />
                <Text style={styles.adminLinkText}>Admin dashboard</Text>
              </Pressable>
            ) : null}
          </>
        ) : (
          <View style={styles.signInBlock}>
            <Text style={styles.signInTitle}>Sign in to see your library</Text>
            <Text style={styles.signInText}>
              Your history, saved samagams and playlists are kept with your account.
            </Text>
          </View>
        )}

        {/* History shelf */}
        <Pressable
          style={styles.sectionHeadingRow}
          onPress={() => navigation.navigate('History')}
          accessibilityRole="button"
        >
          <Text style={styles.sectionHeading}>History</Text>
          <MaterialIcons name="chevron-right" size={22} color={lightColors.text} />
        </Pressable>
        {user && historyShelf.length > 0 ? (
          <FlatList
            horizontal
            data={historyShelf}
            keyExtractor={(item) => item.entry.video_id}
            renderItem={renderHistoryCard}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.historyContent}
          />
        ) : (
          <Text style={styles.emptyLine}>
            {user
              ? history.loading
                ? 'Loading…'
                : 'Recordings you watch will appear here.'
              : 'Sign in to build your history.'}
          </Text>
        )}

        {/* Library chips (reference §4 filter chips, wired to real sections) */}
        <Text style={[styles.sectionHeading, styles.libraryHeading]}>Library</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsContent}
        >
          <Pressable style={styles.chip} onPress={() => navigation.navigate('History')} accessibilityRole="button">
            <Text style={styles.chipText}>Recent</Text>
          </Pressable>
          <Pressable style={styles.chip} onPress={() => navigation.navigate('Saved')} accessibilityRole="button">
            <Text style={styles.chipText}>Saved</Text>
          </Pressable>
          <Pressable style={styles.chip} onPress={() => navigation.navigate('Playlists')} accessibilityRole="button">
            <Text style={styles.chipText}>Playlists</Text>
          </Pressable>
        </ScrollView>

        {/* Playlists — stacked rows */}
        <View style={styles.rowsBlock}>
          {playlistPreview.map((summary) => (
            <PlaylistRow key={summary.playlist.id} summary={summary} onPress={openPlaylist} />
          ))}
          {summaries.data.length === 0 ? (
            <Text style={styles.rowsEmpty}>
              {summaries.loading
                ? 'Loading…'
                : user
                  ? 'No playlists yet.'
                  : 'No public playlists yet.'}
            </Text>
          ) : null}
          {user ? (
            <Pressable style={styles.newPlaylistRow} onPress={() => setCreateOpen(true)} accessibilityRole="button">
              <MaterialIcons name="add" size={24} color={lightColors.text} />
              <Text style={styles.newPlaylistText}>New playlist</Text>
            </Pressable>
          ) : null}
          {summaries.data.length > playlistPreview.length ? (
            <Pressable style={styles.viewAllRow} onPress={() => navigation.navigate('Playlists')} accessibilityRole="button">
              <Text style={styles.viewAllText}>View all playlists</Text>
              <MaterialIcons name="chevron-right" size={18} color={lightColors.textSecondary} />
            </Pressable>
          ) : null}
        </View>

        {/* Saved — compact rows */}
        <Pressable
          style={styles.sectionHeadingRow}
          onPress={() => navigation.navigate('Saved')}
          accessibilityRole="button"
        >
          <Text style={styles.sectionHeading}>Saved</Text>
          <MaterialIcons name="chevron-right" size={22} color={lightColors.text} />
        </Pressable>
        <View style={styles.rowsBlock}>
          {savedPreview.map((item) => (
            <VideoListRow
              key={item.entry.video_id}
              video={item.video}
              onPress={(video) => openVideo(video.id)}
            />
          ))}
          {saved.data.length === 0 ? (
            <Text style={styles.rowsEmpty}>
              {user
                ? saved.loading
                  ? 'Loading…'
                  : 'Samagams you save will appear here.'
                : 'Sign in to save samagams here.'}
            </Text>
          ) : null}
        </View>
      </ScrollView>

      <CreatePlaylistSheet visible={createOpen} onCreate={handleCreate} onClose={() => setCreateOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: lightColors.background },
  scrollContent: { paddingBottom: spacing.xxl },
  headerRow: {
    height: layout.headerHeight,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
  },
  accountsPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: lightColors.surfaceVariant,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: 9,
  },
  accountsText: { fontSize: 15, fontWeight: '500', color: lightColors.text },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 22 },
  profileBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  profileAvatar: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: lightColors.surfaceVariant,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileInitial: { fontSize: 34, fontWeight: '600', color: lightColors.textSecondary },
  profileLines: { flex: 1 },
  profileName: { fontSize: 26, fontWeight: '700', color: lightColors.text },
  profileMeta: { fontSize: 14, color: lightColors.textSecondary, marginTop: 3 },
  profileButtons: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.lg,
  },
  pillButton: {
    flex: 1,
    borderRadius: radii.pill,
    paddingVertical: 11,
    alignItems: 'center',
  },
  pillDark: { backgroundColor: lightColors.subscribeBackground },
  pillLight: { backgroundColor: lightColors.surfaceVariant },
  pillText: { fontSize: 15, fontWeight: '600' },
  pillTextDark: { color: lightColors.subscribeText },
  pillTextLight: { color: lightColors.text },
  adminLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.lg,
  },
  adminLinkText: { fontSize: 15, fontWeight: '500', color: lightColors.text },
  signInBlock: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  signInTitle: { fontSize: 20, fontWeight: '600', color: lightColors.text },
  signInText: { fontSize: 14, color: lightColors.textSecondary, marginTop: spacing.xs },
  sectionHeadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    marginTop: spacing.xxl,
  },
  sectionHeading: { fontSize: 20, fontWeight: '600', color: lightColors.text },
  libraryHeading: { paddingHorizontal: spacing.lg, marginTop: spacing.xxl },
  historyContent: { paddingHorizontal: spacing.lg, gap: spacing.md, paddingTop: spacing.md },
  historyCard: { width: HISTORY_CARD_WIDTH },
  historyThumbWrap: { position: 'relative' },
  historyThumb: {
    width: '100%',
    aspectRatio: layout.thumbnailAspectRatio,
    borderRadius: radii.card,
    backgroundColor: lightColors.playerBackground,
  },
  thumbEmpty: { backgroundColor: lightColors.surfaceVariant },
  progressTrack: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.4)',
    borderBottomLeftRadius: radii.card,
    borderBottomRightRadius: radii.card,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', backgroundColor: lightColors.accent },
  historyTitle: {
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '600',
    color: lightColors.text,
    marginTop: spacing.sm,
  },
  chipsContent: { paddingHorizontal: spacing.lg, gap: spacing.sm, paddingTop: spacing.md },
  chip: {
    backgroundColor: lightColors.surfaceVariant,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: 8,
  },
  chipText: { fontSize: 14, fontWeight: '500', color: lightColors.text },
  rowsBlock: { paddingHorizontal: spacing.lg },
  rowsEmpty: { fontSize: 14, color: lightColors.textSecondary, paddingTop: spacing.md },
  newPlaylistRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  newPlaylistText: { fontSize: 15, fontWeight: '500', color: lightColors.text },
  viewAllRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm },
  viewAllText: { fontSize: 14, fontWeight: '500', color: lightColors.textSecondary },
  emptyLine: {
    fontSize: 14,
    color: lightColors.textSecondary,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
});
