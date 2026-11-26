import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { MaterialIcons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { EmptyState } from '../../components/common/EmptyState';
import { LinkedText } from '../../components/common/LinkedText';
import { Toast, useToast } from '../../components/common/Toast';
import { shareContent, shareFeedback } from '../../lib/share';
import { ShelfCard } from '../../components/video/ShelfCard';
import { SkeletonCard } from '../../components/video/SkeletonCard';
import { apiCardData } from '../../components/video/cardData';
import { useOfficialChannel } from '../../features/channel';
import { formatCount } from '../../lib/format';
import {
  OFFICIAL_CHANNEL_ID,
  fetchChannelById,
  fetchChannelLiveAndUpcoming,
  fetchChannelUploads,
  type YouTubeChannelInfo,
  type YouTubeVideoMetadata,
} from '../../lib/youtube';
import { lightColors, radii, spacing } from '../../theme';
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
  const [tab, setTab] = useState<ChannelTab>('videos');
  const [uploads, setUploads] = useState<YouTubeVideoMetadata[]>([]);
  const [nextPage, setNextPage] = useState<string | null>(null);
  const [liveItems, setLiveItems] = useState<YouTubeVideoMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [liveLoaded, setLiveLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [descExpanded, setDescExpanded] = useState(false);
  // QA33: there is NO subscriptions backend table, so Subscribe here is
  // an honest DEVICE-LOCAL follow: it persists in AsyncStorage on this
  // device only (labelled as such under the button) and drives nothing
  // fake — no counts change, no bell, no notifications are promised.
  const [following, setFollowing] = useState(false);
  const { toast, showToast } = useToast();
  const followKey = `channel-follow:${channelId}`;
  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(followKey)
      .then((value) => {
        if (active) setFollowing(value === '1');
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [followKey]);
  const toggleFollow = useCallback(() => {
    setFollowing((prev) => {
      const next = !prev;
      void AsyncStorage.setItem(followKey, next ? '1' : '0').catch(() => undefined);
      return next;
    });
  }, [followKey]);
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
      const data = apiCardData(item, channel?.avatarUrl ?? null);
      return (
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
      );
    },
    [channel, navigation, shareVideo],
  );

  const keyExtractor = useCallback((item: YouTubeVideoMetadata) => item.youtubeVideoId, []);

  const header = channel ? (
    <View>
      <View style={styles.topBar}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10} accessibilityLabel="Back">
          <MaterialIcons name="arrow-back" size={24} color={lightColors.text} />
        </Pressable>
        <Text style={styles.topBarTitle} numberOfLines={1}>
          {channel.title}
        </Text>
        <Pressable onPress={() => navigation.navigate('Search')} hitSlop={10} accessibilityLabel="Search">
          <MaterialIcons name="search" size={24} color={lightColors.text} />
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
        <Pressable
          style={[styles.subscribePill, following && styles.subscribePillActive]}
          onPress={toggleFollow}
          accessibilityRole="button"
          accessibilityState={{ selected: following }}
        >
          <Text style={[styles.subscribeText, following && styles.subscribeTextActive]}>
            {following ? 'Subscribed' : 'Subscribe'}
          </Text>
        </Pressable>
        <Text style={styles.followNote}>Saved on this device only</Text>
        {channel.description ? (
          <View style={styles.descriptionWrap}>
            <LinkedText
              text={channel.description}
              style={styles.description}
              numberOfLines={descExpanded ? undefined : 3}
            />
            <Pressable
              onPress={() => setDescExpanded((v) => !v)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityRole="button"
              accessibilityLabel={descExpanded ? 'Show less' : 'Show more'}
            >
              <Text style={styles.moreText}>{descExpanded ? 'Show less' : '…more'}</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
      <View style={styles.tabs}>
        {(
          [
            { key: 'videos', label: 'Videos' },
            { key: 'live', label: 'Live' },
          ] as { key: ChannelTab; label: string }[]
        ).map((t) => {
          const active = tab === t.key;
          return (
            <Pressable
              key={t.key}
              style={[styles.tab, active && styles.tabActive]}
              onPress={() => setTab(t.key)}
              hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
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
        <View style={styles.listPad}>
          <SkeletonCard variant="shelf" />
          <SkeletonCard variant="shelf" />
        </View>
      </View>
    );
  }

  if (error || !channel) {
    return (
      <View style={styles.container}>
        <EmptyState title="Channel unavailable" message={error ?? 'This channel could not be loaded.'} />
      </View>
    );
  }

  const data = tab === 'videos' ? uploads : liveItems;

  return (
    <View style={styles.container}>
      <FlatList
        data={data}
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
      <Toast message={toast} />
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
    aspectRatio: 1280 / 210,
    borderRadius: 16,
    backgroundColor: lightColors.surfaceVariant,
    marginTop: spacing.sm,
  },
  identity: { alignItems: 'center', paddingTop: spacing.lg },
  avatar: { width: 88, height: 88, borderRadius: 44 },
  avatarFallback: {
    backgroundColor: lightColors.surfaceVariant,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: { fontSize: 30, fontWeight: '600', color: lightColors.textSecondary },
  name: {
    fontSize: 20,
    lineHeight: 25,
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
  descriptionWrap: { alignItems: 'center', marginTop: spacing.sm },
  moreText: { fontSize: 14, fontWeight: '600', color: lightColors.text, marginTop: spacing.xs },
  subscribePill: {
    marginTop: spacing.lg,
    backgroundColor: lightColors.subscribeBackground,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.xl,
    minHeight: 44,
    justifyContent: 'center',
  },
  subscribePillActive: { backgroundColor: lightColors.surfaceVariant },
  subscribeText: { fontSize: 15, fontWeight: '600', color: lightColors.subscribeText },
  subscribeTextActive: { color: lightColors.text },
  followNote: { fontSize: 12, color: lightColors.textSecondary, marginTop: spacing.xs },
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
});
