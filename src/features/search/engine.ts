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
} from './youtubeSearch';
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

async function runLegs(
  query: string,
  options: SearchOptions,
): Promise<{ channel: SearchResults['channel']; videos: VideoResult[]; youtubeSkipped: boolean }> {
  const channels = await loadSearchChannels().catch(() => []);
  const localPromise = searchLocalCatalogue(query, options.signal).catch(() => [] as VideoResult[]);

  // Channel card: the BEST-matching active channel wins the single
  // ref-3 card slot. Matching is local (zero quota); only the winner's
  // card data costs a (cached) channels.list call.
  let bestMatch: { channelId: string; score: number; kind: NonNullable<SearchResults['channel']>['matchKind'] } | null = null;
  for (const identity of channels) {
    const match = matchChannel(query, identity);
    if (match && (!bestMatch || match.score > bestMatch.score)) {
      bestMatch = { channelId: identity.id, score: match.score, kind: match.kind };
    }
  }
  const channelPromise = bestMatch
    ? fetchChannelCard(bestMatch.channelId, options.signal)
        .then((channel) =>
          channel ? { ...channel, score: bestMatch!.score, matchKind: bestMatch!.kind } : null,
        )
        .catch(() => null)
    : Promise.resolve(null);

  let youtubeSkipped = false;
  let youtubePromise: Promise<VideoResult[]>;
  if (options.localOnly) {
    youtubeSkipped = true;
    youtubePromise = Promise.resolve([]);
  } else {
    // Fan out per channel (capped for quota), merging every leg. The
    // leg counts as skipped only when EVERY channel's search failed.
    const targets = channels.slice(0, MAX_YOUTUBE_SEARCH_CHANNELS);
    youtubePromise = Promise.all(
      targets.map((identity) =>
        searchChannelVideosFor(identity.id, query, options.signal).then(
          (results) => ({ ok: true as const, results }),
          (error: unknown) => {
            if (error instanceof Error && error.name === 'AbortError') throw error;
            return { ok: false as const, results: [] as VideoResult[] };
          },
        ),
      ),
    ).then((legs) => {
      if (targets.length > 0 && legs.every((leg) => !leg.ok)) youtubeSkipped = true;
      return legs.flatMap((leg) => leg.results);
    });
  }
  const [local, channel, youtube] = await Promise.all([localPromise, channelPromise, youtubePromise]);
  return { channel, videos: mergeRanked(local, youtube, options.limit ?? 25), youtubeSkipped };
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
    return { query, channel: null, videos: [], youtubeSkipped: false, didYouMean: null };
  }

  const first = await runLegs(query, options);
  let { channel, videos, youtubeSkipped } = first;

  let didYouMean: string | null = null;
  if (!options.localOnly) {
    didYouMean = await deriveCorrection(query).catch(() => null);
    if (didYouMean && videos.length < 3) {
      const second = await runLegs(didYouMean, options).catch(() => null);
      if (second) {
        videos = mergeRanked(videos, second.videos, limit);
        channel = channel ?? second.channel;
        youtubeSkipped = youtubeSkipped && second.youtubeSkipped;
      }
    }
  }

  return { query, channel, videos, youtubeSkipped, didYouMean };
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
        waiter.resolve({ query: '', channel: null, videos: [], youtubeSkipped: true, didYouMean: null }),
      );
    },
  };
}

/** Normalized cache/comparison key for a query string. */
export function queryKey(queryText: string): string {
  return normalizeText(queryText);
}
