import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import type { CompositeScreenProps } from '@react-navigation/native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AppHeader } from '../../components/layout/AppHeader';
import { ChipsRow } from '../../components/layout/ChipsRow';
import { Toast, useToast } from '../../components/common/Toast';
import { AddToPlaylistSheet } from '../../features/library';
import { shareContent, shareFeedback } from '../../lib/share';
import { OFFICIAL_CHANNEL_ID } from '../../lib/youtube';
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
import { lightColors, spacing, typography } from '../../theme';
import type { Category, Video } from '../../types/database';
import type { MainTabParamList, RootStackParamList } from '../../navigation/types';

type Props = CompositeScreenProps<
  BottomTabScreenProps<MainTabParamList, 'Home'>,
  NativeStackScreenProps<RootStackParamList>
>;

const PAGE_SIZE = 25;
const ALL_CHIP = 'All';

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
  const [playlistVideoId, setPlaylistVideoId] = useState<string | null>(null);
  const { toast, showToast } = useToast();
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

  const shareVideo = useCallback(
    (title: string, youtubeVideoId: string) => {
      void shareContent(title, `https://www.youtube.com/watch?v=${youtubeVideoId}`).then((outcome) => {
        const feedback = shareFeedback(outcome);
        if (feedback) showToast(feedback);
      });
    },
    [showToast],
  );

  const renderItem = useCallback(
    ({ item }: { item: Video }) => {
      const data: CardVideoData = supabaseCardData(item, avatarUrl);
      return (
        <FeedCard
          data={data}
          onPress={() => navigation.navigate('Watch', { videoRowId: item.id })}
          saved={savedIds.has(item.id)}
          onToggleSave={
            user
              ? () => {
                  const next = !savedIds.has(item.id);
                  setSavedIds((prev) => {
                    const copy = new Set(prev);
                    if (next) copy.add(item.id);
                    else copy.delete(item.id);
                    return copy;
                  });
                  void setVideoSaved(user.id, item.id, next).catch(() => {
                    // Roll back the optimistic toggle on failure.
                    setSavedIds((prev) => {
                      const copy = new Set(prev);
                      if (next) copy.delete(item.id);
                      else copy.add(item.id);
                      return copy;
                    });
                  });
                }
              : undefined
          }
          onShare={() => shareVideo(item.title, item.youtube_video_id)}
          onChannelPress={() =>
            navigation.navigate('Channel', { channelId: channel?.channelId ?? OFFICIAL_CHANNEL_ID })
          }
          menuActions={[
            {
              key: 'share',
              label: 'Share',
              icon: 'share',
              onPress: () => shareVideo(item.title, item.youtube_video_id),
            },
            ...(user
              ? [
                  {
                    key: 'save-toggle',
                    label: savedIds.has(item.id) ? 'Remove from Saved' : 'Save to Saved',
                    icon: savedIds.has(item.id) ? 'bookmark' : 'bookmark-border',
                    onPress: () => {
                      const next = !savedIds.has(item.id);
                      setSavedIds((prev) => {
                        const copy = new Set(prev);
                        if (next) copy.add(item.id);
                        else copy.delete(item.id);
                        return copy;
                      });
                      void setVideoSaved(user.id, item.id, next).catch(() => {
                        setSavedIds((prev) => {
                          const copy = new Set(prev);
                          if (next) copy.delete(item.id);
                          else copy.add(item.id);
                          return copy;
                        });
                      });
                    },
                  },
                  {
                    key: 'playlist',
                    label: 'Save to playlist',
                    icon: 'playlist-add',
                    onPress: () => setPlaylistVideoId(item.id),
                  },
                ]
              : []),
          ]}
        />
      );
    },
    [avatarUrl, channel, navigation, savedIds, shareVideo, user],
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
      {/* QA44: the Home/Subs SecondaryTabs duplicated the bottom nav
          exactly (same two destinations, no distinction), so the row
          was removed from Home/Subscriptions. Category chips below are
          filters, not navigation, and stay. */}
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
          removeClippedSubviews
          initialNumToRender={4}
          windowSize={7}
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
