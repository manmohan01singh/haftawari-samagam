import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useIsFocused } from '@react-navigation/native';
import { CardActionSheet } from '../../components/common/CardActionSheet';
import { RequireAuthSheet } from '../../components/common/RequireAuthSheet';
import { EmptyState } from '../../components/common/EmptyState';
import { LinkedText } from '../../components/common/LinkedText';
import { Toast, useToast } from '../../components/common/Toast';
import { shareContent, shareFeedback } from '../../lib/share';
import { FeedCard } from '../../components/video/FeedCard';
import { YouTubePlayer } from '../../components/video/YouTubePlayer';
import { HostedWatchPlayer } from '../../components/video/HostedWatchPlayer';
import {
  apiCardData,
  supabaseCardData,
  formatDateLine,
  type CardVideoData,
} from '../../components/video/cardData';
import { useAuth } from '../../features/auth';
import { ChatPreviewCard, SessionChat } from '../../features/chat/components';
import {
  CommentsPreviewRow,
  VideoCommentsSheet,
  useVideoEngagement,
} from '../../features/watch';
import { sessionShareUrl, watchShareUrl } from '../../navigation/linking';
import { useCurrentChatUser } from '../../features/chat/useSessionChat';
import { joinPresence, leavePresence } from '../../features/presence/presenceService';
import { useChannelFollow, useOfficialChannel } from '../../features/channel';
import { getChannelInfoCached, getUploadsPageCached } from '../../features/channels/channelCache';
import { usePlaybackStore, type PlaybackItem } from '../../features/playback/playbackStore';
import { AddToPlaylistSheet } from '../../features/library';
import { formatCount } from '../../lib/format';
import { FEED_LIST_PERF } from '../../lib/listPerf';
import { isSupabaseConfigured } from '../../lib/supabase';
import {
  OFFICIAL_CHANNEL_HANDLE,
  OFFICIAL_CHANNEL_ID,
  fetchVideoMetadata,
  isShortVideo,
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
import { layout, nativeApp, radii, spacing, typography, useTheme, type ThemeColors } from '../../theme';
import { goBackOrTab } from '../../navigation/safeBack';
import { BackButton } from '../../components/layout/StackHeader';
import { recordLocalWatch } from '../../features/library/localHistory';
import { ICON_HIT_SLOP } from '../../lib/touch';
import type { Video, VideoSource } from '../../types/database';
import type { RootStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Watch'>;

interface ResolvedWatch {
  /** NULL for hosted rows — they have no YouTube id (migration 0005). */
  youtubeVideoId: string | null;
  /** Media source; rows fetched before migration 0005 default to 'youtube'. */
  source: VideoSource;
  title: string;
  description: string;
  channelId: string | null;
  channelTitle: string;
  metaLine: string;
  thumbnailUrl: string | null;
  /** Real duration (API contentDetails or the catalogue row). */
  durationSeconds: number | null;
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
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  // Expanded player must clear the status bar on edge-to-edge
  // Android (first-APK fix); the mini bar is a bottom bar, exempt.
  const insets = useSafeAreaInsets();
  const { videoRowId, youtubeVideoId, sessionId } = route.params;
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
  // Bell pill (reference §5): the Subscribed pill's geometry — bell +
  // chevron in a light-grey pill. There is no subscriptions backend,
  // so this drives the honest DEVICE-LOCAL follow state shared with
  // the Channel/Search screens (useChannelFollow): it never claims a
  // YouTube subscription and never changes any subscriber count.
  const { following, toggleFollow } = useChannelFollow(channel?.channelId ?? OFFICIAL_CHANNEL_ID);
  const [menuOpen, setMenuOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  // Mini player (round-4, user's direct ask): collapsing the watch
  // view into a bottom mini bar WITHOUT unmounting the player — the
  // YouTubePlayer element never leaves the tree (see the player
  // element below), only its container's style changes, so playback
  // continues across collapse/expand with no restart.
  const [mini, setMini] = useState(false);
  // Phase E: a PLAIN watch (no sessionId) plays through the root
  // persistent player (see the Phase E block below); a SESSION
  // watch keeps its in-screen player + mini bar.
  const persistent = !sessionId;
  // Minimize affordances (sheet drag-down, header chevron): a plain
  // watch minimizes to the persistent bar and leaves the screen; a
  // session watch collapses to the in-screen mini bar.
  const minimizeAndLeave = useCallback(() => {
    if (persistent) {
      usePlaybackStore.getState().minimize();
      goBackOrTab(navigation, 'Home');
    } else {
      setMini(true);
    }
  }, [persistent, navigation]);
  // Drag-down gesture on the sheet's header zone (back row + title):
  // a clearly-vertical drag past the snap threshold collapses to
  // mini. Taps are untouched (the responder only claims a gesture
  // once it is unambiguously a vertical drag), and the chevron-down
  // button in the header row is the non-gesture affordance.
  const sheetPanResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_e, g) =>
          g.dy > 10 && Math.abs(g.dy) > Math.abs(g.dx) * 1.5,
        onPanResponderRelease: (_e, g) => {
          if (g.dy > nativeApp.chatSheet.dragSnapThreshold || g.vy > 0.5) minimizeAndLeave();
        },
      }),
    [minimizeAndLeave],
  );
  // Real sangat count for a session watch: Supabase Realtime Presence
  // on the session's room (same service SessionWatchScreen uses).
  // Only signed-in viewers can be tracked, so signed-out watches show
  // no count — hidden, never invented.
  const { user: chatUser } = useCurrentChatUser();
  const [presenceCount, setPresenceCount] = useState<number | null>(null);
  // Depend on PRIMITIVES, not the chatUser object (audit P0, 28 Nov
  // 2026): useCurrentChatUser recreates the object on every profile
  // resolve and every auth-state change (incl. the hourly token
  // refresh), which tore down and re-created the presence
  // subscription each time — churn at best, the .on()-after-
  // subscribe throw at worst, potentially mid-samagam.
  const presenceUserId = chatUser?.id;
  const presenceDisplayName = chatUser?.displayName;
  useEffect(() => {
    if (!sessionId || !isSupabaseConfigured || !presenceUserId) return;
    const channel = joinPresence(
      sessionId,
      {
        userId: presenceUserId,
        displayName: presenceDisplayName ?? '',
        onlineAt: new Date().toISOString(),
      },
      (snapshot) => setPresenceCount(snapshot.participantCount),
    );
    return () => {
      void leavePresence(channel);
    };
  }, [sessionId, presenceUserId, presenceDisplayName]);
  // Comments + like engagement for THIS video (Phase 13): keyed by
  // the resolved YouTube id, so catalogue rows and API-only videos
  // behave identically. Identity comes from the chat user resolution
  // already running on this screen (real profile name + own avatar).
  const engagementUser = useMemo(
    () => (chatUser ? { id: chatUser.id, displayName: chatUser.displayName } : null),
    [chatUser],
  );
  const engagement = useVideoEngagement(
    resolved?.youtubeVideoId ?? null,
    resolved?.row?.id ?? null,
    engagementUser,
  );
  const {
    commentsStatus,
    comments,
    commentCount,
    likeStatus,
    likeCount,
    likedByMe,
    toggleLike,
  } = engagement;

  // Up Next items: local catalogue rows first; when the catalogue is
  // thin, real channel uploads from the YouTube API fill the list
  // (QA issue 58) — same compact-row rendering either way.
  type UpNextItem =
    | { kind: 'row'; video: Video }
    | { kind: 'api'; meta: YouTubeVideoMetadata };
  const [upNextItems, setUpNextItems] = useState<UpNextItem[]>([]);
  // Up Next pagination (P10 leftover fix): the uploads page token
  // from the last fetchChannelUploads page, whether uploads paging
  // has started at all, and the in-flight flag for the footer button.
  // Previously the token was discarded and the list was sliced to 15
  // with no way to load more.
  const [upNextToken, setUpNextToken] = useState<string | null>(null);
  const [upNextStarted, setUpNextStarted] = useState(false);
  const [upNextLoadingMore, setUpNextLoadingMore] = useState(false);
  // Saved state for Up Next CATALOGUE rows (their ⋮ menu carries the
  // same Save action as the main menu — it needs the row's real
  // saved state, loaded with the current video's in the effect below).
  const [upNextSavedIds, setUpNextSavedIds] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState(false);
  const [readyFor, setReadyFor] = useState<string | null>(null);
  const playerKey = resolved ? (resolved.youtubeVideoId ?? resolved.row?.id ?? null) : null;
  const playerReady = resolved != null && playerKey != null && readyFor === playerKey;

  // Phase E — persistent player. A PLAIN watch (no sessionId) hands
  // its video to the root PlaybackHost: this screen renders only a
  // measured slot, the host positions the single never-unmounted
  // player over it, and leaving the screen minimizes instead of
  // stopping (YouTube's behaviour). A SESSION watch keeps the
  // in-screen player exactly as before — presence, chat and group
  // sync belong to this screen, so its playback stays here too.
  const isFocused = useIsFocused();
  const slotRef = useRef<React.ElementRef<typeof View>>(null);

  const buildItem = useCallback((): PlaybackItem | null => {
    if (!resolved || !playerKey) return null;
    return {
      key: playerKey,
      kind: resolved.source === 'hosted' && resolved.row ? 'hosted' : 'youtube',
      youtubeVideoId: resolved.youtubeVideoId ?? null,
      videoRowId: resolved.row?.id ?? null,
      title: resolved.title,
      channelLine: channel?.title ?? resolved.channelTitle,
      thumbnailUrl: resolved.thumbnailUrl ?? null,
    };
  }, [resolved, playerKey, channel]);

  // Hand the video to the host once this screen is focused and the
  // navigation transition has settled (same 60 ms lazy-mount delay
  // the in-screen player used). Re-runs on refocus, which is what
  // restores THIS screen's video after a stacked Watch above it is
  // popped.
  useEffect(() => {
    if (!persistent || !isFocused) return;
    const item = buildItem();
    if (!item) return;
    const t = setTimeout(() => usePlaybackStore.getState().open(item), 60);
    return () => clearTimeout(t);
  }, [persistent, isFocused, buildItem]);

  // A SESSION watch pushed over a plain watch: this screen has its
  // own in-screen player at the same position, so park the
  // persistent one (minimize + flag the focused Watch as a session
  // watch) — otherwise the host would draw the previous video over
  // this screen's player and float its mini bar over the session.
  useEffect(() => {
    if (!sessionId || !isFocused) return;
    const st = usePlaybackStore.getState();
    st.setWatchKind('session');
    st.minimize();
  }, [sessionId, isFocused]);

  // Leaving a plain watch (back, tab switch, deep link) minimizes
  // the persistent player instead of killing it. The bar's X is the
  // only full stop.
  useEffect(() => {
    if (!persistent) return;
    const unsub = navigation.addListener('beforeRemove', () => {
      const st = usePlaybackStore.getState();
      if (st.item && st.item.key === playerKey) st.minimize();
    });
    return unsub;
  }, [navigation, persistent, playerKey]);

  const measureSlot = useCallback(() => {
    if (!persistent || !playerKey) return;
    const key = playerKey;
    slotRef.current?.measureInWindow((x, y, width, height) => {
      if (width > 0) usePlaybackStore.getState().setSlotRect({ key, x, y, width, height });
    });
  }, [persistent, playerKey]);

  // Re-measure once the focus transition settles: measureInWindow
  // during an animated transition can catch a mid-flight position.
  useEffect(() => {
    if (!isFocused || !persistent) return;
    measureSlot();
    const t = setTimeout(measureSlot, 400);
    return () => clearTimeout(t);
  }, [isFocused, persistent, measureSlot]);

  const [savedState, setSavedState] = useState<{ rowId: string; saved: boolean } | null>(null);
  // Like (Phase 13): REAL state now — migration 0005's video_likes
  // table (one row per member per video, keyed by youtube_video_id).
  // The toggle is optimistic, persisted, and rolled back on failure;
  // the count beside the thumb is the app's own real like-row count
  // (the meta line separately carries YouTube's count from the API).
  // Until 0005 is applied the hook reports 'unavailable' and a tap
  // answers honestly via toast that nothing was recorded — the
  // round-3 rule (no filled-thumb claim without a backend) still
  // holds. Dislike remains that honest toast: there is no dislike
  // backend and YouTube shows no dislike count either.
  const [authAction, setAuthAction] = useState<string | null>(null);
  const [commentsOpen, setCommentsOpen] = useState(false);
  // "Save to playlist" target row id (P10): the main ⋮ menu targets
  // the current video's row; an Up Next row's ⋮ menu targets THAT
  // row. One sheet, whichever id is set.
  const [playlistTargetId, setPlaylistTargetId] = useState<string | null>(null);
  const { toast, showToast } = useToast();
  const saved =
    resolved?.row && savedState?.rowId === resolved.row.id ? savedState.saved : false;
  const localHistoryRecordedFor = useRef<string | null>(null);
  const serverHistoryRecordedFor = useRef<string | null>(null);

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
        // Hosted rows (migration 0005) have no YouTube id and never
        // touch the YouTube API: everything shown comes from the row
        // itself, and playback is minted later by HostedWatchPlayer.
        if (row && (row.source ?? 'youtube') === 'hosted') {
          if (!active) return;
          setWatchState({
            key: watchKey,
            resolved: {
              youtubeVideoId: null,
              source: 'hosted',
              title: row.title,
              description: row.description ?? '',
              channelId: null,
              channelTitle: '',
              metaLine: formatDateLine(row.published_at ?? row.created_at),
              thumbnailUrl: row.thumbnail_url,
              durationSeconds: row.duration_seconds,
              row,
              isLive: false,
            },
            error: null,
          });
          return;
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
          // Reference §5 meta line, ONE line, in this order:
          // @handle · N likes · N watching (live) or ▷ N views
          // (recorded) · date · #hashtag · more. The previous build
          // pushed "watching" TWICE for live videos and put it before
          // likes — screenshot order is likes first, watching second,
          // each exactly once.
          // Attributed (Chat 2 fault 13, 28 Nov 2026): this is
          // YouTube's count for the video; the Like BUTTON's count
          // is the sangat's own in this app. Unlabelled, the two
          // numbers contradicted each other on the same screen.
          if (meta.likeCount != null) metaParts.push(`${formatCount(meta.likeCount)} likes on YouTube`);
          if (isLive) {
            if (meta.concurrentViewers != null) {
              metaParts.push(`${formatCount(meta.concurrentViewers)} watching`);
            }
          } else if (meta.viewCount != null) {
            // Reference: view counts in metadata lines carry the ▷
            // prefix ("▷ 3.3 lakh", "▷332 watching").
            metaParts.push(`▷ ${formatCount(meta.viewCount)} views`);
          }
          // ONE date format everywhere: formatDateLine (en-IN,
          // "30 Nov 2020") — the same helper the cards use.
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
            source: 'youtube',
            title: row?.title ?? meta?.title ?? '',
            description: row?.description ?? meta?.description ?? '',
            channelId: meta?.channelId ?? null,
            channelTitle: meta?.channelTitle ?? officialChannel?.title ?? '',
            metaLine: metaParts.filter(Boolean).join(' · '),
            thumbnailUrl: row?.thumbnail_url ?? meta?.thumbnailUrl ?? null,
            durationSeconds: meta?.durationSeconds ?? row?.duration_seconds ?? null,
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
    const promise = target ? getChannelInfoCached(target) : Promise.resolve(officialChannel);
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
      let token: string | null = null;
      let started = false;
      if (items.length < 4 && officialChannel?.uploadsPlaylistId) {
        const page = await getUploadsPageCached(officialChannel.uploadsPlaylistId).catch(() => null);
        if (page) {
          started = true;
          // P10: KEEP the page token — "Load more" (footer below)
          // continues from exactly here instead of the list ending.
          token = page.nextPageToken;
          const seen = new Set(rows.map((r) => r.youtube_video_id));
          if (currentYtId) seen.add(currentYtId);
          for (const meta of page.videos) {
            // NO Shorts anywhere (locked rule) — uploads pages are
            // filtered with the app's established isShortVideo rule.
            if (!seen.has(meta.youtubeVideoId) && !isShortVideo(meta)) {
              items.push({ kind: 'api' as const, meta });
            }
          }
        }
      }
      if (active) {
        setUpNextItems(items.slice(0, 15));
        setUpNextToken(token);
        setUpNextStarted(started);
      }
    })();
    return () => {
      active = false;
    };
  }, [videoRowId, officialChannel, currentYtId]);

  // "Load more" (P10): fetch the NEXT page of channel uploads —
  // page 1 when the catalogue alone filled the list and uploads
  // paging has not started, otherwise the stored next page — and
  // append only videos not already shown and not the current one.
  const upNextHasMore = !!officialChannel?.uploadsPlaylistId && (!upNextStarted || upNextToken != null);
  const loadMoreUpNext = useCallback(() => {
    const playlistId = officialChannel?.uploadsPlaylistId;
    if (!playlistId || upNextLoadingMore || !upNextHasMore) return;
    setUpNextLoadingMore(true);
    getUploadsPageCached(playlistId, upNextStarted ? (upNextToken ?? undefined) : undefined)
      .then((page) => {
        const seen = new Set<string>();
        if (currentYtId) seen.add(currentYtId);
        for (const item of upNextItems) {
          seen.add(item.kind === 'row' ? (item.video.youtube_video_id ?? `row:${item.video.id}`) : item.meta.youtubeVideoId);
        }
        const fresh = page.videos.filter(
          (meta) => !seen.has(meta.youtubeVideoId) && !isShortVideo(meta),
        );
        if (fresh.length > 0) {
          setUpNextItems((prev) => [...prev, ...fresh.map((meta) => ({ kind: 'api' as const, meta }))]);
        }
        setUpNextStarted(true);
        setUpNextToken(page.nextPageToken);
      })
      .catch(() => {
        // A failed page must not loop the button forever on the
        // same token: mark paging started with no token (footer
        // hides) — the already-shown list stays fully usable.
        setUpNextStarted(true);
        setUpNextToken(null);
      })
      .finally(() => setUpNextLoadingMore(false));
  }, [officialChannel, upNextLoadingMore, upNextHasMore, upNextStarted, upNextToken, currentYtId, upNextItems]);

  // Save toggle for an Up Next catalogue row (its ⋮ menu's Save) —
  // same optimistic pattern as the current video's onToggleSave,
  // rolled back when the saved_videos write fails.
  const onToggleSaveUpNext = useCallback(
    (video: Video) => {
      if (!user) return;
      const next = !upNextSavedIds.has(video.id);
      setUpNextSavedIds((prev) => {
        const copy = new Set(prev);
        if (next) copy.add(video.id);
        else copy.delete(video.id);
        return copy;
      });
      void setVideoSaved(user.id, video.id, next).catch(() =>
        setUpNextSavedIds((prev) => {
          const copy = new Set(prev);
          if (next) copy.delete(video.id);
          else copy.add(video.id);
          return copy;
        }),
      );
    },
    [user, upNextSavedIds],
  );

  // Saved state for archive rows (stored keyed by row id). The same
  // fetch also seeds the Up Next rows' saved set (P10) — one
  // saved_videos read serves both menus.
  useEffect(() => {
    if (!user || !resolved?.row) return;
    const rowId = resolved.row.id;
    let active = true;
    fetchSavedVideoIds(user.id)
      .then((ids) => {
        if (active) {
          setSavedState({ rowId, saved: ids.has(rowId) });
          setUpNextSavedIds(ids);
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [user, resolved]);

  // ── History write path (round-3 audit — the user, signed in,
  // watched live videos all morning and History stayed empty) ──
  // The old single effect had THREE holes:
  //  1. Signed-in + API-only video (every live/upload opened from
  //     Home/Search/Subscriptions/Channel/Up Next, which pass only a
  //     youtubeVideoId and have NO catalogue row): neither branch
  //     fired — no server row (watch_history.video_id is an FK to
  //     videos, so none can exist) and no local entry either.
  //  2. Auth race: one shared "recorded" guard was set by whichever
  //     branch ran first. On the PWA the session restores async, so
  //     the effect usually ran signed-OUT (local write, guard set);
  //     when the user arrived a moment later the guard blocked the
  //     server write for catalogue rows too.
  //  3. API-only entries lost their duration (only row durations
  //     were stored).
  // Now the two stores are written by separate effects with separate
  // guards:
  //  - LOCAL: every watch, signed in or out, row or API-only, once
  //    per video per mount, with youtube_video_id + title +
  //    thumbnail + duration — everything the History screen needs
  //    to render the entry.
  //  - SERVER: catalogue rows only, fired when the signed-in user
  //    is known (whenever auth resolves), once per row per mount.
  //
  // BOTH stores now record only after 5 seconds of REAL playing
  // state (Chat 2 fault 19, 28 Nov 2026): previously a row was
  // written on mount, so merely opening a Watch page — or an
  // autoplay chain passing through — put videos in the user's
  // History that they never actually watched.
  const storePlaying = usePlaybackStore((st) => st.playing);
  useEffect(() => {
    if (!resolved || !storePlaying) return;
    const ytId = resolved.youtubeVideoId;
    const rowId = resolved.row?.id ?? null;
    const localDone = ytId != null && localHistoryRecordedFor.current === ytId;
    const serverDone = rowId != null && serverHistoryRecordedFor.current === rowId;
    if (localDone && (serverDone || !user || !rowId)) return;
    const t = setTimeout(() => {
      if (ytId && localHistoryRecordedFor.current !== ytId) {
        localHistoryRecordedFor.current = ytId;
        void recordLocalWatch({
          youtubeVideoId: ytId,
          videoRowId: rowId,
          channelTitle: resolved.channelTitle || null,
          title: resolved.title,
          thumbnailUrl: resolved.thumbnailUrl,
          durationSeconds: resolved.durationSeconds,
        }).catch(() => undefined);
      }
      if (rowId && user && serverHistoryRecordedFor.current !== rowId) {
        serverHistoryRecordedFor.current = rowId;
        void recordWatchHistory(user.id, rowId, resolved.channelTitle || null).catch(() => undefined);
      }
    }, 5000);
    return () => clearTimeout(t);
  }, [resolved, user, storePlaying]);

  // Lazy player mount: mark this video ready only after the navigation
  // transition settles (timer callback), so the screen opens smoothly
  // and the embed never loads on any other screen.
  useEffect(() => {
    if (!resolved) return;
    const ytId = resolved.youtubeVideoId ?? resolved.row?.id ?? null;
    const t = setTimeout(() => setReadyFor(ytId), 60);
    return () => clearTimeout(t);
  }, [resolved]);

  // Share (Phase 13): the link opens THIS app, not youtube.com — a
  // session watch shares the session's own deep link (the tapped
  // link lands on that Samagam in the app), a plain recording shares
  // its Watch deep link. Playback inside still uses the official
  // embed; only the doorway is ours.
  const onShare = useCallback(() => {
    if (!resolved) return;
    const url = sessionId
      ? sessionShareUrl(sessionId)
      : watchShareUrl({
          videoRowId: resolved.row?.id ?? videoRowId,
          youtubeVideoId: resolved.youtubeVideoId,
        });
    void shareContent(resolved.title, url).then((outcome) => {
      const feedback = shareFeedback(outcome);
      if (feedback) showToast(feedback);
    });
  }, [resolved, sessionId, videoRowId, showToast]);

  // Like tap: signed-out goes to SignIn (same gating as Save); the
  // unavailable backend (migration 0005 pending) answers honestly;
  // otherwise the hook's optimistic persisted toggle runs and only a
  // failure speaks.
  const onToggleLike = useCallback(() => {
    if (!resolved) return;
    if (!user) {
      setAuthAction('like this samagam');
      return;
    }
    if (likeStatus === 'unavailable') {
      showToast('Likes are not available yet — nothing was recorded');
      return;
    }
    void toggleLike().then((outcome) => {
      if (outcome === 'unavailable') {
        showToast('Likes are not available yet — nothing was recorded');
      } else if (outcome === 'failed') {
        showToast('Could not save your like — please try again');
      }
    });
  }, [resolved, user, likeStatus, toggleLike, navigation, showToast]);

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
      const shareItem = (
        title: string,
        params: { videoRowId?: string; youtubeVideoId?: string },
      ) => {
        void shareContent(title, watchShareUrl(params)).then((outcome) => {
          const feedback = shareFeedback(outcome);
          if (feedback) showToast(feedback);
        });
      };
      // Mini mode: an Up Next tap loads the video IN PLACE and
      // re-expands — pushing a second Watch screen would stack two
      // mounted embeds and both would play. Expanded mode keeps the
      // normal push.
      const openItem = (params: { videoRowId?: string; youtubeVideoId?: string }) => {
        if (mini) {
          // Pass BOTH keys so the other one is cleared — setParams
          // merges, and a stale youtubeVideoId would shadow the new
          // videoRowId (watchKey prefers neither; resolution reads
          // both).
          navigation.setParams({
            videoRowId: params.videoRowId,
            youtubeVideoId: params.youtubeVideoId,
            // A session Watch opened with a sessionId must not keep
            // that session's chat bound to a different video.
            sessionId: undefined,
          });
          setMini(false);
        } else if (params.videoRowId) {
          navigation.push('Watch', { videoRowId: params.videoRowId });
        } else if (params.youtubeVideoId) {
          navigation.push('Watch', { youtubeVideoId: params.youtubeVideoId });
        }
      };
      // Row ⋮ menu (P10 leftover fix): the SAME items as the main
      // ⋮ menu wherever they make sense for another video — Share,
      // Save, Save to playlist, View Channel (CardActionSheet adds
      // Cancel itself). Save/playlist exist only for catalogue rows
      // (saved_videos/playlists are FKs to videos rows), exactly as
      // the main menu omits them for API-only videos; signed-out
      // taps go to SignIn, mirroring the main menu's gating.
      if (item.kind === 'api') {
        const data: CardVideoData = apiCardData(item.meta, officialChannel?.avatarUrl ?? null);
        return (
          <FeedCard
            variant="upNext"
            data={data}
            onPress={() => openItem({ youtubeVideoId: item.meta.youtubeVideoId })}
            onShare={() => shareItem(item.meta.title, { youtubeVideoId: item.meta.youtubeVideoId })}
            onChannelPress={() =>
              navigation.navigate('Channel', { channelId: officialChannel?.channelId })
            }
            menuActions={[
              {
                key: 'share',
                label: 'Share',
                icon: 'share',
                onPress: () => shareItem(item.meta.title, { youtubeVideoId: item.meta.youtubeVideoId }),
              },
              {
                key: 'channel',
                label: 'View Channel',
                icon: 'account-circle',
                onPress: () =>
                  navigation.navigate('Channel', { channelId: item.meta.channelId }),
              },
            ]}
          />
        );
      }
      const rowSaved = upNextSavedIds.has(item.video.id);
      const data: CardVideoData = supabaseCardData(item.video, officialChannel?.avatarUrl ?? null);
      return (
        <FeedCard
          variant="upNext"
          data={data}
          onPress={() => openItem({ videoRowId: item.video.id })}
          onShare={() => shareItem(item.video.title, { videoRowId: item.video.id })}
          onChannelPress={() =>
            navigation.navigate('Channel', { channelId: officialChannel?.channelId })
          }
          menuActions={[
            {
              key: 'share',
              label: 'Share',
              icon: 'share',
              onPress: () => shareItem(item.video.title, { videoRowId: item.video.id }),
            },
            {
              key: 'save',
              label: rowSaved ? 'Remove from saved' : 'Save',
              icon: rowSaved ? 'bookmark' : 'bookmark-border',
              onPress: user
                ? () => onToggleSaveUpNext(item.video)
                : () => setAuthAction('save this samagam'),
            },
            {
              key: 'playlist',
              label: 'Save to playlist',
              icon: 'playlist-add',
              onPress: user
                ? () => setPlaylistTargetId(item.video.id)
                : () => setAuthAction('save this samagam to a playlist'),
            },
            {
              key: 'channel',
              label: 'View Channel',
              icon: 'account-circle',
              onPress: () =>
                navigation.navigate('Channel', { channelId: officialChannel?.channelId }),
            },
          ]}
        />
      );
    },
    [navigation, officialChannel, showToast, mini, user, upNextSavedIds, onToggleSaveUpNext],
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
    <View style={[styles.playerWrap, mini && styles.playerWrapMini, !mini && { marginTop: insets.top }]}>
      {/* The player box is in the SAME tree position in both modes —
          only its style changes (full 16:9 ↔ 106px mini thumb). The
          YouTubePlayer element therefore never unmounts/remounts on
          collapse/expand, and playback does not restart.
          Phase E: for a PLAIN watch this box is only a measured
          SLOT — the player itself lives in the root PlaybackHost,
          positioned exactly over this box, so it survives leaving
          the screen (mini player). Session watches keep the
          in-screen player below. */}
      <View
        ref={persistent ? slotRef : undefined}
        onLayout={persistent ? measureSlot : undefined}
        style={[styles.playerBox, mini && styles.playerBoxMini]}
      >
        {persistent ? (
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
        ) : playerReady ? (
          resolved.source === 'hosted' && resolved.row ? (
            <HostedWatchPlayer videoId={resolved.row.id} thumbnailUrl={resolved.thumbnailUrl} title={resolved.title} />
          ) : resolved.youtubeVideoId ? (
            <YouTubePlayer youtubeVideoId={resolved.youtubeVideoId} />
          ) : (
            <View style={styles.playerThumb} />
          )
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
      {mini ? (
        <>
          <Pressable
            style={styles.miniTitleZone}
            onPress={() => setMini(false)}
            accessibilityRole="button"
            accessibilityLabel="Expand player"
          >
            <Text style={styles.miniTitle} numberOfLines={2} ellipsizeMode="tail">
              {resolved.title}
            </Text>
            <Text style={styles.miniChannel} numberOfLines={1} ellipsizeMode="tail">
              {channel?.title ?? resolved.channelTitle}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setMini(false)}
            hitSlop={ICON_HIT_SLOP}
            accessibilityRole="button"
            accessibilityLabel="Expand player"
          >
            <MaterialIcons name="expand-less" size={24} color={colors.text} />
          </Pressable>
          <Pressable
            onPress={() => goBackOrTab(navigation, 'Home')}
            hitSlop={ICON_HIT_SLOP}
            accessibilityRole="button"
            accessibilityLabel="Close player"
          >
            <MaterialIcons name="close" size={24} color={colors.text} />
          </Pressable>
        </>
      ) : null}
      {/* Round-3 (user's phone, 27 Nov): NOTHING of ours overlays the
          player rectangle — no back arrow, no LIVE pill. The old
          back overlay sat on top of the embed's own title/channel
          icon ("LIVE | Dhan Guru…" was cut), and our LIVE pill
          duplicated the embed's own LIVE badge. The embed's own
          branding/badges stay exactly as YouTube serves them; the
          back control lives in the sheet's header zone (below). The
          only thing inside this rectangle besides the embed is its
          own loading poster (thumbnail + spinner, pointer-events
          none), removed the moment the embed mounts. */}
    </View>
  ) : null;

  // Back control (round-3): a plain dark arrow in the SHEET's header
  // zone, above the title — never on the video. Shared by the loaded,
  // loading and error states so the exit is always in the same place.
  const backRow = useMemo(
    () => (
      <View style={styles.backRow}>
        <BackButton onPress={() => goBackOrTab(navigation, 'Home')} />
      </View>
    ),
    [navigation, styles],
  );

  const header = useMemo(() => {
    if (!resolved) return null;
    // Mini mode: the sheet is gone (the mini bar at the bottom is the
    // watch surface now); the list shows only the Up Next heading,
    // rendered by the FlatList header wrapper below.
    if (mini) return null;
    const channelName = channel?.title ?? resolved.channelTitle;
    const channelAvatar = channel?.avatarUrl ?? null;
    // Screenshot 06 metadata line: "@handle · N likes · ▷ N views ·
    // date · #tag · more" — ONE single line, parts joined only when
    // present. Archive rows belong to the official channel, so its
    // real handle fills in until the channel fetch lands (the old
    // build left the handle out entirely in that window).
    const handle = channel?.handle ?? (resolved.row ? OFFICIAL_CHANNEL_HANDLE : null);
    const metaText = [handle, resolved.metaLine].filter(Boolean).join(' · ');
    return (
      <View style={styles.headerWrap}>
        <View style={styles.sheet}>
          {/* Mini-player gesture zone: drag DOWN on this header strip
              (back row + title) collapses to the mini bar; the
              chevron-down at the row's right is the tap affordance.
              The responder only claims clearly-vertical drags, so
              the back tap and the meta line's tap still work. */}
          <View {...sheetPanResponder.panHandlers}>
            <View style={styles.backRowLine}>
              {backRow}
              <Pressable
                onPress={minimizeAndLeave}
                style={styles.backButton}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Minimise player"
              >
                <MaterialIcons name="expand-more" size={24} color={colors.text} />
              </Pressable>
            </View>
            <Text style={styles.title} numberOfLines={expanded ? undefined : 2}>
              {resolved.title}
            </Text>
          </View>
          {/* P10 leftover fix: collapsed keeps the single truncated
              line, but EXPANDED must wrap the meta text fully — it
              previously stayed numberOfLines={1}, so expanding still
              showed "…17.2K vie…" cut off mid-word. */}
          <Pressable
            onPress={() => setExpanded((v) => !v)}
            hitSlop={{ top: 10, bottom: 10, left: 0, right: 0 }}
            accessibilityRole="button"
            accessibilityLabel={expanded ? 'Show less' : 'Show more'}
          >
            <Text style={styles.metaLine} numberOfLines={expanded ? undefined : 1}>
              {metaText}
              {/* Round-3 sweep (27 Nov 2026): plain '  ' collapses to
                  nothing in the web render, so the toggle read
                  "2020less". Non-breaking spaces survive on web and
                  native alike. */}
              {metaText ? '\u00A0\u00A0' : ''}
              <Text style={styles.moreText}>{expanded ? 'less' : 'more'}</Text>
            </Text>
          </Pressable>

          {/* QA issue 62: the whole channel row is the tap target to
              the Channel page; the name is one line, tail-ellipsis. */}
          <Pressable
            style={({ pressed }) => [styles.channelRow, pressed && styles.actionPressed]}
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

          {/* Action row (screenshot 06): at left the light-grey bell
              pill in the Subscribed pill's exact geometry (bell +
              chevron-down). It toggles the device-local follow state
              (see useChannelFollow above) — it is NOT labelled
              "Subscribed" because there is no subscription backend.
              Right-aligned icon group: Like / Dislike / Share /
              Save / ⋮, 24px. The reference's sparkle (Ask) slot is
              NOT rendered: this app has no Ask backend, and a dead
              sparkle would be a fake action — flagged in the QA
              report. Like is REAL since Phase 13 (video_likes,
              migration 0005): filled thumb when the member's like
              row exists, the app's real like count beside it when
              non-zero; while the migration is pending it falls back
              to the round-3 honest toast. Dislike still holds no
              state — no backend, honest toast only. */}
          <View style={styles.actionRow}>
            <Pressable
              style={styles.channelPill}
              onPress={() => {
                toggleFollow();
                showToast(
                  following
                    ? 'Removed from your followed channels on this device'
                    : 'Following this channel on this device',
                );
              }}
              accessibilityRole="button"
              accessibilityLabel={following ? 'Following this channel' : 'Follow this channel'}
              accessibilityState={{ selected: following }}
            >
              <MaterialIcons
                name={following ? 'notifications' : 'notifications-none'}
                size={20}
                color={colors.text}
              />
              <MaterialIcons name="expand-more" size={18} color={colors.text} />
            </Pressable>
            <View style={styles.actions}>
              {/* YouTube's segmented Like|Dislike pill (audit B2):
                  one surfaceVariant capsule, real like count inside,
                  a divider, then Dislike. */}
              <View style={styles.likePill}>
                <Pressable
                  onPress={onToggleLike}
                  hitSlop={ICON_HIT_SLOP}
                  accessibilityLabel="Like"
                  accessibilityRole="button"
                  accessibilityState={{ selected: likedByMe }}
                  style={({ pressed }) => [styles.likeButton, pressed && styles.actionPressed]}
                >
                  <MaterialIcons
                    name={likedByMe ? 'thumb-up' : 'thumb-up-off-alt'}
                    size={22}
                    color={colors.text}
                  />
                  {likeStatus === 'ready' && likeCount > 0 ? (
                    <Text style={styles.likeCount}>{formatCount(likeCount)}</Text>
                  ) : null}
                </Pressable>
                <View style={styles.likeDivider} />
                <Pressable
                  onPress={() => showToast('Dislikes are not available in this app yet — nothing was recorded')}
                  hitSlop={ICON_HIT_SLOP}
                  accessibilityLabel="Dislike"
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.likeButton, pressed && styles.actionPressed]}
                >
                  <MaterialIcons name="thumb-down-off-alt" size={22} color={colors.text} />
                </Pressable>
              </View>
              <Pressable
                onPress={onShare}
                hitSlop={ICON_HIT_SLOP}
                accessibilityLabel="Share"
                accessibilityRole="button"
                style={({ pressed }) => pressed && styles.actionPressed}
              >
                <MaterialIcons name="share" size={24} color={colors.text} />
              </Pressable>
              {resolved.row ? (
                <Pressable
                  onPress={user ? onToggleSave : () => setAuthAction('save this samagam')}
                  hitSlop={ICON_HIT_SLOP}
                  accessibilityLabel={saved ? 'Remove from saved' : 'Save'}
                  accessibilityRole="button"
                  accessibilityState={{ selected: saved }}
                  style={({ pressed }) => pressed && styles.actionPressed}
                >
                  <MaterialIcons name={saved ? 'bookmark' : 'bookmark-border'} size={24} color={colors.text} />
                </Pressable>
              ) : null}
              {/* ⋮ (screenshot 06's horizontal •••): opens the real
                  action menu (Share / Save / Save to playlist / View
                  Channel) — always present, for API-only videos too.
                  Previously this icon was hidden for non-archive
                  videos and, when shown, opened the playlist sheet
                  directly under a misleading "more" glyph. */}
              <Pressable
                onPress={() => setMenuOpen(true)}
                hitSlop={ICON_HIT_SLOP}
                accessibilityLabel="More actions"
                accessibilityRole="button"
                style={({ pressed }) => pressed && styles.actionPressed}
              >
                <MaterialIcons name="more-horiz" size={24} color={colors.text} />
              </Pressable>
            </View>
          </View>

          {/* Live chat preview (reference §5 + round-3): rendered
              ONLY when this watch was opened for a real Samagam
              session (route carries a sessionId) — the grey box,
              "Live chat" label and the signed-in user's own
              "Chat publicly as …" pill, in ChatPreviewCard's ref
              geometry (radius 16, padding 12, avatar 36). Tapping it
              opens the real SessionChat sheet (rendered at the root
              below). A plain recording has no session and gets NO
              chat box — a "Live chat" label under a prerecorded
              video would mislabel it. The participant count is the
              REAL Realtime Presence count for this session's room
              (joined above when signed in); signed-out, it stays
              hidden rather than invented. */}
          {sessionId ? (
            <View style={styles.chatWrap}>
              <ChatPreviewCard
                sessionId={sessionId}
                participantCount={presenceCount ?? undefined}
                onPress={() => setChatOpen(true)}
                // Same rule as the session page: the sheet opens and
                // shows its own sign-in state; its button navigates.
                onSignInPress={() => setChatOpen(true)}
              />
            </View>
          ) : null}

          {/* Comments (Phase 13) sit ABOVE the description (user
              change request, 27 Nov, verified on his phone on build
              5e3ed9ae: "description nu comments de upro remove karke
              thale rehn de"). The row is the YouTube-pattern entry —
              real count + newest-comment preview, opening the
              VideoCommentsSheet (root-level modal below). This is
              the RECORDING's comments (public, video_comments); a
              session watch ALSO keeps its Live chat card above —
              the two are different data and are never merged. */}
          <CommentsPreviewRow
            status={commentsStatus}
            count={commentCount}
            topComment={comments[0] ?? null}
            ownUserId={chatUser?.id ?? null}
            ownAvatarUrl={chatUser?.avatarUrl ?? null}
            signedIn={!!user}
            onPress={() => setCommentsOpen(true)}
          />

          {/* QA issues 55/65: a description PREVIEW box is visible in
              the collapsed state (2 lines, tap to expand); in the
              expanded state the box carries its own visible
              "Show less" collapse affordance — previously "less" was
              hidden inside the meta line only. Links inside the
              expanded description are tappable (LinkedText, QA 40).
              Position: BELOW the Comments row (see above). */}
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
                  {/* Newlines collapse to spaces in the 2-line preview
                      so words never run together ("SahibSahibJi");
                      the expanded view keeps the real line breaks. */}
                  {resolved.description.replace(/\s*\n\s*/g, ' ')}
                </Text>
                {/* Visible expand control, mirroring the expanded
                    state's "Show less" — the collapsed box previously
                    gave no sign it could be opened. */}
                <Text style={styles.descriptionToggle}>Show more</Text>
              </Pressable>
            )
          ) : null}

        </View>
      </View>
    );
  }, [
    resolved,
    channel,
    expanded,
    user,
    saved,
    onToggleSave,
    onShare,
    navigation,
    following,
    toggleFollow,
    showToast,
    backRow,
    sessionId,
    presenceCount,
    mini,
    sheetPanResponder,
    minimizeAndLeave,
    colors,
    styles,
    onToggleLike,
    commentsStatus,
    commentCount,
    comments,
    chatUser,
    likeStatus,
    likeCount,
    likedByMe,
  ]);

  if (loading) {
    return (
      <View style={styles.container}>
        {/* Player loading state: the video's REAL thumbnail (derived
            from the route's YouTube id when we have one) + spinner —
            never a long black box, and (round-3) NOTHING overlaid on
            it: the back control sits in the sheet skeleton below,
            exactly where it sits in the loaded sheet. */}
        <View style={styles.playerSkeleton}>
          {youtubeVideoId ? (
            <Image
              source={{ uri: `https://i.ytimg.com/vi/${encodeURIComponent(youtubeVideoId)}/hqdefault.jpg` }}
              style={styles.playerThumb}
              contentFit="cover"
              cachePolicy="memory-disk"
            />
          ) : null}
          <View style={styles.playerSpinner}>
            <ActivityIndicator color={youtubeVideoId ? '#FFFFFF' : colors.textSecondary} />
            {!youtubeVideoId ? (
              <Text style={styles.playerSkeletonLabel}>Loading recording…</Text>
            ) : null}
          </View>
        </View>
        <View style={styles.sheetSkeleton}>
          {backRow}
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
        <View style={styles.sheetSkeleton}>{backRow}</View>
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
        style={[styles.list, mini && styles.listMini]}
        contentContainerStyle={[styles.listContent, mini && styles.listContentMini]}
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
        ListFooterComponent={
          // Paging continues automatically via onEndReached (audit
          // B5 — YouTube's Up Next never asks for a tap); the footer
          // is just a spinner while the next page is in flight.
          upNextItems.length > 0 && upNextLoadingMore ? (
            <View style={styles.loadMoreRow}>
              <ActivityIndicator color={colors.textSecondary} />
            </View>
          ) : undefined
        }
        onEndReached={loadMoreUpNext}
        onEndReachedThreshold={0.5}
        {...FEED_LIST_PERF}
      />
      {/* ⋮ action menu (screenshot 06 •••): only actions that really
          work here — Share (system sheet), Save + Save to playlist
          (saved_videos / playlists backends, archive rows + signed-in
          users; signed-out taps go to SignIn, as the Save icon does),
          and View Channel. */}
      <CardActionSheet
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        actions={[
          { key: 'share', label: 'Share', icon: 'share', onPress: onShare },
          ...(resolved.row
            ? [
                {
                  key: 'save',
                  label: saved ? 'Remove from saved' : 'Save',
                  icon: saved ? 'bookmark' : 'bookmark-border',
                  onPress: user ? onToggleSave : () => setAuthAction('save this samagam'),
                },
                {
                  key: 'playlist',
                  label: 'Save to playlist',
                  icon: 'playlist-add',
                  onPress: user
                    ? () => setPlaylistTargetId(resolved.row?.id ?? null)
                    : () => setAuthAction('save this samagam to a playlist'),
                },
              ]
            : []),
          {
            key: 'channel',
            label: 'View Channel',
            icon: 'account-circle',
            onPress: () =>
              navigation.navigate('Channel', { channelId: channel?.channelId }),
          },
        ]}
      />
      {/* Live chat sheet — only reachable when a real sessionId
          opened this watch (the preview card above is its only
          doorway). Same host pattern as SessionWatchScreen:
          SessionChat owns its own height so the player stays
          visible above the sheet. */}
      {sessionId ? (
        <Modal
          visible={chatOpen}
          animationType="slide"
          transparent
          onRequestClose={() => setChatOpen(false)}
        >
          <View style={styles.chatBackdrop}>
            <Pressable
              style={styles.chatBackdropTap}
              onPress={() => setChatOpen(false)}
              accessibilityLabel="Close chat"
              accessibilityRole="button"
            />
            <View style={styles.chatSheetHost}>
              <SessionChat
                sessionId={sessionId}
                participantCount={presenceCount ?? undefined}
                onClose={() => setChatOpen(false)}
              />
            </View>
          </View>
        </Modal>
      ) : null}
      {/* Comments sheet (Phase 13) — the recording's own comments,
          reachable from the CommentsPreviewRow in the sheet above.
          Same Modal host pattern as the chat sheet. Signed-out
          posting is impossible by design: the sheet shows a sign-in
          prompt instead of a composer. */}
      <Modal
        visible={commentsOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setCommentsOpen(false)}
      >
        <View style={styles.chatBackdrop}>
          <Pressable
            style={styles.chatBackdropTap}
            onPress={() => setCommentsOpen(false)}
            accessibilityLabel="Close comments"
            accessibilityRole="button"
          />
          <View style={styles.chatSheetHost}>
            <RequireAuthSheet
              action={authAction}
              onDismiss={() => setAuthAction(null)}
              onSignIn={() => {
                setAuthAction(null);
                navigation.navigate('SignIn');
              }}
            />
            <VideoCommentsSheet
              engagement={engagement}
              user={
                chatUser
                  ? {
                      id: chatUser.id,
                      displayName: chatUser.displayName,
                      avatarUrl: chatUser.avatarUrl ?? null,
                    }
                  : null
              }
              onClose={() => setCommentsOpen(false)}
              onSignInPress={() => {
                setCommentsOpen(false);
                navigation.navigate('SignIn');
              }}
            />
          </View>
        </View>
      </Modal>
      {/* "Save to playlist" sheet (library stream) — archive rows and
          signed-in users only, matching the action button's gating.
          The target is whichever row opened it: the current video
          (main ⋮ menu) or an Up Next row (its ⋮ menu). */}
      <AddToPlaylistSheet
        visible={playlistTargetId != null}
        userId={user?.id ?? null}
        videoId={playlistTargetId}
        onClose={() => setPlaylistTargetId(null)}
      />
      <Toast message={toast} />
    </View>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  playerWrap: {
    width: '100%',
    // Wide screens (round-3 live check, desktop 1919px): an uncapped
    // full-width 16:9 player is ~1080px tall — taller than the
    // viewport — and the sheet/Up Next below it became unreachable
    // (wheel events land on the iframe). Cap the watch column at
    // 1100px, centred, like YouTube's desktop watch column; phone
    // widths (≤1100) are completely unaffected.
    maxWidth: 1100,
    alignSelf: 'center',
    backgroundColor: colors.playerBackground,
  },
  // The 16:9 box lives one level in (round-4) so the mini bar can
  // restyle the WRAP into a bottom bar while the box — and the
  // player inside it — only changes size, never remounts.
  playerBox: { width: '100%', aspectRatio: layout.thumbnailAspectRatio },
  playerBoxMini: { width: 106, aspectRatio: layout.thumbnailAspectRatio, borderRadius: 6, overflow: 'hidden' },
  playerWrapMini: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxWidth: '100%',
    alignSelf: 'auto',
    height: 64,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    shadowColor: '#000000',
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: -2 },
    elevation: 8,
    zIndex: 20,
  },
  miniTitleZone: { flex: 1, justifyContent: 'center' },
  miniTitle: { fontSize: 13, lineHeight: 17, fontWeight: '500', color: colors.text },
  miniChannel: { fontSize: 11, lineHeight: 14, color: colors.textSecondary, marginTop: 1 },
  listMini: { marginTop: 0 },
  listContentMini: { paddingBottom: 80 },
  backRowLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  // The list itself is pulled 20px UP over the player's bottom edge
  // (round-3 device check: the sheet's old -20 margin was clipped
  // inside the scroll view, so the rounded corners never actually
  // overlapped the video — the seam rendered as a straight edge).
  // With the list overlapping, the sheet's corner notches reveal the
  // video behind them, exactly as in ref-watch-live.
  list: { flex: 1, marginTop: 0, zIndex: 1 },
  listContent: { width: '100%', maxWidth: 1100, alignSelf: 'center' },
  headerWrap: { position: 'relative' },
  playerThumb: { width: '100%', height: '100%', backgroundColor: colors.playerBackground },
  // Back control: the shared BackButton (Phase 9) in the sheet's
  // header zone, above the title — a plain dark arrow on white, 48dp
  // target; its -12 margin + centred glyph put the icon's left edge
  // at the sheet's 16dp content inset, aligned with the title text.
  backRow: { flexDirection: 'row', alignItems: 'center' },
  backButton: {
    width: 36,
    height: 36,
    marginLeft: -6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chatWrap: { marginTop: spacing.lg },
  chatBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  chatBackdropTap: { flex: 1 },
  chatSheetHost: { justifyContent: 'flex-end' },
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
    backgroundColor: colors.surface,
    // Screenshot 06 / token: exactly 20px rounded top corners. The
    // OVERLAP itself now comes from the list's -20 margin (see
    // styles.list) — the sheet's own margin is 0, because a negative
    // margin inside the scroll view was clipped at its top edge and
    // the corners never showed over the video (device check).
    borderTopLeftRadius: nativeApp.watchSheet.topRadius,
    borderTopRightRadius: nativeApp.watchSheet.topRadius,
    paddingHorizontal: spacing.lg,
    // The back row occupies the sheet's header zone. Phase 9: the
    // shared BackButton is 48dp tall (was a hand-rolled 36dp), so top
    // padding drops to 0 — the title lands ≈4dp below the round-3
    // measured offset, the accepted cost of the standard 48dp target.
    paddingTop: 0,
    paddingBottom: spacing.md,
    zIndex: 1,
  },
  title: { fontSize: 20, lineHeight: 26, fontWeight: '600', color: colors.text },
  metaLine: { fontSize: 14, color: colors.textSecondary, marginTop: spacing.md },
  moreText: { color: colors.text, fontWeight: '600' },
  channelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.lg,
    gap: spacing.md,
  },
  channelAvatar: { width: 40, height: 40, borderRadius: 20 },
  avatarFallback: {
    backgroundColor: colors.surfaceVariant,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: { fontSize: 16, fontWeight: '600', color: colors.textSecondary },
  channelLines: { flex: 1, minWidth: 0 },
  channelName: { fontSize: 15, fontWeight: '600', color: colors.text },
  channelMeta: { fontSize: 13, color: colors.textSecondary, marginTop: 1 },
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
    backgroundColor: colors.surfaceVariant,
    borderRadius: radii.pill,
    // Screenshot 06 bell pill: ≈52×40dp, icon-only (bell + chevron).
    paddingHorizontal: spacing.md + 2,
    paddingVertical: 9,
  },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 20, flexShrink: 0 },
  // Like (Phase 13): thumb + the app's real like count on one tap
  // target; the count text inherits the row's 24px icon rhythm.
  likeButton: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  likeCount: { fontSize: 13, fontWeight: '600', color: colors.text },
  // Segmented Like|Dislike capsule (YouTube's current watch row).
  likePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceVariant,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    minHeight: 40,
  },
  likeDivider: { width: 1, height: 20, backgroundColor: colors.border, marginHorizontal: spacing.sm },
  actionPressed: { opacity: 0.6 },
  descriptionBox: {
    backgroundColor: colors.surfaceVariant,
    borderRadius: radii.card,
    padding: spacing.md,
    marginTop: spacing.lg,
  },
  descriptionText: { fontSize: 14, lineHeight: 20, color: colors.text },
  descriptionToggle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    marginTop: spacing.sm,
  },
  upNextHeading: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '700',
    color: colors.text,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  upNextEmpty: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    paddingVertical: spacing.xl,
  },
  loadMoreRow: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    marginHorizontal: spacing.lg,
    marginVertical: spacing.md,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceVariant,
  },
  loadMoreText: { fontSize: 14, fontWeight: '600', color: colors.text },
  playerSkeleton: {
    width: '100%',
    maxWidth: 1100,
    alignSelf: 'center',
    aspectRatio: layout.thumbnailAspectRatio,
    backgroundColor: colors.surfaceVariant,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  playerSkeletonLabel: { ...typography.metadata, color: colors.textSecondary },
  // The loading sheet keeps the real sheet's geometry (white surface,
  // 20px rounded top overlapping the player) so the layout does not
  // jump when the real sheet replaces it.
  sheetSkeleton: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: nativeApp.watchSheet.topRadius,
    borderTopRightRadius: nativeApp.watchSheet.topRadius,
    marginTop: 0,
    padding: spacing.lg,
    zIndex: 1,
  },
  skelLine: { height: 18, borderRadius: 4, backgroundColor: colors.surfaceVariant },
  skelRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.lg, gap: spacing.md },
  skelAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceVariant,
  },
});
