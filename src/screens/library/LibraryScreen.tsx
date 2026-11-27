import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Image } from 'expo-image';
import type { CompositeScreenProps } from '@react-navigation/native';
import { useFocusEffect, useScrollToTop } from '@react-navigation/native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { isSupabaseConfigured } from '../../lib/supabase';
import { layout, lightColors, radii, spacing } from '../../theme';
import { ICON_HIT_SLOP } from '../../lib/touch';
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
import { ScreenLoading } from '../../features/library/components/ScreenMessage';
import { listThumbnailUrl } from '../../components/video/cardData';
import { useLocalHistory } from '../../features/library/localHistory';
import { PlaylistRow } from '../../features/library/components/PlaylistRow';
import { VideoListRow } from '../../features/library/components/VideoListRow';
import { H_LIST_PERF } from '../../lib/listPerf';

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
  const scrollRef = React.useRef<React.ElementRef<typeof ScrollView>>(null);
  useScrollToTop(scrollRef);
  const { profile } = useProfile(user?.id ?? null);
  const history = useHistory(user?.id ?? null);
  const saved = useSavedItems(user?.id ?? null);
  const summaries = usePlaylistSummaries(user?.id ?? null);
  // Device-local history for signed-out users (QA 78): the History
  // shelf below shows real on-device entries instead of a bare
  // "sign in" line when the user has watched while signed out.
  const local = useLocalHistory();
  const [createOpen, setCreateOpen] = useState(false);
  const reloadLocal = local.reload;
  useFocusEffect(
    useCallback(() => {
      reloadLocal();
    }, [reloadLocal]),
  );

  const refreshing = history.refreshing || saved.refreshing || summaries.refreshing;
  const onRefresh = useCallback(() => {
    history.refresh();
    saved.refresh();
    summaries.refresh();
    local.reload();
  }, [history, saved, summaries, local]);

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
      const thumbUrl = listThumbnailUrl(item.video.youtube_video_id, item.video.thumbnail_url);
      return (
        <Pressable
          style={styles.historyCard}
          onPress={() => openVideo(item.video.id)}
          accessibilityRole="button"
          accessibilityLabel={item.video.title}
        >
          <View style={styles.historyThumbWrap}>
            {thumbUrl ? (
              <Image
                source={{ uri: thumbUrl }}
                style={styles.historyThumb}
                contentFit="cover"
                cachePolicy="memory-disk"
                recyclingKey={item.video.id}
              />
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
          hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
          accessibilityRole="button"
        >
          <Text style={styles.accountsText}>Account</Text>
          <MaterialIcons name="keyboard-arrow-down" size={20} color={lightColors.text} />
        </Pressable>
        <View style={styles.headerActions}>
          <Pressable onPress={() => navigation.navigate('Search')} hitSlop={ICON_HIT_SLOP} accessibilityLabel="Search" accessibilityRole="button">
            <MaterialIcons name="search" size={24} color={lightColors.text} />
          </Pressable>
          <Pressable onPress={() => navigation.navigate('Settings')} hitSlop={ICON_HIT_SLOP} accessibilityLabel="Settings" accessibilityRole="button">
            <MaterialIcons name="settings" size={24} color={lightColors.text} />
          </Pressable>
        </View>
      </View>

      <ScrollView
        ref={scrollRef}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={styles.scrollContent}
      >
        {!isSupabaseConfigured ? (
          <Text style={styles.emptyLine}>
            The backend is not configured in this build, so your library cannot be loaded.
          </Text>
        ) : authLoading ? (
          <ScreenLoading label="Loading your library…" />
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
            <Pressable
              style={styles.channelRow}
              onPress={() => navigation.navigate('Channel', {})}
              accessibilityRole="button"
            >
              <MaterialIcons name="play-circle-outline" size={22} color={lightColors.text} />
              <Text style={styles.channelRowText}>Official channel</Text>
              <MaterialIcons name="chevron-right" size={20} color={lightColors.textSecondary} />
            </Pressable>
            {profile?.role === 'admin' ? (
              <Pressable
                style={styles.adminLink}
                onPress={() => navigation.navigate('Admin', { screen: 'AdminOverview' })}
                hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
                accessibilityRole="button"
              >
                <MaterialIcons name="dashboard" size={18} color={lightColors.text} />
                <Text style={styles.adminLinkText}>Admin dashboard</Text>
              </Pressable>
            ) : null}
          </>
        ) : (
          <View style={styles.signInBlock}>
            <View style={styles.signInAvatar}>
              <MaterialIcons name="person" size={40} color={lightColors.textSecondary} />
            </View>
            <Text style={styles.signInTitle}>Sign in to see your library</Text>
            <Text style={styles.signInText}>
              Your history, saved samagams and playlists are kept with your account.
            </Text>
            {/* This block used to be text-only: a signed-out user landed
                here and had NO way to sign in from this screen. */}
            <View style={styles.profileButtonsAlt}>
              <Pressable
                style={[styles.pillButton, styles.pillDark]}
                onPress={() => navigation.navigate('SignIn')}
                accessibilityRole="button"
              >
                <Text style={[styles.pillText, styles.pillTextDark]}>Sign in</Text>
              </Pressable>
              <Pressable
                style={[styles.pillButton, styles.pillLight]}
                onPress={() => navigation.navigate('SignUp')}
                accessibilityRole="button"
              >
                <Text style={[styles.pillText, styles.pillTextLight]}>Create account</Text>
              </Pressable>
            </View>
          </View>
        )}

        {/* Load failures used to be silently shown as empty sections
            ("No playlists yet" when the fetch had actually failed).
            Surface one honest banner with a retry instead. */}
        {user && (history.error || saved.error || summaries.error) ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorBannerText}>
              Some of your library could not be loaded. Check your connection and try again.
            </Text>
            <Pressable onPress={onRefresh} accessibilityRole="button" hitSlop={8}>
              <Text style={styles.errorBannerAction}>Retry</Text>
            </Pressable>
          </View>
        ) : null}

        {/* History shelf */}
        <Pressable
          style={styles.sectionHeadingRow}
          onPress={() => navigation.navigate('History')}
          hitSlop={{ top: 8, bottom: 8, left: 0, right: 0 }}
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
            {...H_LIST_PERF}
          />
        ) : user && history.loading ? (
          <View style={[styles.sectionLoading, styles.sectionLoadingPadded]}>
            <ActivityIndicator size="small" color={lightColors.textSecondary} />
            <Text style={styles.sectionLoadingText}>Loading…</Text>
          </View>
        ) : !user && local.entries.length > 0 ? (
          <>
            <FlatList
              horizontal
              data={local.entries.slice(0, 10)}
              keyExtractor={(item) => item.youtubeVideoId}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.historyContent}
              {...H_LIST_PERF}
              renderItem={({ item }) => (
                <Pressable
                  style={styles.historyCard}
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
                  <View style={styles.historyThumbWrap}>
                    {item.thumbnailUrl ? (
                      <Image source={{ uri: item.thumbnailUrl }} style={styles.historyThumb} resizeMode="cover" />
                    ) : (
                      <View style={[styles.historyThumb, styles.thumbEmpty]} />
                    )}
                  </View>
                  <Text style={styles.historyTitle} numberOfLines={2}>
                    {item.title}
                  </Text>
                </Pressable>
              )}
            />
            <Text style={styles.emptyLine}>Watched on this device while signed out.</Text>
          </>
        ) : (
          <Text style={styles.emptyLine}>
            {user
              ? history.error
                ? 'History could not be loaded — use Retry above.'
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
          <Pressable style={styles.chip} onPress={() => navigation.navigate('History')} hitSlop={{ top: 4, bottom: 4, left: 2, right: 2 }} accessibilityRole="button">
            <MaterialIcons name="history" size={16} color={lightColors.text} />
            <Text style={styles.chipText}>Recent</Text>
          </Pressable>
          <Pressable style={styles.chip} onPress={() => navigation.navigate('Saved')} hitSlop={{ top: 4, bottom: 4, left: 2, right: 2 }} accessibilityRole="button">
            <MaterialIcons name="bookmark-border" size={16} color={lightColors.text} />
            <Text style={styles.chipText}>Saved</Text>
          </Pressable>
          <Pressable style={styles.chip} onPress={() => navigation.navigate('Playlists')} hitSlop={{ top: 4, bottom: 4, left: 2, right: 2 }} accessibilityRole="button">
            <MaterialIcons name="playlist-play" size={16} color={lightColors.text} />
            <Text style={styles.chipText}>Playlists</Text>
          </Pressable>
        </ScrollView>

        {/* Samagam Sessions were only reachable from a Home banner;
            the You/Library tab is the other natural home for them. */}
        <Pressable
          style={styles.sessionsRow}
          onPress={() => navigation.navigate('Sessions')}
          accessibilityRole="button"
        >
          <MaterialIcons name="groups" size={24} color={lightColors.text} />
          <View style={styles.sessionsLines}>
            <Text style={styles.sessionsTitle}>Samagam Sessions</Text>
            <Text style={styles.sessionsMeta}>Scheduled group playbacks — upcoming, now playing, completed</Text>
          </View>
          <MaterialIcons name="chevron-right" size={22} color={lightColors.textSecondary} />
        </Pressable>

        {/* Playlists — stacked rows */}
        <View style={styles.rowsBlock}>
          {playlistPreview.map((summary) => (
            <PlaylistRow key={summary.playlist.id} summary={summary} onPress={openPlaylist} />
          ))}
          {summaries.data.length === 0 ? (
            summaries.loading ? (
              <View style={styles.sectionLoading}>
                <ActivityIndicator size="small" color={lightColors.textSecondary} />
                <Text style={styles.sectionLoadingText}>Loading…</Text>
              </View>
            ) : (
              <Text style={styles.rowsEmpty}>
                {summaries.error
                  ? 'Playlists could not be loaded — use Retry above.'
                  : user
                    ? 'No playlists yet.'
                    : 'No public playlists yet.'}
              </Text>
            )
          ) : null}
          {user ? (
            <Pressable style={styles.newPlaylistRow} onPress={() => setCreateOpen(true)} accessibilityRole="button">
              <MaterialIcons name="add" size={24} color={lightColors.text} />
              <Text style={styles.newPlaylistText}>New playlist</Text>
            </Pressable>
          ) : null}
          {summaries.data.length > playlistPreview.length ? (
            <Pressable style={styles.viewAllRow} onPress={() => navigation.navigate('Playlists')} hitSlop={{ top: 4, bottom: 4, left: 0, right: 0 }} accessibilityRole="button">
              <Text style={styles.viewAllText}>View all playlists</Text>
              <MaterialIcons name="chevron-right" size={18} color={lightColors.textSecondary} />
            </Pressable>
          ) : null}
        </View>

        {/* Saved — compact rows */}
        <Pressable
          style={styles.sectionHeadingRow}
          onPress={() => navigation.navigate('Saved')}
          hitSlop={{ top: 8, bottom: 8, left: 0, right: 0 }}
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
            user && saved.loading ? (
              <View style={styles.sectionLoading}>
                <ActivityIndicator size="small" color={lightColors.textSecondary} />
                <Text style={styles.sectionLoadingText}>Loading…</Text>
              </View>
            ) : (
              <Text style={styles.rowsEmpty}>
                {user
                  ? saved.error
                    ? 'Saved recordings could not be loaded — use Retry above.'
                    : 'Samagams you save will appear here.'
                  : 'Sign in to save samagams here.'}
              </Text>
            )
          ) : null}
        </View>
      </ScrollView>

      <CreatePlaylistSheet visible={createOpen} onCreate={handleCreate} onClose={() => setCreateOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: lightColors.background },
  // Bottom clearance for the overlay blur bottom bar (was 32 —
  // the 56dp overlay bar would cover the last library rows).
  scrollContent: { paddingBottom: layout.bottomNavHeight + 24 },
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
  profileButtonsAlt: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    backgroundColor: lightColors.surfaceVariant,
    borderRadius: radii.card,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  errorBannerText: { flex: 1, fontSize: 13, color: lightColors.textSecondary },
  errorBannerAction: { fontSize: 14, fontWeight: '700', color: lightColors.text },
  signInBlock: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  signInTitle: { fontSize: 20, fontWeight: '600', color: lightColors.text },
  signInText: { fontSize: 14, color: lightColors.textSecondary, marginTop: spacing.xs },
  signInButton: {
    alignSelf: 'flex-start',
    marginTop: spacing.lg,
    backgroundColor: lightColors.subscribeBackground,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.xl,
    minHeight: 44,
    justifyContent: 'center',
  },
  signInButtonText: { fontSize: 15, fontWeight: '600', color: lightColors.subscribeText },
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
  sessionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.xl,
  },
  sessionsLines: { flex: 1 },
  sessionsTitle: { fontSize: 16, fontWeight: '600', color: lightColors.text },
  sessionsMeta: { fontSize: 13, color: lightColors.textSecondary, marginTop: 2 },
  chipsContent: { paddingHorizontal: spacing.lg, gap: spacing.sm, paddingTop: spacing.md },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: lightColors.surfaceVariant,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: 8,
  },
  signInAvatar: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: lightColors.surfaceVariant,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  channelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.lg,
  },
  channelRowText: { flex: 1, fontSize: 15, fontWeight: '500', color: lightColors.text },
  chipText: { fontSize: 14, fontWeight: '500', color: lightColors.text },
  rowsBlock: { paddingHorizontal: spacing.lg },
  sectionLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingTop: spacing.md,
  },
  sectionLoadingPadded: { paddingHorizontal: spacing.lg },
  sectionLoadingText: { fontSize: 14, color: lightColors.textSecondary },
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
