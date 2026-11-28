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
 *  - Round-robin across sources (catalogue + one stream per channel)
 *    GATHERS each batch: uploads playlists are newest-first, so one
 *    item per source per round collects RECENT videos from all
 *    channels and no single channel can dominate the gathering.
 *  - Each emitted batch is then ordered LATEST FIRST (user order,
 *    27 Nov 2026: "pull the latest, don't show the old ones first"):
 *    currently-live broadcasts first, then by real published date
 *    descending — the YouTube-home recency feel. Items already on
 *    screen never move; the ordering applies per batch as it lands.
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
 *  - Topic chips deliberately use this scan, NOT search.list: the
 *    search bucket is only 100 queries/day SHARED across every user
 *    of the shipped API key (measured 27 Nov 2026 — a test harness
 *    exhausted it in an afternoon: HTTP 429 'Search Queries per
 *    day'), while the scan draws on the 10,000-unit general bucket.
 *    The scan's cost is bounded by CALL_SCAN_CAP + the first-call
 *    round-1 return, and recent uploads genuinely carry the topics
 *    (Simran Sadhna / Chaliya uploads are weekly).
 */

import { uploadsPlaylistIdFor, type AppChannel } from '../channels/channelsService';
import { getUploadsCached, getUploadsPageCached } from '../channels/channelCache';
import { isSupabaseConfigured } from '../../lib/supabase';
import { contentKeyFor, normaliseTitleHard } from '../../lib/contentDedupe';
import { fetchPublishedVideos } from '../../lib/videos';
import {
  OFFICIAL_CHANNEL_ID,
  isShortVideo,
  isYouTubeConfigured,
  type YouTubeVideoMetadata,
} from '../../lib/youtube';
import type { Video } from '../../types/database';

// ── Feed items ───────────────────────────────────────────────────────

export type HomeFeedItem =
  | { kind: 'catalogue'; key: string; video: Video }
  | { kind: 'upload'; key: string; meta: YouTubeVideoMetadata; channel: AppChannel };

/** The YouTube video id behind either item kind (dedupe + share). NULL for hosted catalogue rows — they have no YouTube id. */
export function feedItemYoutubeId(item: HomeFeedItem): string | null {
  return item.kind === 'catalogue' ? item.video.youtube_video_id : item.meta.youtubeVideoId;
}

// ── Chips + filters ──────────────────────────────────────────────────

/**
 * The Home topic-chips row (user's explicit list, YouTube pattern).
 * 'Live' IS a real feed filter (user order, 27 Nov 2026): it shows
 * every channel's currently-live broadcast (the uploads scan carries
 * the real broadcast state) — HomeScreen additionally pins the app's
 * own NOW PLAYING session as a normal card at its top.
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
  | { kind: 'topic'; keywords: string[] }
  /** Only currently-live broadcasts, from every channel's uploads. */
  | { kind: 'live' };

/**
 * Resolve a chip to a feed filter. Channel chips resolve against
 * the ACTIVE channel list, so an admin-added/renamed channel still
 * matches by handle/id; a chip whose channel is not active resolves
 * to an empty channel set (an honest empty feed, never a
 * silently-wrong one).
 */
export function resolveChipFilter(
  chip: string,
  channels: AppChannel[],
): HomeFeedFilter {
  if (chip === 'Live') return { kind: 'live' };
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
  let mine = Infinity;
  for (const k of keywords) {
    const i = haystack.indexOf(k);
    if (i !== -1 && i < mine) mine = i;
  }
  if (mine === Infinity) return false;
  // First-topic-wins (fix round 4, Chat 2 #9): a title that LEADS
  // with another topic's keyword belongs to that topic's chip even
  // when this chip's keyword appears later in the title — "Sakhi …
  // Kirtan" is a Sakhi video that also mentions kirtan, and the
  // Kirtan chip showing it read as "chips don't filter".
  for (const kws of Object.values(TOPIC_KEYWORDS)) {
    if (kws === keywords) continue;
    for (const k of kws) {
      const i = haystack.indexOf(k);
      if (i !== -1 && i < mine) return false;
    }
  }
  return true;
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

// ── Latest-first ordering ────────────────────────────────────────────

/** Real published timestamp of a feed item (0 when unknown). */
function feedItemTimestamp(item: HomeFeedItem): number {
  const raw = item.kind === 'upload' ? item.meta.publishedAt : item.video.published_at;
  if (!raw) return 0;
  const t = Date.parse(raw);
  return Number.isNaN(t) ? 0 : t;
}

/** A genuinely live YouTube broadcast (the app's own sessions are not feed items). */
function feedItemIsLive(item: HomeFeedItem): boolean {
  return item.kind === 'upload' && item.meta.liveBroadcastContent === 'live';
}

/**
 * Latest first (user order, 27 Nov 2026): live broadcasts lead the
 * batch, then newest published first. Stable for equal keys, so the
 * round-robin gathering order survives inside a tie.
 */
function latestFirst(items: HomeFeedItem[]): HomeFeedItem[] {
  return [...items].sort((a, b) => {
    const la = feedItemIsLive(a) ? 0 : 1;
    const lb = feedItemIsLive(b) ? 0 : 1;
    if (la !== lb) return la - lb;
    const dt = feedItemTimestamp(b) - feedItemTimestamp(a);
    if (dt !== 0) return dt;
    // Deterministic tiebreak (fix round 5, N-5): the same SET of
    // items must always produce the same ORDER — batch-arrival
    // order used to leak in through ties, so tapping All reshuffled
    // the feed and returning via minimise restored a different one.
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
}

/**
 * The one ordering for the whole feed (exported for the screen):
 * the screen re-sorts its FULL list with this on every append, so
 * the visible order is a pure function of the items gathered —
 * never of which batch they arrived in (N-5).
 */
export const sortFeedItems = latestFirst;

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
/**
 * First-call scan budget (speed fixes #2/#4, measured 27 Nov 2026):
 * a batch must not wait for every channel's DEEP scan before it can
 * render — the first next() call reads ONE page per channel (the
 * shared cached page 1, the same one Home/Subscriptions already
 * fetched) so catalogue matches + page-1 topic matches paint in a
 * couple of seconds, and later calls (scroll) continue the same
 * cursors deeper at the full budget. At 3 pages the first batch
 * still took ~16 s on a slow network for a sparse topic — the
 * slowest channel's sequential page chain gates the whole round.
 */
const FIRST_CALL_SCAN_PAGES = 1;
/**
 * Early-return batch floor (speed fix #3, verified live 27 Nov
 * 2026): next() previously hunted until the batch held the full
 * requested count (25) before returning ANYTHING. For a sparse
 * topic (Simran), some channel keeps finding a match every few
 * pages, so the call ran for minutes while the first item — a
 * catalogue row matched in round 1 — sat unrendered and the chip
 * looked dead. Now a call returns at a round boundary once it
 * holds a useful batch; the screen's onEndReached simply calls
 * next() again and the cursors continue from where they stopped.
 */
const MIN_BATCH_BEFORE_RETURN = 8;
/** Round cap per call once anything is collected (same fix). */
const MAX_ROUNDS_PER_CALL = 6;
/**
 * Per-call TOTAL page cap across all channels (same fix, measured
 * round 2): without it, a sparse topic's later rounds re-scanned
 * every channel's full budget again and again — one Sakhi batch
 * burned 282 API calls / ~107 s in simulation. 40 pages bounds any
 * single next() to a few seconds of parallel fetching; the cursors
 * keep their positions and scrolling continues the hunt.
 */
const CALL_SCAN_CAP = 40;
/**
 * Live-filter scan budget per channel per call: a channel's live
 * broadcast, when one exists, sits at the head of its uploads
 * playlist (it is the newest item), so two pages always suffice —
 * a channel with nothing live must not burn the deep topic-scan
 * budget proving it on every scroll step.
 */
const LIVE_SCAN_PAGES = 2;
/**
 * Live-filter LIFETIME scan cap per channel: live broadcasts sit
 * at the head of the uploads playlist, so after 3 lifetime pages a
 * channel is declared drained FOR THE LIVE FILTER — otherwise the
 * feed never reports exhausted and the footer spinner runs forever
 * under the last live card (verified live, 27 Nov 2026: 7 live
 * cards, all from page 1, spinner still hunting page 5+).
 */
const LIVE_TOTAL_SCAN_CAP = 3;

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
  /** Pages absorbed over the pager's whole life (live-filter cap). */
  totalScans: number;
  /** A fill is already in flight for this cursor (deadline races
   *  must not start a second fetch of the same page). */
  filling: boolean;
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
}

export function createHomeFeedPager({ channels, filter }: HomeFeedPagerOptions): HomeFeedPager {
  const seen = new Set<string>();
  // Content-level dedupe (fault 4): the same programme re-uploaded
  // under a different video id (same channel + title + duration)
  // is emitted once; a different duration is a different programme
  // and always stays.
  const contentSeen = new Set<string>();
  const liveSeen = new Set<string>();
  // Same-day same-title dedupe (fix round 5, #4): a broadcast and
  // its same-day recording share a title but carry different
  // durations, so the duration-keyed dedupe above can never pair
  // them — the feed showed "Official SGPC LIVE … 28.11.2026" twice.
  // Keyed by channel + hard-normalised title + published DAY; a
  // later twin drops when either side is/was live or the titles
  // are exactly equal. Daily series are safe: their titles repeat
  // across DAYS, not within one.
  const daySeen = new Map<string, { isLive: boolean; title: string }>();

  // ── Catalogue source ──────────────────────────────────────────────
  // Included for 'all' and topic filters, and for channel filters
  // that include the official channel (catalogue rows ARE official
  // uploads). The full catalogue id set is preloaded up front (it is
  // small) so an upload twin is dropped even before its row's turn
  // in the rotation — the row itself is what must open in Watch.
  const includeCatalogue =
    filter.kind === 'live'
      ? // Live broadcasts are carried by the uploads scan (real
        // broadcast state); catalogue rows are recordings.
        false
      : filter.kind !== 'channels' || filter.channelIds.includes(OFFICIAL_CHANNEL_ID);
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
          if (row.youtube_video_id) catalogueIds.add(row.youtube_video_id);
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
      // A card with no title is not a card (fix round 5, #4): an
      // untitled row reads as a broken blank entry in the feed.
      if (!row.title || row.title.trim().length === 0) continue;
      // Hosted rows have no YouTube id; dedupe them by row id instead.
      const dedupeKey = row.youtube_video_id ?? `row:${row.id}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
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
      totalScans: 0,
      filling: false,
      exhausted: !isYouTubeConfigured,
      failed: false,
    }));

  /** Filter + dedupe a raw uploads page into a cursor's buffer. */
  function absorb(cursor: ChannelCursor, videos: YouTubeVideoMetadata[]): void {
    for (const meta of videos) {
      if (!isFeedEligible(meta)) continue;
      if (filter.kind === 'topic' && !matchesTopic(meta.title, filter.keywords)) continue;
      if (filter.kind === 'live' && meta.liveBroadcastContent !== 'live') continue;
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
  /** Scan budget for the next() call currently running (see FIRST_CALL_SCAN_PAGES). */
  let currentScanBudget = MAX_SCAN_PAGES_PER_CALL;
  /** Pages fetched by the next() call currently running, all channels summed. */
  let callScansUsed = 0;

  async function fillBuffer(cursor: ChannelCursor): Promise<boolean> {
    if (cursor.buffer.length > 0) return true;
    if (cursor.exhausted || cursor.failed) return false;
    if (cursor.filling) return false;
    cursor.filling = true;
    try {
      return await fillBufferInner(cursor);
    } finally {
      cursor.filling = false;
    }
  }

  async function fillBufferInner(cursor: ChannelCursor): Promise<boolean> {
    if (filter.kind === 'live' && cursor.totalScans >= LIVE_TOTAL_SCAN_CAP) {
      // Live-filter lifetime cap (see LIVE_TOTAL_SCAN_CAP): nothing
      // live lives this deep in a channel's uploads.
      cursor.exhausted = true;
      return false;
    }
    let scans = 0;
    while (
      cursor.buffer.length === 0 &&
      !cursor.exhausted &&
      // The failed flag MUST be part of the loop condition: the
      // catch below sets it, but the page-fetch branch increments
      // `scans` only AFTER a successful fetch — a channel whose
      // fetch throws every time (bad token, dead playlist) never
      // increments anything, so without this check the loop spun
      // forever and the feed's next() never resolved (verified
      // live, 27 Nov 2026: the Live chip's footer spinner never
      // stopped — one failing channel hung the whole batch).
      !cursor.failed &&
      scans < currentScanBudget &&
      callScansUsed < CALL_SCAN_CAP
    ) {
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
          callScansUsed++;
          cursor.totalScans++;
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
          const page = await getUploadsPageCached(cursor.uploadsPlaylistId);
          cursor.nextPageToken = page.nextPageToken;
          if (!page.nextPageToken) cursor.exhausted = true;
          continue;
        }
        if (!cursor.nextPageToken) {
          cursor.exhausted = true;
          break;
        }
        const page = await getUploadsPageCached(cursor.uploadsPlaylistId, cursor.nextPageToken);
        cursor.nextPageToken = page.nextPageToken;
        if (!page.nextPageToken) cursor.exhausted = true;
        absorb(cursor, page.videos);
        scans++;
        callScansUsed++;
        cursor.totalScans++;
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
    // Dedupe-drop guard: a take that keeps shifting items it must
    // drop (catalogue twins, cross-channel duplicates — common for
    // topic search results) must not loop through a channel's whole
    // buffer in one call; after a few drops it yields the round and
    // the next call continues from the same buffer.
    let drops = 0;
    while (true) {
      const ready = await fillBuffer(cursor);
      if (!ready) return null;
      const meta = cursor.buffer.shift()!;
      // No title, no card (fix round 5, #4): an untitled item
      // renders as a broken blank entry.
      if (!meta.title || meta.title.trim().length === 0) {
        drops++;
        if (drops >= 6) return null;
        continue;
      }
      // Same-day same-title twin (see daySeen above).
      const dayKey = `${meta.channelId}|${normaliseTitleHard(meta.title)}|${(meta.publishedAt ?? '').slice(0, 10)}`;
      const dayTwin = daySeen.get(dayKey);
      if (
        dayTwin &&
        (meta.liveBroadcastContent === 'live' ||
          dayTwin.isLive ||
          dayTwin.title === meta.title.trim().toLowerCase())
      ) {
        drops++;
        if (drops >= 6) return null;
        continue;
      }
      // Dedupe by YouTube id: a catalogue twin (the row renders
      // instead) or an item already emitted from another source.
      if (seen.has(meta.youtubeVideoId) || catalogueIds.has(meta.youtubeVideoId)) {
        drops++;
        if (drops >= 6) return null;
        continue;
      }
      const contentKey = contentKeyFor(meta.channelId, meta.title, meta.durationSeconds);
      if (contentKey != null && contentSeen.has(contentKey)) {
        drops++;
        if (drops >= 6) return null;
        continue;
      }
      // Live dedupe (fix round 4, Chat 2 #4): live items have no
      // duration, so the content key above can never fire for them —
      // and one channel's parallel streams with the SAME title
      // ("Official SGPC LIVE" ×4) read as duplicates in the feed.
      // Same channel + same normalised title + both live = one card.
      if (meta.liveBroadcastContent === 'live') {
        const liveKey = `live:${meta.channelId}:${meta.title.trim().toLowerCase().replace(/\s+/g, ' ')}`;
        if (liveSeen.has(liveKey)) {
          drops++;
          if (drops >= 6) return null;
          continue;
        }
        liveSeen.add(liveKey);
      }
      seen.add(meta.youtubeVideoId);
      if (contentKey != null) contentSeen.add(contentKey);
      if (!daySeen.has(dayKey)) {
        daySeen.set(dayKey, {
          isLive: meta.liveBroadcastContent === 'live',
          title: meta.title.trim().toLowerCase(),
        });
      }
      return { kind: 'upload', key: `yt-${meta.youtubeVideoId}`, meta, channel: cursor.channel };
    }
  }

  let nextCallCount = 0;

  async function next(count: number): Promise<{ items: HomeFeedItem[]; exhausted: boolean }> {
    // A channel that failed during the previous call gets a fresh
    // chance on every new call (scroll / refresh); within one call
    // it is tried once, so a dead key cannot spin the round-robin.
    for (const cursor of cursors) cursor.failed = false;
    const isFirstCall = nextCallCount === 0;
    currentScanBudget = isFirstCall ? FIRST_CALL_SCAN_PAGES : MAX_SCAN_PAGES_PER_CALL;
    if (filter.kind === 'live') {
      currentScanBudget = Math.min(currentScanBudget, LIVE_SCAN_PAGES);
    }
    callScansUsed = 0;
    nextCallCount++;
    await ensureCatalogue();
    const collected: HomeFeedItem[] = [];
    // Round-robin: one item per source per round, catalogue first in
    // the rotation, until the batch fills or a full round produces
    // nothing (every source drained/failed) — with the early-return
    // floor above: once a round boundary leaves us holding a useful
    // batch, return it and let scrolling continue the hunt.
    let rounds = 0;
    while (collected.length < count) {
      let progressed = false;
      const catItem = takeCatalogue();
      if (catItem) {
        collected.push(catItem);
        progressed = true;
      }
      // Parallel pre-fill (speed fix, 27 Nov 2026): every channel's
      // network fetch for this round runs CONCURRENTLY. The takes
      // below stay sequential (they share the dedupe set), but they
      // now read from warm buffers — first paint no longer waits on
      // nine channels' round trips in series, and a topic chip's
      // deep scan stops feeling like an empty tab.
      // Deadline (fix round 4, Chat 2 #1/B9): the round no longer
      // waits for the SLOWEST channel — under API quota death one
      // hanging fetch (12 s timeout) stalled the whole first paint
      // behind a full-screen loader. Fills that miss the deadline
      // keep running in the background and their items join the
      // next round; the channel is not marked failed for being slow.
      await Promise.race([
        Promise.all(cursors.map((c) => fillBuffer(c))),
        new Promise((resolve) => setTimeout(resolve, 5000)),
      ]);
      for (const cursor of cursors) {
        if (collected.length >= count) break;
        const item = await takeChannel(cursor);
        if (item) {
          collected.push(item);
          progressed = true;
        }
      }
      if (!progressed) break;
      rounds++;
      // Early return (see MIN_BATCH_BEFORE_RETURN): never hold a
      // useful batch hostage to a sparse topic's long hunt. The
      // round cap only applies once something is collected — an
      // empty-handed call keeps hunting until a genuinely dead
      // round, so a chip never reports empty over a slow scan.
      if (collected.length >= MIN_BATCH_BEFORE_RETURN) break;
      // FIRST call paints after ONE round with whatever it holds
      // (measured round 2: waiting for 8 items let sparse topics
      // burn 100-280 calls across extra rounds before first paint;
      // one round is ~2-4 s of parallel fetching, and scrolling
      // continues the hunt immediately).
      // …unless nothing LIVE is in hand yet (user, 28 Nov 2026:
      // 'latest live sab ton upar kyun nahi aa raha'): one more
      // round gives a live broadcast the chance to lead the very
      // first screen instead of landing in the second batch.
      if (isFirstCall && collected.length >= 4) break;
      if (isFirstCall && collected.length > 0 && (rounds >= 2 || collected.some((i) => feedItemIsLive(i)))) break;
      if (collected.length > 0 && rounds >= MAX_ROUNDS_PER_CALL) break;
    }
    const catalogueDrained = catalogueEmitted >= catalogueRows.length;
    // A channel that FAILED this call (quota/network) counts as
    // drained for the marker (fix round 5, #8): it resets at the
    // start of every next() call, so at return time `failed` means
    // "produced nothing this call" — without it the end-of-feed
    // marker could never appear while any key was dead, and the
    // feed just dissolved into blank space.
    const exhausted =
      catalogueDrained && cursors.every((c) => (c.exhausted || c.failed) && c.buffer.length === 0);
    // Latest first per batch (live broadcasts lead, then newest
    // published): the round-robin above only GATHERS across sources
    // so no channel dominates; the visible order is recency, the
    // YouTube-home feel the user asked for.
    return { items: latestFirst(collected), exhausted };
  }

  return { next };
}
