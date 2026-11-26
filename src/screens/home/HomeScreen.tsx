import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import type { CompositeScreenProps } from '@react-navigation/native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AppHeader } from '../../components/layout/AppHeader';
import { SecondaryTabs } from '../../components/layout/SecondaryTabs';
import { ChipsRow } from '../../components/layout/ChipsRow';
import { EmptyState } from '../../components/common/EmptyState';
import { FeedCard } from '../../components/video/FeedCard';
import { SkeletonCard } from '../../components/video/SkeletonCard';
import { supabaseCardData, type CardVideoData } from '../../components/video/cardData';
import { useAuth } from '../../features/auth';
import { useOfficialChannel } from '../../features/channel';
import { isSupabaseConfigured } from '../../lib/supabase';
import {
  fetchCategories,
  fetchPublishedVideos,
  fetchSavedVideoIds,
  setVideoSaved,
} from '../../lib/videos';
import { FEED_LIST_PERF } from '../../lib/listPerf';
import { lightColors, spacing, typography } from '../../theme';
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
}: HomeFeedItemProps) {
  return (
    <FeedCard
      data={data}
      saved={saved}
      onPress={() => onPressVideo(video)}
      onToggleSave={canSave ? () => onToggleSaveVideo(video) : undefined}
      onShare={() => onShareVideo(video)}
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
  const loadingRef = useRef(false);

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
    if (selectedCategory === ALL_CHIP) return videos;
    const cat = categories.find((c) => c.name === selectedCategory);
    if (!cat) return videos;
    return videos.filter((v) => v.category_id === cat.id);
  }, [videos, categories, selectedCategory]);

  const avatarUrl = channel?.avatarUrl ?? null;

  // Stable per-card display data: one CardVideoData object per video,
  // rebuilt only when the feed or the channel avatar changes — never
  // on a saved-state toggle.
  const cardDataById = useMemo(() => {
    const map = new Map<string, CardVideoData>();
    for (const v of videos) map.set(v.id, supabaseCardData(v, avatarUrl));
    return map;
  }, [videos, avatarUrl]);

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

  const handleShareVideo = useCallback((video: Video) => {
    void Share.share({
      message: `${video.title} — https://www.youtube.com/watch?v=${video.youtube_video_id}`,
    });
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

  const renderItem = useCallback(
    ({ item }: { item: Video }) => (
      <HomeFeedItem
        video={item}
        data={cardDataById.get(item.id) ?? supabaseCardData(item, avatarUrl)}
        saved={savedIds.has(item.id)}
        canSave={!!user}
        onPressVideo={handlePressVideo}
        onToggleSaveVideo={handleToggleSaveVideo}
        onShareVideo={handleShareVideo}
      />
    ),
    [
      cardDataById,
      avatarUrl,
      savedIds,
      user,
      handlePressVideo,
      handleToggleSaveVideo,
      handleShareVideo,
    ],
  );

  const keyExtractor = useCallback((item: Video) => item.id, []);

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
        selectedKey="home"
        onSelect={(key) => {
          if (key === 'subs') navigation.navigate('Subscriptions');
        }}
      />
      {categories.length > 0 ? (
        <ChipsRow
          chips={[ALL_CHIP, ...categories.map((c) => c.name)]}
          selected={selectedCategory}
          onSelect={setSelectedCategory}
        />
      ) : null}

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
          data={visibleVideos}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          onEndReached={onEndReached}
          onEndReachedThreshold={0.6}
          refreshing={refreshing}
          onRefresh={onRefresh}
          ListFooterComponent={
            loadingMore ? (
              <ActivityIndicator style={styles.footerSpinner} color={lightColors.textSecondary} />
            ) : undefined
          }
          {...FEED_LIST_PERF}
        />
      )}
      {error && videos.length > 0 ? <Text style={styles.inlineError}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: lightColors.background },
  sessionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: lightColors.border,
  },
  sessionsRowPressed: { backgroundColor: lightColors.surfaceVariant },
  sessionsLines: { flex: 1 },
  sessionsTitle: { ...typography.channelName, fontWeight: '600', color: lightColors.text },
  sessionsSub: { ...typography.metadata, color: lightColors.textSecondary, marginTop: 1 },
  footerSpinner: { paddingVertical: spacing.lg },
  inlineError: {
    ...typography.metadata,
    color: lightColors.accent,
    textAlign: 'center',
    padding: spacing.sm,
  },
});
