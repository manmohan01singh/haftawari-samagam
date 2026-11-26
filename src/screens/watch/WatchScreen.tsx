import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { EmptyState } from '../../components/common/EmptyState';
import { LinkedText } from '../../components/common/LinkedText';
import { Toast, useToast } from '../../components/common/Toast';
import { shareContent, shareFeedback } from '../../lib/share';
import { FeedCard } from '../../components/video/FeedCard';
import { YouTubePlayer } from '../../components/video/YouTubePlayer';
import {
  apiCardData,
  supabaseCardData,
  formatDateLine,
  type CardVideoData,
} from '../../components/video/cardData';
import { useAuth } from '../../features/auth';
import { useOfficialChannel } from '../../features/channel';
import { AddToPlaylistSheet } from '../../features/library';
import { formatCount } from '../../lib/format';
import { FEED_LIST_PERF } from '../../lib/listPerf';
import { isSupabaseConfigured } from '../../lib/supabase';
import {
  fetchChannelById,
  fetchChannelUploads,
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
import { layout, lightColors, nativeApp, radii, spacing, typography } from '../../theme';
import { goBackOrTab } from '../../navigation/safeBack';
import { recordLocalWatch } from '../../features/library/localHistory';
import { ICON_HIT_SLOP } from '../../lib/touch';
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
  /** True only when the YouTube API itself reports this video live. */
  isLive: boolean;
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
  // Up Next items: local catalogue rows first; when the catalogue is
  // thin, real channel uploads from the YouTube API fill the list
  // (QA issue 58) — same compact-row rendering either way.
  type UpNextItem =
    | { kind: 'row'; video: Video }
    | { kind: 'api'; meta: YouTubeVideoMetadata };
  const [upNextItems, setUpNextItems] = useState<UpNextItem[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [readyFor, setReadyFor] = useState<string | null>(null);
  const playerReady = resolved != null && readyFor === resolved.youtubeVideoId;
  const [savedState, setSavedState] = useState<{ rowId: string; saved: boolean } | null>(null);
  // Local pressed-state for the icon-only Like/Dislike pair (screenshot
  // 06 action row shows no counts; the real like count, when the API
  // provides one, lives in the metadata line). No count is displayed
  // or stored from these toggles.
  const [reaction, setReaction] = useState<'like' | 'dislike' | null>(null);
  const [playlistSheetOpen, setPlaylistSheetOpen] = useState(false);
  const { toast, showToast } = useToast();
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
        // QA issue 55: ALWAYS enrich from the YouTube API when it is
        // reachable — even for archive rows — so the sheet's meta
        // line carries the real likes / watching / views / hashtags
        // of screenshot 06 instead of a bare date. Failure to enrich
        // is not fatal for archive rows (the row itself is the data);
        // it IS fatal when there is no row at all.
        meta = await fetchVideoMetadata(ytId).catch(() => null);
        if (!row && !meta) throw new Error('This recording could not be found on YouTube.');
        if (!active) return;
        const isLive = meta?.liveBroadcastContent === 'live';
        const metaParts: string[] = [];
        if (meta) {
          if (meta.liveBroadcastContent === 'live' && meta.concurrentViewers != null) {
            metaParts.push(`${formatCount(meta.concurrentViewers)} watching`);
          }
          if (meta.likeCount != null) metaParts.push(`${formatCount(meta.likeCount)} likes`);
          if (isLive) {
            if (meta.concurrentViewers != null) {
              metaParts.push(`${formatCount(meta.concurrentViewers)} watching`);
            }
          } else if (meta.viewCount != null) {
            // Reference: view counts in metadata lines carry the ▷
            // prefix ("▷ 3.3 lakh", "▷332 watching").
            metaParts.push(`▷ ${formatCount(meta.viewCount)} views`);
          }
          metaParts.push(formatDateLine(meta.publishedAt));
          // Hashtags come from the video's OWN description text
          // (real API data), first two, as in the reference meta line.
          const tags = [...new Set((meta.description.match(/#[\p{L}\p{N}_]+/gu) ?? []).slice(0, 2))];
          metaParts.push(...tags);
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
            isLive,
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

  // Up Next: other published archive recordings first; if the local
  // catalogue is thin (< 4), fall back to the channel's real uploads
  // via the YouTube API (QA issue 58 — the channel has far more
  // videos than the seeded catalogue).
  const currentYtId = resolved?.youtubeVideoId ?? youtubeVideoId ?? null;
  useEffect(() => {
    let active = true;
    (async () => {
      const rows = isSupabaseConfigured
        ? await fetchUpNext(videoRowId ?? null).catch(() => [] as Video[])
        : [];
      const items: UpNextItem[] = rows.map((video) => ({ kind: 'row' as const, video }));
      if (items.length < 4 && officialChannel?.uploadsPlaylistId) {
        const page = await fetchChannelUploads(officialChannel.uploadsPlaylistId).catch(() => null);
        if (page) {
          const seen = new Set(rows.map((r) => r.youtube_video_id));
          if (currentYtId) seen.add(currentYtId);
          for (const meta of page.videos) {
            if (!seen.has(meta.youtubeVideoId)) items.push({ kind: 'api' as const, meta });
          }
        }
      }
      if (active) setUpNextItems(items.slice(0, 15));
    })();
    return () => {
      active = false;
    };
  }, [videoRowId, officialChannel, currentYtId]);

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

  // Record watch history once per recording per mount. Signed-in:
  // the server watch_history row (archive rows only). Signed-out:
  // a DEVICE-LOCAL entry (features/library/localHistory) so History
  // can honestly show what was watched on this device instead of
  // claiming nothing happened (QA issue 78).
  useEffect(() => {
    if (!resolved) return;
    if (historyRecordedFor.current === resolved.youtubeVideoId) return;
    historyRecordedFor.current = resolved.youtubeVideoId;
    if (user && resolved.row) {
      void recordWatchHistory(user.id, resolved.row.id).catch(() => undefined);
    } else if (!user) {
      void recordLocalWatch({
        youtubeVideoId: resolved.youtubeVideoId,
        videoRowId: resolved.row?.id ?? null,
        title: resolved.title,
        thumbnailUrl: resolved.thumbnailUrl,
        durationSeconds: resolved.row?.duration_seconds ?? null,
      }).catch(() => undefined);
    }
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
    void shareContent(
      resolved.title,
      `https://www.youtube.com/watch?v=${resolved.youtubeVideoId}`,
    ).then((outcome) => {
      const feedback = shareFeedback(outcome);
      if (feedback) showToast(feedback);
    });
  }, [resolved, showToast]);

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
    ({ item }: { item: UpNextItem }) => {
      const shareItem = (title: string, youtubeVideoId: string) => {
        void shareContent(title, `https://www.youtube.com/watch?v=${youtubeVideoId}`).then(
          (outcome) => {
            const feedback = shareFeedback(outcome);
            if (feedback) showToast(feedback);
          },
        );
      };
      if (item.kind === 'api') {
        const data: CardVideoData = apiCardData(item.meta, officialChannel?.avatarUrl ?? null);
        return (
          <FeedCard
            variant="upNext"
            data={data}
            onPress={() => navigation.push('Watch', { youtubeVideoId: item.meta.youtubeVideoId })}
            onShare={() => shareItem(item.meta.title, item.meta.youtubeVideoId)}
            onChannelPress={() =>
              navigation.navigate('Channel', { channelId: officialChannel?.channelId })
            }
            menuActions={[
              {
                key: 'share',
                label: 'Share',
                icon: 'share',
                onPress: () => shareItem(item.meta.title, item.meta.youtubeVideoId),
              },
            ]}
          />
        );
      }
      const data: CardVideoData = supabaseCardData(item.video, officialChannel?.avatarUrl ?? null);
      return (
        <FeedCard
          variant="upNext"
          data={data}
          onPress={() => navigation.push('Watch', { videoRowId: item.video.id })}
          onShare={() => shareItem(item.video.title, item.video.youtube_video_id)}
          onChannelPress={() =>
            navigation.navigate('Channel', { channelId: officialChannel?.channelId })
          }
          menuActions={[
            {
              key: 'share',
              label: 'Share',
              icon: 'share',
              onPress: () => shareItem(item.video.title, item.video.youtube_video_id),
            },
          ]}
        />
      );
    },
    [navigation, officialChannel, showToast],
  );

  const keyExtractor = useCallback(
    (item: UpNextItem) => (item.kind === 'row' ? `sb-${item.video.id}` : `yt-${item.meta.youtubeVideoId}`),
    [],
  );

  // Player element — rendered OUTSIDE the FlatList (see the return
  // below) so it stays pinned at the top while Up Next scrolls, as in
  // screenshot 06. Previously it lived inside ListHeaderComponent and
  // scrolled away with the sheet.
  const player = resolved ? (
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
      {/* QA issue 64: a clear red LIVE pill on the player itself when
          the API reports the video live (bottom-right, as in the
          reference thumbnails/player), not just a small label that
          appears somewhere after load. */}
      {resolved.isLive ? (
        <View style={styles.playerLiveBadge}>
          <MaterialIcons name="sensors" size={14} color="#FFFFFF" />
          <Text style={styles.playerLiveText}>LIVE</Text>
        </View>
      ) : null}
      {/* QA issues 26/71: Watch previously had NO on-screen way back
          (browser Back exited the PWA). A back overlay on the pinned
          player is the always-visible exit. */}
      <Pressable
        onPress={() => goBackOrTab(navigation, 'Home')}
        style={styles.backOverlay}
        hitSlop={8}
        accessibilityLabel="Back"
        accessibilityRole="button"
      >
        <MaterialIcons name="arrow-back" size={22} color="#FFFFFF" />
      </Pressable>
    </View>
  ) : null;

  // QA26: Watch had NO back affordance at all — the browser Back button
  // exits the SPA, stranding phone users. The back target floats over
  // the pinned player's top-left (see the player element above); the
  // error state offers its own "Go back" action.
  const header = useMemo(() => {
    if (!resolved) return null;
    const channelName = channel?.title ?? resolved.channelTitle;
    const channelAvatar = channel?.avatarUrl ?? null;
    // Screenshot 06 metadata line: "@handle · N likes · ▷ N views ·
    // date · more" — single line, parts joined only when present (the
    // old build left a leading space when the handle was missing).
    const metaText = [channel?.handle, resolved.metaLine].filter(Boolean).join('  ·  ');
    return (
      <View>
        <View style={styles.sheet}>
          <Text style={styles.title} numberOfLines={expanded ? undefined : 1}>
            {resolved.title}
          </Text>
          <Pressable
            onPress={() => setExpanded((v) => !v)}
            hitSlop={{ top: 10, bottom: 10, left: 0, right: 0 }}
            accessibilityRole="button"
            accessibilityLabel={expanded ? 'Show less' : 'Show more'}
          >
            <Text style={styles.metaLine} numberOfLines={1}>
              {metaText}
              {metaText ? '  ' : ''}
              <Text style={styles.moreText}>{expanded ? 'less' : 'more'}</Text>
            </Text>
          </Pressable>

          {/* QA issue 62: the whole channel row is the tap target to
              the Channel page; the name is one line, tail-ellipsis. */}
          <Pressable
            style={styles.channelRow}
            onPress={() => navigation.navigate('Channel', { channelId: channel?.channelId })}
            accessibilityRole="button"
            accessibilityLabel={`View channel ${channelName}`}
          >
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
              <Text style={styles.channelName} numberOfLines={1} ellipsizeMode="tail">
                {channelName}
              </Text>
              {channel?.subscriberCount != null ? (
                <Text style={styles.channelMeta} numberOfLines={1}>
                  {`${formatCount(channel.subscriberCount)} subscribers`}
                </Text>
              ) : null}
            </View>
          </Pressable>

          {/* Action row (screenshot 06): at left the light-grey pill
              beside the channel row's avatar column — here the real
              "View Channel" destination in the Subscribed pill's
              geometry (this app has no subscribe backend, so the pill
              is NOT labelled Subscribed); right-aligned icon-only
              group Like / Dislike / Share / Save / •••, no counts,
              no labels. Previously Save/Playlist/Share were crowded
              into the channel row and the pill sat alone below it. */}
          <View style={styles.actionRow}>
            <Pressable
              style={styles.channelPill}
              onPress={() => navigation.navigate('Channel', { channelId: channel?.channelId })}
              accessibilityRole="button"
              accessibilityLabel="View Channel"
            >
              <Text style={styles.channelPillText}>View Channel</Text>
              <MaterialIcons name="chevron-right" size={18} color={lightColors.text} />
            </Pressable>
            <View style={styles.actions}>
              <Pressable
                onPress={() => setReaction((r) => (r === 'like' ? null : 'like'))}
                hitSlop={ICON_HIT_SLOP}
                accessibilityLabel="Like"
                accessibilityRole="button"
                accessibilityState={{ selected: reaction === 'like' }}
              >
                <MaterialIcons
                  name={reaction === 'like' ? 'thumb-up' : 'thumb-up-off-alt'}
                  size={24}
                  color={lightColors.text}
                />
              </Pressable>
              <Pressable
                onPress={() => setReaction((r) => (r === 'dislike' ? null : 'dislike'))}
                hitSlop={ICON_HIT_SLOP}
                accessibilityLabel="Dislike"
                accessibilityRole="button"
                accessibilityState={{ selected: reaction === 'dislike' }}
              >
                <MaterialIcons
                  name={reaction === 'dislike' ? 'thumb-down' : 'thumb-down-off-alt'}
                  size={24}
                  color={lightColors.text}
                />
              </Pressable>
              <Pressable onPress={onShare} hitSlop={ICON_HIT_SLOP} accessibilityLabel="Share" accessibilityRole="button">
                <MaterialIcons name="share" size={23} color={lightColors.text} />
              </Pressable>
              {resolved.row ? (
                <Pressable
                  onPress={user ? onToggleSave : () => navigation.navigate('SignIn')}
                  hitSlop={ICON_HIT_SLOP}
                  accessibilityLabel={saved ? 'Remove from saved' : 'Save'}
                  accessibilityRole="button"
                  accessibilityState={{ selected: saved }}
                >
                  <MaterialIcons name={saved ? 'bookmark' : 'bookmark-border'} size={24} color={lightColors.text} />
                </Pressable>
              ) : null}
              {resolved.row ? (
                <Pressable
                  onPress={
                    user ? () => setPlaylistSheetOpen(true) : () => navigation.navigate('SignIn')
                  }
                  hitSlop={ICON_HIT_SLOP}
                  accessibilityLabel="Save to playlist"
                  accessibilityRole="button"
                >
                  <MaterialIcons name="more-horiz" size={24} color={lightColors.text} />
                </Pressable>
              ) : null}
            </View>
          </View>

          {/* QA issues 55/65: a description PREVIEW box is visible in
              the collapsed state (2 lines, tap to expand); in the
              expanded state the box carries its own visible
              "Show less" collapse affordance — previously "less" was
              hidden inside the meta line only. Links inside the
              expanded description are tappable (LinkedText, QA 40). */}
          {resolved.description ? (
            expanded ? (
              <View style={styles.descriptionBox}>
                <LinkedText text={resolved.description} style={styles.descriptionText} />
                <Pressable
                  onPress={() => setExpanded(false)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Show less"
                >
                  <Text style={styles.descriptionToggle}>Show less</Text>
                </Pressable>
              </View>
            ) : (
              <Pressable
                style={styles.descriptionBox}
                onPress={() => setExpanded(true)}
                accessibilityRole="button"
                accessibilityLabel="Show description"
              >
                <Text style={styles.descriptionText} numberOfLines={2} ellipsizeMode="tail">
                  {resolved.description}
                </Text>
              </Pressable>
            )
          ) : null}
        </View>
      </View>
    );
  }, [resolved, channel, expanded, user, saved, onToggleSave, onShare, navigation, reaction]);

  if (loading) {
    return (
      <View style={styles.container}>
        <View style={styles.playerSkeleton}>
          <ActivityIndicator color={lightColors.textSecondary} />
          <Text style={styles.playerSkeletonLabel}>Loading recording…</Text>
        </View>
        <View style={styles.sheetSkeleton}>
          <View style={[styles.skelLine, { width: '85%' }]} />
          <View style={[styles.skelLine, { width: '55%', marginTop: 8 }]} />
          <View style={styles.skelRow}>
            <View style={styles.skelAvatar} />
            <View style={{ flex: 1 }}>
              <View style={[styles.skelLine, { width: '40%', height: 14 }]} />
              <View style={[styles.skelLine, { width: '28%', height: 12, marginTop: 6 }]} />
            </View>
          </View>
        </View>
      </View>
    );
  }

  if (error || !resolved) {
    return (
      <View style={styles.container}>
        <View style={styles.playerSkeleton} />
        <EmptyState
          title="Recording unavailable"
          message={error ?? 'This recording could not be loaded.'}
          actionLabel="Go back"
          onAction={() => goBackOrTab(navigation, 'Home')}
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {player}
      <FlatList
        data={upNextItems}
        renderItem={renderUpNext}
        keyExtractor={keyExtractor}
        ListHeaderComponent={
          <View>
            {header}
            {/* QA issue 56: an explicit "Up Next" heading above the
                compact rows (shown only when there are items). */}
            {upNextItems.length > 0 ? <Text style={styles.upNextHeading}>Up Next</Text> : null}
          </View>
        }
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
      <Toast message={toast} />
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
  playerLiveBadge: {
    position: 'absolute',
    right: 8,
    bottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: lightColors.accent,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 3,
    zIndex: 2,
  },
  playerLiveText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  backOverlay: {
    position: 'absolute',
    top: spacing.sm,
    left: spacing.sm,
    zIndex: 10,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
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
    // Screenshot 06 / token: exactly 20px rounded top corners
    // overlapping the player's bottom edge by the same 20px (the old
    // build used token+4 = 24 on both, which read visibly rounder
    // and ate 4px more of the player than the reference).
    borderTopLeftRadius: nativeApp.watchSheet.topRadius,
    borderTopRightRadius: nativeApp.watchSheet.topRadius,
    marginTop: -nativeApp.watchSheet.topRadius,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    zIndex: 1,
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
  channelLines: { flex: 1, minWidth: 0 },
  channelName: { fontSize: 15, fontWeight: '600', color: lightColors.text },
  channelMeta: { fontSize: 13, color: lightColors.textSecondary, marginTop: 1 },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.md,
    gap: spacing.md,
  },
  channelPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: lightColors.surfaceVariant,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
  },
  channelPillText: { fontSize: 14, fontWeight: '500', color: lightColors.text },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 20, flexShrink: 0 },
  descriptionBox: {
    backgroundColor: lightColors.surfaceVariant,
    borderRadius: radii.card,
    padding: spacing.md,
    marginTop: spacing.lg,
  },
  descriptionText: { fontSize: 14, lineHeight: 20, color: lightColors.text },
  descriptionToggle: {
    fontSize: 14,
    fontWeight: '600',
    color: lightColors.text,
    marginTop: spacing.sm,
  },
  upNextHeading: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '700',
    color: lightColors.text,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  upNextEmpty: {
    fontSize: 14,
    color: lightColors.textSecondary,
    textAlign: 'center',
    paddingVertical: spacing.xl,
  },
  playerSkeleton: {
    width: '100%',
    aspectRatio: layout.thumbnailAspectRatio,
    backgroundColor: lightColors.surfaceVariant,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  playerSkeletonLabel: { ...typography.metadata, color: lightColors.textSecondary },
  // The loading sheet keeps the real sheet's geometry (white surface,
  // 20px rounded top overlapping the player) so the layout does not
  // jump when the real sheet replaces it.
  sheetSkeleton: {
    backgroundColor: lightColors.surface,
    borderTopLeftRadius: nativeApp.watchSheet.topRadius,
    borderTopRightRadius: nativeApp.watchSheet.topRadius,
    marginTop: -nativeApp.watchSheet.topRadius,
    padding: spacing.lg,
    zIndex: 1,
  },
  skelLine: { height: 18, borderRadius: 4, backgroundColor: lightColors.surfaceVariant },
  skelRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.lg, gap: spacing.md },
  skelAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: lightColors.surfaceVariant,
  },
});
