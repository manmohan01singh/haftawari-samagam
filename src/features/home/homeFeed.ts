/**
 * Home feed engine (Phase 11, user order 27 Nov 2026): the Home
 * "All" feed is no longer just the small published Supabase catalogue
 * — it interleaves uploads from EVERY active sangat channel (the
 * built-in registry ∪ admin channels: Bhai Gursharan Singh Ji
 * official, Amritvela Trust Live, Amritvela Trust, Sakhiyan) with the
 * catalogue, YouTube-home style, and pages endlessly via each
 * channel's uploads playlist.
 *
 * Design contract:
 *  - Round-robin across sources (catalogue + one stream per channel):
 *    uploads playlists are newest-first, so one item per source per
 *    round interleaves RECENT videos from all channels and no single
 *    channel can dominate the feed.
 *  - Each emitted batch gets a light DETERMINISTIC shuffle (seeded
 *    PRNG; the seed changes only on refresh / filter change), so the
 *    rotation doesn't read as a rigid pattern, while items already on
 *    screen never move.
 *  - Dedupe by YouTube video id. A catalogue row and its upload twin
 *    are the same video: the upload is dropped and the catalogue row
 *    is what renders (Watch needs the row id for history/saves).
 *  - Shorts are filtered with the app's isShortVideo rule (locked:
 *    NO Shorts anywhere), and scheduled premieres that have no real
 *    duration yet are skipped (they are not watchable recordings).
 *  - A per-channel fetch failure (quota, network) pauses ONLY that
 *    channel for the current next() call; it is retried on the next
 *    scroll from the same scan position (Phase 13: permanent
 *    retirement let a rate-limited key empty the topic chips and
 *    falsely report the feed exhausted). The feed reports
 *    `exhausted` only when every source is genuinely drained —
 *    with thousands of uploads per channel that is, in practice,
 *    never.
 *  - Quota: one uploads page = playlistItems (1 unit) + videos.list
 *    (1 unit). The FIRST page of each channel goes through the shared
 *    30-minute AsyncStorage cache (getUploadsCached, also used by
 *    Subscriptions/Channel); deeper pages fetch directly.
 */

import { uploadsPlaylistIdFor, type AppChannel } from '../channels/channelsService';
import { getUploadsCached } from '../channels/channelCache';
import { isSupabaseConfigured } from '../../lib/supabase';
import { fetchPublishedVideos } from '../../lib/videos';
import {
  OFFICIAL_CHANNEL_ID,
  fetchChannelUploads,
  isShortVideo,
  isYouTubeConfigured,
  type YouTubeVideoMetadata,
} from '../../lib/youtube';
import type { Video } from '../../types/database';

// ── Feed items ───────────────────────────────────────────────────────

export type HomeFeedItem =
  | { kind: 'catalogue'; key: string; video: Video }
  | { kind: 'upload'; key: string; meta: YouTubeVideoMetadata; channel: AppChannel };

/** The YouTube video id behind either item kind (dedupe + share). */
export function feedItemYoutubeId(item: HomeFeedItem): string {
  return item.kind === 'catalogue' ? item.video.youtube_video_id : item.meta.youtubeVideoId;
}

// ── Chips + filters ──────────────────────────────────────────────────

/**
 * The Home topic-chips row (user's explicit list, YouTube pattern).
 * 'Live' is NOT a feed filter — it keeps the destination the old
 * Home/Subs/Live segment row's Live tab had (Sessions filtered to
 * NOW PLAYING); HomeScreen routes it and never selects it.
 */
export const HOME_CHIPS = [
  'All',
  'Live',
  'Simran',
  'Katha',
  'Kirtan',
  'Sakhi',
  'Haadbiti',
  'Path',
  'Amritvela',
  'Sakhiyan',
  'Bhai Gursharan Singh Ji',
] as const;

export type HomeChip = (typeof HOME_CHIPS)[number];

/**
 * Title-keyword sets for the topic chips. Matching is a
 * case-insensitive substring test on the video title, with the
 * common spelling variants the sangat actually uses (the locked
 * examples: sakhi/sakhiyan — 'sakhi' is a substring of 'sakhiyan',
 * so one keyword covers both — and haadbiti/hadbiti/haadbeeti).
 *
 * Phase 13 widening (verified against 1,610 real upload titles
 * pulled from the 9 registry channels, 2026-11-27): the channels
 * also title videos in Gurmukhi script (ਸਿਮਰਨ, ਕਥਾ, ਕੀਰਤਨ, ਸਾਖੀ,
 * ਹਾਦਬੀਤੀ, ਪਾਠ — e.g. Hazur Sahib's Gurmukhi Hukamnama titles and
 * SGPC's ਅਖੰਡ ਪਾਠ uploads matched NOTHING before) and use spaced
 * forms like "Hadd Biti", so both scripts and the spaced variants
 * are first-class keywords now.
 */
const TOPIC_KEYWORDS: Record<string, string[]> = {
  Simran: ['simran', 'ਸਿਮਰਨ'],
  Katha: ['katha', 'ਕਥਾ'],
  Kirtan: ['kirtan', 'keertan', 'ਕੀਰਤਨ'],
  Sakhi: ['sakhi', 'saakhi', 'ਸਾਖੀ'],
  Haadbiti: [
    'haadbiti',
    'hadbiti',
    'haadbeeti',
    'hadbeeti',
    'haddbiti',
    'hadd biti',
    'haad biti',
    'ਹਾਦਬੀਤੀ',
    'ਹੱਦ ਬੀਤੀ',
    'ਹਾਦ ਬੀਤੀ',
  ],
  Path: ['path', 'paath', 'ਪਾਠ'],
};

const AMRITVELA_HANDLES = new Set(['@amritvelatrustlive', '@amritvelatrust']);
const AMRITVELA_IDS = new Set(['UCsWEj3uf31iAF_STEvO3A2A', 'UCvo6eEtGT5LehydhnMo5sKw']);
const SAKHIYAN_HANDLE = '@sakhiyanbhaigursharansinghji';

export type HomeFeedFilter =
  | { kind: 'all' }
  /** Only these channels' uploads (the catalogue joins when the official channel is among them). */
  | { kind: 'channels'; channelIds: string[] }
  /** All channels (+ catalogue), title-keyword matched. */
  | { kind: 'topic'; keywords: string[] };

/**
 * Resolve a chip to a feed filter. Returns the string 'live' for the
 * Live chip (a navigation destination, not a filter). Channel chips
 * resolve against the ACTIVE channel list, so an admin-added/renamed
 * channel still matches by handle/id; a chip whose channel is not
 * active resolves to an empty channel set (an honest empty feed,
 * never a silently-wrong one).
 */
export function resolveChipFilter(
  chip: string,
  channels: AppChannel[],
): HomeFeedFilter | 'live' {
  if (chip === 'Live') return 'live';
  if (chip === 'All') return { kind: 'all' };
  const keywords = TOPIC_KEYWORDS[chip];
  if (keywords) return { kind: 'topic', keywords };
  if (chip === 'Amritvela') {
    return {
      kind: 'channels',
      channelIds: channels
        .filter(
          (c) =>
            AMRITVELA_IDS.has(c.youtubeChannelId) ||
            (c.handle != null && AMRITVELA_HANDLES.has(c.handle.toLowerCase())),
        )
        .map((c) => c.youtubeChannelId),
    };
  }
  if (chip === 'Sakhiyan') {
    return {
      kind: 'channels',
      channelIds: channels
        .filter(
          (c) =>
            (c.handle != null && c.handle.toLowerCase() === SAKHIYAN_HANDLE) ||
            c.title.toLowerCase().includes('sakhiyan'),
        )
        .map((c) => c.youtubeChannelId),
    };
  }
  if (chip === 'Bhai Gursharan Singh Ji') {
    return {
      kind: 'channels',
      channelIds: channels
        .filter((c) => c.youtubeChannelId === OFFICIAL_CHANNEL_ID)
        .map((c) => c.youtubeChannelId),
    };
  }
  return { kind: 'all' };
}

function matchesTopic(title: string, keywords: string[]): boolean {
  const haystack = title.toLowerCase();
  return keywords.some((k) => haystack.includes(k));
}

/**
 * Uploads-stream eligibility (locked rules): no Shorts, and no
 * scheduled premieres that have no real duration yet — an 'upcoming'
 * item with a duration is a premiere whose recording exists in the
 * metadata and may stay; one without is not watchable yet. Genuinely
 * live broadcasts ('live') always stay.
 */
function isFeedEligible(meta: YouTubeVideoMetadata): boolean {
  if (isShortVideo(meta)) return false;
  if (meta.liveBroadcastContent === 'upcoming' && !meta.durationSeconds) return false;
  return true;
}

// ── Deterministic shuffle ────────────────────────────────────────────

/** mulberry32 — tiny seeded PRNG; same seed ⇒ same order, always. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: T[], seed: number): T[] {
  const rand = mulberry32(seed);
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ── Pager ────────────────────────────────────────────────────────────

const CATALOGUE_PAGE_SIZE = 25;
/** Safety bound on catalogue preload (the catalogue is admin-curated and small). */
const MAX_CATALOGUE_PAGES = 10;
/**
 * Per channel per next() call, how many uploads pages may be scanned
 * while hunting topic matches — bounds quota/time per scroll step;
 * the scan simply continues on the next onEndReached. Only pages
 * actually absorbed for matching count against the budget: the two
 * priming fetches (cache page + token page) are overhead, and when
 * they consumed budget (Phase 11) a sparse topic effectively got
 * only ~4 pages ≈ 100 titles per channel per call — for a topic
 * like Haadbiti (~1% of titles) that routinely found nothing and
 * the chip looked empty (Phase 13 fix).
 */
const MAX_SCAN_PAGES_PER_CALL = 10;

interface ChannelCursor {
  channel: AppChannel;
  uploadsPlaylistId: string;
  buffer: YouTubeVideoMetadata[];
  /** Continuation token for direct paging; null until token priming ran. */
  nextPageToken: string | null;
  /** The cache-backed first page has been consumed into the buffer. */
  primed: boolean;
  /** Token priming (one direct page-1 fetch to learn the token) has run. */
  tokenPrimed: boolean;
  exhausted: boolean;
  /**
   * A fetch failed during the current next() call. The channel is
   * skipped for the rest of that call and RETRIED on the next one —
   * a transient failure (quota blip, network) must not retire a
   * channel for the pager's lifetime or mark the feed exhausted
   * (Phase 13 fix: Phase 11 retired the channel permanently on any
   * error, so a rate-limited key emptied the sparse topic chips —
   * which need ~10× the calls of the channel chips — while the
   * channel chips still worked off page 1 / the uploads cache).
   */
  failed: boolean;
}

export interface HomeFeedPager {
  /** Pull the next batch (up to `count` items). `exhausted` = every source drained. */
  next(count: number): Promise<{ items: HomeFeedItem[]; exhausted: boolean }>;
}

export interface HomeFeedPagerOptions {
  channels: AppChannel[];
  filter: HomeFeedFilter;
  /** Changes on refresh so a pull-to-refresh reshuffles/restarts. */
  seed: number;
}

export function createHomeFeedPager({ channels, filter, seed }: HomeFeedPagerOptions): HomeFeedPager {
  const seen = new Set<string>();
  let batchIndex = 0;

  // ── Catalogue source ──────────────────────────────────────────────
  // Included for 'all' and topic filters, and for channel filters
  // that include the official channel (catalogue rows ARE official
  // uploads). The full catalogue id set is preloaded up front (it is
  // small) so an upload twin is dropped even before its row's turn
  // in the rotation — the row itself is what must open in Watch.
  const includeCatalogue =
    filter.kind !== 'channels' || filter.channelIds.includes(OFFICIAL_CHANNEL_ID);
  const catalogueRows: Video[] = [];
  // Ids of every (filter-matching) catalogue row, preloaded BEFORE
  // anything is emitted: an upload whose id is in here is dropped at
  // take time even if its row hasn't had its rotation turn yet — the
  // row is the item that must render/open, never its upload twin.
  const catalogueIds = new Set<string>();
  let catalogueLoaded = false;
  let catalogueEmitted = 0;

  async function ensureCatalogue(): Promise<void> {
    if (catalogueLoaded) return;
    catalogueLoaded = true;
    if (!includeCatalogue || !isSupabaseConfigured) return;
    try {
      for (let page = 0; page < MAX_CATALOGUE_PAGES; page++) {
        const rows = await fetchPublishedVideos(
          CATALOGUE_PAGE_SIZE,
          page * CATALOGUE_PAGE_SIZE,
        );
        for (const row of rows) {
          if (filter.kind === 'topic' && !matchesTopic(row.title, filter.keywords)) continue;
          catalogueRows.push(row);
          catalogueIds.add(row.youtube_video_id);
        }
        if (rows.length < CATALOGUE_PAGE_SIZE) break;
      }
    } catch {
      // Backend unreachable: the catalogue source simply stays empty;
      // the channel streams keep the feed alive (no error wall).
    }
  }

  function takeCatalogue(): HomeFeedItem | null {
    while (catalogueEmitted < catalogueRows.length) {
      const row = catalogueRows[catalogueEmitted++];
      if (seen.has(row.youtube_video_id)) continue;
      seen.add(row.youtube_video_id);
      return { kind: 'catalogue', key: `sb-${row.id}`, video: row };
    }
    return null;
  }

  // ── Channel sources ───────────────────────────────────────────────
  const cursors: ChannelCursor[] = (filter.kind === 'channels'
    ? channels.filter((c) => filter.channelIds.includes(c.youtubeChannelId))
    : channels
  )
    .filter((c) => c.youtubeChannelId)
    .map((channel) => ({
      channel,
      uploadsPlaylistId: uploadsPlaylistIdFor(channel.youtubeChannelId),
      buffer: [],
      nextPageToken: null,
      primed: false,
      tokenPrimed: false,
      exhausted: !isYouTubeConfigured,
      failed: false,
    }));

  /** Filter + dedupe a raw uploads page into a cursor's buffer. */
  function absorb(cursor: ChannelCursor, videos: YouTubeVideoMetadata[]): void {
    for (const meta of videos) {
      if (!isFeedEligible(meta)) continue;
      if (filter.kind === 'topic' && !matchesTopic(meta.title, filter.keywords)) continue;
      cursor.buffer.push(meta);
    }
  }

  /**
   * Make sure the cursor's buffer holds at least one item, fetching
   * pages as needed. Returns false when the channel can produce no
   * more items in this call (drained, or a fetch failed — see the
   * `failed` flag). Topic scans keep pulling pages until a match
   * lands, bounded per call by MAX_SCAN_PAGES_PER_CALL absorbed
   * pages; the scan position persists on the cursor, so the next
   * onEndReached simply continues deeper into the uploads.
   */
  async function fillBuffer(cursor: ChannelCursor): Promise<boolean> {
    if (cursor.buffer.length > 0) return true;
    if (cursor.exhausted || cursor.failed) return false;
    let scans = 0;
    while (cursor.buffer.length === 0 && !cursor.exhausted && scans < MAX_SCAN_PAGES_PER_CALL) {
      try {
        if (!cursor.primed) {
          // First page via the shared 30-min cache (2 units saved on
          // every repeat visit; shared with Subscriptions/Channel).
          // It IS an absorbed page, so it counts as a scan page.
          cursor.primed = true;
          const videos = await getUploadsCached(
            cursor.channel.youtubeChannelId,
            cursor.uploadsPlaylistId,
          );
          absorb(cursor, videos);
          scans++;
          // A short first page means the uploads playlist has no
          // second page; a full one needs token priming below.
          if (videos.length < 25) cursor.exhausted = true;
          continue;
        }
        if (!cursor.tokenPrimed) {
          // getUploadsCached returns videos but no continuation
          // token, so continuing past page 1 costs ONE direct page-1
          // fetch purely to learn the token; its videos are already
          // in `seen`/buffer flow and dedupe drops any repeat.
          // Also overhead — not counted as a scan page.
          cursor.tokenPrimed = true;
          const page = await fetchChannelUploads(cursor.uploadsPlaylistId);
          cursor.nextPageToken = page.nextPageToken;
          if (!page.nextPageToken) cursor.exhausted = true;
          continue;
        }
        if (!cursor.nextPageToken) {
          cursor.exhausted = true;
          break;
        }
        const page = await fetchChannelUploads(cursor.uploadsPlaylistId, cursor.nextPageToken);
        cursor.nextPageToken = page.nextPageToken;
        if (!page.nextPageToken) cursor.exhausted = true;
        absorb(cursor, page.videos);
        scans++;
      } catch {
        // Transient failure (quota blip / network): pause THIS
        // channel for the rest of this next() call only. It is NOT
        // exhausted — the next scroll retries from the same cursor
        // position, and the feed's `exhausted` stays false, so the
        // screen never claims "that's every video" over a blip.
        cursor.failed = true;
      }
    }
    return cursor.buffer.length > 0;
  }

  async function takeChannel(cursor: ChannelCursor): Promise<HomeFeedItem | null> {
    while (true) {
      const ready = await fillBuffer(cursor);
      if (!ready) return null;
      const meta = cursor.buffer.shift()!;
      // Dedupe by YouTube id: a catalogue twin (the row renders
      // instead) or an item already emitted from another source.
      if (seen.has(meta.youtubeVideoId) || catalogueIds.has(meta.youtubeVideoId)) continue;
      seen.add(meta.youtubeVideoId);
      return { kind: 'upload', key: `yt-${meta.youtubeVideoId}`, meta, channel: cursor.channel };
    }
  }

  async function next(count: number): Promise<{ items: HomeFeedItem[]; exhausted: boolean }> {
    // A channel that failed during the previous call gets a fresh
    // chance on every new call (scroll / refresh); within one call
    // it is tried once, so a dead key cannot spin the round-robin.
    for (const cursor of cursors) cursor.failed = false;
    await ensureCatalogue();
    const collected: HomeFeedItem[] = [];
    // Round-robin: one item per source per round, catalogue first in
    // the rotation, until the batch fills or a full round produces
    // nothing (every source drained/failed).
    while (collected.length < count) {
      let progressed = false;
      const catItem = takeCatalogue();
      if (catItem) {
        collected.push(catItem);
        progressed = true;
      }
      for (const cursor of cursors) {
        if (collected.length >= count) break;
        const item = await takeChannel(cursor);
        if (item) {
          collected.push(item);
          progressed = true;
        }
      }
      if (!progressed) break;
    }
    const catalogueDrained = catalogueEmitted >= catalogueRows.length;
    const exhausted =
      catalogueDrained && cursors.every((c) => c.exhausted && c.buffer.length === 0);
    // Light deterministic shuffle per batch: same seed + batch index
    // ⇒ same order (stable across re-renders); a refresh changes the
    // seed and reshuffles from page 1.
    return { items: shuffled(collected, seed + batchIndex++ * 7919), exhausted };
  }

  return { next };
}
