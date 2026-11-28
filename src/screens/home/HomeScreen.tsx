import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { CompositeScreenProps } from '@react-navigation/native';
import { useScrollToTop } from '@react-navigation/native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AppHeader } from '../../components/layout/AppHeader';
import { IkOnkarMark } from '../../components/layout/IkOnkarMark';
import { useWebPullToRefresh } from '../../components/gesture/WebPullToRefresh';
import { ChipsRow } from '../../components/layout/ChipsRow';
import { Toast, useToast } from '../../components/common/Toast';
import { AddToPlaylistSheet } from '../../features/library';
import { RequireAuthSheet } from '../../components/common/RequireAuthSheet';
import { shareContent, shareFeedback } from '../../lib/share';
import { EmptyState } from '../../components/common/EmptyState';
import { FeedCard } from '../../components/video/FeedCard';
import { SkeletonCard } from '../../components/video/SkeletonCard';
import { apiCardData, listThumbnailUrl, supabaseCardData, type CardVideoData } from '../../components/video/cardData';
import { useAuth } from '../../features/auth';
import { useOfficialChannel } from '../../features/channel';
import { uploadsPlaylistIdFor, useActiveChannels } from '../../features/channels/channelsService';
import {
  HOME_CHIPS,
  createHomeFeedPager,
  feedItemYoutubeId,
  resolveChipFilter,
  sortFeedItems,
  type HomeFeedItem,
  type HomeFeedPager,
} from '../../features/home/homeFeed';
import { isSupabaseConfigured, supabase } from '../../lib/supabase';
import {
  OFFICIAL_CHANNEL_ID,
  fetchVideosMetadata,
  isYouTubeConfigured,
  type YouTubeVideoMetadata,
} from '../../lib/youtube';
import { getLiveCached, getLiveFresh, invalidateUploadsFirstPages } from '../../features/channels/channelCache';
import { useDockInset } from '../../features/playback/useDockInset';
import { fetchSavedVideoIds, setVideoSaved } from '../../lib/videos';
import { FEED_LIST_PERF } from '../../lib/listPerf';
import { listSessionsWithVideos, uniqueTopic } from '../../features/sessions/sessionService';
import { deriveStatus } from '../../features/sessions/stateMachine';
import { serverClock } from '../../features/sessions/serverClock';
import { layout, spacing, typography, useTheme, type ThemeColors } from '../../theme';
import type { MainTabParamList, RootStackParamList } from '../../navigation/types';
import { watchShareUrl } from '../../navigation/linking';

type Props = CompositeScreenProps<
  BottomTabScreenProps<MainTabParamList, 'Home'>,
  NativeStackScreenProps<RootStackParamList>
>;

const PAGE_SIZE = 25;
const ALL_CHIP = 'All';

/**
 * Chip results cache, MODULE-level (fix round 5, #1): it used to
 * live in a ref, so any remount of this screen (tab returns in the
 * cloud browser, navigation resets) threw away every chip's items
 * and the full "Gathering the sangat…" loader ran again — while
 * the Back-route restore, which never remounted, looked instant.
 * Module scope survives remounts for the whole app session.
 */
const SHARED_CHIP_CACHE = new Map<string, { items: HomeFeedItem[]; exhausted: boolean }>();

/** "Today · 7:00 PM" / "Tomorrow · 4:00 PM" / "Sat, 5 Dec · 4:00 PM" — device-local. */
function formatSessionStart(startAtMs: number): string {
  const start = new Date(startAtMs);
  const now = new Date();
  const time = start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (start.toDateString() === now.toDateString()) return `Today · ${time}`;
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (start.toDateString() === tomorrow.toDateString()) return `Tomorrow · ${time}`;
  const day = start.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
  return `${day} · ${time}`;
}

interface HomeFeedCellProps {
  item: HomeFeedItem;
  data: CardVideoData;
  saved: boolean;
  canSave: boolean;
  onPressItem: (item: HomeFeedItem) => void;
  onToggleSaveItem: (item: HomeFeedItem) => void;
  onShareItem: (item: HomeFeedItem) => void;
  onChannelPressItem: (item: HomeFeedItem) => void;
  onOpenPlaylistItem: (item: HomeFeedItem) => void;
  onAuthNeededItem: (action: string) => void;
}

/**
 * Memoised feed-cell wrapper (UX perf pass). The card receives only
 * stable handler props plus per-item primitives; the per-item
 * closures are created inside this wrapper, which re-renders only
 * when its own item's props change.
 */
const HomeFeedCell = memo(function HomeFeedCell({
  item,
  data,
  saved,
  canSave,
  onPressItem,
  onToggleSaveItem,
  onShareItem,
  onChannelPressItem,
  onOpenPlaylistItem,
  onAuthNeededItem,
}: HomeFeedCellProps) {
  // Kebab menu actions: the SAME set on every card (blueprint
  // round 2, fault 27). Save / Save-to-playlist exist for catalogue
  // rows (saved_videos / playlists are FKs to catalogue rows, so an
  // API-only upload cannot be saved — the same gating Watch uses).
  // For GUESTS the actions no longer vanish (which collapsed the
  // menu to Share + Cancel): they route through the screen-root
  // auth sheet instead. Uploads get View Channel, matching Watch.
  const isCatalogue = item.kind === 'catalogue';
  const menuActions = useMemo(
    () => [
      {
        key: 'share',
        label: 'Share',
        icon: 'share',
        onPress: () => onShareItem(item),
      },
      ...(isCatalogue
        ? [
            {
              key: 'save-toggle',
              label: saved ? 'Remove from Saved' : 'Save to Watch Later',
              icon: saved ? 'bookmark' : 'bookmark-border',
              onPress: () =>
                canSave ? onToggleSaveItem(item) : onAuthNeededItem('save this samagam'),
            },
            {
              key: 'playlist',
              label: 'Save to playlist',
              icon: 'playlist-add',
              onPress: () =>
                canSave ? onOpenPlaylistItem(item) : onAuthNeededItem('save this samagam to a playlist'),
            },
          ]
        : [
            {
              key: 'channel',
              label: 'View Channel',
              icon: 'smart-display',
              onPress: () => onChannelPressItem(item),
            },
          ]),
    ],
    [canSave, isCatalogue, saved, item, onShareItem, onToggleSaveItem, onOpenPlaylistItem, onChannelPressItem, onAuthNeededItem],
  );
  return (
    <FeedCard
      data={data}
      saved={saved}
      onPress={() => onPressItem(item)}
      onToggleSave={canSave && isCatalogue ? () => onToggleSaveItem(item) : undefined}
      onShare={() => onShareItem(item)}
      onChannelPress={() => onChannelPressItem(item)}
      menuActions={menuActions}
    />
  );
});

/**
 * Home feed (Phase 11) — real data only, from TWO real sources
 * interleaved by the homeFeed pager: the published Supabase catalogue
 * and the uploads of every active sangat channel (Bhai Gursharan
 * Singh Ji official, Amritvela Trust Live, Amritvela Trust,
 * Sakhiyan), gathered round-robin across sources and ordered
 * LATEST FIRST per batch (live broadcasts lead), deduped by
 * YouTube id, Shorts-free, paging
 * endlessly via each channel's uploads playlist. The topic chips
 * under the header really filter (title keywords / channel sets /
 * live broadcasts). While the first page loads, geometry-matched
 * skeletons hold the layout (no jumps).
 */
export function HomeScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const dockInset = useDockInset();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { user, profile } = useAuth();
  // QA 89: tapping the Home tab while already on Home scrolls the
  // feed back to the top (useScrollToTop hooks the tab re-press).
  const feedRef = useRef<FlatList<HomeFeedItem>>(null);
  // Responsive columns (audit sweep fix, 28 Nov 2026): the same
  // breakpoints the Channel page already uses. On a phone this is
  // 1 — the exact mobile layout the user approved; on a wide
  // screen the feed becomes a real grid instead of one giant
  // stretched column with pixelated thumbnails.
  const { width: windowWidth } = useWindowDimensions();
  const columns = windowWidth >= 1024 ? 3 : windowWidth >= 640 ? 2 : 1;
  useScrollToTop(feedRef);
  const channel = useOfficialChannel();
  const { channels, loading: channelsLoading } = useActiveChannels();
  const [items, setItems] = useState<HomeFeedItem[]>([]);
  const [selectedChip, setSelectedChip] = useState<string>(ALL_CHIP);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  const [playlistVideoId, setPlaylistVideoId] = useState<string | null>(null);
  // Guest menu actions (Save / playlist) explain themselves here
  // instead of vanishing from the card menu (fault 27).
  const [authAction, setAuthAction] = useState<string | null>(null);
  const handleAuthNeeded = useCallback((action: string) => setAuthAction(action), []);
  const { toast, showToast } = useToast();
  const loadingRef = useRef(false);
  const pagerRef = useRef<HomeFeedPager | null>(null);
  // Bumped on every feed (re)start so a stale pager's late page can
  // never land on top of a newer filter/refresh.
  const generationRef = useRef(0);
  // Per-chip feed cache for keepPreviousData (fault 1/N2): the last
  // items each chip produced this session, so revisiting a chip is
  // instant and a chip change never blanks the screen.
  const chipCacheRef = useRef(SHARED_CHIP_CACHE);
  // Real live state from the YouTube API (QA 49/68): a map of
  // youtube_video_id → live/upcoming metadata for the official
  // channel. Archive rows have no live flag of their own.
  const [liveMap, setLiveMap] = useState<Map<string, YouTubeVideoMetadata>>(new Map());

  const refreshLive = useCallback(async (force: boolean) => {
    if (!isYouTubeConfigured) return;
    try {
      // EVERY registry channel, not only the official one (fix
      // round 5, #5): SGPC's live card count froze at gather time
      // while its Watch page showed the real number, because this
      // map — the card counts' live source — only ever held the
      // official channel's broadcasts.
      const lists = await Promise.all(
        channels.map((c) =>
          (force ? getLiveFresh(c.youtubeChannelId) : getLiveCached(c.youtubeChannelId)).catch(
            () => [] as YouTubeVideoMetadata[],
          ),
        ),
      );
      const merged = new Map<string, YouTubeVideoMetadata>();
      for (const list of lists) {
        for (const m of list) merged.set(m.youtubeVideoId, m);
      }
      if (merged.size > 0 || force) setLiveMap(merged);
    } catch {
      // A failed live check leaves the last known map in place.
    }
  }, [channels]);

  useEffect(() => {
    void refreshLive(false);
  }, [refreshLive]);

  // Live counts keep breathing (fix round 5, #5): while Home is
  // mounted, re-check the channels that currently have a live
  // broadcast every 60 s so card counts track the Watch page's
  // instead of freezing at first paint.
  const liveMapRef = useRef(liveMap);
  liveMapRef.current = liveMap;
  useEffect(() => {
    const t = setInterval(() => {
      const channelIds = [...new Set([...liveMapRef.current.values()].map((m) => m.channelId))];
      if (channelIds.length === 0) return;
      void (async () => {
        const lists = await Promise.all(
          channelIds.map((id) => getLiveFresh(id).catch(() => [] as YouTubeVideoMetadata[])),
        );
        setLiveMap((prev) => {
          const next = new Map(prev);
          for (const list of lists) {
            for (const m of list) next.set(m.youtubeVideoId, m);
          }
          return next;
        });
      })();
    }, 60_000);
    return () => clearInterval(t);
  }, []);

  // NOW PLAYING Samagam session, if one is really running right now:
  // derived from the real sessions table + server clock (the same
  // state machine the Sessions screens use), re-checked every 60s.
  // Drives only the Sessions entry row below (its subtitle + where it
  // leads) — no fabricated indicator: when nothing is playing, the
  // row keeps its plain "watch together" form and leads to the list.
  const [liveSession, setLiveSession] = useState<{
    id: string;
    title: string;
    thumbnailUrl: string | null;
  } | null>(null);

  // The NEXT upcoming session, derived in the same 60s check: Home
  // shows it as a normal feed card with an UPCOMING chip and the real
  // scheduled start in its meta line (user order, 28 Nov 2026 — the
  // sangat should SEE the session coming, with its full title, and
  // when the time comes the same check flips it to NOW PLAYING).
  const [upcomingSession, setUpcomingSession] = useState<{
    id: string;
    title: string;
    thumbnailUrl: string | null;
    startAtMs: number;
  } | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let active = true;
    const check = async () => {
      try {
        await serverClock.sync();
        const rows = await listSessionsWithVideos();
        if (!active) return;
        const nowMs = serverClock.nowMs();
        const playing = rows.find(
          (row) =>
            deriveStatus({
              storedStatus: row.session.status,
              scheduledStartAt: row.session.scheduled_start_at,
              scheduledEndAt: row.session.scheduled_end_at,
              durationSeconds: row.video?.duration_seconds ?? null,
              nowMs,
            }) === 'now_playing',
        );
        setLiveSession(
          playing
            ? {
                id: playing.session.id,
                title: playing.session.title ?? playing.video?.title ?? 'Samagam',
                thumbnailUrl: listThumbnailUrl(
                  playing.video?.youtube_video_id ?? null,
                  playing.video?.thumbnail_url ?? null,
                ),
              }
            : null,
        );
        const upcomingRows = rows
          .filter(
            (row) =>
              deriveStatus({
                storedStatus: row.session.status,
                scheduledStartAt: row.session.scheduled_start_at,
                scheduledEndAt: row.session.scheduled_end_at,
                durationSeconds: row.video?.duration_seconds ?? null,
                nowMs,
              }) === 'upcoming',
          )
          .sort((a, b) => a.session.scheduled_start_at.localeCompare(b.session.scheduled_start_at));
        const next = upcomingRows[0];
        setUpcomingSession(
          next
            ? {
                id: next.session.id,
                title: next.session.title ?? next.video?.title ?? 'Samagam',
                thumbnailUrl: listThumbnailUrl(
                  next.video?.youtube_video_id ?? null,
                  next.video?.thumbnail_url ?? null,
                ),
                startAtMs: Date.parse(next.session.scheduled_start_at),
              }
            : null,
        );
      } catch {
        // Sessions presence on Home is an entry-point nicety; a failed
        // check must never break the feed — the row just stays plain.
      }
    };
    void check();
    // INSTANT session updates (user, 28 Nov 2026): the moment an
    // admin schedules / edits / cancels a session, Home must show
    // it — no reload. The sessions table is in the realtime
    // publication (migration 0001), so any change re-runs the check
    // immediately; the 30s sweep is the insurance layer in case the
    // socket drops (research: flips are derived locally from
    // starts_at, so the NOW PLAYING flip lands on the tick even if
    // Realtime is down).
    // The topic MUST be unique per subscription instance:
    // channel(topic) returns the existing channel for a repeated
    // topic, and .on() then throws after subscribe() — that exact
    // throw crashed Home on return visits (the P10 lesson in
    // sessionService, re-learned 28 Nov 2026). try/catch as well:
    // a realtime failure must degrade to the 30s sweep, never to
    // an error screen.
    let channel: ReturnType<NonNullable<typeof supabase>['channel']> | null = null;
    try {
      channel =
        supabase
          ?.channel(uniqueTopic('home-sessions-watch'))
          .on('postgres_changes', { event: '*', schema: 'public', table: 'sessions' }, () => {
            void check();
          })
          .subscribe() ?? null;
    } catch {
      channel = null;
    }
    const timer = setInterval(() => void check(), 30_000);
    return () => {
      active = false;
      clearInterval(timer);
      if (channel && supabase) void supabase.removeChannel(channel);
    };
  }, []);

  // (Re)build the pager for the current chip + channel set and load
  // its first batch. The pager itself degrades per source (a failed
  // channel or the catalogue never walls the feed), so a throw here
  // is only a last-resort guard.
  const startFeed = useCallback(async () => {
    const generation = ++generationRef.current;
    loadingRef.current = true;
    // keepPreviousData (blueprint round 2, fault 1/N2): a chip
    // visited before renders its cached items INSTANTLY and
    // revalidates in the background; a new chip keeps the current
    // list visible until its first page lands (the render gate
    // shows the skeleton only when there are zero items). The
    // full-screen loader on every chip tap is gone.
    const cached = chipCacheRef.current.get(selectedChip);
    if (cached) {
      setItems(cached.items);
      setExhausted(cached.exhausted);
      setLoading(false);
    } else {
      // Chip discipline (fix round 5, #9): a chip with no cache
      // must show its OWN loading state — never the previous chip's
      // items under this chip's name. "Sakhi" appeared to show the
      // full unfiltered feed because the All items stayed on screen
      // while Sakhi's first page loaded.
      setItems([]);
      setExhausted(false);
    }
    const resolved = resolveChipFilter(selectedChip, channels);
    const pager = createHomeFeedPager({
      channels,
      filter: resolved,
    });
    pagerRef.current = pager;
    try {
      const first = await pager.next(PAGE_SIZE);
      if (generationRef.current !== generation) return;
      const sortedFirst = sortFeedItems(first.items);
      chipCacheRef.current.set(selectedChip, { items: sortedFirst, exhausted: first.exhausted });
      setItems(sortedFirst);
      setExhausted(first.exhausted);
    } catch {
      if (generationRef.current !== generation) return;
      if (!cached) {
        setItems([]);
        setExhausted(true);
      }
    } finally {
      if (generationRef.current === generation) {
        loadingRef.current = false;
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [channels, selectedChip]);

  useEffect(() => {
    // Wait for the channel registry before the first pager exists —
    // a catalogue-only first paint would reshuffle under the user
    // the moment the channels land.
    if (channelsLoading) return;
    // Deferred one tick so the initial load does not run (or set
    // state) synchronously inside the effect.
    const t = setTimeout(() => {
      void startFeed();
    }, 0);
    return () => clearTimeout(t);
  }, [channelsLoading, startFeed]);

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
    // A manual pull means "show me what's new" (audit P2, 28 Nov
    // 2026): drop the cached first pages first, so the rebuilt
    // pager fetches fresh uploads instead of re-serving the SWR
    // copy it already had (the gesture visibly changed nothing).
    void (async () => {
      const playlistIds = channels
        .map((c) => (c.youtubeChannelId ? uploadsPlaylistIdFor(c.youtubeChannelId) : null))
        .filter((x): x is string => !!x);
      await invalidateUploadsFirstPages(playlistIds).catch(() => undefined);
      void refreshLive(true);
      await startFeed();
    })();
  }, [startFeed, channels, refreshLive]);

  // Web pull-to-refresh (gestures round): react-native-web's
  // RefreshControl is a no-op stub, so the FlatList's own
  // refreshing/onRefresh below can never fire in the PWA. This hook
  // restores the pull gesture on web (native keeps the real control).
  const ptr = useWebPullToRefresh({ onRefresh, refreshing });

  const onEndReached = useCallback(() => {
    if (loadingRef.current || exhausted || loading || items.length === 0) return;
    const pager = pagerRef.current;
    if (!pager) return;
    const generation = generationRef.current;
    loadingRef.current = true;
    setLoadingMore(true);
    pager
      .next(PAGE_SIZE)
      .then((page) => {
        if (generationRef.current !== generation) return;
        if (page.items.length > 0) {
          setItems((prev) => {
            // Whole-list sort on every append (N-5): the visible
            // order is a pure function of the gathered set, so it
            // cannot reshuffle between visits.
            const next = sortFeedItems([...prev, ...page.items]);
            chipCacheRef.current.set(selectedChip, { items: next, exhausted: page.exhausted });
            return next;
          });
        }
        // End marker guarantee (fault 8): a page that adds nothing
        // IS the end, whatever the pager believes — the footer must
        // appear instead of the loading skeleton running forever.
        setExhausted(page.exhausted || page.items.length === 0);
      })
      .catch(() => undefined)
      .finally(() => {
        if (generationRef.current === generation) {
          loadingRef.current = false;
          setLoadingMore(false);
        }
      });
  }, [exhausted, loading, items.length, selectedChip]);

  // Chip taps: every chip — Live included — selects a real feed
  // filter and restarts the pager (effect above). The Live filter
  // shows every channel's currently-live broadcast (user order,
  // 27 Nov 2026: the Live chip is a feed, not a jump to Sessions).
  // The loading flag flips in a timer callback, matching the
  // codebase's no-sync-setState-in-handler-adjacent pattern for
  // feed restarts.
  const handleSelectChip = useCallback(
    (chip: string) => {
      if (chip === selectedChip) return;
      // No setLoading(true) here anymore: startFeed's
      // keepPreviousData path decides what shows (cache / current
      // list / skeleton only when the screen is truly empty).
      setSelectedChip(chip);
    },
    [selectedChip],
  );

  const avatarUrl = channel?.avatarUrl ?? null;

  // Per-channel avatars for upload cards (registry/DB values; the
  // official channel's fresh API avatar wins over its registry row).
  const avatarByChannelId = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const c of channels) map.set(c.youtubeChannelId, c.avatarUrl);
    if (channel?.avatarUrl) map.set(OFFICIAL_CHANNEL_ID, channel.avatarUrl);
    return map;
  }, [channels, channel]);

  // Stable per-card display data: one CardVideoData object per item,
  // rebuilt only when the feed, the avatars or the live map change —
  // never on a saved-state toggle. The live map feeds the QA 49
  // enrichment (LIVE badge + real watching count) for catalogue rows;
  // upload cards carry their own API live state via apiCardData.
  // Catalogue view-count backfill state (fault 5; the fetch effect
  // sits just below cardDataByKey): rows carry no statistics, so
  // their cards showed a bare date while upload cards showed
  // views. One batched videos.list call per 50 ids fills the real
  // counts; ids already fetched (or in flight) are never re-asked.
  const [statsMap, setStatsMap] = useState<Map<string, number>>(new Map());
  const statsAskedRef = useRef(new Set<string>());
  const cardDataByKey = useMemo(() => {
    const map = new Map<string, CardVideoData>();
    for (const item of items) {
      map.set(
        item.key,
        item.kind === 'catalogue'
          ? supabaseCardData(
              item.video,
              avatarUrl,
              item.video.youtube_video_id ? (liveMap.get(item.video.youtube_video_id) ?? null) : null,
              item.video.youtube_video_id ? (statsMap.get(item.video.youtube_video_id) ?? null) : null,
            )
          : apiCardData(item.meta, avatarByChannelId.get(item.meta.channelId) ?? item.channel.avatarUrl, {
              viewCount: statsMap.get(item.meta.youtubeVideoId) ?? null,
              liveMeta: liveMap.get(item.meta.youtubeVideoId) ?? null,
            }),
      );
    }
    return map;
  }, [items, avatarUrl, avatarByChannelId, liveMap, statsMap]);

  useEffect(() => {
    if (!isYouTubeConfigured) return;
    const missing: string[] = [];
    for (const item of items) {
      // Catalogue rows (no statistics of their own) AND upload
      // items whose metadata arrived without a view count (fix
      // round 5, #5 — some cards showed no count at all).
      const id =
        item.kind === 'catalogue'
          ? item.video.youtube_video_id
          : item.meta.viewCount == null
            ? item.meta.youtubeVideoId
            : null;
      if (id && !statsAskedRef.current.has(id)) {
        statsAskedRef.current.add(id);
        missing.push(id);
      }
    }
    if (missing.length === 0) return;
    let active = true;
    fetchVideosMetadata(missing)
      .then((metas) => {
        if (!active || metas.length === 0) return;
        setStatsMap((prev) => {
          const next = new Map(prev);
          for (const m of metas) {
            if (m.viewCount != null) next.set(m.youtubeVideoId, m.viewCount);
          }
          return next;
        });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [items]);

  // The NOW PLAYING session as a NORMAL feed card (user order,
  // 27 Nov 2026: on YouTube's home the live item is an ordinary big
  // card like every other card — no special banner). Rendered as
  // the FlatList header on the All and Live chips only, so it
  // scrolls with the feed exactly like YouTube's live card.
  const sessionCardData = useMemo<CardVideoData | null>(() => {
    if (!liveSession) return null;
    return {
      key: `session-${liveSession.id}`,
      title: liveSession.title,
      thumbnailUrl: liveSession.thumbnailUrl,
      durationSeconds: null,
      broadcastState: 'none',
      nowPlayingSession: true,
      channelLine: channel?.title ?? 'Bhai Gursharan Singh Ji',
      metaLine: 'Samagam Session',
      channelAvatarUrl: avatarUrl,
      youtubeVideoId: null,
      channelId: channel?.channelId ?? OFFICIAL_CHANNEL_ID,
    };
  }, [liveSession, channel, avatarUrl]);

  // The NEXT upcoming session as a NORMAL feed card too (same user
  // order): full title + thumbnail, a neutral UPCOMING chip on the
  // thumbnail, and the real start in the meta line — "Starts Today ·
  // 7:00 PM". When the start time arrives, the 60s check above flips
  // this card to the NOW PLAYING one on its own.
  const upcomingCardData = useMemo<CardVideoData | null>(() => {
    if (!upcomingSession) return null;
    return {
      key: `session-upcoming-${upcomingSession.id}`,
      title: upcomingSession.title,
      thumbnailUrl: upcomingSession.thumbnailUrl,
      durationSeconds: null,
      broadcastState: 'none',
      upcomingSession: true,
      channelLine: channel?.title ?? 'Bhai Gursharan Singh Ji',
      metaLine: `Starts ${formatSessionStart(upcomingSession.startAtMs)}`,
      channelAvatarUrl: avatarUrl,
      youtubeVideoId: null,
      channelId: channel?.channelId ?? OFFICIAL_CHANNEL_ID,
    };
  }, [upcomingSession, channel, avatarUrl]);

  // Mirror of savedIds for the stable toggle handler below.
  const savedIdsRef = useRef(savedIds);
  useEffect(() => {
    savedIdsRef.current = savedIds;
  }, [savedIds]);

  const handlePressItem = useCallback(
    (item: HomeFeedItem) => {
      // Catalogue rows open via their row id (history/saves need it);
      // uploads that matched a catalogue row never reach the feed as
      // uploads (the pager dedupes them), so an upload here opens via
      // the same API-video watch path Channel/Search use.
      if (item.kind === 'catalogue') {
        navigation.navigate('Watch', { videoRowId: item.video.id });
      } else {
        navigation.navigate('Watch', { youtubeVideoId: item.meta.youtubeVideoId });
      }
    },
    [navigation],
  );

  // Share goes through the shared share util (QA 30): Web Share API
  // with a clipboard fallback, and the outcome is surfaced as a toast
  // so the tap never feels dead.
  const handleShareItem = useCallback(
    (item: HomeFeedItem) => {
      const title = item.kind === 'catalogue' ? item.video.title : item.meta.title;
      void shareContent(title, watchShareUrl({ videoRowId: item.kind === 'catalogue' ? item.video.id : null, youtubeVideoId: feedItemYoutubeId(item) })).then(
        (outcome) => {
          const feedback = shareFeedback(outcome);
          if (feedback) showToast(feedback);
        },
      );
    },
    [showToast],
  );

  const handleChannelPressItem = useCallback(
    (item: HomeFeedItem) => {
      navigation.navigate('Channel', {
        channelId:
          item.kind === 'catalogue'
            ? (channel?.channelId ?? OFFICIAL_CHANNEL_ID)
            : item.meta.channelId,
      });
    },
    [navigation, channel],
  );

  const handleOpenPlaylistItem = useCallback((item: HomeFeedItem) => {
    if (item.kind === 'catalogue') setPlaylistVideoId(item.video.id);
  }, []);

  const handleToggleSaveItem = useCallback(
    (item: HomeFeedItem) => {
      if (!user || item.kind !== 'catalogue') return;
      const video = item.video;
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

  // The Sessions entry strip (rendered by renderItem after the
  // second card — see the round-2 note there). The topic chips that
  // used to ride in this strip moved up under the header in Phase 11
  // (the YouTube pattern the user asked for); there is ONE filter row
  // now, not two.
  const feedStrip = useMemo(
    () => (
      <Pressable
        style={({ pressed }) => [styles.sessionsRow, pressed && styles.sessionsRowPressed]}
        onPress={() =>
          liveSession
            ? navigation.navigate('SessionWatch', { sessionId: liveSession.id })
            : upcomingSession
              ? navigation.navigate('SessionWatch', { sessionId: upcomingSession.id })
              : navigation.navigate('Sessions')
        }
        accessibilityRole="button"
        accessibilityLabel={
          liveSession
            ? `Now playing: ${liveSession.title}`
            : upcomingSession
              ? `Upcoming Samagam: ${upcomingSession.title}`
              : 'Samagam Sessions'
        }
      >
        <MaterialIcons name="groups" size={24} color={colors.text} />
        <View style={styles.sessionsLines}>
          <Text style={styles.sessionsTitle}>Samagam Sessions</Text>
          <Text style={styles.sessionsSub} numberOfLines={1}>
            {liveSession
              ? `NOW PLAYING · ${liveSession.title}`
              : upcomingSession
                ? `UPCOMING · ${formatSessionStart(upcomingSession.startAtMs)} · ${upcomingSession.title}`
                : 'Watch together at the scheduled time'}
          </Text>
        </View>
        <MaterialIcons name="chevron-right" size={24} color={colors.textSecondary} />
      </Pressable>
    ),
    [navigation, liveSession, upcomingSession, colors, styles],
  );

  const renderItem = useCallback(
    ({ item, index }: { item: HomeFeedItem; index: number }) => {
      // Round-2 pixel pass: the feed must start IMMEDIATELY with the
      // first card (ref-1 goes straight from the tab row to card 1).
      // The Sessions entry strip renders after the SECOND card (or
      // after the only card), never above card 1.
      const stripAfter = Math.min(1, items.length - 1);
      if (columns > 1) {
        // Grid mode (wide screens): cells only — the Sessions strip
        // moves to the list header, since a full-width strip inside
        // a grid cell would break the row.
        return (
          <View
            style={[
              styles.gridCell,
              { flexBasis: `${100 / columns}%`, maxWidth: `${100 / columns}%` },
            ]}
          >
            <HomeFeedCell
              item={item}
              data={
                cardDataByKey.get(item.key) ??
                (item.kind === 'catalogue'
                  ? supabaseCardData(item.video, avatarUrl, item.video.youtube_video_id ? (liveMap.get(item.video.youtube_video_id) ?? null) : null, item.video.youtube_video_id ? (statsMap.get(item.video.youtube_video_id) ?? null) : null)
                  : apiCardData(item.meta, item.channel.avatarUrl))
              }
              saved={item.kind === 'catalogue' && savedIds.has(item.video.id)}
              canSave={!!user}
              onPressItem={handlePressItem}
              onToggleSaveItem={handleToggleSaveItem}
              onShareItem={handleShareItem}
              onChannelPressItem={handleChannelPressItem}
              onOpenPlaylistItem={handleOpenPlaylistItem}
              onAuthNeededItem={handleAuthNeeded}
            />
          </View>
        );
      }
      return (
        <>
            <HomeFeedCell
              item={item}
              data={
                cardDataByKey.get(item.key) ??
                (item.kind === 'catalogue'
                  ? supabaseCardData(item.video, avatarUrl, item.video.youtube_video_id ? (liveMap.get(item.video.youtube_video_id) ?? null) : null, item.video.youtube_video_id ? (statsMap.get(item.video.youtube_video_id) ?? null) : null)
                  : apiCardData(item.meta, item.channel.avatarUrl))
              }
              saved={item.kind === 'catalogue' && savedIds.has(item.video.id)}
              canSave={!!user}
              onPressItem={handlePressItem}
              onToggleSaveItem={handleToggleSaveItem}
              onShareItem={handleShareItem}
              onChannelPressItem={handleChannelPressItem}
              onOpenPlaylistItem={handleOpenPlaylistItem}
              onAuthNeededItem={handleAuthNeeded}
            />
          {index === stripAfter ? feedStrip : null}
        </>
      );
    },
    [
      cardDataByKey,
      avatarUrl,
      liveMap,
      savedIds,
      user,
      handlePressItem,
      handleToggleSaveItem,
      handleShareItem,
      handleChannelPressItem,
      handleOpenPlaylistItem,
      items.length,
      feedStrip,
      columns,
      styles,
    ],
  );

  const keyExtractor = useCallback((item: HomeFeedItem) => item.key, []);

  const initial = profile?.display_name?.charAt(0)?.toUpperCase() ?? user?.email?.charAt(0)?.toUpperCase() ?? null;
  const notConfigured = !isSupabaseConfigured && !isYouTubeConfigured;

  return (
    <View style={styles.container}>
      <View style={styles.headerBlock}>
        <AppHeader
          onSearchPress={() => navigation.navigate('Search')}
          onAccountPress={() => navigation.navigate('Account')}
          avatarUrl={profile?.avatar_url ?? null}
          avatarInitial={initial}
        />
        {/* Phase 11: the topic chips row sits directly under the
            header (the YouTube pattern from the user's screenshot)
            and is the feed's ONE filter row. It replaces the old
            Home/Subs/Live segment row on this screen: Subscriptions
            stays in the bottom tab bar, and the Live chip is a real
            feed filter (every channel's live broadcast). */}
        <ChipsRow chips={[...HOME_CHIPS]} selected={selectedChip} onSelect={handleSelectChip} />
      </View>

      {notConfigured ? (
        <EmptyState
          title="Backend not configured"
          message="Samagams will appear here once the app is connected to its data sources."
        />
      ) : loading && items.length === 0 ? (
        <View>
          {/* Skeleton-first loading (Chat 2 fault 1, 28 Nov 2026):
              the structure of the feed is visible immediately, the
              ੴ is small, and a caption says what is happening —
              never a lone symbol on a blank screen. The skeleton
              shows ONLY when there is nothing to display: with
              keep-previous-data (round 2, fault 1/N2) a chip change
              keeps the current list on screen until the new first
              page lands, so a filter tap is never a full-screen
              reload again. */}
          <IkOnkarMark size={56} label="Gathering the sangat…" />
          <SkeletonCard variant="feed" />
          <SkeletonCard variant="feed" />
          <SkeletonCard variant="feed" />
        </View>
      ) : items.length === 0 ? (
        // The empty state carries its own way out (audit A5): a
        // filtered empty offers "Show all"; the All empty — which can
        // also mean a transient failure — offers "Try again".
        <EmptyState
          title={selectedChip === ALL_CHIP ? 'No samagams yet' : 'Nothing in this filter yet'}
          message={
            selectedChip === ALL_CHIP
              ? 'Recordings from the sangat channels will appear here.'
              : `No videos match "${selectedChip}" yet — try another chip.`
          }
          actionLabel={selectedChip === ALL_CHIP ? 'Try again' : 'Show all'}
          onAction={
            selectedChip === ALL_CHIP
              ? onRefresh
              : () => handleSelectChip(ALL_CHIP)
          }
        />
      ) : (
        <View style={styles.ptrWrap}>
          {ptr.indicator}
          <FlatList
            {...ptr.listProps}
            key={`cols-${columns}`}
            numColumns={columns}
            columnWrapperStyle={columns > 1 ? styles.gridRow : undefined}
            ref={feedRef}
            data={items}
            renderItem={renderItem}
            keyExtractor={keyExtractor}
            // The bottom bar is an OVERLAY now (blur material): the
            // feed scrolls under it, so the last cards need clearance
            // ≥ the bar height (56) + breathing room, or the bar would
            // cover them at the end of the list.
            contentContainerStyle={[styles.feedContent, { paddingBottom: layout.bottomNavHeight + insets.bottom + 24 + dockInset }]}
            ListHeaderComponent={
              (sessionCardData && liveSession && (selectedChip === ALL_CHIP || selectedChip === 'Live')) ||
              (upcomingCardData && upcomingSession && selectedChip === ALL_CHIP) ||
              columns > 1 ? (
                <View>
                  {sessionCardData && liveSession && (selectedChip === ALL_CHIP || selectedChip === 'Live') ? (
                    <FeedCard
                      data={sessionCardData}
                      onPress={() => navigation.navigate('SessionWatch', { sessionId: liveSession.id })}
                      onChannelPress={() =>
                        navigation.navigate('Channel', { channelId: channel?.channelId ?? OFFICIAL_CHANNEL_ID })
                      }
                    />
                  ) : null}
                  {upcomingCardData && upcomingSession && selectedChip === ALL_CHIP ? (
                    <FeedCard
                      data={upcomingCardData}
                      onPress={() => navigation.navigate('SessionWatch', { sessionId: upcomingSession.id })}
                      onChannelPress={() =>
                        navigation.navigate('Channel', { channelId: channel?.channelId ?? OFFICIAL_CHANNEL_ID })
                      }
                    />
                  ) : null}
                  {/* In grid mode the Sessions strip lives here
                      (in 1-column mode it sits after the 2nd card). */}
                  {columns > 1 ? feedStrip : null}
                </View>
              ) : undefined
            }
            onEndReached={onEndReached}
            onEndReachedThreshold={0.6}
            refreshing={refreshing}
            onRefresh={onRefresh}
            ListFooterComponent={
              loadingMore ? (
                // Skeleton footer (audit A11): a bare spinner row is
                // shorter than a card and makes the list end jump.
                <SkeletonCard variant="feed" />
              ) : exhausted ? (
                <View style={styles.endOfFeed}>
                  <MaterialIcons name="check-circle" size={18} color={colors.textSecondary} />
                  <Text style={styles.endOfFeedText}>
                    That&rsquo;s every video from the sangat channels
                  </Text>
                </View>
              ) : undefined
            }
            {...FEED_LIST_PERF}
          />
        </View>
      )}
      <AddToPlaylistSheet
        visible={playlistVideoId != null}
        userId={user?.id ?? null}
        videoId={playlistVideoId}
        onClose={() => setPlaylistVideoId(null)}
      />
      <RequireAuthSheet
        action={authAction}
        onDismiss={() => setAuthAction(null)}
        onSignIn={() => {
          setAuthAction(null);
          navigation.navigate('SignIn');
        }}
      />
      <Toast message={toast} />
    </View>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  // Screenshot 01: cards are white containers on a light-grey page
  // ground — the grey shows in the gaps between cards and around the
  // sessions row. White-on-white made the feed read as one
  // unbroken sheet with no card separation. Phase 13: the ground is
  // the pageGround token — #F8F8F8 in light (unchanged), flat
  // #0F0F0F in dark. It was hard-coded #F8F8F8 through the Phase 12
  // migration, which left dark mode with a light-grey page behind
  // dark cards (the user's "dark mode bahut kharab" report).
  container: { flex: 1, backgroundColor: colors.pageGround },
  // Web pull-to-refresh wrapper: fills the feed area under the
  // header block; the indicator anchors to it.
  ptrWrap: { flex: 1 },
  // Translucent now: AppHeader carries the blur material; the chips
  // row below it sits on the same near-white translucent tone so the
  // whole top block reads as one glass bar (no solid white slab).
  // Phase 13: theme-aware via the headerBlockBackground token — the
  // hard-coded white rendered as a white band in dark mode.
  headerBlock: { backgroundColor: colors.headerBlockBackground },
  sessionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  sessionsRowPressed: { backgroundColor: colors.surfaceVariant },
  sessionsLines: { flex: 1 },
  sessionsTitle: { ...typography.channelName, fontWeight: '600', color: colors.text },
  sessionsSub: { ...typography.metadata, color: colors.textSecondary, marginTop: 1 },
  feedContent: { paddingBottom: layout.bottomNavHeight + 24 },
  // Grid cell (blueprint round 2, fault 6): NEVER bare flex:1 — in
  // a numColumns list a short last row stretches its cells to the
  // full row width (the giant 4th Live card). flexBasis/maxWidth
  // percentages are applied inline from the live column count.
  gridCell: { flexGrow: 0, flexShrink: 0, paddingHorizontal: 6 },
  gridRow: { paddingHorizontal: 10 },
  footerSpinner: { paddingVertical: spacing.lg },
  endOfFeed: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
  endOfFeedText: { ...typography.metadata, color: colors.textSecondary, textAlign: 'center' },
  pressed: { opacity: 0.85 },
});
