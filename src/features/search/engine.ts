/**
 * Search engine — merges the three legs into one ranked result set:
 *
 *   1. Channel card   — when the query names ANY active panel channel
 *      ("bgsj", "amritvela trust live", a handle). Identities come from
 *      the admin `channels` table (channelRegistry); matching is local;
 *      card data from channels.list (1 unit, cached 6h per channel).
 *   2. Local catalogue — the app's published videos, fuzzy-ranked.
 *      Zero quota; always runs.
 *   3. Channel uploads — a fuzzy scan of each active channel's
 *      latest ~200 uploads (playlistItems, cached 6h). NO search.list
 *      is used at all (user, 28 Nov 2026): results come ONLY from
 *      the app's added channels, and no search quota can kill it.
 *      When the query names a channel, that channel's recent videos
 *      are merged in under its card, like YouTube does.
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
  fetchChannelRecentResults,
  fetchChannelTitlesFor,
  matchChannel,
  searchUploadsFallbackFor,
  searchYouTubeGlobalFiltered,
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
 * Why this exists (QA issue 91): a typo'd token ("haftawri") scores
 * weakly against real titles, so a thin result set re-runs once with
 * the corrected query derived from REAL known vocabulary — the same
 * trick that let the old search.list leg answer "haftawari".
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
    // Never "correct" by prefix-shrinking or prefix-growing: if one
    // word is a prefix of the other, the longer one is usually the
    // user's real word and the shorter a different word entirely —
    // 'purakh' -> 'pura' and 'ramdasji' -> 'ramdas' both came from
    // this (user screenshots, 28 Nov 2026) and read as wrong guesses.
    // The scorer already handles prefix typing; the corrector is for
    // genuine typos (transpositions, dropped letters) only.
    if (
      best &&
      bestScore >= 0.8 &&
      best !== token &&
      !token.startsWith(best) &&
      !best.startsWith(token)
    ) {
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
    // Hosted rows have no YouTube id (null): they can never twin with a
    // YouTube result, so they merge under their own row key.
    const key = result.youtubeVideoId ?? `row:${result.videoRowId ?? result.title}`;
    const existing = byVideoId.get(key);
    if (!existing || (existing.source === 'youtube' && result.source === 'local')) {
      byVideoId.set(key, result);
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
  // card data costs a (cached) channels.list call.
  let bestMatch: { channelId: string; score: number; kind: NonNullable<SearchResults['channel']>['matchKind']; viaName: boolean } | null = null;
  for (const identity of channels) {
    const match = matchChannel(query, identity);
    if (!match) continue;
    // A NAME match on any channel beats an ALIAS match on any other
    // (see matchChannel) — raw score only breaks ties within a class.
    const wins =
      !bestMatch ||
      (match.viaName && !bestMatch.viaName) ||
      (match.viaName === bestMatch.viaName && match.score > bestMatch.score);
    if (wins) {
      bestMatch = { channelId: identity.id, score: match.score, kind: match.kind, viaName: match.viaName };
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

  // Fan out per channel over the uploads scan — ALL active
  // channels, in parallel (playlistItems rides the general quota
  // bucket and the pages are cached 6h; the old search.list burst
  // problem does not apply). Each channel's failure is classified
  // (never collapsed into one generic failure); the search counts
  // as skipped only when EVERY channel's scan failed. Legs throw
  // only on abort, which must propagate (a superseded search is not
  // a failed search and must not light the degraded banner).
  const targets = channels;
  let firstError: YouTubeErrorClass | null = null;
  // PRIMARY leg (user's instruction, 28 Nov 2026): one real YouTube
  // search, filtered to the app's channels — YouTube's index finds
  // videos of ANY age on those channels. The per-channel uploads
  // scans run alongside as the recall supplement and as the
  // degradation path when the search.list bucket is exhausted.
  let globalError: YouTubeErrorClass | null = null;
  const globalPromise = options.skipGlobalLeg
    ? Promise.resolve([] as VideoResult[])
    : searchYouTubeGlobalFiltered(
    query,
    targets.map((t) => t.id),
    options.signal,
  ).catch((error) => {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    if (error instanceof YouTubeApiError) globalError = error.errorClass;
    return [] as VideoResult[];
  });
  const legs = await Promise.all(
    targets.map(async (identity) => {
      try {
        const channelTerms = new Set<string>(
          [identity.title, ...(identity.aliases ?? [])]
            .flatMap((text) => tokenize(text))
            .filter((token) => token.length >= 3),
        );
        const results = await searchUploadsFallbackFor(identity.id, query, options.signal, channelTerms);
        return { ok: true, channelId: identity.id, results };
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') throw error;
        if (error instanceof YouTubeApiError && firstError === null) {
          firstError = error.errorClass;
        }
        return { ok: false, channelId: identity.id, results: [] as VideoResult[] };
      }
    }),
  );
  const globalResults = await globalPromise;
  let youtubeVideos = [
    ...globalResults,
    ...legs.flatMap((leg) =>
    leg.results.map((r) => {
      const identity = targets.find((t) => t.id === leg.channelId);
      return {
        ...r,
        channelId: r.channelId ?? leg.channelId,
        channelTitle: r.channelTitle ?? identity?.title,
      };
    }),
    ),
  ];
  // Channel-name query: the named channel's recent videos ride
  // under its card (YouTube behaviour for a channel search), scored
  // just under an exact title match so they interleave with the
  // query matches instead of sinking below one big channel's flood.
  if (bestMatch) {
    try {
      const identity = targets.find((t) => t.id === bestMatch.channelId);
      const recent = (await fetchChannelRecentResults(bestMatch.channelId, 10, options.signal)).map(
        (r) => ({
          ...r,
          score: 0.99,
          channelId: r.channelId ?? bestMatch.channelId,
          channelTitle: r.channelTitle ?? identity?.title,
        }),
      );
      youtubeVideos = [...youtubeVideos, ...recent];
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw error;
      // Best-effort garnish; the card and the query matches stand.
    }
  }
  const scansFailed = targets.length > 0 && legs.every((leg) => !leg.ok);
  // Skipped only when NOTHING remote worked. When the YouTube leg
  // failed but the scans carried the page, the outcome is the
  // degraded fallback mode (the screen notes it) — not an error.
  const allFailed = scansFailed && globalError !== null;
  const [local, channel] = await Promise.all([localPromise, channelPromise]);
  return {
    channel,
    videos: capPerChannel(mergeRanked(local, youtubeVideos, options.limit ?? 25), options.limit ?? 25),
    youtubeSkipped: allFailed,
    youtubeError: allFailed ? (globalError ?? firstError) : null,
    youtubeFallback: globalError !== null && !allFailed,
  };
}

/**
 * Flood control (user, 28 Nov 2026): one prolific channel's matches
 * must not fill the whole results page — for "amritvela" the
 * official channel alone produced 25+ high-scoring matches and the
 * Amritvela Trust's own videos never surfaced. At most ~40% of the
 * page comes from a single channel in the first pass; overflow
 * results fill any slots left over, in ranked order. Results with
 * no channel identity (local catalogue rows) are never capped.
 */
function capPerChannel(results: VideoResult[], limit: number): VideoResult[] {
  const cap = Math.max(3, Math.floor(limit * 0.4));
  const counts = new Map<string, number>();
  const kept: VideoResult[] = [];
  const overflow: VideoResult[] = [];
  for (const result of results) {
    const channelId = result.channelId;
    if (!channelId) {
      kept.push(result);
      continue;
    }
    const n = counts.get(channelId) ?? 0;
    if (n < cap) {
      counts.set(channelId, n + 1);
      kept.push(result);
    } else {
      overflow.push(result);
    }
  }
  return [...kept, ...overflow].slice(0, limit);
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
      // When the first channel scan already failed with a
      // classified error, do NOT fire the corrected query into the
      // same dead leg. The correction re-run then covers the local +
      // channel-card legs only; the screen's Retry re-runs the
      // channel scan once things recover.
      const legDead = youtubeError !== null && !youtubeFallback;
      // When the first run's global leg already succeeded (no error,
      // no fallback), the correction re-run skips it (audit P2,
      // 28 Nov 2026): the corrected query's recall comes from the
      // scans + local legs, and the shared search bucket is not
      // burned twice for one user search.
      const globalAlreadyOk = !youtubeFallback && youtubeError === null;
      const secondOptions = legDead
        ? { ...options, localOnly: true }
        : globalAlreadyOk
          ? { ...options, skipGlobalLeg: true }
          : options;
      const second = await runLegs(didYouMean, secondOptions).catch(
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

  // Never offer a correction above an EMPTY result page: "did you
  // mean: karta pura vkhaniye" over "No results found" (user
  // screenshot, 28 Nov 2026) reads as a wrong guess and erodes trust.
  // The suggestion stays when the search itself found videos.
  if (videos.length === 0) didYouMean = null;

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
