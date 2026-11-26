import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Dimensions, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import type { CompositeScreenProps } from '@react-navigation/native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AppHeader } from '../../components/layout/AppHeader';
import { SecondaryTabs } from '../../components/layout/SecondaryTabs';
import { EmptyState } from '../../components/common/EmptyState';
import { ShelfCard } from '../../components/video/ShelfCard';
import { SkeletonCard } from '../../components/video/SkeletonCard';
import { apiCardData } from '../../components/video/cardData';
import { useAuth } from '../../features/auth';
import { useOfficialChannel } from '../../features/channel';
import {
  fetchChannelLiveAndUpcoming,
  fetchChannelUploads,
  type YouTubeVideoMetadata,
} from '../../lib/youtube';
import { FEED_LIST_PERF, H_LIST_PERF } from '../../lib/listPerf';
import { lightColors, nativeApp, spacing } from '../../theme';
import type { MainTabParamList, RootStackParamList } from '../../navigation/types';

type Props = CompositeScreenProps<
  BottomTabScreenProps<MainTabParamList, 'Subscriptions'>,
  NativeStackScreenProps<RootStackParamList>
>;

const CAROUSEL_CARD_WIDTH = Math.round(Dimensions.get('window').width * nativeApp.shelfCard.carouselCardWidthRatio);

/**
 * Subscriptions (reference §2 geometry): channel avatar rail with a
 * red live dot when the channel is genuinely live on YouTube, a "Most
 * relevant" heading, and a horizontal carousel of inset shelf cards.
 * This app follows ONE channel — Bhai Gursharan Singh Ji's official
 * channel — so the rail and shelves show that channel's real data
 * from the YouTube API. There is NO Shorts shelf (user decision).
 */
export function SubscriptionsScreen({ navigation }: Props) {
  const { user, profile } = useAuth();
  const channel = useOfficialChannel();
  const [uploads, setUploads] = useState<YouTubeVideoMetadata[]>([]);
  const [isLiveNow, setIsLiveNow] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : 'Could not load the channel.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [channel]);

  // QA issue 14: order newest-first by real publish date (the
  // uploads-playlist order is insertion order, not guaranteed date
  // order). The "Most relevant" heading itself is the reference's
  // own section heading (screenshot 02) and stays a heading.
  const sortedUploads = useMemo(
    () => [...uploads].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)),
    [uploads],
  );
  const carousel = useMemo(() => sortedUploads.slice(0, 10), [sortedUploads]);
  const rest = useMemo(() => sortedUploads.slice(10), [sortedUploads]);

  const renderRest = useCallback(
    ({ item }: { item: YouTubeVideoMetadata }) => {
      const data = apiCardData(item, channel?.avatarUrl ?? null);
      return (
        <View style={styles.listPad}>
          <ShelfCard
            data={data}
            onPress={() => navigation.navigate('Watch', { youtubeVideoId: item.youtubeVideoId })}
          />
        </View>
      );
    },
    [channel, navigation],
  );

  const renderCarouselItem = useCallback(
    ({ item }: { item: YouTubeVideoMetadata }) => {
      const data = apiCardData(item, channel?.avatarUrl ?? null);
      return (
        <View style={styles.carouselCard}>
          <ShelfCard
            data={data}
            onPress={() => navigation.navigate('Watch', { youtubeVideoId: item.youtubeVideoId })}
          />
        </View>
      );
    },
    [channel, navigation],
  );

  const keyExtractor = useCallback((item: YouTubeVideoMetadata) => item.youtubeVideoId, []);

  // Everything above the main list (avatar rail, heading, carousel)
  // lives in the list's header so the screen has ONE virtualised
  // scroll container (UX perf pass — see the return comment).
  const listHeader = useMemo(() => {
    if (!channel) return null;
    return (
      <View>
        {/* Avatar rail — the one channel this app follows. */}
        <View style={styles.rail}>
          <Pressable
            style={styles.railItem}
            onPress={() => navigation.navigate('Channel', { channelId: channel.channelId })}
            accessibilityRole="button"
          >
            <View style={styles.railAvatarWrap}>
              {channel.avatarUrl ? (
                <Image source={{ uri: channel.avatarUrl }} style={styles.railAvatar} contentFit="cover" cachePolicy="memory-disk" />
              ) : (
                <View style={[styles.railAvatar, styles.avatarFallback]}>
                  <Text style={styles.avatarInitial}>{channel.title.charAt(0)}</Text>
                </View>
              )}
              {isLiveNow ? <View style={styles.liveDot} /> : null}
            </View>
            <Text style={styles.railName} numberOfLines={1}>
              {channel.title}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => navigation.navigate('Channel', { channelId: channel.channelId })}
            accessibilityRole="button"
            style={styles.railAll}
          >
            <Text style={styles.railAllText}>All</Text>
          </Pressable>
        </View>

        <Text style={styles.heading}>Most relevant</Text>
        <FlatList
          horizontal
          data={carousel}
          keyExtractor={keyExtractor}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.carouselContent}
          renderItem={renderCarouselItem}
          {...H_LIST_PERF}
        />
      </View>
    );
  }, [channel, isLiveNow, carousel, keyExtractor, navigation, renderCarouselItem]);
  const initial = profile?.display_name?.charAt(0)?.toUpperCase() ?? user?.email?.charAt(0)?.toUpperCase() ?? null;

  return (
    <View style={styles.container}>
      <AppHeader
        onSearchPress={() => navigation.navigate('Search')}
        onAccountPress={() => navigation.navigate('Account')}
        avatarInitial={initial}
      />
      <SecondaryTabs
        items={[
          { key: 'home', label: 'Home' },
          { key: 'subs', label: 'Subs' },
        ]}
        selectedKey="subs"
        onSelect={(key) => {
          if (key === 'home') navigation.navigate('Home');
        }}
      />

      {loading ? (
        <View style={styles.listPad}>
          <SkeletonCard variant="shelf" />
          <SkeletonCard variant="shelf" />
        </View>
      ) : error || !channel ? (
        <EmptyState title="Could not load subscriptions" message={error ?? 'The official channel could not be loaded.'} />
      ) : (
        /* UX perf pass: this was a ScrollView wrapping a second,
           scroll-disabled FlatList for `rest` — with scrolling off,
           virtualisation is disabled and EVERY remaining upload card
           mounted at once (the screen's main jank source). It is now a
           single virtualised FlatList; the rail/heading/carousel moved
           into ListHeaderComponent above with identical layout. */
        <FlatList
          data={rest}
          keyExtractor={keyExtractor}
          renderItem={renderRest}
          ListHeaderComponent={listHeader ?? undefined}
          ListEmptyComponent={
            uploads.length === 0 ? (
              <EmptyState title="No uploads yet" message="The channel's uploads will appear here." />
            ) : undefined
          }
          {...FEED_LIST_PERF}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: lightColors.background },
  listPad: { paddingHorizontal: spacing.lg },
  rail: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    gap: spacing.lg,
  },
  railItem: { width: nativeApp.avatarRail.avatarSize + 12, alignItems: 'center' },
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
    paddingHorizontal: spacing.lg,
    marginTop: spacing.xl,
    marginBottom: spacing.md,
  },
  carouselContent: { paddingHorizontal: spacing.lg, gap: spacing.lg },
  carouselCard: { width: CAROUSEL_CARD_WIDTH },
});
