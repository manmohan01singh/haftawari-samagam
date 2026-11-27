import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import type { CompositeScreenProps } from '@react-navigation/native';
import { useScrollToTop } from '@react-navigation/native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AppHeader } from '../../components/layout/AppHeader';
import { ChipsRow } from '../../components/layout/ChipsRow';
import { Toast, useToast } from '../../components/common/Toast';
import { AddToPlaylistSheet } from '../../features/library';
import { shareContent, shareFeedback } from '../../lib/share';
import { SecondaryTabs } from '../../components/layout/SecondaryTabs';
import { EmptyState } from '../../components/common/EmptyState';
import { FeedCard } from '../../components/video/FeedCard';
import { SkeletonCard } from '../../components/video/SkeletonCard';
import { supabaseCardData, type CardVideoData } from '../../components/video/cardData';
import { useAuth } from '../../features/auth';
import { useOfficialChannel } from '../../features/channel';
import { isSupabaseConfigured } from '../../lib/supabase';
import {
  OFFICIAL_CHANNEL_ID,
  fetchChannelLiveAndUpcoming,
  isYouTubeConfigured,
  type YouTubeVideoMetadata,
} from '../../lib/youtube';
import {
  fetchCategories,
  fetchPublishedVideos,
  fetchSavedVideoIds,
  setVideoSaved,
} from '../../lib/videos';
import { FEED_LIST_PERF } from '../../lib/listPerf';
import { layout, lightColors, spacing, typography } from '../../theme';
import type { Category, Video } from '../../types/database';
import type { MainTabParamList, RootStackParamList } from '../../navigation/types';

type Props = CompositeScreenProps<
  BottomTabScreenProps<MainTabParamList, 'Home'>,
  NativeStackScreenProps<RootStackParamList>
>;

const PAGE_SIZE = 25;
const ALL_CHIP = 'All';

interface HomeFeedItemProps {
  video: Video;
  data: CardVideoData;
  saved: boolean;
  canSave: boolean;
  onPressVideo: (video: Video) => void;
  onToggleSaveVideo: (video: Video) => void;
  onShareVideo: (video: Video) => void;
  onChannelPress: () => void;
  onOpenPlaylistVideo: (video: Video) => void;
}

/**
 * Memoised feed-cell wrapper (UX perf pass). The previous renderItem
 * built a fresh onPress/onToggleSave/onShare closure AND a fresh
 * CardVideoData object for every card on every render, and its
 * identity changed whenever ANY card's saved state changed — so
 * FeedCard's memo never held and one bookmark tap re-rendered every
 * visible card. Here the card receives only stable handler props plus
 * per-item primitives; the per-item closures are created inside this
 * wrapper, which re-renders only when its own item's props change.
 */
const HomeFeedItem = memo(function HomeFeedItem({
  video,
  data,
  saved,
  canSave,
  onPressVideo,
  onToggleSaveVideo,
  onShareVideo,
  onChannelPress,
  onOpenPlaylistVideo,
}: HomeFeedItemProps) {
  // Kebab menu actions (QA 31/32): only real actions — share (system
  // sheet via the share util), save toggle and save-to-playlist for
  // signed-in users (real saved_videos / playlist backends).
  const menuActions = useMemo(
    () => [
      {
        key: 'share',
        label: 'Share',
        icon: 'share',
        onPress: () => onShareVideo(video),
      },
      ...(canSave
        ? [
            {
              key: 'save-toggle',
              label: saved ? 'Remove from Saved' : 'Save to Saved',
              icon: saved ? 'bookmark' : 'bookmark-border',
              onPress: () => onToggleSaveVideo(video),
            },
            {
              key: 'playlist',
              label: 'Save to playlist',
              icon: 'playlist-add',
              onPress: () => onOpenPlaylistVideo(video),
            },
          ]
        : []),
    ],
    [canSave, saved, video, onShareVideo, onToggleSaveVideo, onOpenPlaylistVideo],
  );
  return (
    <FeedCard
      data={data}
      saved={saved}
      onPress={() => onPressVideo(video)}
      onToggleSave={canSave ? () => onToggleSaveVideo(video) : undefined}
      onShare={() => onShareVideo(video)}
      onChannelPress={onChannelPress}
      menuActions={menuActions}
    />
  );
});

/**
 * Home feed — real data only: published rows from the Supabase
 * `videos` table, paginated incrementally (25/page) into a FlatList
 * of memoized full-bleed FeedCards (reference §1 geometry). Category
 * chips come from the real `categories` table. While the first page
 * loads, geometry-matched skeletons hold the layout (no jumps).
 */
export function HomeScreen({ navigation }: Props) {
  const { user, profile } = useAuth();
  // QA 89: tapping the Home tab while already on Home scrolls the
  // feed back to the top (useScrollToTop hooks the tab re-press).
  const feedRef = useRef<FlatList<Video>>(null);
  useScrollToTop(feedRef);
  const channel = useOfficialChannel();
  const [videos, setVideos] = useState<Video[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>(ALL_CHIP);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(isSupabaseConfigured);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exhausted, setExhausted] = useState(false);
  const [playlistVideoId, setPlaylistVideoId] = useState<string | null>(null);
  const { toast, showToast } = useToast();
  const loadingRef = useRef(false);
  // Real live state from the YouTube API (QA 49/68): a map of
  // youtube_video_id → live/upcoming metadata for the official
  // channel. Archive rows have no live flag of their own.
  const [liveMap, setLiveMap] = useState<Map<string, YouTubeVideoMetadata>>(new Map());

  useEffect(() => {
    if (!isYouTubeConfigured) return;
    let active = true;
    fetchChannelLiveAndUpcoming(OFFICIAL_CHANNEL_ID)
      .then((metas) => {
        if (active) setLiveMap(new Map(metas.map((m) => [m.youtubeVideoId, m])));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const loadPage = useCallback(async (offset: number): Promise<Video[]> => {
    const page = await fetchPublishedVideos(PAGE_SIZE, offset);
    setExhausted(page.length < PAGE_SIZE);
    return page;
  }, []);

  const loadInitial = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      const [page, cats] = await Promise.all([loadPage(0), fetchCategories().catch(() => [])]);
      setError(null);
      setVideos(page);
      setCategories(cats);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the feed.');
    } finally {
      loadingRef.current = false;
      setLoading(false);
      setRefreshing(false);
    }
  }, [loadPage]);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    // Deferred one tick so the initial load does not run (or set state)
    // synchronously inside the effect.
    const t = setTimeout(() => {
      void loadInitial();
    }, 0);
    return () => clearTimeout(t);
  }, [loadInitial]);

  useEffect(() => {
    if (!user) {
      // Reset in a timer callback (not synchronously in the effect).
      const t = setTimeout(() => setSavedIds(new Set()), 0);
      return () => clearTimeout(t);
    }
    let active = true;
    fetchSavedVideoIds(user.id)
      .then((ids) => {
        if (active) setSavedIds(ids);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [user]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void loadInitial();
  }, [loadInitial]);

  const onEndReached = useCallback(() => {
    if (loadingRef.current || exhausted || loading || videos.length === 0) return;
    loadingRef.current = true;
    setLoadingMore(true);
    loadPage(videos.length)
      .then((page) => {
        setVideos((prev) => [...prev, ...page]);
      })
      .catch(() => undefined)
      .finally(() => {
        loadingRef.current = false;
        setLoadingMore(false);
      });
  }, [exhausted, loadPage, loading, videos.length]);

  const visibleVideos = useMemo(() => {
    const filtered =
      selectedCategory === ALL_CHIP
        ? videos
        : (() => {
            const cat = categories.find((c) => c.name === selectedCategory);
            return cat ? videos.filter((v) => v.category_id === cat.id) : videos;
          })();
    // Live first (QA 68): stable float of genuinely-live items (real
    // API state) above the newest-first catalogue order.
    if (liveMap.size === 0) return filtered;
    const live = filtered.filter((v) => liveMap.get(v.youtube_video_id)?.liveBroadcastContent === 'live');
    if (live.length === 0) return filtered;
    const rest = filtered.filter((v) => liveMap.get(v.youtube_video_id)?.liveBroadcastContent !== 'live');
    return [...live, ...rest];
  }, [videos, categories, selectedCategory, liveMap]);

  const avatarUrl = channel?.avatarUrl ?? null;

  // Stable per-card display data: one CardVideoData object per video,
  // rebuilt only when the feed, the channel avatar or the live map
  // changes — never on a saved-state toggle. The live map feeds the
  // QA 49 enrichment (LIVE badge + real watching count) inside
  // supabaseCardData.
  const cardDataById = useMemo(() => {
    const map = new Map<string, CardVideoData>();
    for (const v of videos) {
      map.set(v.id, supabaseCardData(v, avatarUrl, liveMap.get(v.youtube_video_id) ?? null));
    }
    return map;
  }, [videos, avatarUrl, liveMap]);

  // Mirror of savedIds for the stable toggle handler below.
  const savedIdsRef = useRef(savedIds);
  useEffect(() => {
    savedIdsRef.current = savedIds;
  }, [savedIds]);

  const handlePressVideo = useCallback(
    (video: Video) => {
      navigation.navigate('Watch', { videoRowId: video.id });
    },
    [navigation],
  );

  // Share goes through the shared share util (QA 30): Web Share API
  // with a clipboard fallback, and the outcome is surfaced as a toast
  // so the tap never feels dead.
  const handleShareVideo = useCallback(
    (video: Video) => {
      void shareContent(
        video.title,
        `https://www.youtube.com/watch?v=${video.youtube_video_id}`,
      ).then((outcome) => {
        const feedback = shareFeedback(outcome);
        if (feedback) showToast(feedback);
      });
    },
    [showToast],
  );

  const handleChannelPress = useCallback(() => {
    navigation.navigate('Channel', { channelId: channel?.channelId ?? OFFICIAL_CHANNEL_ID });
  }, [navigation, channel]);

  const handleOpenPlaylistVideo = useCallback((video: Video) => {
    setPlaylistVideoId(video.id);
  }, []);

  const handleToggleSaveVideo = useCallback(
    (video: Video) => {
      if (!user) return;
      const next = !savedIdsRef.current.has(video.id);
      setSavedIds((prev) => {
        const copy = new Set(prev);
        if (next) copy.add(video.id);
        else copy.delete(video.id);
        return copy;
      });
      void setVideoSaved(user.id, video.id, next).catch(() => {
        // Roll back the optimistic toggle on failure.
        setSavedIds((prev) => {
          const copy = new Set(prev);
          if (next) copy.delete(video.id);
          else copy.add(video.id);
          return copy;
        });
      });
    },
    [user],
  );

  // The Sessions entry + category chips strip (rendered by
  // renderItem after the second card — see the round-2 note there).
  // The ChipsRow itself is ALWAYS rendered when the strip shows
  // (QA issue 11): with no categories it shows just "All".
  const feedStrip = useMemo(
    () => (
    <View>
      {/* Samagam Sessions entry point — scheduled group playbacks
          (UPCOMING / NOW PLAYING / COMPLETED), listed on their own
          screen. Styled as a plain reference row, not a banner. */}
      <Pressable
        style={({ pressed }) => [styles.sessionsRow, pressed && styles.sessionsRowPressed]}
        onPress={() => navigation.navigate('Sessions')}
        accessibilityRole="button"
        accessibilityLabel="Samagam Sessions"
      >
        <MaterialIcons name="groups" size={24} color={lightColors.text} />
        <View style={styles.sessionsLines}>
          <Text style={styles.sessionsTitle}>Samagam Sessions</Text>
          <Text style={styles.sessionsSub}>Watch together at the scheduled time</Text>
        </View>
        <MaterialIcons name="chevron-right" size={24} color={lightColors.textSecondary} />
      </Pressable>
      <ChipsRow
        chips={[ALL_CHIP, ...categories.map((c) => c.name)]}
        selected={selectedCategory}
        onSelect={setSelectedCategory}
      />
    </View>
    ),
    [categories, selectedCategory, navigation],
  );

  const renderItem = useCallback(
    ({ item, index }: { item: Video; index: number }) => {
      // Round-2 pixel pass: the feed must start IMMEDIATELY with the
      // first card (ref-1 goes straight from the tab row to card 1).
      // The Sessions entry + category chips strip renders after the
      // SECOND card (or after the only card), never above card 1.
      const stripAfter = Math.min(1, visibleVideos.length - 1);
      return (
        <>
          <HomeFeedItem
            video={item}
            data={
              cardDataById.get(item.id) ??
              supabaseCardData(item, avatarUrl, liveMap.get(item.youtube_video_id) ?? null)
            }
            saved={savedIds.has(item.id)}
            canSave={!!user}
            onPressVideo={handlePressVideo}
            onToggleSaveVideo={handleToggleSaveVideo}
            onShareVideo={handleShareVideo}
            onChannelPress={handleChannelPress}
            onOpenPlaylistVideo={handleOpenPlaylistVideo}
          />
          {index === stripAfter ? feedStrip : null}
        </>
      );
    },
    [
      cardDataById,
      avatarUrl,
      liveMap,
      savedIds,
      user,
      handlePressVideo,
      handleToggleSaveVideo,
      handleShareVideo,
      handleChannelPress,
      handleOpenPlaylistVideo,
      visibleVideos.length,
      feedStrip,
    ],
  );

  const keyExtractor = useCallback((item: Video) => item.id, []);

  const initial = profile?.display_name?.charAt(0)?.toUpperCase() ?? user?.email?.charAt(0)?.toUpperCase() ?? null;

  return (
    <View style={styles.container}>
      <View style={styles.headerBlock}>
        <AppHeader
          onSearchPress={() => navigation.navigate('Search')}
          onAccountPress={() => navigation.navigate('Account')}
          avatarInitial={initial}
        />
        <SecondaryTabs
          items={[
            { key: 'home', label: 'Home' },
            { key: 'subs', label: 'Subs' },
            { key: 'live', label: 'Live' },
          ]}
          selectedKey="home"
          onSelect={(key) => {
            if (key === 'subs') navigation.navigate('Subscriptions');
            // "Live" is the reference tab row's live entry; in this
            // app the live surface is Samagam Sessions (NOW PLAYING) —
            // a real destination, not a dead tab. "Music"/"More" from
            // the screenshot have no section in this app and are not
            // shown as dead tabs.
            if (key === 'live') navigation.navigate('Sessions');
          }}
        />
      </View>

      {!isSupabaseConfigured ? (
        <EmptyState
          title="Backend not configured"
          message="Published samagams will appear here once Supabase is connected."
        />
      ) : loading ? (
        <View>
          <SkeletonCard variant="feed" />
          <SkeletonCard variant="feed" />
        </View>
      ) : error ? (
        <EmptyState title="Could not load the feed" message={error} />
      ) : visibleVideos.length === 0 ? (
        <EmptyState
          title="No samagams published yet"
          message={
            videos.length > 0
              ? 'Nothing published in this category yet.'
              : 'Recordings published by the admin will appear here.'
          }
        />
      ) : (
        <FlatList
          ref={feedRef}
          data={visibleVideos}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          // The bottom bar is an OVERLAY now (blur material): the
          // feed scrolls under it, so the last cards need clearance
          // ≥ the bar height (56) + breathing room, or the bar would
          // cover them at the end of the list.
          contentContainerStyle={styles.feedContent}
          onEndReached={onEndReached}
          onEndReachedThreshold={0.6}
          refreshing={refreshing}
          onRefresh={onRefresh}
          ListFooterComponent={
            loadingMore ? (
              <ActivityIndicator style={styles.footerSpinner} color={lightColors.textSecondary} />
            ) : exhausted ? (
              <View style={styles.endOfFeed}>
                <MaterialIcons name="check-circle" size={18} color={lightColors.textSecondary} />
                <Text style={styles.endOfFeedText}>
                  You&rsquo;re all caught up — that&rsquo;s every published samagam
                </Text>
              </View>
            ) : undefined
          }
          {...FEED_LIST_PERF}
        />
      )}
      {error && videos.length > 0 ? <Text style={styles.inlineError}>{error}</Text> : null}
      <AddToPlaylistSheet
        visible={playlistVideoId != null}
        userId={user?.id ?? null}
        videoId={playlistVideoId}
        onClose={() => setPlaylistVideoId(null)}
      />
      <Toast message={toast} />
    </View>
  );
}

const styles = StyleSheet.create({
  // Screenshot 01: cards are white containers on a light-grey page
  // ground — the grey shows in the gaps between cards and around the
  // chips/sessions rows. White-on-white made the feed read as one
  // unbroken sheet with no card separation.
  container: { flex: 1, backgroundColor: '#F8F8F8' },
  // Translucent now: AppHeader carries the blur material; the tab
  // row below it sits on the same near-white translucent tone so the
  // whole top block reads as one glass bar (no solid white slab).
  headerBlock: { backgroundColor: 'rgba(255,255,255,0.88)' },
  sessionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  sessionsRowPressed: { backgroundColor: lightColors.surfaceVariant },
  sessionsLines: { flex: 1 },
  sessionsTitle: { ...typography.channelName, fontWeight: '600', color: lightColors.text },
  sessionsSub: { ...typography.metadata, color: lightColors.textSecondary, marginTop: 1 },
  feedContent: { paddingBottom: layout.bottomNavHeight + 24 },
  footerSpinner: { paddingVertical: spacing.lg },
  endOfFeed: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
  endOfFeedText: { ...typography.metadata, color: lightColors.textSecondary, textAlign: 'center' },
  inlineError: {
    ...typography.metadata,
    color: lightColors.accent,
    textAlign: 'center',
    padding: spacing.sm,
  },
});
