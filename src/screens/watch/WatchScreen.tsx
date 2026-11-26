import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { EmptyState } from '../../components/common/EmptyState';
import { FeedCard } from '../../components/video/FeedCard';
import { YouTubePlayer } from '../../components/video/YouTubePlayer';
import { supabaseCardData, formatDateLine, type CardVideoData } from '../../components/video/cardData';
import { useAuth } from '../../features/auth';
import { useOfficialChannel } from '../../features/channel';
import { AddToPlaylistSheet } from '../../features/library';
import { formatCount } from '../../lib/format';
import { FEED_LIST_PERF } from '../../lib/listPerf';
import { isSupabaseConfigured } from '../../lib/supabase';
import {
  fetchChannelById,
  fetchVideoMetadata,
  type YouTubeChannelInfo,
  type YouTubeVideoMetadata,
} from '../../lib/youtube';
import {
  fetchSavedVideoIds,
  fetchUpNext,
  fetchVideoByRowId,
  recordWatchHistory,
  setVideoSaved,
} from '../../lib/videos';
import { layout, lightColors, nativeApp, radii, spacing } from '../../theme';
import type { Video } from '../../types/database';
import type { RootStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Watch'>;

interface ResolvedWatch {
  youtubeVideoId: string;
  title: string;
  description: string;
  channelId: string | null;
  channelTitle: string;
  metaLine: string;
  thumbnailUrl: string | null;
  row: Video | null;
}

/**
 * Watch screen (reference §5 geometry): player pinned at the top, then
 * a white sheet with 20px rounded top corners overlapping the player's
 * bottom edge holding title, metadata, channel row, action row and
 * description; Up Next continues below as full feed cards.
 *
 * Playback is the OFFICIAL YouTube embed only, mounted lazily after
 * the navigation transition settles so the screen opens smoothly.
 * Session (Samagam) playback + live chat arrive in Phase 3; this
 * screen plays archive recordings.
 */
export function WatchScreen({ route, navigation }: Props) {
  const { videoRowId, youtubeVideoId } = route.params;
  const { user } = useAuth();
  const officialChannel = useOfficialChannel();
  // The resolved video is stored keyed by its route params; loading and
  // error are derived from whether the stored entry matches the current
  // params (no synchronous setState in the fetch effect).
  const watchKey = `${videoRowId ?? ''}|${youtubeVideoId ?? ''}`;
  const [watchState, setWatchState] = useState<{
    key: string;
    resolved: ResolvedWatch | null;
    error: string | null;
  }>({ key: '', resolved: null, error: null });
  const resolved = watchState.key === watchKey ? watchState.resolved : null;
  const error = watchState.key === watchKey ? watchState.error : null;
  const loading = watchState.key !== watchKey;
  const [channel, setChannel] = useState<YouTubeChannelInfo | null>(null);
  const [upNext, setUpNext] = useState<Video[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [readyFor, setReadyFor] = useState<string | null>(null);
  const playerReady = resolved != null && readyFor === resolved.youtubeVideoId;
  const [savedState, setSavedState] = useState<{ rowId: string; saved: boolean } | null>(null);
  const [playlistSheetOpen, setPlaylistSheetOpen] = useState(false);
  const saved =
    resolved?.row && savedState?.rowId === resolved.row.id ? savedState.saved : false;
  const historyRecordedFor = useRef<string | null>(null);

  // Resolve the video from Supabase (archive row) or the YouTube API.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        let row: Video | null = null;
        let meta: YouTubeVideoMetadata | null = null;
        if (videoRowId && isSupabaseConfigured) {
          row = await fetchVideoByRowId(videoRowId);
          if (!row) throw new Error('This recording could not be found.');
        }
        const ytId = row?.youtube_video_id ?? youtubeVideoId;
        if (!ytId) throw new Error('This recording could not be found.');
        if (!row) {
          meta = await fetchVideoMetadata(ytId);
          if (!meta) throw new Error('This recording could not be found on YouTube.');
        }
        if (!active) return;
        const metaParts: string[] = [];
        if (meta) {
          if (meta.likeCount != null) metaParts.push(`${formatCount(meta.likeCount)} likes`);
          if (meta.viewCount != null) metaParts.push(`${formatCount(meta.viewCount)} views`);
          metaParts.push(formatDateLine(meta.publishedAt));
        } else if (row) {
          metaParts.push(formatDateLine(row.published_at ?? row.created_at));
        }
        setWatchState({
          key: watchKey,
          resolved: {
            youtubeVideoId: ytId,
            title: row?.title ?? meta?.title ?? '',
            description: row?.description ?? meta?.description ?? '',
            channelId: meta?.channelId ?? null,
            channelTitle: meta?.channelTitle ?? officialChannel?.title ?? '',
            metaLine: metaParts.filter(Boolean).join('  ·  '),
            thumbnailUrl: row?.thumbnail_url ?? meta?.thumbnailUrl ?? null,
            row,
          },
          error: null,
        });
      } catch (e) {
        if (active) {
          setWatchState({
            key: watchKey,
            resolved: null,
            error: e instanceof Error ? e.message : 'Could not load this recording.',
          });
        }
      }
    })();
    return () => {
      active = false;
    };
    // officialChannel intentionally not a dependency: it only fills a
    // fallback title; the channel fetch below provides the real row.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoRowId, youtubeVideoId, watchKey]);

  // Channel info for the channel row (official channel for archive rows).
  useEffect(() => {
    if (!resolved) return;
    if (!resolved.row && !resolved.channelId) return;
    let active = true;
    const target = resolved.row ? null : resolved.channelId;
    const promise = target ? fetchChannelById(target) : Promise.resolve(officialChannel);
    void promise
      .then((info) => {
        if (active) setChannel(info);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [resolved, officialChannel]);

  // Up Next: other published archive recordings.
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let active = true;
    fetchUpNext(videoRowId ?? null)
      .then((rows) => {
        if (active) setUpNext(rows);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [videoRowId]);

  // Saved state for archive rows (stored keyed by row id).
  useEffect(() => {
    if (!user || !resolved?.row) return;
    const rowId = resolved.row.id;
    let active = true;
    fetchSavedVideoIds(user.id)
      .then((ids) => {
        if (active) setSavedState({ rowId, saved: ids.has(rowId) });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [user, resolved]);

  // Record watch history once per archive recording per mount.
  useEffect(() => {
    if (!user || !resolved?.row) return;
    if (historyRecordedFor.current === resolved.row.id) return;
    historyRecordedFor.current = resolved.row.id;
    void recordWatchHistory(user.id, resolved.row.id).catch(() => undefined);
  }, [user, resolved]);

  // Lazy player mount: mark this video ready only after the navigation
  // transition settles (timer callback), so the screen opens smoothly
  // and the embed never loads on any other screen.
  useEffect(() => {
    if (!resolved) return;
    const ytId = resolved.youtubeVideoId;
    const t = setTimeout(() => setReadyFor(ytId), 60);
    return () => clearTimeout(t);
  }, [resolved]);

  const onShare = useCallback(() => {
    if (!resolved) return;
    void Share.share({
      message: `${resolved.title} — https://www.youtube.com/watch?v=${resolved.youtubeVideoId}`,
    });
  }, [resolved]);

  const onToggleSave = useCallback(() => {
    if (!user || !resolved?.row) return;
    const rowId = resolved.row.id;
    const next = !saved;
    setSavedState({ rowId, saved: next });
    void setVideoSaved(user.id, rowId, next).catch(() =>
      setSavedState({ rowId, saved: !next }),
    );
  }, [user, resolved, saved]);

  const renderUpNext = useCallback(
    ({ item }: { item: Video }) => {
      const data: CardVideoData = supabaseCardData(item, officialChannel?.avatarUrl ?? null);
      return (
        <FeedCard
          data={data}
          onPress={() => navigation.push('Watch', { videoRowId: item.id })}
          onShare={() => {
            void Share.share({
              message: `${item.title} — https://www.youtube.com/watch?v=${item.youtube_video_id}`,
            });
          }}
        />
      );
    },
    [navigation, officialChannel],
  );

  const keyExtractor = useCallback((item: Video) => item.id, []);

  const header = useMemo(() => {
    if (!resolved) return null;
    const channelName = channel?.title ?? resolved.channelTitle;
    const channelAvatar = channel?.avatarUrl ?? null;
    return (
      <View>
        <View style={styles.playerWrap}>
          {playerReady ? (
            <YouTubePlayer youtubeVideoId={resolved.youtubeVideoId} />
          ) : (
            <>
              {resolved.thumbnailUrl ? (
                <Image
                  source={{ uri: resolved.thumbnailUrl }}
                  style={styles.playerThumb}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                />
              ) : (
                <View style={styles.playerThumb} />
              )}
              <View style={styles.playerSpinner}>
                <ActivityIndicator color="#FFFFFF" />
              </View>
            </>
          )}
        </View>
        <View style={styles.sheet}>
          <Text style={styles.title} numberOfLines={expanded ? undefined : 2}>
            {resolved.title}
          </Text>
          <Pressable onPress={() => setExpanded((v) => !v)}>
            <Text style={styles.metaLine} numberOfLines={1}>
              {channel?.handle ?? ''} {resolved.metaLine ? ` · ${resolved.metaLine}` : ''}{' '}
              <Text style={styles.moreText}>{expanded ? 'less' : 'more'}</Text>
            </Text>
          </Pressable>

          <View style={styles.channelRow}>
            {channelAvatar ? (
              <Image
                source={{ uri: channelAvatar }}
                style={styles.channelAvatar}
                contentFit="cover"
                cachePolicy="memory-disk"
              />
            ) : (
              <View style={[styles.channelAvatar, styles.avatarFallback]}>
                <Text style={styles.avatarInitial}>{channelName.charAt(0).toUpperCase()}</Text>
              </View>
            )}
            <View style={styles.channelLines}>
              <Text style={styles.channelName} numberOfLines={1}>
                {channelName}
              </Text>
              {channel?.subscriberCount != null ? (
                <Text style={styles.channelMeta} numberOfLines={1}>
                  {formatCount(channel.subscriberCount)} subscribers
                </Text>
              ) : null}
            </View>
            <View style={styles.actions}>
              {resolved.row && user ? (
                <Pressable onPress={onToggleSave} hitSlop={8} accessibilityLabel={saved ? 'Remove from saved' : 'Save'}>
                  <MaterialIcons name={saved ? 'bookmark' : 'bookmark-border'} size={24} color={lightColors.text} />
                </Pressable>
              ) : null}
              {resolved.row && user ? (
                <Pressable
                  onPress={() => setPlaylistSheetOpen(true)}
                  hitSlop={8}
                  accessibilityLabel="Save to playlist"
                >
                  <MaterialIcons name="playlist-add" size={26} color={lightColors.text} />
                </Pressable>
              ) : null}
              <Pressable onPress={onShare} hitSlop={8} accessibilityLabel="Share">
                <MaterialIcons name="share" size={23} color={lightColors.text} />
              </Pressable>
            </View>
          </View>
          <Pressable
            style={styles.viewChannelPill}
            onPress={() => navigation.navigate('Channel', { channelId: channel?.channelId })}
            accessibilityRole="button"
          >
            <Text style={styles.viewChannelText}>View Channel</Text>
          </Pressable>

          {expanded && resolved.description ? (
            <View style={styles.descriptionBox}>
              <Text style={styles.descriptionText}>{resolved.description}</Text>
            </View>
          ) : null}
        </View>
      </View>
    );
  }, [resolved, channel, playerReady, expanded, user, saved, onToggleSave, onShare, navigation]);

  if (loading) {
    return (
      <View style={styles.container}>
        <View style={styles.playerSkeleton} />
        <View style={styles.sheetSkeleton}>
          <View style={[styles.skelLine, { width: '85%' }]} />
          <View style={[styles.skelLine, { width: '55%', marginTop: 8 }]} />
        </View>
      </View>
    );
  }

  if (error || !resolved) {
    return (
      <View style={styles.container}>
        <EmptyState title="Recording unavailable" message={error ?? 'This recording could not be loaded.'} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={upNext}
        renderItem={renderUpNext}
        keyExtractor={keyExtractor}
        ListHeaderComponent={header ?? undefined}
        ListEmptyComponent={
          <Text style={styles.upNextEmpty}>No other published recordings yet.</Text>
        }
        {...FEED_LIST_PERF}
      />
      {/* "Save to playlist" sheet (library stream) — archive rows and
          signed-in users only, matching the action button's gating. */}
      <AddToPlaylistSheet
        visible={playlistSheetOpen}
        userId={user?.id ?? null}
        videoId={resolved.row?.id ?? null}
        onClose={() => setPlaylistSheetOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: lightColors.background },
  playerWrap: {
    width: '100%',
    aspectRatio: layout.thumbnailAspectRatio,
    backgroundColor: lightColors.playerBackground,
  },
  playerThumb: { width: '100%', height: '100%', backgroundColor: lightColors.playerBackground },
  playerSpinner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheet: {
    backgroundColor: lightColors.surface,
    borderTopLeftRadius: nativeApp.watchSheet.topRadius + 4,
    borderTopRightRadius: nativeApp.watchSheet.topRadius + 4,
    marginTop: -(nativeApp.watchSheet.topRadius + 4),
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  title: { fontSize: 20, lineHeight: 26, fontWeight: '600', color: lightColors.text },
  metaLine: { fontSize: 14, color: lightColors.textSecondary, marginTop: spacing.sm },
  moreText: { color: lightColors.text, fontWeight: '600' },
  channelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.lg,
    gap: spacing.md,
  },
  channelAvatar: { width: 40, height: 40, borderRadius: 20 },
  avatarFallback: {
    backgroundColor: lightColors.surfaceVariant,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: { fontSize: 16, fontWeight: '600', color: lightColors.textSecondary },
  channelLines: { flex: 1 },
  channelName: { fontSize: 15, fontWeight: '600', color: lightColors.text },
  channelMeta: { fontSize: 13, color: lightColors.textSecondary, marginTop: 1 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 26 },
  viewChannelPill: {
    alignSelf: 'flex-start',
    marginTop: spacing.md,
    borderWidth: 1,
    borderColor: lightColors.border,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: 9,
  },
  viewChannelText: { fontSize: 14, fontWeight: '600', color: lightColors.text },
  descriptionBox: {
    backgroundColor: lightColors.surfaceVariant,
    borderRadius: radii.card,
    padding: spacing.md,
    marginTop: spacing.lg,
  },
  descriptionText: { fontSize: 14, lineHeight: 20, color: lightColors.text },
  upNextEmpty: {
    fontSize: 14,
    color: lightColors.textSecondary,
    textAlign: 'center',
    paddingVertical: spacing.xl,
  },
  playerSkeleton: {
    width: '100%',
    aspectRatio: layout.thumbnailAspectRatio,
    backgroundColor: lightColors.playerBackground,
  },
  sheetSkeleton: { padding: spacing.lg },
  skelLine: { height: 18, borderRadius: 4, backgroundColor: lightColors.surfaceVariant },
});
