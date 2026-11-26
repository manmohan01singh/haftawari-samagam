import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { MaterialIcons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { EmptyState } from '../../components/common/EmptyState';
import { ShelfCard } from '../../components/video/ShelfCard';
import { SkeletonCard } from '../../components/video/SkeletonCard';
import {
  apiCardData,
  supabaseCardData,
  type CardVideoData,
} from '../../components/video/cardData';
import { useOfficialChannel } from '../../features/channel';
import { formatCount } from '../../lib/format';
import { isSupabaseConfigured } from '../../lib/supabase';
import {
  OFFICIAL_CHANNEL_ID,
  fetchChannelUploads,
  searchChannelVideos,
  type YouTubeVideoMetadata,
} from '../../lib/youtube';
import { searchPublishedVideos } from '../../lib/videos';
import { lightColors, radii, spacing, typography } from '../../theme';
import type { Video } from '../../types/database';
import type { RootStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'SearchResults'>;

type ResultItem =
  | { kind: 'local'; video: Video }
  | { kind: 'api'; meta: YouTubeVideoMetadata };

/** Does the query plausibly ask for the channel itself (name, handle, initials like "bgsj")? */
function queryMatchesChannel(query: string, title: string, handle: string | null): boolean {
  const q = query.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!q) return false;
  const titleKey = title.toLowerCase().replace(/[^a-z0-9]/g, '');
  const handleKey = (handle ?? '').toLowerCase().replace(/[^a-z@0-9]/g, '').replace('@', '');
  if (titleKey.includes(q) || handleKey.includes(q)) return true;
  const initials = title
    .split(/\s+/)
    .map((w) => w.replace(/[^A-Za-z]/g, '').charAt(0))
    .join('')
    .toLowerCase();
  if (initials.startsWith(q)) return true;
  return title
    .toLowerCase()
    .split(/\s+/)
    .some((w) => w.replace(/[^a-z]/g, '').startsWith(q) && q.length >= 3);
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
  // Results are stored keyed by their query; loading/error are derived
  // from whether the stored result matches the current query (no
  // synchronous setState in the fetch effect).
  const [result, setResult] = useState<{
    query: string;
    local: Video[];
    api: YouTubeVideoMetadata[];
    error: string | null;
  } | null>(null);
  const [latest, setLatest] = useState<YouTubeVideoMetadata[]>([]);
  const loading = result?.query !== query;
  const error = result?.query === query ? result.error : null;

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [localRows, apiRows] = await Promise.all([
          isSupabaseConfigured ? searchPublishedVideos(query).catch(() => []) : Promise.resolve([]),
          searchChannelVideos(OFFICIAL_CHANNEL_ID, query).catch(() => []),
        ]);
        if (!active) return;
        const localIds = new Set(localRows.map((v) => v.youtube_video_id));
        setResult({
          query,
          local: localRows,
          api: apiRows.filter((m) => !localIds.has(m.youtubeVideoId)),
          error: null,
        });
      } catch (e) {
        if (active) {
          setResult({
            query,
            local: [],
            api: [],
            error: e instanceof Error ? e.message : 'Search failed.',
          });
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [query]);

  const channelMatches = useMemo(
    () => (channel ? queryMatchesChannel(query, channel.title, channel.handle) : false),
    [channel, query],
  );

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

  const items = useMemo<ResultItem[]>(() => {
    if (!result || result.query !== query) return [];
    return [
      ...result.local.map((video) => ({ kind: 'local', video }) as ResultItem),
      ...result.api.map((meta) => ({ kind: 'api', meta }) as ResultItem),
    ];
  }, [result, query]);

  const renderItem = useCallback(
    ({ item }: { item: ResultItem }) => {
      if (item.kind === 'local') {
        const data = supabaseCardData(item.video, channel?.avatarUrl ?? null);
        return (
          <ShelfCard
            data={data}
            onPress={() => navigation.navigate('Watch', { videoRowId: item.video.id })}
          />
        );
      }
      const data = apiCardData(item.meta, channel?.avatarUrl ?? null);
      return (
        <ShelfCard
          data={data}
          showAvatar={item.meta.liveBroadcastContent === 'live'}
          onPress={() => navigation.navigate('Watch', { youtubeVideoId: item.meta.youtubeVideoId })}
        />
      );
    },
    [channel, navigation],
  );

  const keyExtractor = useCallback(
    (item: ResultItem) => (item.kind === 'local' ? `sb-${item.video.id}` : `yt-${item.meta.youtubeVideoId}`),
    [],
  );

  const header = channelMatches && channel ? (
    <View>
      <View style={styles.channelBlock}>
        {channel.avatarUrl ? (
          <Image source={{ uri: channel.avatarUrl }} style={styles.channelAvatar} contentFit="cover" cachePolicy="memory-disk" />
        ) : (
          <View style={[styles.channelAvatar, styles.avatarFallback]}>
            <Text style={styles.avatarInitial}>{channel.title.charAt(0)}</Text>
          </View>
        )}
        <View style={styles.channelLines}>
          <Text style={styles.channelName} numberOfLines={2}>
            {channel.title}
          </Text>
          {channel.handle ? <Text style={styles.channelHandle}>{channel.handle}</Text> : null}
          <Text style={styles.channelMeta} numberOfLines={1}>
            {channel.subscriberCount != null ? `${formatCount(channel.subscriberCount)} subscribers` : ''}
            {channel.subscriberCount != null && channel.videoCount != null ? '  •  ' : ''}
            {channel.videoCount != null ? `${formatCount(channel.videoCount)} videos` : ''}
          </Text>
        </View>
      </View>
      <Pressable
        style={styles.viewChannelPill}
        onPress={() => navigation.navigate('Channel', { channelId: channel.channelId })}
        accessibilityRole="button"
      >
        <Text style={styles.viewChannelText}>View Channel</Text>
      </Pressable>
      {latest.length > 0 ? (
        <View>
          <Text style={styles.latestHeading}>Latest videos</Text>
          <FlatList
            horizontal
            data={latest}
            keyExtractor={(m) => m.youtubeVideoId}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.carouselContent}
            renderItem={({ item }) => {
              const data: CardVideoData = apiCardData(item, channel.avatarUrl);
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
          removeClippedSubviews
          initialNumToRender={5}
          windowSize={7}
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
