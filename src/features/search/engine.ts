/**
 * Search engine — merges the three legs into one ranked result set:
 *
 *   1. Channel card   — when the query names ANY active panel channel
 *      ("bgsj", "amritvela trust live", a handle). Identities come from
 *      the admin `channels` table (channelRegistry); matching is local;
 *      card data from channels.list (1 unit, cached 6h per channel).
 *   2. Local catalogue — the app's published videos, fuzzy-ranked.
 *      Zero quota; always runs.
 *   3. Channel uploads — YouTube search.list scoped to each active
 *      channel (100 units per channel, capped at
 *      MAX_YOUTUBE_SEARCH_CHANNELS, cached 10 min per channel+query).
 *
 * Ranking contract (see docs/SEARCH.md):
 *   exact/phrase local  >  acronym local  >  fuzzy local  >  YouTube leg,
 *   within a tier by score, then newest first. A video present in BOTH
 *   legs appears once — the local row wins (it carries the row id the
 *   app needs for history/saves). Shorts never appear (both legs filter).
 */

import { normalizeText, tokenize } from './normalize';
import { tokenSimilarity } from './fuzzy';
import { fetchPublishedVideos, searchLocalCatalogue } from './localCatalogue';
import { loadSearchChannels, MAX_YOUTUBE_SEARCH_CHANNELS } from './channelRegistry';
import {
  fetchChannelCard,
  fetchChannelTitlesFor,
  matchChannel,
  searchChannelVideosFor,
  searchUploadsFallbackFor,
} from './youtubeSearch';
import { YouTubeApiError, type YouTubeErrorClass } from './youtubeError';
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

/**
 * Derive a corrected query from REAL known vocabulary only: tokens of
 * the published catalogue titles, the cached channel-upload titles and
 * the official channel's name/aliases. Each typed token is replaced by
 * its best fuzzy token match (similarity ≥ 0.8, and actually different);
 * if no token changes, there is no correction (null).
 *
 * Why this exists (QA issue 91): the YouTube search.list leg is literal
 * — for the typo "haftawri" it returns NOTHING, and the fuzzy scorer
 * only ever ranked the local catalogue, so the live search came back
 * empty even though the engine's own tests pass for that typo. The
 * correction lets searchAll retry the YouTube leg with the real word
 * "haftawari", which the channel's search does answer.
 */
export async function deriveCorrection(queryText: string): Promise<string | null> {
  const queryTokens = tokenize(queryText);
  if (queryTokens.length === 0) return null;
  const vocabulary = new Set<string>();
  const addTitle = (title: string) => {
    for (const token of tokenize(title)) if (token.length >= 3) vocabulary.add(token);
  };
  const channels = await loadSearchChannels().catch(() => []);
  try {
    const [videos, ...titleLists] = await Promise.all([
      fetchPublishedVideos().catch(() => []),
      ...channels
        .slice(0, MAX_YOUTUBE_SEARCH_CHANNELS)
        .map((c) => fetchChannelTitlesFor(c.id).catch(() => [] as string[])),
    ]);
    for (const video of videos) addTitle(video.title);
    for (const titles of titleLists) for (const title of titles) addTitle(title);
  } catch {
    // Vocabulary sources are best-effort; aliases below still apply.
  }
  for (const channel of channels) {
    addTitle(channel.title);
    for (const alias of channel.aliases) addTitle(alias);
  }
  addTitle('haftawari samagam kirtan'); // the app's own domain words (branding, not data)

  let changed = false;
  const corrected = queryTokens.map((token) => {
    if (vocabulary.has(token)) return token;
    let best: string | null = null;
    let bestScore = 0;
    for (const candidate of vocabulary) {
      const score = tokenSimilarity(token, candidate);
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
    if (best && bestScore >= 0.8 && best !== token) {
      changed = true;
      return best;
    }
    return token;
  });
  return changed ? corrected.join(' ') : null;
}


function mergeRanked(local: VideoResult[], youtube: VideoResult[], limit: number): VideoResult[] {
  const byVideoId = new Map<string, VideoResult>();
  for (const result of [...local, ...youtube]) {
    const existing = byVideoId.get(result.youtubeVideoId);
    if (!existing || (existing.source === 'youtube' && result.source === 'local')) {
      byVideoId.set(result.youtubeVideoId, result);
    }
  }
  return [...byVideoId.values()].sort(compareResults).slice(0, limit);
}

/** Merge two ranked result sets (local row wins over its API twin). */
export function mergeRankedResults(a: VideoResult[], b: VideoResult[], limit = 25): VideoResult[] {
  return mergeRanked(a, b, limit);
}

interface LegsOutcome {
  channel: SearchResults['channel'];
  videos: VideoResult[];
  youtubeSkipped: boolean;
  youtubeError: YouTubeErrorClass | null;
  youtubeFallback: boolean;
}

async function runLegs(query: string, options: SearchOptions): Promise<LegsOutcome> {
  const channels = await loadSearchChannels().catch(() => []);
  const localPromise = options.youtubeOnly
    ? Promise.resolve([] as VideoResult[])
    : searchLocalCatalogue(query, options.signal).catch(() => [] as VideoResult[]);

  // Channel card: the BEST-matching active channel wins the single
  // ref-3 card slot. Matching is local (zero quota); only the winner's
  // card data costs a (cached) channels.list call. Comparison is by
  // matchChannel's source-weighted RANK, not the raw score: a
  // channel's own title/handle match always beats another channel's
  // alias match (Phase 13: "amritvela" must show an Amritvela
  // channel's card, not BGSJ's, whose identity carried the term as
  // an alias).
  let bestMatch: { channelId: string; score: number; rank: number; kind: NonNullable<SearchResults['channel']>['matchKind'] } | null = null;
  for (const identity of channels) {
    const match = matchChannel(query, identity);
    if (match && (!bestMatch || match.rank > bestMatch.rank)) {
      bestMatch = { channelId: identity.id, score: match.score, rank: match.rank, kind: match.kind };
    }
  }
  const channelPromise = bestMatch
    ? fetchChannelCard(bestMatch.channelId, options.signal)
        .then((channel) =>
          channel ? { ...channel, score: bestMatch!.score, matchKind: bestMatch!.kind } : null,
        )
        .catch(() => null)
    : Promise.resolve(null);

  if (options.localOnly) {
    const [local, channel] = await Promise.all([localPromise, channelPromise]);
    return {
      channel,
      videos: mergeRanked(local, [], options.limit ?? 25),
      youtubeSkipped: true,
      youtubeError: null,
      youtubeFallback: false,
    };
  }

  // Fan out per channel (capped for quota), merging every leg. Each
  // leg's failure is classified (never collapsed into one generic
  // failure); the search counts as skipped only when EVERY channel's
  // leg failed AND the degraded fallback found nothing. Legs throw
  // only on abort, which must propagate (a superseded search is not a
  // failed search and must not light the degraded banner).
  const targets = channels.slice(0, MAX_YOUTUBE_SEARCH_CHANNELS);
  let firstError: YouTubeErrorClass | null = null;
  // SEQUENTIAL, not Promise.all: Google throttles this project's
  // search.list in bursts (separate "Search Queries" rate metric,
  // diagnosed 2026-11-27), so firing every channel's search in the
  // same instant risks losing all of them; spaced calls succeed.
  // (This fix was lost once in a union merge — keep it.)
  const legs: { ok: boolean; channelId: string; results: VideoResult[] }[] = [];
  for (const identity of targets) {
    try {
      const results = await searchChannelVideosFor(identity.id, query, options.signal);
      legs.push({ ok: true, channelId: identity.id, results });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw error;
      if (error instanceof YouTubeApiError && firstError === null) {
        firstError = error.errorClass;
      }
      legs.push({ ok: false, channelId: identity.id, results: [] });
    }
  }
  let youtubeVideos = legs.flatMap((leg) => leg.results);
  let youtubeFallback = false;
  // Degraded fallback, PER FAILED CHANNEL (Phase 11): fuzzy-match
  // each failed channel's latest uploads (playlistItems, 1 unit/page,
  // cached 6h) so its real results can still appear when search.list
  // is down or rate-limited. This used to run ONLY for the official
  // channel — a failed Amritvela/Sakhiyan leg silently returned
  // nothing even though the same cheap fallback could have covered
  // it. Sequential, like the legs, for burst discipline.
  for (const leg of legs) {
    if (leg.ok) continue;
    try {
      const fallbackVideos = await searchUploadsFallbackFor(leg.channelId, query, options.signal);
      if (fallbackVideos.length > 0) {
        youtubeVideos = [...youtubeVideos, ...fallbackVideos];
        youtubeFallback = true;
      }
    } catch (fallbackError) {
      if (fallbackError instanceof Error && fallbackError.name === 'AbortError') throw fallbackError;
      console.warn('[search] Uploads fallback also failed; continuing with the archive only.');
    }
  }
  const allFailed = targets.length > 0 && legs.every((leg) => !leg.ok);
  const [local, channel] = await Promise.all([localPromise, channelPromise]);
  return {
    channel,
    videos: mergeRanked(local, youtubeVideos, options.limit ?? 25),
    youtubeSkipped: allFailed && !youtubeFallback,
    youtubeError: firstError,
    youtubeFallback,
  };
}

/**
 * Run a full search. Safe to call with an AbortSignal for cancellation.
 *
 * TIMING CONTRACT (QA issue 91): callers that need fast first paint use
 * searchAll(q, { localOnly: true }) for stage 1 (Supabase catalogue —
 * no YouTube quota, no search.list latency) and then this full call for
 * stage 2. The full call still awaits the YouTube leg, but a screen
 * must never blank-wait on it: stage-1 results stay on screen while
 * stage 2 runs, and a failed/slow YouTube leg degrades to the local
 * results (youtubeSkipped), never to an empty page.
 *
 * TYPO CONTRACT: if the merged set is thin (< 3) and a correction was
 * derived from known titles, the legs re-run ONCE with the corrected
 * query and merge in; `didYouMean` reports the correction so the
 * screen can offer it explicitly.
 */
export async function searchAll(queryText: string, options: SearchOptions = {}): Promise<SearchResults> {
  const query = queryText.trim();
  const limit = options.limit ?? 25;
  if (query === '') {
    return {
      query,
      channel: null,
      videos: [],
      youtubeSkipped: false,
      youtubeError: null,
      youtubeFallback: false,
      didYouMean: null,
    };
  }

  const first = await runLegs(query, options);
  let { channel, videos, youtubeSkipped, youtubeError, youtubeFallback } = first;

  let didYouMean: string | null = null;
  if (!options.localOnly) {
    didYouMean = await deriveCorrection(query).catch(() => null);
    if (didYouMean && videos.length < 3) {
      // Burst discipline: when the first channel leg already failed
      // with a classified error, do NOT fire a second search.list for
      // the corrected query into the same dead/throttled leg — that
      // doubles the burst that caused 429s. The correction re-run then
      // covers the local + channel-card legs only; the screen's Retry
      // re-runs the channel leg once things recover.
      const legDead = youtubeError !== null && !youtubeFallback;
      const second = await runLegs(didYouMean, legDead ? { ...options, localOnly: true } : options).catch(
        () => null,
      );
      if (second) {
        videos = mergeRanked(videos, second.videos, limit);
        channel = channel ?? second.channel;
        if (!legDead) {
          // The correction run re-attempted the channel leg: its
          // outcome replaces the first run's failure state.
          youtubeSkipped = second.youtubeSkipped;
          youtubeError = second.youtubeError;
          youtubeFallback = second.youtubeFallback;
        }
      }
    }
  }

  return { query, channel, videos, youtubeSkipped, youtubeError, youtubeFallback, didYouMean };
}

/**
 * Re-run ONLY the channel legs (card + YouTube videos) for a query —
 * the results screen's degraded-banner Retry. The local catalogue is
 * not re-fetched and no second search is started; the caller merges
 * the returned videos into the results already on screen.
 */
export async function searchYoutubeOnly(
  queryText: string,
  options: SearchOptions = {},
): Promise<SearchResults> {
  const query = queryText.trim();
  if (query === '') {
    return {
      query,
      channel: null,
      videos: [],
      youtubeSkipped: false,
      youtubeError: null,
      youtubeFallback: false,
      didYouMean: null,
    };
  }
  const legs = await runLegs(query, { ...options, youtubeOnly: true });
  return {
    query,
    channel: legs.channel,
    videos: legs.videos,
    youtubeSkipped: legs.youtubeSkipped,
    youtubeError: legs.youtubeError,
    youtubeFallback: legs.youtubeFallback,
    didYouMean: null,
  };
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
        waiter.resolve({
          query: '',
          channel: null,
          videos: [],
          youtubeSkipped: true,
          youtubeError: null,
          youtubeFallback: false,
          didYouMean: null,
        }),
      );
    },
  };
}

/** Normalized cache/comparison key for a query string. */
export function queryKey(queryText: string): string {
  return normalizeText(queryText);
}
