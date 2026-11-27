import React, { useCallback, useMemo, useState } from 'react';
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
import { layout, radii, spacing, useTheme, type ThemeColors } from '../../theme';
import { ICON_HIT_SLOP } from '../../lib/touch';
import type { MainTabParamList } from '../../navigation/types';
import {
  useHistory,
  usePlaylistSummaries,
  useSavedItems,
} from '../../features/library/hooks';
import { useAuth } from '../../features/auth';
import { createPlaylist, removeHistoryEntry } from '../../features/library/libraryService';
import { OFFICIAL_CHANNEL_HANDLE } from '../../lib/youtube';
import { resumeRatio } from '../../features/library/format';
import type { HistoryItem, PlaylistSummary } from '../../features/library/types';
import type { LibraryRootStackParamList } from '../../features/library/screenTypes';
import { CreatePlaylistSheet } from '../../features/library/components/CreatePlaylistSheet';
import { listThumbnailUrl } from '../../components/video/cardData';
import { SkeletonCard } from '../../components/video/SkeletonCard';
import { UserAvatar } from '../../components/common/UserAvatar';
import { removeLocalHistoryEntry, useLocalHistory } from '../../features/library/localHistory';
import { PlaylistRow } from '../../features/library/components/PlaylistRow';
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
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  // ONE source of truth for identity: AuthContext. This screen used
  // to keep TWO private copies — useCurrentUser for the user and a
  // one-shot useProfile fetch for the profile — and the profile copy
  // was never refreshed, so after Edit Profile saved a new name the
  // Account page (AuthContext) showed the new name while this header
  // kept showing the old one ("Mamm") for the whole session. The
  // profile now comes from the same live context as Account,
  // Settings and the headers, and the focus effect below re-pulls
  // it via refreshProfile() as a belt-and-braces.
  const { user, profile, loading: authLoading, refreshProfile } = useAuth();
  const scrollRef = React.useRef<React.ElementRef<typeof ScrollView>>(null);
  useScrollToTop(scrollRef);
  const history = useHistory(user?.id ?? null);
  const saved = useSavedItems(user?.id ?? null);
  const summaries = usePlaylistSummaries(user?.id ?? null);
  // Device-local history for signed-out users (QA 78): the History
  // shelf below shows real on-device entries instead of a bare
  // "sign in" line when the user has watched while signed out.
  const local = useLocalHistory();
  const [createOpen, setCreateOpen] = useState(false);
  const reloadLocal = local.reload;
  const reloadHistory = history.reload;
  const reloadSaved = saved.reload;
  const reloadSummaries = summaries.reload;
  // Phase 11 (user order): the Library tab stays mounted, so without
  // this its History shelf / Saved count / playlist rows went stale
  // until pull-to-refresh or an app reload — watch a recording, come
  // back here, and it must already be listed. Silent refresh: every
  // section below renders its existing data while a reload is in
  // flight (skeletons only appear when a section has no data yet),
  // so refocusing never flashes placeholders.
  useFocusEffect(
    useCallback(() => {
      reloadLocal();
      reloadHistory();
      reloadSaved();
      reloadSummaries();
      // Re-pull the profile row too: an Edit Profile save in this
      // session must show here the moment the user returns to this
      // tab, even if the context update was somehow missed.
      void refreshProfile();
    }, [reloadLocal, reloadHistory, reloadSaved, reloadSummaries, refreshProfile]),
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

  const removeFromShelf = useCallback(
    (item: HistoryItem) => {
      if (!user) return;
      history.setData(history.data.filter((h) => h.entry.video_id !== item.entry.video_id));
      void removeHistoryEntry(user.id, item.entry.video_id).catch(() => history.reload());
    },
    [history, user],
  );

  const renderHistoryCard = useCallback(
    ({ item }: { item: HistoryItem }) => {
      const ratio = resumeRatio(item.entry.last_position_seconds, item.video.duration_seconds);
      const thumbUrl = listThumbnailUrl(item.video.youtube_video_id, item.video.thumbnail_url);
      return (
        <View style={styles.historyCard}>
          <Pressable
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
          </Pressable>
          <View style={styles.historyTitleRow}>
            <Text style={styles.historyTitle} numberOfLines={2}>
              {item.video.title}
            </Text>
            <Pressable
              onPress={() => removeFromShelf(item)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Remove from history"
              style={styles.historyMore}
            >
              <MaterialIcons name="more-horiz" size={20} color={colors.text} />
            </Pressable>
          </View>
          <Text style={styles.historyChannel} numberOfLines={1}>
            {OFFICIAL_CHANNEL_HANDLE}
          </Text>
        </View>
      );
    },
    [openVideo, removeFromShelf, colors, styles],
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
          <MaterialIcons name="keyboard-arrow-down" size={20} color={colors.text} />
        </Pressable>
        <View style={styles.headerActions}>
          <Pressable onPress={() => navigation.navigate('Search')} hitSlop={ICON_HIT_SLOP} accessibilityLabel="Search" accessibilityRole="button">
            <MaterialIcons name="search" size={24} color={colors.text} />
          </Pressable>
          <Pressable onPress={() => navigation.navigate('Settings')} hitSlop={ICON_HIT_SLOP} accessibilityLabel="Settings" accessibilityRole="button">
            <MaterialIcons name="settings" size={24} color={colors.text} />
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
          // P9/W4: first load shows geometry-matched skeletons (the
          // profile block + list rows) instead of a lone spinner, so
          // the page doesn't jump when real content lands. Per-section
          // small spinners below are unchanged.
          <View accessibilityLabel="Loading your library">
            <View style={styles.profileBlock}>
              <View style={styles.profileAvatar} />
              <View style={styles.profileLines}>
                <View style={styles.skeletonLineWide} />
                <View style={styles.skeletonLineNarrow} />
              </View>
            </View>
            <View style={styles.skeletonRows}>
              <SkeletonCard variant="row" />
              <SkeletonCard variant="row" />
              <SkeletonCard variant="row" />
            </View>
          </View>
        ) : user ? (
          <>
            <View style={styles.profileBlock}>
              <UserAvatar avatarUrl={profile?.avatar_url ?? null} initial={initial} size={72} initialFontSize={28} />
              <View style={styles.profileLines}>
                <Text style={styles.profileName} numberOfLines={1}>
                  {displayName ?? 'Sangat member'}
                </Text>
                <Text style={styles.profileMeta} numberOfLines={1}>
                  {user.email ?? ''}
                </Text>
              </View>
            </View>
            {/* Phase 11 (user order): NO "View channel" pill here.
                Users have no channel of their own in this app, and
                the old pill opened the OFFICIAL BGSJ channel from the
                user's own profile — wrong destination, removed. The
                official channel stays reachable via the bottom-nav
                centre slot and Settings → Official channel. */}
            <View style={styles.profileButtons}>
              <Pressable
                style={[styles.pillButton, styles.pillLight]}
                onPress={() => navigation.navigate('Sessions')}
                accessibilityRole="button"
              >
                <Text style={[styles.pillText, styles.pillTextLight]}>Samagam Sessions</Text>
              </Pressable>
            </View>
            {profile?.role === 'admin' ? (
              <Pressable
                style={styles.adminLink}
                onPress={() => navigation.navigate('Admin', { screen: 'AdminOverview' })}
                hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
                accessibilityRole="button"
              >
                <MaterialIcons name="dashboard" size={18} color={colors.text} />
                <Text style={styles.adminLinkText}>Admin dashboard</Text>
              </Pressable>
            ) : null}
          </>
        ) : (
          <View style={styles.signInBlock}>
            <View style={styles.signInRow}>
              <View style={styles.signInAvatar}>
                <MaterialIcons name="person" size={32} color={colors.textSecondary} />
              </View>
              <View style={styles.signInLines}>
                <Text style={styles.signInTitle}>Sign in to see your library</Text>
                <Text style={styles.signInText}>
                  Your history, saved samagams and playlists are kept with your account.
                </Text>
              </View>
            </View>
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
          <MaterialIcons name="chevron-right" size={22} color={colors.text} />
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
            <ActivityIndicator size="small" color={colors.textSecondary} />
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
                <View style={styles.historyCard}>
                  <Pressable
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
                  </Pressable>
                  <View style={styles.historyTitleRow}>
                    <Text style={styles.historyTitle} numberOfLines={2}>
                      {item.title}
                    </Text>
                    <Pressable
                      onPress={() => {
                        void removeLocalHistoryEntry(item.youtubeVideoId)
                          .catch(() => undefined)
                          .finally(() => local.reload());
                      }}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel="Remove from device history"
                      style={styles.historyMore}
                    >
                      <MaterialIcons name="more-horiz" size={20} color={colors.text} />
                    </Pressable>
                  </View>
                  <Text style={styles.historyChannel} numberOfLines={1}>
                    {OFFICIAL_CHANNEL_HANDLE}
                  </Text>
                </View>
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
            <Text style={styles.chipText}>Recent</Text>
            <MaterialIcons name="keyboard-arrow-down" size={18} color={colors.text} />
          </Pressable>
          <Pressable style={styles.chip} onPress={() => navigation.navigate('Saved')} hitSlop={{ top: 4, bottom: 4, left: 2, right: 2 }} accessibilityRole="button">
            <Text style={styles.chipText}>Saved</Text>
          </Pressable>
          <Pressable style={styles.chip} onPress={() => navigation.navigate('Playlists')} hitSlop={{ top: 4, bottom: 4, left: 2, right: 2 }} accessibilityRole="button">
            <Text style={styles.chipText}>Playlists</Text>
          </Pressable>
        </ScrollView>

        {/* Playlists — stacked rows */}
        <View style={styles.rowsBlock}>
          {playlistPreview.map((summary) => (
            <PlaylistRow key={summary.playlist.id} summary={summary} onPress={openPlaylist} />
          ))}
          {summaries.data.length === 0 ? (
            summaries.loading ? (
              <View style={styles.sectionLoading}>
                <ActivityIndicator size="small" color={colors.textSecondary} />
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
              <MaterialIcons name="add" size={24} color={colors.text} />
              <Text style={styles.newPlaylistText}>New playlist</Text>
            </Pressable>
          ) : null}
          {summaries.data.length > playlistPreview.length ? (
            <Pressable style={styles.viewAllRow} onPress={() => navigation.navigate('Playlists')} hitSlop={{ top: 4, bottom: 4, left: 0, right: 0 }} accessibilityRole="button">
              <Text style={styles.viewAllText}>View all playlists</Text>
              <MaterialIcons name="chevron-right" size={18} color={colors.textSecondary} />
            </Pressable>
          ) : null}
        </View>

        {/* Collection rows (ref-4 geometry: left thumbnail, title +
            privacy/count line). Only REAL collections exist here:
            Saved (saved_videos) and Samagam Sessions. The reference's
            Liked/Downloads/Watch later rows have no backend in this
            app and are not imitated. */}
        <View style={styles.rowsBlock}>
          <Pressable
            style={styles.collectionRow}
            onPress={() => navigation.navigate('Saved')}
            accessibilityRole="button"
          >
            <View style={styles.collectionThumbWrap}>
              <View style={styles.stackEdge} pointerEvents="none" />
              {savedPreview[0] ? (
                <Image
                  source={{
                    uri:
                      listThumbnailUrl(
                        savedPreview[0].video.youtube_video_id,
                        savedPreview[0].video.thumbnail_url,
                      ) ?? undefined,
                  }}
                  style={styles.collectionThumb}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                />
              ) : (
                <View style={[styles.collectionThumb, styles.thumbEmptyCenter]}>
                  <MaterialIcons name="bookmark-border" size={30} color={colors.textSecondary} />
                </View>
              )}
            </View>
            <View style={styles.collectionLines}>
              <Text style={styles.collectionTitle} numberOfLines={2}>
                Saved
              </Text>
              <Text style={styles.collectionMeta} numberOfLines={1}>
                {user
                  ? saved.error
                    ? 'Could not be loaded — use Retry above'
                    : `Private · ${saved.data.length} ${saved.data.length === 1 ? 'recording' : 'recordings'}`
                  : 'Sign in to save samagams here'}
              </Text>
            </View>
          </Pressable>

          <Pressable
            style={styles.collectionRow}
            onPress={() => navigation.navigate('Sessions')}
            accessibilityRole="button"
          >
            <View style={styles.collectionThumbWrap}>
              <View style={styles.stackEdge} pointerEvents="none" />
              <View style={[styles.collectionThumb, styles.thumbEmptyCenter]}>
                <MaterialIcons name="groups" size={30} color={colors.textSecondary} />
              </View>
            </View>
            <View style={styles.collectionLines}>
              <Text style={styles.collectionTitle} numberOfLines={2}>
                Samagam Sessions
              </Text>
              <Text style={styles.collectionMeta} numberOfLines={1}>
                Group playbacks — upcoming, now playing, completed
              </Text>
            </View>
          </Pressable>
        </View>

      </ScrollView>

      <CreatePlaylistSheet visible={createOpen} onCreate={handleCreate} onClose={() => setCreateOpen(false)} />
    </View>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
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
    backgroundColor: colors.surfaceVariant,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: 9,
  },
  accountsText: { fontSize: 15, fontWeight: '500', color: colors.text },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 22 },
  profileBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  profileAvatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.surfaceVariant,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileInitial: { fontSize: 28, fontWeight: '600', color: colors.textSecondary },
  profileLines: { flex: 1 },
  skeletonLineWide: {
    height: 20,
    width: '62%',
    borderRadius: 4,
    backgroundColor: colors.surfaceVariant,
  },
  skeletonLineNarrow: {
    height: 14,
    width: '44%',
    borderRadius: 4,
    backgroundColor: colors.surfaceVariant,
    marginTop: spacing.sm,
  },
  skeletonRows: { paddingHorizontal: spacing.lg, paddingTop: spacing.xl, gap: spacing.md },
  profileName: { fontSize: 24, fontWeight: '600', color: colors.text },
  profileMeta: { fontSize: 14, color: colors.textSecondary, marginTop: 3 },
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
  pillDark: { backgroundColor: colors.subscribeBackground },
  pillLight: { backgroundColor: colors.surfaceVariant },
  pillText: { fontSize: 15, fontWeight: '600' },
  pillTextDark: { color: colors.subscribeText },
  pillTextLight: { color: colors.text },
  adminLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.lg,
  },
  adminLinkText: { fontSize: 15, fontWeight: '500', color: colors.text },
  profileButtonsAlt: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    backgroundColor: colors.surfaceVariant,
    borderRadius: radii.card,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  errorBannerText: { flex: 1, fontSize: 13, color: colors.textSecondary },
  errorBannerAction: { fontSize: 14, fontWeight: '700', color: colors.text },
  signInBlock: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  signInTitle: { fontSize: 17, fontWeight: '600', color: colors.text },
  signInText: { fontSize: 13, lineHeight: 18, color: colors.textSecondary, marginTop: 3 },
  signInButton: {
    alignSelf: 'flex-start',
    marginTop: spacing.lg,
    backgroundColor: colors.subscribeBackground,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.xl,
    minHeight: 44,
    justifyContent: 'center',
  },
  signInButtonText: { fontSize: 15, fontWeight: '600', color: colors.subscribeText },
  sectionHeadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    marginTop: spacing.xxl,
  },
  sectionHeading: { fontSize: 20, fontWeight: '600', color: colors.text },
  libraryHeading: { paddingHorizontal: spacing.lg, marginTop: spacing.xxl },
  historyContent: { paddingHorizontal: spacing.lg, gap: spacing.md, paddingTop: spacing.md },
  historyCard: { width: HISTORY_CARD_WIDTH },
  historyThumbWrap: { position: 'relative' },
  historyThumb: {
    width: '100%',
    aspectRatio: layout.thumbnailAspectRatio,
    borderRadius: radii.card,
    backgroundColor: colors.playerBackground,
  },
  thumbEmpty: { backgroundColor: colors.surfaceVariant },
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
  progressFill: { height: '100%', backgroundColor: colors.accent },
  historyTitleRow: { flexDirection: 'row', alignItems: 'flex-start', marginTop: spacing.sm },
  historyTitle: {
    flex: 1,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '600',
    color: colors.text,
  },
  historyMore: { marginLeft: spacing.xs, marginTop: 1 },
  historyChannel: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  collectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingVertical: spacing.sm,
  },
  collectionThumbWrap: { width: '40%', maxWidth: 168, position: 'relative', paddingTop: 6 },
  collectionThumb: {
    width: '100%',
    aspectRatio: layout.thumbnailAspectRatio,
    borderRadius: radii.card,
    backgroundColor: colors.surfaceVariant,
  },
  thumbEmptyCenter: { alignItems: 'center', justifyContent: 'center' },
  stackEdge: {
    position: 'absolute',
    top: 0,
    left: 6,
    right: 6,
    height: 10,
    borderTopLeftRadius: radii.card,
    borderTopRightRadius: radii.card,
    backgroundColor: colors.border,
  },
  collectionLines: { flex: 1 },
  collectionTitle: { fontSize: 17, fontWeight: '500', color: colors.text },
  collectionMeta: { fontSize: 13, color: colors.textSecondary, marginTop: 3 },
  chipsContent: { paddingHorizontal: spacing.lg, gap: spacing.sm, paddingTop: spacing.md },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: colors.surfaceVariant,
    borderRadius: 10,
    paddingHorizontal: spacing.md + 2,
    paddingVertical: 8,
  },
  signInRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  signInLines: { flex: 1 },
  signInAvatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.surfaceVariant,
    alignItems: 'center',
    justifyContent: 'center',
  },
  channelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.lg,
  },
  channelRowText: { flex: 1, fontSize: 15, fontWeight: '500', color: colors.text },
  chipText: { fontSize: 14, fontWeight: '500', color: colors.text },
  rowsBlock: { paddingHorizontal: spacing.lg },
  sectionLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingTop: spacing.md,
  },
  sectionLoadingPadded: { paddingHorizontal: spacing.lg },
  sectionLoadingText: { fontSize: 14, color: colors.textSecondary },
  rowsEmpty: { fontSize: 14, color: colors.textSecondary, paddingTop: spacing.md },
  newPlaylistRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  newPlaylistText: { fontSize: 15, fontWeight: '500', color: colors.text },
  viewAllRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm },
  viewAllText: { fontSize: 14, fontWeight: '500', color: colors.textSecondary },
  emptyLine: {
    fontSize: 14,
    color: colors.textSecondary,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
});
