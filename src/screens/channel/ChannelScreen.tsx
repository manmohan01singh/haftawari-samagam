import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Modal,
  Pressable,
  Share,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { MaterialIcons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { EmptyState } from '../../components/common/EmptyState';
import { goBackOrTab } from '../../navigation/safeBack';
import { StackTabBar } from '../../components/layout/StackTabBar';
import { ShelfCard } from '../../components/video/ShelfCard';
import { SkeletonCard } from '../../components/video/SkeletonCard';
import { useOfficialChannel } from '../../features/channel';
import { formatCount } from '../../lib/format';
import {
  OFFICIAL_CHANNEL_ID,
  fetchChannelById,
  fetchChannelLiveAndUpcoming,
  fetchChannelUploads,
  isShortVideo,
  type YouTubeChannelInfo,
  type YouTubeVideoMetadata,
} from '../../lib/youtube';
import { apiCardData as baseApiCardData, formatDateLine } from '../../components/video/cardData';
import { lightColors, spacing } from '../../theme';
import type { RootStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Channel'>;

type ChannelTab = 'videos' | 'live';

/**
 * Channel screen — all data live from the YouTube Data API: banner,
 * avatar, name, handle, subscriber/video counts, description, and the
 * uploads list (paginated). Tabs are Videos and Live ONLY — there is
 * no Shorts tab (user decision, 26 Nov 2026, overriding the reference).
 * The Live tab lists the channel's own broadcasts that YouTube itself
 * reports as live now or upcoming; it is not a Samagam session label.
 */
export function ChannelScreen({ route, navigation }: Props) {
  const channelId = route.params.channelId ?? OFFICIAL_CHANNEL_ID;
  const isOfficial = channelId === OFFICIAL_CHANNEL_ID;
  const official = useOfficialChannel();
  const [fetchedChannel, setFetchedChannel] = useState<YouTubeChannelInfo | null>(null);
  // The official channel's data comes from the shared cached hook; any
  // other channel is fetched by id into fetchedChannel.
  const channel = fetchedChannel ?? (isOfficial ? official : null);
  const [tab, setTab] = useState<ChannelTab>(route.params.tab ?? 'videos');
  const [menuOpen, setMenuOpen] = useState(false);
  const { width } = useWindowDimensions();
  const columns = width >= 1024 ? 3 : width >= 640 ? 2 : 1;
  const [uploads, setUploads] = useState<YouTubeVideoMetadata[]>([]);
  const [nextPage, setNextPage] = useState<string | null>(null);
  const [liveItems, setLiveItems] = useState<YouTubeVideoMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [liveLoaded, setLiveLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [descExpanded, setDescExpanded] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const info = isOfficial && official ? official : await fetchChannelById(channelId);
        if (!active) return;
        if (!info) throw new Error('Channel not found.');
        setFetchedChannel(info);
        if (info.uploadsPlaylistId) {
          const page = await fetchChannelUploads(info.uploadsPlaylistId);
          if (!active) return;
          setUploads(page.videos);
          setNextPage(page.nextPageToken);
        }
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : 'Could not load this channel.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [channelId, isOfficial, official]);

  useEffect(() => {
    if (tab !== 'live' || liveLoaded) return;
    let active = true;
    fetchChannelLiveAndUpcoming(channelId)
      .then((items) => {
        if (active) {
          setLiveItems(items);
          setLiveLoaded(true);
        }
      })
      .catch(() => {
        if (active) setLiveLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [tab, liveLoaded, channelId]);

  const loadMore = useCallback(() => {
    if (!channel?.uploadsPlaylistId || !nextPage || loadingMore) return;
    setLoadingMore(true);
    fetchChannelUploads(channel.uploadsPlaylistId, nextPage)
      .then((page) => {
        setUploads((prev) => [...prev, ...page.videos]);
        setNextPage(page.nextPageToken);
      })
      .catch(() => undefined)
      .finally(() => setLoadingMore(false));
  }, [channel, nextPage, loadingMore]);

  const renderVideo = useCallback(
    ({ item }: { item: YouTubeVideoMetadata }) => {
      const base = baseApiCardData(item, channel?.avatarUrl ?? null);
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
          />
        </View>
      );
    },
    [channel, navigation, columns],
  );

  const keyExtractor = useCallback((item: YouTubeVideoMetadata) => item.youtubeVideoId, []);

  const header = channel ? (
    <View>
      <View style={styles.topBar}>
        <Pressable onPress={() => goBackOrTab(navigation, 'Home')} hitSlop={10} accessibilityLabel="Back">
          <MaterialIcons name="arrow-back" size={24} color={lightColors.text} />
        </Pressable>
        <Text style={styles.topBarTitle} numberOfLines={1}>
          {channel.title}
        </Text>
        <Pressable onPress={() => navigation.navigate('Search')} hitSlop={10} accessibilityLabel="Search">
          <MaterialIcons name="search" size={24} color={lightColors.text} />
        </Pressable>
        <Pressable onPress={() => setMenuOpen(true)} hitSlop={10} accessibilityLabel="Channel options">
          <MaterialIcons name="more-vert" size={24} color={lightColors.text} />
        </Pressable>
      </View>
      {channel.bannerUrl ? (
        <Image
          source={{ uri: channel.bannerUrl }}
          style={styles.banner}
          contentFit="cover"
          cachePolicy="memory-disk"
        />
      ) : null}
      <View style={styles.identity}>
        {channel.avatarUrl ? (
          <Image source={{ uri: channel.avatarUrl }} style={styles.avatar} contentFit="cover" cachePolicy="memory-disk" />
        ) : (
          <View style={[styles.avatar, styles.avatarFallback]}>
            <Text style={styles.avatarInitial}>{channel.title.charAt(0)}</Text>
          </View>
        )}
        <Text style={styles.name}>{channel.title}</Text>
        <Text style={styles.metaLine}>
          {channel.handle ?? ''}
          {channel.subscriberCount != null ? `  •  ${formatCount(channel.subscriberCount)} subscribers` : ''}
          {channel.videoCount != null ? `  •  ${formatCount(channel.videoCount)} videos` : ''}
        </Text>
        {channel.description ? (
          <Pressable onPress={() => setDescExpanded((v) => !v)} accessibilityRole="button">
            <Text style={styles.description} numberOfLines={descExpanded ? undefined : 3}>
              {channel.description}
            </Text>
            {channel.description.length > 180 ? (
              <Text style={styles.moreToggle}>{descExpanded ? 'Show less' : '…more'}</Text>
            ) : null}
          </Pressable>
        ) : null}
      </View>
      <View style={styles.tabs}>
        {(
          [
            { key: 'videos', label: 'VIDEOS' },
            { key: 'live', label: 'LIVE' },
          ] as { key: ChannelTab; label: string }[]
        ).map((t) => {
          const active = tab === t.key;
          return (
            <Pressable
              key={t.key}
              style={[styles.tab, active && styles.tabActive]}
              onPress={() => setTab(t.key)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  ) : null;

  if (loading && !channel) {
    return (
      <View style={styles.container}>
        <View style={styles.stateTopBar}>
          <Pressable onPress={() => goBackOrTab(navigation, 'Home')} hitSlop={10} accessibilityLabel="Back">
            <MaterialIcons name="arrow-back" size={24} color={lightColors.text} />
          </Pressable>
        </View>
        <View style={styles.listPad}>
          <SkeletonCard variant="shelf" />
          <SkeletonCard variant="shelf" />
        </View>
        <View style={{ flex: 1 }} />
        <StackTabBar navigation={navigation} />
      </View>
    );
  }

  if (error || !channel) {
    return (
      <View style={styles.container}>
        <View style={styles.stateTopBar}>
          <Pressable onPress={() => goBackOrTab(navigation, 'Home')} hitSlop={10} accessibilityLabel="Back">
            <MaterialIcons name="arrow-back" size={24} color={lightColors.text} />
          </Pressable>
        </View>
        <EmptyState
          title="Channel unavailable"
          message={error ?? 'This channel could not be loaded.'}
          actionLabel="Go back"
          onAction={() => goBackOrTab(navigation, 'Home')}
        />
        <StackTabBar navigation={navigation} />
      </View>
    );
  }

  // Uploads grid: Shorts filtered OUT with the search stream's
  // heuristic (user ban), ghost items (no title) dropped.
  const data = (tab === 'videos' ? uploads : liveItems).filter(
    (v) => v.title.trim().length > 0 && (tab !== 'videos' || !isShortVideo(v)),
  );

  return (
    <View style={styles.container}>
      <FlatList
        key={`cols-${columns}`}
        data={data}
        numColumns={columns}
        columnWrapperStyle={columns > 1 ? styles.columnWrapper : undefined}
        renderItem={renderVideo}
        keyExtractor={keyExtractor}
        ListHeaderComponent={header ?? undefined}
        contentContainerStyle={styles.listPad}
        onEndReached={tab === 'videos' ? loadMore : undefined}
        onEndReachedThreshold={0.6}
        ListFooterComponent={
          loadingMore ? (
            <ActivityIndicator style={styles.footerSpinner} color={lightColors.textSecondary} />
          ) : undefined
        }
        ListEmptyComponent={
          loading ? undefined : tab === 'live' ? (
            <EmptyState
              title="No live or upcoming broadcasts"
              message="This channel is not live right now and has no upcoming broadcasts scheduled on YouTube."
            />
          ) : (
            <EmptyState title="No videos found" message="This channel's uploads could not be listed." />
          )
        }
        removeClippedSubviews
        initialNumToRender={5}
        windowSize={7}
      />
      <StackTabBar navigation={navigation} />
      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <Pressable style={styles.menuBackdrop} onPress={() => setMenuOpen(false)}>
          <Pressable style={styles.menuCard} onPress={() => undefined}>
            <Pressable
              style={styles.menuRow}
              accessibilityRole="button"
              onPress={() => {
                setMenuOpen(false);
                void Linking.openURL(`https://www.youtube.com/channel/${channelId}`);
              }}
            >
              <MaterialIcons name="open-in-new" size={22} color={lightColors.text} />
              <Text style={styles.menuText}>Open in YouTube</Text>
            </Pressable>
            <Pressable
              style={styles.menuRow}
              accessibilityRole="button"
              onPress={() => {
                setMenuOpen(false);
                void Share.share({
                  message: `${channel.title} — https://www.youtube.com/channel/${channelId}`,
                });
              }}
            >
              <MaterialIcons name="share" size={22} color={lightColors.text} />
              <Text style={styles.menuText}>Share channel</Text>
            </Pressable>
            <Pressable
              style={styles.menuRow}
              accessibilityRole="button"
              onPress={() => {
                setMenuOpen(false);
                navigation.navigate('Sessions');
              }}
            >
              <MaterialIcons name="groups" size={22} color={lightColors.text} />
              <Text style={styles.menuText}>Samagam Sessions</Text>
            </Pressable>
            <Pressable
              style={styles.menuRow}
              accessibilityRole="button"
              onPress={() => setMenuOpen(false)}
            >
              <MaterialIcons name="close" size={22} color={lightColors.text} />
              <Text style={styles.menuText}>Cancel</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: lightColors.background },
  listPad: { paddingHorizontal: spacing.lg },
  topBar: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    marginHorizontal: -spacing.lg,
    paddingHorizontal: spacing.lg,
  },
  topBarTitle: { flex: 1, fontSize: 17, fontWeight: '600', color: lightColors.text },
  banner: {
    width: '100%',
    aspectRatio: 21 / 9,
    borderRadius: 12,
    backgroundColor: lightColors.surfaceVariant,
    marginTop: spacing.sm,
  },
  identity: { alignItems: 'center', paddingTop: spacing.lg },
  avatar: { width: 96, height: 96, borderRadius: 48 },
  avatarFallback: {
    backgroundColor: lightColors.surfaceVariant,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: { fontSize: 30, fontWeight: '600', color: lightColors.textSecondary },
  name: {
    fontSize: 22,
    lineHeight: 27,
    fontWeight: '700',
    color: lightColors.text,
    textAlign: 'center',
    marginTop: spacing.md,
  },
  metaLine: {
    fontSize: 14,
    color: lightColors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  description: {
    fontSize: 14,
    lineHeight: 20,
    color: lightColors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  moreToggle: {
    fontSize: 14,
    fontWeight: '600',
    color: lightColors.text,
    textAlign: 'center',
    marginTop: 2,
  },
  gridCell: { flex: 1 },
  columnWrapper: { gap: spacing.lg },
  tabs: {
    flexDirection: 'row',
    gap: spacing.xl,
    marginTop: spacing.xl,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: lightColors.border,
  },
  tab: { paddingBottom: spacing.sm },
  tabActive: { borderBottomWidth: 2, borderBottomColor: lightColors.text },
  tabLabel: { fontSize: 15, fontWeight: '500', color: lightColors.textSecondary },
  tabLabelActive: { color: lightColors.text, fontWeight: '600' },
  footerSpinner: { paddingVertical: spacing.lg },
  stateTopBar: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
  },
  menuBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  menuCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: lightColors.surface,
    borderRadius: 16,
    paddingVertical: spacing.sm,
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  menuText: { fontSize: 15, color: lightColors.text },
});
