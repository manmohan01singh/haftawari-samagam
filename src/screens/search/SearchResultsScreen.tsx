import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { EmptyState } from '../../components/common/EmptyState';
import { ShelfCard } from '../../components/video/ShelfCard';
import { SkeletonCard } from '../../components/video/SkeletonCard';
import {
  apiCardData,
  formatDateLine,
  listThumbnailUrl,
  type CardVideoData,
} from '../../components/video/cardData';
import { useOfficialChannel } from '../../features/channel';
import {
  createSearchController,
  type SearchResults,
  type VideoResult,
} from '../../features/search';
import { formatCount } from '../../lib/format';
import {
  OFFICIAL_CHANNEL_HANDLE,
  fetchChannelUploads,
  type YouTubeVideoMetadata,
} from '../../lib/youtube';
import { lightColors, radii, spacing, typography } from '../../theme';
import type { RootStackParamList } from '../../navigation/types';
import { FEED_LIST_PERF, H_LIST_PERF } from '../../lib/listPerf';

type Props = NativeStackScreenProps<RootStackParamList, 'SearchResults'>;

/** Map an engine VideoResult onto the shared card display shape. */
function searchResultCardData(v: VideoResult, channelAvatarUrl: string | null): CardVideoData {
  return {
    key: v.videoRowId ? `sb-${v.videoRowId}` : `yt-${v.youtubeVideoId}`,
    title: v.title,
    thumbnailUrl: listThumbnailUrl(v.youtubeVideoId, v.thumbnailUrl),
    durationSeconds: v.liveBroadcastContent === 'live' ? null : v.durationSeconds,
    broadcastState: v.liveBroadcastContent,
    channelLine: OFFICIAL_CHANNEL_HANDLE,
    metaLine:
      v.liveBroadcastContent === 'live' ? 'Live now' : formatDateLine(v.publishedAt),
    channelAvatarUrl,
  };
}

/**
 * Search results (reference §3 layout): when the query matches the
 * official channel, a channel result block leads (real avatar, name,
 * handle, subscriber/video counts, View Channel pill) followed by a
 * "Latest videos" carousel; results then list real matches from the
 * published archive (Supabase) and from the channel (YouTube Data API),
 * de-duplicated by YouTube video id.
 */
export function SearchResultsScreen({ route, navigation }: Props) {
  const { query } = route.params;
  const channel = useOfficialChannel();
  // Data layer: the search engine (features/search) via its controller
  // — fuzzy local catalogue + official-channel match + YouTube leg,
  // merged, ranked and de-duplicated. Results are stored keyed by
  // their query; loading/error derive from whether the stored result
  // matches the current query (no synchronous setState in the effect).
  const controllerRef = useRef<ReturnType<typeof createSearchController> | null>(null);
  if (controllerRef.current === null) {
    controllerRef.current = createSearchController(300);
  }
  const [result, setResult] = useState<{
    query: string;
    data: SearchResults | null;
    error: string | null;
  } | null>(null);
  const [latest, setLatest] = useState<YouTubeVideoMetadata[]>([]);
  const loading = result?.query !== query;
  const error = result?.query === query ? result.error : null;
  const data = result?.query === query ? result.data : null;

  useEffect(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    let active = true;
    controller
      .search(query)
      .then((data) => {
        if (active) setResult({ query, data, error: null });
      })
      .catch((e) => {
        if (active) {
          setResult({
            query,
            data: null,
            error: e instanceof Error ? e.message : 'Search failed.',
          });
        }
      });
    return () => {
      active = false;
    };
  }, [query]);

  // Cancel any pending/in-flight search when the screen unmounts.
  useEffect(() => {
    const controller = controllerRef.current;
    return () => controller?.cancel();
  }, []);

  const channelResult = data?.channel ?? null;
  const channelMatches = channelResult != null;
  const youtubeSkipped = data?.youtubeSkipped ?? false;

  // "Latest videos" carousel content, only when the channel block shows.
  useEffect(() => {
    if (!channelMatches || !channel?.uploadsPlaylistId) return;
    let active = true;
    fetchChannelUploads(channel.uploadsPlaylistId)
      .then((page) => {
        if (active) setLatest(page.videos.slice(0, 10));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [channelMatches, channel]);

  const items = useMemo<VideoResult[]>(() => data?.videos ?? [], [data]);

  const renderItem = useCallback(
    ({ item }: { item: VideoResult }) => {
      const cardData = searchResultCardData(item, channel?.avatarUrl ?? null);
      return (
        <ShelfCard
          data={cardData}
          showAvatar={item.liveBroadcastContent === 'live'}
          onPress={() =>
            item.videoRowId
              ? navigation.navigate('Watch', { videoRowId: item.videoRowId })
              : navigation.navigate('Watch', { youtubeVideoId: item.youtubeVideoId })
          }
        />
      );
    },
    [channel, navigation],
  );

  const keyExtractor = useCallback(
    (item: VideoResult) => (item.videoRowId ? `sb-${item.videoRowId}` : `yt-${item.youtubeVideoId}`),
    [],
  );

  const header = channelResult || youtubeSkipped ? (
    <View>
      {youtubeSkipped ? (
        <Text style={styles.skippedNote}>
          Showing the published archive only — channel results are unavailable right now.
        </Text>
      ) : null}
      {channelResult ? (
        <>
          <View style={styles.channelBlock}>
            {channelResult.avatarUrl ? (
              <Image source={{ uri: channelResult.avatarUrl }} style={styles.channelAvatar} contentFit="cover" cachePolicy="memory-disk" />
            ) : (
              <View style={[styles.channelAvatar, styles.avatarFallback]}>
                <Text style={styles.avatarInitial}>{channelResult.title.charAt(0)}</Text>
              </View>
            )}
            <View style={styles.channelLines}>
              <Text style={styles.channelName} numberOfLines={2}>
                {channelResult.title}
              </Text>
              {channelResult.handle ? <Text style={styles.channelHandle}>{channelResult.handle}</Text> : null}
              <Text style={styles.channelMeta} numberOfLines={1}>
                {channelResult.subscriberCount != null ? `${formatCount(channelResult.subscriberCount)} subscribers` : ''}
                {channelResult.subscriberCount != null && channelResult.videoCount != null ? '  •  ' : ''}
                {channelResult.videoCount != null ? `${formatCount(channelResult.videoCount)} videos` : ''}
              </Text>
            </View>
          </View>
          <Pressable
            style={styles.viewChannelPill}
            onPress={() => navigation.navigate('Channel', { channelId: channelResult.channelId })}
            accessibilityRole="button"
          >
            <Text style={styles.viewChannelText}>View Channel</Text>
          </Pressable>
        </>
      ) : null}
      {latest.length > 0 ? (
        <View>
          <Text style={styles.latestHeading}>Latest videos</Text>
          <FlatList
            horizontal
            data={latest}
            keyExtractor={(m) => m.youtubeVideoId}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.carouselContent}
            {...H_LIST_PERF}
            renderItem={({ item }) => {
              const data: CardVideoData = apiCardData(item, channel?.avatarUrl ?? null);
              return (
                <View style={styles.carouselCard}>
                  <ShelfCard
                    data={data}
                    showAvatar={item.liveBroadcastContent === 'live'}
                    onPress={() => navigation.navigate('Watch', { youtubeVideoId: item.youtubeVideoId })}
                  />
                </View>
              );
            }}
          />
        </View>
      ) : null}
      {items.length > 0 ? <Text style={styles.resultsHeading}>Results</Text> : null}
    </View>
  ) : null;

  return (
    <View style={styles.container}>
      <View style={styles.bar}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10} accessibilityLabel="Back">
          <MaterialIcons name="arrow-back" size={24} color={lightColors.text} />
        </Pressable>
        <Pressable style={styles.field} onPress={() => navigation.navigate('Search')}>
          <Text style={styles.fieldText} numberOfLines={1}>
            {query}
          </Text>
          <MaterialIcons name="close" size={20} color={lightColors.text} />
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.listPad}>
          <SkeletonCard variant="shelf" />
          <SkeletonCard variant="shelf" />
        </View>
      ) : error ? (
        <EmptyState title="Search failed" message={error} />
      ) : (
        <FlatList
          data={items}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          ListHeaderComponent={header ?? undefined}
          contentContainerStyle={styles.listPad}
          ListEmptyComponent={
            channelMatches ? undefined : (
              <EmptyState
                title="No results found"
                message={`Nothing in the archive or the official channel matches "${query}".`}
              />
            )
          }
          {...FEED_LIST_PERF}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: lightColors.background },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  field: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: lightColors.surfaceVariant,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.lg,
    height: 44,
  },
  fieldText: { ...typography.body, fontSize: 16, color: lightColors.text, flex: 1 },
  listPad: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  skippedNote: {
    ...typography.metadata,
    color: lightColors.textSecondary,
    marginTop: spacing.sm,
  },
  channelBlock: { flexDirection: 'row', gap: spacing.lg, marginTop: spacing.sm },
  channelAvatar: { width: 88, height: 88, borderRadius: 44 },
  avatarFallback: {
    backgroundColor: lightColors.surfaceVariant,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: { fontSize: 30, fontWeight: '600', color: lightColors.textSecondary },
  channelLines: { flex: 1, justifyContent: 'center' },
  channelName: { fontSize: 20, lineHeight: 25, fontWeight: '700', color: lightColors.text },
  channelHandle: { fontSize: 14, color: lightColors.textSecondary, marginTop: 3 },
  channelMeta: { fontSize: 14, color: lightColors.textSecondary, marginTop: 2 },
  viewChannelPill: {
    marginTop: spacing.lg,
    borderWidth: 1,
    borderColor: lightColors.border,
    borderRadius: radii.pill,
    paddingVertical: 11,
    alignItems: 'center',
  },
  viewChannelText: { fontSize: 15, fontWeight: '600', color: lightColors.text },
  latestHeading: { ...typography.sectionTitle, color: lightColors.text, marginTop: spacing.xl, marginBottom: spacing.md },
  carouselContent: { gap: spacing.lg },
  carouselCard: { width: 300 },
  resultsHeading: { ...typography.sectionTitle, color: lightColors.text, marginTop: spacing.xl, marginBottom: spacing.md },
});
