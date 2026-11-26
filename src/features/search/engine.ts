/**
 * Search engine — merges the three legs into one ranked result set:
 *
 *   1. Channel card   — when the query names the official channel
 *      ("bgsj", "bhai gursharan singh ji", the handle). Decided locally;
 *      card data from channels.list (1 unit, cached 6h).
 *   2. Local catalogue — the app's published videos, fuzzy-ranked.
 *      Zero quota; always runs.
 *   3. Channel uploads — YouTube search.list scoped to the official
 *      channel (100 units, cached 10 min per query).
 *
 * Ranking contract (see docs/SEARCH.md):
 *   exact/phrase local  >  acronym local  >  fuzzy local  >  YouTube leg,
 *   within a tier by score, then newest first. A video present in BOTH
 *   legs appears once — the local row wins (it carries the row id the
 *   app needs for history/saves). Shorts never appear (both legs filter).
 */

import { normalizeText } from './normalize';
import { searchLocalCatalogue } from './localCatalogue';
import { fetchOfficialChannel, matchOfficialChannel, searchChannelVideos } from './youtubeSearch';
import type { SearchOptions, SearchResults, VideoResult } from './types';

function tierOf(result: VideoResult): number {
  if (result.source === 'local') {
    if (result.matchKind === 'exact' || result.matchKind === 'phrase') return 0;
    if (result.matchKind === 'acronym') return 1;
    return 2;
  }
  return 3;
}

function compareResults(a: VideoResult, b: VideoResult): number {
  const tierDiff = tierOf(a) - tierOf(b);
  if (tierDiff !== 0) return tierDiff;
  if (b.score !== a.score) return b.score - a.score;
  const aTime = a.publishedAt ? Date.parse(a.publishedAt) : 0;
  const bTime = b.publishedAt ? Date.parse(b.publishedAt) : 0;
  return bTime - aTime;
}

/** Run a full search. Safe to call with an AbortSignal for cancellation. */
export async function searchAll(queryText: string, options: SearchOptions = {}): Promise<SearchResults> {
  const query = queryText.trim();
  const limit = options.limit ?? 25;
  if (query === '') {
    return { query, channel: null, videos: [], youtubeSkipped: false };
  }

  const localPromise = searchLocalCatalogue(query, options.signal).catch(() => [] as VideoResult[]);

  // Channel card: local decision, live data.
  const channelMatch = matchOfficialChannel(query);
  const channelPromise = channelMatch
    ? fetchOfficialChannel(options.signal)
        .then((channel) =>
          channel ? { ...channel, score: channelMatch.score, matchKind: channelMatch.kind } : null,
        )
        .catch(() => null)
    : Promise.resolve(null);

  // YouTube leg — skipped only when asked, unconfigured, or aborted.
  let youtubeSkipped = false;
  let youtubePromise: Promise<VideoResult[]>;
  if (options.localOnly) {
    youtubeSkipped = true;
    youtubePromise = Promise.resolve([]);
  } else {
    youtubePromise = searchChannelVideos(query, options.signal).catch((error: unknown) => {
      if (error instanceof Error && error.name === 'AbortError') throw error;
      youtubeSkipped = true;
      return [] as VideoResult[];
    });
  }

  const [local, channel, youtube] = await Promise.all([localPromise, channelPromise, youtubePromise]);

  const byVideoId = new Map<string, VideoResult>();
  for (const result of [...local, ...youtube]) {
    const existing = byVideoId.get(result.youtubeVideoId);
    if (!existing || (existing.source === 'youtube' && result.source === 'local')) {
      byVideoId.set(result.youtubeVideoId, result);
    }
  }
  const videos = [...byVideoId.values()].sort(compareResults).slice(0, limit);

  return { query, channel, videos, youtubeSkipped };
}

// ── Debounce + cancellation for the screen ───────────────────────────

export interface SearchController {
  /** Debounced search; superseded calls resolve with the LATEST result. */
  search(queryText: string, options?: SearchOptions): Promise<SearchResults>;
  /** Cancel the pending debounce and any in-flight request. */
  cancel(): void;
}

/**
 * Wraps searchAll with a debounce (default 300 ms) and an internal
 * AbortController: a new call aborts the previous in-flight request, so
 * stale results can never land after newer ones. All callers awaiting a
 * superseded search receive the newest search's result.
 */
export function createSearchController(debounceMs = 300): SearchController {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let aborter: AbortController | null = null;
  let waiters: { resolve: (value: SearchResults) => void; reject: (error: unknown) => void }[] = [];

  const flush = (settle: (waiter: (typeof waiters)[number]) => void) => {
    const pending = waiters;
    waiters = [];
    for (const waiter of pending) settle(waiter);
  };

  return {
    search(queryText, options) {
      if (timer) clearTimeout(timer);
      aborter?.abort();
      aborter = new AbortController();
      const signal = options?.signal ?? aborter.signal;

      return new Promise<SearchResults>((resolve, reject) => {
        waiters.push({ resolve, reject });
        timer = setTimeout(() => {
          timer = null;
          searchAll(queryText, { ...options, signal }).then(
            (results) => flush((waiter) => waiter.resolve(results)),
            (error) => flush((waiter) => waiter.reject(error)),
          );
        }, debounceMs);
      });
    },
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
      aborter?.abort();
      flush((waiter) =>
        waiter.resolve({ query: '', channel: null, videos: [], youtubeSkipped: true }),
      );
    },
  };
}

/** Normalized cache/comparison key for a query string. */
export function queryKey(queryText: string): string {
  return normalizeText(queryText);
}
