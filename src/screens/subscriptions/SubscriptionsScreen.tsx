import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Image } from 'expo-image';
import { MaterialIcons } from '@expo/vector-icons';
import type { CompositeScreenProps } from '@react-navigation/native';
import { useScrollToTop } from '@react-navigation/native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AppHeader } from '../../components/layout/AppHeader';
import { Toast, useToast } from '../../components/common/Toast';
import { shareContent, shareFeedback } from '../../lib/share';
import { EmptyState } from '../../components/common/EmptyState';
import { ShelfCard } from '../../components/video/ShelfCard';
import { SkeletonCard } from '../../components/video/SkeletonCard';
import { apiCardData, formatDateLine } from '../../components/video/cardData';
import { useAuth } from '../../features/auth';
import { useOfficialChannel } from '../../features/channel';
import {
  fetchChannelLiveAndUpcoming,
  fetchChannelUploads,
  isShortVideo,
  type YouTubeVideoMetadata,
} from '../../lib/youtube';
import { FEED_LIST_PERF } from '../../lib/listPerf';
import { layout, lightColors, nativeApp, radii, spacing } from '../../theme';
import type { MainTabParamList, RootStackParamList } from '../../navigation/types';

type Props = CompositeScreenProps<
  BottomTabScreenProps<MainTabParamList, 'Subscriptions'>,
  NativeStackScreenProps<RootStackParamList>
>;

type UploadFilter = 'all' | 'videos' | 'live';
type UploadSort = 'latest' | 'oldest';

const FILTERS: { key: UploadFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'videos', label: 'Videos' },
  { key: 'live', label: 'Live' },
];

/**
 * Subscriptions (reference §2 + QA fixes 72–76): channel avatar rail,
 * a "Most relevant" heading, and the channel's uploads as ONE
 * consistent, responsive grid.
 *
 * QA fixes in this rewrite:
 *  - Shorts are filtered OUT of the uploads with the same heuristic
 *    search uses (isShortVideo) — never showcased (user ban).
 *  - Working filter chips (All / Videos / Live) and a working sort
 *    (Latest / Oldest) — previously neither existed.
 *  - The old carousel + list split produced inconsistent cards (a
 *    first card with no title, missing channel/meta lines) and sliced
 *    the second column off at desktop widths. Now every item is the
 *    same ShelfCard in a 1/2/3-column grid by window width, and card
 *    data falls back to the channel title / publish date so no card
 *    renders blank lines. Items with no title at all (deleted/private
 *    uploads) are dropped rather than shown as ghosts.
 *  - The rail name gets room for two lines instead of one truncated
 *    line. The rail has exactly one entry because this app follows
 *    exactly one channel — real data, honestly shown.
 * There is NO Shorts shelf (user decision).
 */
export function SubscriptionsScreen({ navigation }: Props) {
  const { user, profile } = useAuth();
  const listRef = useRef<FlatList<YouTubeVideoMetadata>>(null);
  useScrollToTop(listRef);
  const channel = useOfficialChannel();
  const { width } = useWindowDimensions();
  const [uploads, setUploads] = useState<YouTubeVideoMetadata[]>([]);
  const [isLiveNow, setIsLiveNow] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<UploadFilter>('all');
  const [sort, setSort] = useState<UploadSort>('latest');
  const [reloadKey, setReloadKey] = useState(0);
  const { toast, showToast } = useToast();

  const shareVideo = useCallback(
    (title: string, youtubeVideoId: string) => {
      void shareContent(title, `https://www.youtube.com/watch?v=${youtubeVideoId}`).then((outcome) => {
        const feedback = shareFeedback(outcome);
        if (feedback) showToast(feedback);
      });
    },
    [showToast],
  );

  useEffect(() => {
    if (!channel?.uploadsPlaylistId || !channel.channelId) return;
    let active = true;
    (async () => {
      try {
        const [page, live] = await Promise.all([
          fetchChannelUploads(channel.uploadsPlaylistId!),
          fetchChannelLiveAndUpcoming(channel.channelId).catch(() => []),
        ]);
        if (!active) return;
        setUploads(page.videos);
        setIsLiveNow(live.some((v) => v.liveBroadcastContent === 'live'));
        setError(null);
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : 'Could not load the channel.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [channel, reloadKey]);

  const visible = useMemo(() => {
    const clean = uploads.filter((v) => v.title.trim().length > 0 && !isShortVideo(v));
    const filtered =
      filter === 'all'
        ? clean
        : filter === 'videos'
          ? clean.filter((v) => v.liveBroadcastContent === 'none')
          : clean.filter((v) => v.liveBroadcastContent !== 'none');
    const sorted = [...filtered].sort((a, b) =>
      sort === 'latest'
        ? b.publishedAt.localeCompare(a.publishedAt)
        : a.publishedAt.localeCompare(b.publishedAt),
    );
    return sorted;
  }, [uploads, filter, sort]);

  const columns = width >= 1024 ? 3 : width >= 640 ? 2 : 1;

  const renderItem = useCallback(
    ({ item }: { item: YouTubeVideoMetadata }) => {
      const base = apiCardData(item, channel?.avatarUrl ?? null);
      const data = {
        ...base,
        channelLine: base.channelLine || (channel?.title ?? ''),
        metaLine: base.metaLine || formatDateLine(item.publishedAt),
      };
      return (
        <View style={columns > 1 ? styles.gridCell : undefined}>
          <ShelfCard
            data={data}
            onPress={() => navigation.navigate('Watch', { youtubeVideoId: item.youtubeVideoId })}
            menuActions={[
              {
                key: 'share',
                label: 'Share',
                icon: 'share',
                onPress: () => shareVideo(item.title, item.youtubeVideoId),
              },
            ]}
          />
        </View>
      );
    },
    [channel, navigation, columns, shareVideo],
  );

  const keyExtractor = useCallback((item: YouTubeVideoMetadata) => item.youtubeVideoId, []);
  const initial = profile?.display_name?.charAt(0)?.toUpperCase() ?? user?.email?.charAt(0)?.toUpperCase() ?? null;

  const header = (
    <View>
      {/* Avatar rail — the one channel this app follows. */}
      <View style={styles.rail}>
        <Pressable
          style={styles.railItem}
          onPress={() => navigation.navigate('Channel', { channelId: channel?.channelId })}
          accessibilityRole="button"
          accessibilityLabel={channel?.title ?? 'Official channel'}
        >
          <View style={styles.railAvatarWrap}>
            {channel?.avatarUrl ? (
              <Image source={{ uri: channel.avatarUrl }} style={styles.railAvatar} contentFit="cover" cachePolicy="memory-disk" />
            ) : (
              <View style={[styles.railAvatar, styles.avatarFallback]}>
                <Text style={styles.avatarInitial}>{channel?.title.charAt(0) ?? 'B'}</Text>
              </View>
            )}
            {isLiveNow ? <View style={styles.liveDot} /> : null}
          </View>
          <Text style={styles.railName} numberOfLines={2}>
            {channel?.title ?? ''}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => navigation.navigate('Channel', { channelId: channel?.channelId })}
          accessibilityRole="button"
          style={styles.railAll}
        >
          <Text style={styles.railAllText}>All</Text>
        </Pressable>
      </View>

      <Text style={styles.heading}>Most relevant</Text>

      {/* Filter chips + sort (QA 76): real, working controls. */}
      <View style={styles.controlsRow}>
        <View style={styles.chipsRow}>
          {FILTERS.map((f) => {
            const active = filter === f.key;
            return (
              <Pressable
                key={f.key}
                style={[styles.chip, active && styles.chipActive]}
                onPress={() => setFilter(f.key)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{f.label}</Text>
              </Pressable>
            );
          })}
        </View>
        <Pressable
          style={styles.sortButton}
          onPress={() => setSort((s) => (s === 'latest' ? 'oldest' : 'latest'))}
          accessibilityRole="button"
          accessibilityLabel={`Sort by date, currently ${sort === 'latest' ? 'latest first' : 'oldest first'}. Tap to change.`}
        >
          <MaterialIcons name="swap-vert" size={18} color={lightColors.text} />
          <Text style={styles.sortText}>{sort === 'latest' ? 'Latest' : 'Oldest'}</Text>
        </Pressable>
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      <AppHeader
        onSearchPress={() => navigation.navigate('Search')}
        onAccountPress={() => navigation.navigate('MainTabs', { screen: 'Library' })}
        avatarInitial={initial}
      />
      {/* QA44: SecondaryTabs removed — it duplicated the bottom nav. */}

      {loading ? (
        <View style={styles.listPad}>
          <SkeletonCard variant="shelf" />
          <SkeletonCard variant="shelf" />
        </View>
      ) : error || !channel ? (
        <EmptyState
          title="Could not load subscriptions"
          message={error ?? 'The official channel could not be loaded.'}
          actionLabel="Try again"
          onAction={() => {
            setLoading(true);
            setReloadKey((k) => k + 1);
          }}
        />
      ) : (

        <FlatList
          ref={listRef}
          key={`cols-${columns}`}
          data={visible}
          numColumns={columns}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          ListHeaderComponent={header}
          contentContainerStyle={styles.listPad}
          columnWrapperStyle={columns > 1 ? styles.columnWrapper : undefined}
          ListEmptyComponent={
            <EmptyState
              title={
                uploads.length === 0
                  ? 'No uploads yet'
                  : filter === 'live'
                    ? 'No live or upcoming broadcasts'
                    : 'Nothing here'
              }
              message={
                uploads.length === 0
                  ? "The channel's uploads will appear here."
                  : filter === 'live'
                    ? 'This channel is not live right now and has no upcoming broadcasts on YouTube.'
                    : 'No uploads match this filter.'

              }
            />
          }
          {...FEED_LIST_PERF}
        />
      )}
      <Toast message={toast} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: lightColors.background },
  // Bottom clearance for the overlay blur bottom bar (UX Fix 3's
  // overlay change): without it the bar covers the last rows.
  listPad: { paddingHorizontal: spacing.lg, paddingBottom: layout.bottomNavHeight + 24 },
  rail: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingTop: spacing.sm,
    gap: spacing.lg,
  },
  railItem: { width: 96, alignItems: 'center' },
  railAvatarWrap: { position: 'relative' },
  railAvatar: {
    width: nativeApp.avatarRail.avatarSize,
    height: nativeApp.avatarRail.avatarSize,
    borderRadius: nativeApp.avatarRail.avatarSize / 2,
  },
  avatarFallback: {
    backgroundColor: lightColors.surfaceVariant,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: { fontSize: 22, fontWeight: '600', color: lightColors.textSecondary },
  liveDot: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: nativeApp.avatarRail.liveDotSize,
    height: nativeApp.avatarRail.liveDotSize,
    borderRadius: nativeApp.avatarRail.liveDotSize / 2,
    backgroundColor: lightColors.accent,
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  railName: {
    fontSize: nativeApp.avatarRail.nameFontSize,
    lineHeight: 15,
    color: lightColors.text,
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  railAll: { marginLeft: 'auto', paddingTop: 22 },
  railAllText: { fontSize: 15, fontWeight: '600', color: '#065FD4' },
  heading: {
    fontSize: 20,
    fontWeight: '600',
    color: lightColors.text,
    marginTop: spacing.xl,
    marginBottom: spacing.md,
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
    gap: spacing.md,
  },
  chipsRow: { flexDirection: 'row', gap: spacing.sm },
  chip: {
    backgroundColor: lightColors.surfaceVariant,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
  },
  chipActive: { backgroundColor: lightColors.text },
  chipText: { fontSize: 14, fontWeight: '500', color: lightColors.text },
  chipTextActive: { color: lightColors.background },
  sortButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 7,
    paddingHorizontal: spacing.sm,
  },
  sortText: { fontSize: 14, fontWeight: '600', color: lightColors.text },
  columnWrapper: { gap: spacing.lg },
  gridCell: { flex: 1 },
});
