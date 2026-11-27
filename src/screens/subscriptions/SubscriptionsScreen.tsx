import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
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
import { GridCard } from '../../components/video/GridCard';
import { SkeletonCard } from '../../components/video/SkeletonCard';
import { apiCardData, formatDateLine } from '../../components/video/cardData';
import { useAuth } from '../../features/auth';
import {
  getChannelInfoCached,
  getLiveCached,
  getUploadsCached,
  uploadsPlaylistIdFor,
  useActiveChannels,
  type AppChannel,
} from '../../features/channels';
import { isShortVideo, type YouTubeVideoMetadata } from '../../lib/youtube';
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
 * Subscriptions — MULTI-CHANNEL since the channels panel (migration
 * 0003): the avatar rail and the feed read from the admin-chosen
 * `channels` table (all ACTIVE channels, in admin order), not from a
 * hard-coded single channel. With exactly one active channel this is
 * precisely the old single-channel screen.
 *
 *  - Rail: one avatar per active channel (ref-2 pattern), with a red
 *    live dot ONLY when YouTube itself reports that channel as live
 *    right now (cached live check, 5 min). Tapping an avatar filters
 *    the feed to that channel; tapping the selected avatar again opens
 *    its Channel page. "All" merges every channel's uploads.
 *  - Feed: each channel's uploads (Shorts filtered OUT — user ban),
 *    de-duplicated and date-ordered; the Live filter shows only what
 *    the API reports as live/upcoming.
 *  - Quota: uploads cached 30 min per channel, live checks cached
 *    5 min and run sequentially (staggered) — see docs/CHANNELS.md.
 * There is NO Shorts shelf (user decision).
 */
export function SubscriptionsScreen({ navigation }: Props) {
  const { user, profile } = useAuth();
  const listRef = useRef<FlatList<YouTubeVideoMetadata>>(null);
  useScrollToTop(listRef);
  const { channels, loading: channelsLoading } = useActiveChannels();
  const { width } = useWindowDimensions();
  const [selected, setSelected] = useState<string | 'all'>('all');
  const [uploadsByChannel, setUploadsByChannel] = useState<Map<string, YouTubeVideoMetadata[]>>(new Map());
  const [liveByChannel, setLiveByChannel] = useState<Map<string, YouTubeVideoMetadata[]>>(new Map());
  const [infoAvatars, setInfoAvatars] = useState<Map<string, string | null>>(new Map());
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

  const channelIdsKey = channels.map((c) => c.youtubeChannelId).join(',');

  // Uploads for every active channel (cached per channel).
  useEffect(() => {
    if (channels.length === 0) return;
    let active = true;
    (async () => {
      try {
        const entries = await Promise.all(
          channels.map(async (c) => {
            const videos = await getUploadsCached(
              c.youtubeChannelId,
              uploadsPlaylistIdFor(c.youtubeChannelId),
            ).catch(() => [] as YouTubeVideoMetadata[]);
            return [c.youtubeChannelId, videos] as const;
          }),
        );
        if (!active) return;
        setUploadsByChannel(new Map(entries));
        setError(null);
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : 'Could not load subscriptions.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelIdsKey, reloadKey]);

  // Live checks — sequential (staggered) so N channels never burst
  // N×200 units at once; each result is cached 5 min.
  useEffect(() => {
    if (channels.length === 0) return;
    let active = true;
    (async () => {
      for (const c of channels) {
        if (!active) return;
        const items = await getLiveCached(c.youtubeChannelId);
        if (!active) return;
        setLiveByChannel((prev) => new Map(prev).set(c.youtubeChannelId, items));
      }
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelIdsKey, reloadKey]);

  // Fill avatars the table snapshot lacks (e.g. the fallback channel)
  // from cached channel metadata (1 unit, 6h cache).
  useEffect(() => {
    let active = true;
    for (const c of channels) {
      if (c.avatarUrl) continue;
      void getChannelInfoCached(c.youtubeChannelId).then((info) => {
        if (active && info) {
          setInfoAvatars((prev) => new Map(prev).set(c.youtubeChannelId, info.avatarUrl));
        }
      });
    }
    return () => {
      active = false;
    };
  }, [channels]);

  const avatarFor = useCallback(
    (channel: AppChannel): string | null => channel.avatarUrl ?? infoAvatars.get(channel.youtubeChannelId) ?? null,
    [infoAvatars],
  );

  const channelById = useMemo(
    () => new Map(channels.map((c) => [c.youtubeChannelId, c])),
    [channels],
  );

  const scopeChannels = useMemo(
    () => (selected === 'all' ? channels : channels.filter((c) => c.youtubeChannelId === selected)),
    [channels, selected],
  );

  const visible = useMemo(() => {
    const byVideoId = new Map<string, YouTubeVideoMetadata>();
    for (const c of scopeChannels) {
      for (const v of uploadsByChannel.get(c.youtubeChannelId) ?? []) {
        if (!byVideoId.has(v.youtubeVideoId)) byVideoId.set(v.youtubeVideoId, v);
      }
      if (filter === 'live') {
        for (const v of liveByChannel.get(c.youtubeChannelId) ?? []) {
          if (!byVideoId.has(v.youtubeVideoId)) byVideoId.set(v.youtubeVideoId, v);
        }
      }
    }
    const clean = [...byVideoId.values()].filter(
      (v) => v.title.trim().length > 0 && !isShortVideo(v),
    );
    const filtered =
      filter === 'all'
        ? clean
        : filter === 'videos'
          ? clean.filter((v) => v.liveBroadcastContent === 'none')
          : clean.filter((v) => v.liveBroadcastContent !== 'none');
    return [...filtered].sort((a, b) =>
      sort === 'latest'
        ? b.publishedAt.localeCompare(a.publishedAt)
        : a.publishedAt.localeCompare(b.publishedAt),
    );
  }, [scopeChannels, uploadsByChannel, liveByChannel, filter, sort]);

  const columns = width >= 1024 ? 4 : width >= 640 ? 3 : 2;

  const renderItem = useCallback(
    ({ item }: { item: YouTubeVideoMetadata }) => {
      const owner = channelById.get(item.channelId);
      const base = apiCardData(item, owner ? avatarFor(owner) : null);
      const data = {
        ...base,
        channelLine: base.channelLine || item.channelTitle || owner?.title || '',
        metaLine: base.metaLine || formatDateLine(item.publishedAt),
      };
      return (
        <GridCard
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
      );
    },
    [channelById, avatarFor, navigation, shareVideo],
  );

  const keyExtractor = useCallback((item: YouTubeVideoMetadata) => item.youtubeVideoId, []);
  const initial = profile?.display_name?.charAt(0)?.toUpperCase() ?? user?.email?.charAt(0)?.toUpperCase() ?? null;
  const selectedChannel = selected === 'all' ? null : (channelById.get(selected) ?? null);
  const isLoading = channelsLoading || loading;

  const header = (
    <View>
      {/* Avatar rail — every active channel from the panel. */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rail}>
        {channels.map((c) => {
          const isLiveNow = (liveByChannel.get(c.youtubeChannelId) ?? []).some(
            (v) => v.liveBroadcastContent === 'live',
          );
          const isSelected = selected === c.youtubeChannelId;
          const avatar = avatarFor(c);
          return (
            <Pressable
              key={c.youtubeChannelId}
              style={styles.railItem}
              onPress={() => {
                if (isSelected) {
                  navigation.navigate('Channel', { channelId: c.youtubeChannelId });
                } else {
                  setSelected(c.youtubeChannelId);
                }
              }}
              accessibilityRole="button"
              accessibilityLabel={isSelected ? `${c.title} — open channel page` : `Show uploads from ${c.title}`}
              accessibilityState={{ selected: isSelected }}
            >
              <View style={[styles.railAvatarWrap, isSelected && styles.railAvatarSelected]}>
                {avatar ? (
                  <Image source={{ uri: avatar }} style={styles.railAvatar} contentFit="cover" cachePolicy="memory-disk" />
                ) : (
                  <View style={[styles.railAvatar, styles.avatarFallback]}>
                    <Text style={styles.avatarInitial}>{c.title.charAt(0)}</Text>
                  </View>
                )}
                {isLiveNow ? <View style={styles.liveDot} /> : null}
              </View>
              <Text style={styles.railName} numberOfLines={1}>
                {c.title}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={styles.headingRow}>
        <Text style={styles.heading}>
          {selectedChannel ? selectedChannel.title : 'Most relevant'}
        </Text>
        {channels.length > 1 && selected !== 'all' ? (
          <Pressable
            onPress={() => setSelected('all')}
            accessibilityRole="button"
            accessibilityLabel="Show all channels"
            style={styles.railAll}
          >
            <Text style={styles.railAllText}>All</Text>
          </Pressable>
        ) : null}
      </View>

      {/* Filter chips + sort (QA 76): real, working controls. */}
      <View style={styles.controlsRow}>
        <View style={styles.chipsRow}>
          {FILTERS.map((f) => {
            const activeChip = filter === f.key;
            return (
              <Pressable
                key={f.key}
                style={[styles.chip, activeChip && styles.chipActive]}
                onPress={() => setFilter(f.key)}
                accessibilityRole="button"
                accessibilityState={{ selected: activeChip }}
              >
                <Text style={[styles.chipText, activeChip && styles.chipTextActive]}>{f.label}</Text>
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
        avatarUrl={profile?.avatar_url ?? null}
        avatarInitial={initial}
      />

      {isLoading ? (
        <View style={[styles.listPad, styles.skeletonRow]}>
          <View style={styles.skeletonCell}>
            <SkeletonCard variant="shelf" />
          </View>
          <View style={styles.skeletonCell}>
            <SkeletonCard variant="shelf" />
          </View>
        </View>
      ) : error ? (
        <EmptyState
          title="Could not load subscriptions"
          message={error}
          actionLabel="Try again"
          onAction={() => {
            setLoading(true);
            setReloadKey((k) => k + 1);
          }}
        />
      ) : channels.length === 0 ? (
        <EmptyState
          title="No channels in the app"
          message="The admin has not activated any channel yet. Channels added in the admin panel will appear here."
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
                filter === 'live'
                  ? 'No live or upcoming broadcasts'
                  : 'Nothing here'
              }
              message={
                filter === 'live'
                  ? 'None of these channels is live right now or has an upcoming broadcast on YouTube.'
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
  railItem: { width: 76, alignItems: 'center' },
  railAvatarWrap: { position: 'relative', borderRadius: nativeApp.avatarRail.avatarSize / 2 + 3, padding: 3 },
  railAvatarSelected: { borderWidth: 2, borderColor: lightColors.text, padding: 1 },
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
    width: '100%',
  },
  railAll: { paddingVertical: 4 },
  railAllText: { fontSize: 15, fontWeight: '600', color: '#065FD4' },
  headingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xl,
    marginBottom: spacing.md,
    gap: spacing.md,
  },
  heading: {
    flex: 1,
    fontSize: 20,
    fontWeight: '600',
    color: lightColors.text,
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
  columnWrapper: { gap: spacing.md },
  skeletonRow: { flexDirection: 'row', gap: spacing.md },
  skeletonCell: { flex: 1 },
});
