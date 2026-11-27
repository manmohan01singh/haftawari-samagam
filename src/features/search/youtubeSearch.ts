/**
 * YouTube Data API v3 leg of search — every active panel channel
 * (the engine fans out per channel; the single-channel helpers keep
 * the official channel as their default for back-compat).
 *
 * QUOTA (see docs/SEARCH.md): search.list costs 100 units per call — by
 * far the most expensive call we make. It is therefore:
 *   - cached per normalized query (10 minutes in memory, 6 hours in
 *     AsyncStorage — search results for a fixed query change slowly,
 *     and every repeat call burns the separate 'Search Queries'
 *     rate-limit metric as well as 100 units);
 *   - only fired by searchAll() on an explicit search, never per keystroke
 *     (suggestions are local + cached titles only);
 *   - de-duplicated while in flight;
 *   - retried exactly once on transient failures (network, timeout,
 *     5xx, and 429 rateLimitExceeded — probing on 2026-11-27 showed
 *     search.list 429s in bursts and recovers within about a minute,
 *     while the 1-unit endpoints stay healthy).
 * channels.list and videos.list cost 1 unit each; playlistItems.list
 * costs 1 unit per page. Those are cached for hours / a day.
 *
 * ERRORS are classified (youtubeError.ts) — never collapsed into one
 * generic failure. When search.list fails, a degraded fallback fuzzy-
 * matches the query over the channel's latest uploads (playlistItems,
 * 1 unit/page) so real channel results can still appear.
 *
 * Shorts exclusion: the Data API exposes no "isShort" flag. We drop any
 * result whose title/description carries "#shorts" or whose real
 * duration (videos.list) is 60 seconds or less. This is a heuristic and
 * is documented as such in docs/SEARCH.md.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { isYouTubeConfigured } from '../../lib/youtube';
import { OFFICIAL_CHANNEL, uploadsPlaylistId } from './config';
import { DEFAULT_THRESHOLD, rankByTitle, scoreTitle } from './fuzzy';
import type { ChannelResult, VideoResult } from './types';
import {
  YouTubeApiError,
  classifyFetchFailure,
  parseYouTubeErrorBody,
  timeoutError,
} from './youtubeError';

const API_BASE = 'https://www.googleapis.com/youtube/v3';
const SEARCH_MEM_CACHE_TTL_MS = 10 * 60 * 1000;
const SEARCH_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CHANNEL_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const TITLES_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const UPLOADS_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const SEARCH_CACHE_PREFIX = '@haftawari/yt-search:v1:';
const CHANNEL_CACHE_KEY = '@haftawari/yt-channel:v1';
const TITLES_CACHE_KEY = '@haftawari/yt-titles:v1';
const UPLOADS_CACHE_KEY = '@haftawari/yt-uploads:v1';
const REQUEST_TIMEOUT_MS = 10 * 1000;

function apiKey(): string {
  const key = process.env.EXPO_PUBLIC_YOUTUBE_API_KEY;
  if (!key) {
    throw new YouTubeApiError({
      errorClass: 'config',
      retryable: false,
      message: 'YouTube Data API is not configured.',
    });
  }
  return key;
}

function abortError(): Error {
  const error = new Error('The operation was aborted.');
  error.name = 'AbortError';
  return error;
}

/**
 * One API GET with a 10s timeout and classified failures. The caller's
 * AbortSignal still wins (thrown as AbortError so the engine can tell
 * "superseded" apart from "failed"); our own timeout surfaces as the
 * retryable 'timeout' class. Error bodies are parsed for the API's
 * machine-readable reason — the status alone is never the whole story.
 */
async function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  const separator = path.includes('?') ? '&' : '?';
  const url = `${API_BASE}/${path}${separator}key=${encodeURIComponent(apiKey())}`;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);
  const onCallerAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) {
      clearTimeout(timer);
      throw abortError();
    }
    signal.addEventListener?.('abort', onCallerAbort);
  }
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      const bodyText = await response.text().catch(() => '');
      throw parseYouTubeErrorBody(response.status, bodyText);
    }
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof YouTubeApiError) throw error;
    if (timedOut) throw timeoutError();
    if (signal?.aborted) throw abortError();
    throw classifyFetchFailure(error);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.('abort', onCallerAbort);
  }
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener?.('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal?.addEventListener?.('abort', onAbort);
  });
}

/**
 * Exactly ONE automatic retry, and only for transient classes
 * (network, timeout, 5xx, 429 rateLimitExceeded). Quota, referrer and
 * config failures are never retried — repeating them only burns quota
 * or hammers a hard limit. The rate-limit pause is longer: probing
 * showed bursts of search.list calls 429 within seconds and recover
 * in about a minute, so an 800ms retry would usually still be inside
 * the burst window.
 */
async function withRetry<T>(run: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof YouTubeApiError && error.retryable) {
      console.warn(
        `[search] YouTube leg failed (${error.errorClass}${error.reason ? `/${error.reason}` : ''}, HTTP ${error.status ?? '—'}); retrying once.`,
      );
      await delay(error.errorClass === 'rateLimit' ? 1500 : 800, signal);
      return run();
    }
    throw error;
  }
}

async function readCache<T>(key: string, ttlMs: number): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { fetchedAt: number; value: T };
    if (Date.now() - parsed.fetchedAt > ttlMs) return null;
    return parsed.value;
  } catch {
    return null;
  }
}

async function writeCache<T>(key: string, value: T): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify({ fetchedAt: Date.now(), value }));
  } catch {
    // Cache is best-effort; a full/blocked store must not fail a search.
  }
}

/** Parse an ISO-8601 duration ("PT2H5M27S") to seconds. */
export function parseIso8601Duration(iso: string): number | null {
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  if (!match) return null;
  const [, h, m, s] = match;
  return Number(h ?? 0) * 3600 + Number(m ?? 0) * 60 + Number(s ?? 0);
}

// ── Official channel card ────────────────────────────────────────────

interface ChannelsResponse {
  items?: {
    id: string;
    snippet: {
      title: string;
      customUrl?: string;
      thumbnails: Record<string, { url: string } | undefined>;
    };
    statistics: { subscriberCount?: string; videoCount?: string };
  }[];
}

/** A panel channel's identity for matching (table-driven, migration 0003). */
export interface ChannelIdentity {
  id: string;
  title: string;
  handle: string;
  aliases: readonly string[];
}

/**
 * Decide — locally, at zero quota cost — whether the query names a
 * channel (full name, alias, handle, or acronym like "bgsj").
 */
export function matchChannel(
  queryText: string,
  channel: ChannelIdentity,
): { score: number; kind: ChannelResult['matchKind'] } | null {
  const candidates = [channel.title, channel.handle.replace(/^@/, ''), ...channel.aliases];
  let best: { score: number; kind: ChannelResult['matchKind'] } | null = null;
  for (const candidate of candidates) {
    const { score, kind } = scoreTitle(queryText, candidate);
    // The channel card needs a stronger signal than a video result:
    // a stray word like "singh" must not summon it.
    if (score >= 0.7 && (!best || score > best.score)) best = { score, kind };
  }
  return best;
}

/** Back-compat wrapper: match against the original official channel. */
export function matchOfficialChannel(queryText: string): { score: number; kind: ChannelResult['matchKind'] } | null {
  return matchChannel(queryText, OFFICIAL_CHANNEL);
}

/** Live channel data for ANY panel channel's card (channels.list = 1 unit, cached 6h per channel). */
export async function fetchChannelCard(channelId: string, signal?: AbortSignal): Promise<ChannelResult | null> {
  if (!isYouTubeConfigured) return null;
  const cacheKey = channelId === OFFICIAL_CHANNEL.id ? CHANNEL_CACHE_KEY : `${CHANNEL_CACHE_KEY}:${channelId}`;
  const cached = await readCache<ChannelResult>(cacheKey, CHANNEL_CACHE_TTL_MS);
  if (cached) return cached;

  const data = await apiGet<ChannelsResponse>(
    `channels?part=snippet,statistics&id=${encodeURIComponent(channelId)}`,
    signal,
  );
  const item = data.items?.[0];
  if (!item) return null;
  const thumbs = item.snippet.thumbnails;
  const channel: ChannelResult = {
    kind: 'channel',
    channelId: item.id,
    title: item.snippet.title,
    handle: item.snippet.customUrl ?? '',
    avatarUrl: (thumbs.high ?? thumbs.medium ?? thumbs.default)?.url ?? null,
    subscriberCount: item.statistics.subscriberCount ? Number(item.statistics.subscriberCount) : null,
    videoCount: item.statistics.videoCount ? Number(item.statistics.videoCount) : null,
    matchKind: 'exact',
    score: 1,
  };
  await writeCache(cacheKey, channel);
  return channel;
}

/** Back-compat wrapper for the original official channel. */
export async function fetchOfficialChannel(signal?: AbortSignal): Promise<ChannelResult | null> {
  const channel = await fetchChannelCard(OFFICIAL_CHANNEL.id, signal);
  return channel ? { ...channel, handle: channel.handle || OFFICIAL_CHANNEL.handle } : null;
}

// ── Channel-scoped video search ──────────────────────────────────────

interface SearchResponse {
  items?: {
    id: { videoId: string };
    snippet: {
      title: string;
      description: string;
      channelId: string;
      channelTitle: string;
      publishedAt: string;
      liveBroadcastContent: 'none' | 'live' | 'upcoming';
      thumbnails: Record<string, { url: string } | undefined>;
    };
  }[];
}

interface VideosDetailsResponse {
  items?: { id: string; contentDetails: { duration: string } }[];
}

const inFlight = new Map<string, Promise<VideoResult[]>>();
const memCache = new Map<string, { fetchedAt: number; value: VideoResult[] }>();

async function searchChannelUncached(channelId: string, queryText: string, signal?: AbortSignal): Promise<VideoResult[]> {
  const params = new URLSearchParams({
    part: 'snippet',
    channelId,
    q: queryText,
    type: 'video',
    maxResults: '25',
    order: 'relevance',
  });
  const data = await apiGet<SearchResponse>(`search?${params.toString()}`, signal);
  const items = data.items ?? [];
  if (items.length === 0) return [];

  // One videos.list call (1 unit) for real durations → Shorts filter.
  const ids = items.map((item) => item.id.videoId).join(',');
  const details = await apiGet<VideosDetailsResponse>(
    `videos?part=contentDetails&id=${encodeURIComponent(ids)}`,
    signal,
  );
  const durations = new Map<string, number | null>(
    (details.items ?? []).map((item) => [item.id, parseIso8601Duration(item.contentDetails.duration)]),
  );

  const results: VideoResult[] = [];
  for (const item of items) {
    const durationSeconds = durations.get(item.id.videoId) ?? null;
    const taggedShort =
      item.snippet.title.toLowerCase().includes('#shorts') ||
      item.snippet.description.toLowerCase().includes('#shorts');
    if (taggedShort || (durationSeconds !== null && durationSeconds <= 60)) continue; // no Shorts, ever
    const thumbs = item.snippet.thumbnails;
    const { score, kind } = scoreTitle(queryText, item.snippet.title);
    results.push({
      kind: 'video',
      source: 'youtube',
      videoRowId: null,
      youtubeVideoId: item.id.videoId,
      title: item.snippet.title,
      thumbnailUrl: (thumbs.high ?? thumbs.medium ?? thumbs.default)?.url ?? null,
      durationSeconds,
      publishedAt: item.snippet.publishedAt,
      liveBroadcastContent: item.snippet.liveBroadcastContent,
      channelId: item.snippet.channelId,
      channelTitle: item.snippet.channelTitle,
      score,
      matchKind: kind,
    });
  }
  return results;
}

/**
 * Channel-scoped search with caching + in-flight de-duping, for ANY
 * panel channel. Failures are NEVER cached (a cached 429 would poison
 * the query for hours) and surface as classified YouTubeApiErrors.
 */
export async function searchChannelVideosFor(channelId: string, queryText: string, signal?: AbortSignal): Promise<VideoResult[]> {
  if (!isYouTubeConfigured) return [];
  const cacheKey = `${SEARCH_CACHE_PREFIX}${channelId}:${queryText.trim().toLowerCase()}`;
  const mem = memCache.get(cacheKey);
  if (mem && Date.now() - mem.fetchedAt < SEARCH_MEM_CACHE_TTL_MS) return mem.value;
  const cached = await readCache<VideoResult[]>(cacheKey, SEARCH_CACHE_TTL_MS);
  if (cached) {
    memCache.set(cacheKey, { fetchedAt: Date.now(), value: cached });
    return cached;
  }

  const existing = inFlight.get(cacheKey);
  if (existing) return existing;

  const promise = withRetry(() => searchChannelUncached(channelId, queryText, signal), signal)
    .then(async (results) => {
      memCache.set(cacheKey, { fetchedAt: Date.now(), value: results });
      await writeCache(cacheKey, results);
      return results;
    })
    .finally(() => inFlight.delete(cacheKey));
  inFlight.set(cacheKey, promise);
  return promise;
}

/** Back-compat wrapper scoped to the original official channel. */
export async function searchChannelVideos(queryText: string, signal?: AbortSignal): Promise<VideoResult[]> {
  return searchChannelVideosFor(OFFICIAL_CHANNEL.id, queryText, signal);
}

// ── Degraded fallback: fuzzy-match the channel's latest uploads ─────

interface UploadItem {
  videoId: string;
  title: string;
  description: string;
  publishedAt: string;
  thumbnailUrl: string | null;
}

interface PlaylistSnippetResponse {
  nextPageToken?: string;
  items?: {
    snippet: {
      title: string;
      description: string;
      publishedAt: string;
      resourceId: { videoId: string };
      thumbnails: Record<string, { url: string } | undefined>;
    };
  }[];
}

interface VideosFullDetailsResponse {
  items?: {
    id: string;
    snippet: { liveBroadcastContent: 'none' | 'live' | 'upcoming' };
    contentDetails: { duration: string };
  }[];
}

/**
 * One channel's latest 100 uploads (2 playlistItems pages = 2 units),
 * cached 6h per channel. This is the fallback's raw material: real
 * API data, newest first — NOT a query-matched set on its own.
 */
async function fetchRecentUploadsFor(channelId: string, signal?: AbortSignal): Promise<UploadItem[]> {
  const cacheKey =
    channelId === OFFICIAL_CHANNEL.id ? UPLOADS_CACHE_KEY : `${UPLOADS_CACHE_KEY}:${channelId}`;
  const cached = await readCache<UploadItem[]>(cacheKey, UPLOADS_CACHE_TTL_MS);
  if (cached) return cached;

  const playlistId = uploadsPlaylistId(channelId);
  const uploads: UploadItem[] = [];
  let pageToken = '';
  for (let page = 0; page < 2; page++) {
    const tokenPart = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '';
    const data = await apiGet<PlaylistSnippetResponse>(
      `playlistItems?part=snippet&playlistId=${playlistId}&maxResults=50${tokenPart}`,
      signal,
    );
    for (const item of data.items ?? []) {
      const thumbs = item.snippet.thumbnails;
      uploads.push({
        videoId: item.snippet.resourceId.videoId,
        title: item.snippet.title,
        description: item.snippet.description,
        publishedAt: item.snippet.publishedAt,
        thumbnailUrl: (thumbs.high ?? thumbs.medium ?? thumbs.default)?.url ?? null,
      });
    }
    pageToken = data.nextPageToken ?? '';
    if (!pageToken) break;
  }
  await writeCache(cacheKey, uploads);
  return uploads;
}

/**
 * Degraded fallback for a failed search.list leg: fuzzy-match the
 * query over the latest uploads' titles with the engine's OWN scorer
 * and threshold (rankByTitle / DEFAULT_THRESHOLD), then enrich the
 * matches with one videos.list call (durations → Shorts filter, real
 * live state). Coverage is inherently partial — only the latest ~100
 * uploads — so callers MUST label these results as fallback matches
 * (the engine does, via `youtubeFallback`).
 */
export async function searchUploadsFallbackFor(
  channelId: string,
  queryText: string,
  signal?: AbortSignal,
): Promise<VideoResult[]> {
  const uploads = await fetchRecentUploadsFor(channelId, signal);
  const ranked = rankByTitle(queryText, uploads, (upload) => upload.title, DEFAULT_THRESHOLD);
  if (ranked.length === 0) return [];

  const top = ranked.slice(0, 25);
  const ids = top.map(({ item }) => item.videoId).join(',');
  const details = await apiGet<VideosFullDetailsResponse>(
    `videos?part=contentDetails,snippet&id=${encodeURIComponent(ids)}`,
    signal,
  );
  const byId = new Map((details.items ?? []).map((item) => [item.id, item]));

  const results: VideoResult[] = [];
  for (const { item, score, kind } of top) {
    const detail = byId.get(item.videoId);
    const durationSeconds = detail ? parseIso8601Duration(detail.contentDetails.duration) : null;
    const taggedShort =
      item.title.toLowerCase().includes('#shorts') || item.description.toLowerCase().includes('#shorts');
    if (taggedShort || (durationSeconds !== null && durationSeconds <= 60)) continue; // no Shorts, ever
    results.push({
      kind: 'video',
      source: 'youtube',
      videoRowId: null,
      youtubeVideoId: item.videoId,
      title: item.title,
      thumbnailUrl: item.thumbnailUrl,
      durationSeconds,
      publishedAt: item.publishedAt,
      liveBroadcastContent: detail?.snippet.liveBroadcastContent ?? 'none',
      score,
      matchKind: kind,
    });
  }
  return results;
}

/** Back-compat wrapper: the uploads fallback for the official channel. */
export async function searchUploadsFallback(
  queryText: string,
  signal?: AbortSignal,
): Promise<VideoResult[]> {
  return searchUploadsFallbackFor(OFFICIAL_CHANNEL.id, queryText, signal);
}

/** Outcome of the channel video leg: results, or a classified failure. */
export interface YoutubeLegOutcome {
  videos: VideoResult[];
  /** Classified search.list failure, when the leg failed. */
  error: YouTubeApiError | null;
  /** True when `videos` came from the latest-uploads fallback. */
  usedFallback: boolean;
}

/**
 * The channel video leg as the engine consumes it: search.list first
 * (cached, de-duped, one retry on transient failure); on ANY failure,
 * the latest-uploads fuzzy fallback. Throws only on abort — every
 * other failure is reported in the outcome so the screen can show the
 * classified cause instead of a generic banner.
 */
export async function searchChannelVideosWithFallback(
  queryText: string,
  signal?: AbortSignal,
): Promise<YoutubeLegOutcome> {
  if (!isYouTubeConfigured) {
    return {
      videos: [],
      error: new YouTubeApiError({
        errorClass: 'config',
        retryable: false,
        message: 'YouTube Data API is not configured.',
      }),
      usedFallback: false,
    };
  }
  try {
    const videos = await searchChannelVideos(queryText, signal);
    return { videos, error: null, usedFallback: false };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    const classified =
      error instanceof YouTubeApiError
        ? error
        : new YouTubeApiError({
            errorClass: 'unknown',
            retryable: false,
            message: error instanceof Error ? error.message : String(error),
          });
    console.warn(
      `[search] Channel search leg failed (${classified.errorClass}${classified.reason ? `/${classified.reason}` : ''}, HTTP ${classified.status ?? '—'}): ${classified.message}`,
    );
    try {
      const fallbackVideos = await searchUploadsFallback(queryText, signal);
      if (fallbackVideos.length > 0) {
        return { videos: fallbackVideos, error: classified, usedFallback: true };
      }
    } catch (fallbackError) {
      if (fallbackError instanceof Error && fallbackError.name === 'AbortError') throw fallbackError;
      console.warn('[search] Uploads fallback also failed; continuing with the archive only.');
    }
    return { videos: [], error: classified, usedFallback: false };
  }
}

// ── Channel titles for suggestions ───────────────────────────────────

interface PlaylistItemsResponse {
  items?: { snippet: { title: string } }[];
}

/**
 * Recent upload titles of ANY panel channel (uploads playlist,
 * playlistItems.list = 1 unit per page), cached 24h. Feeds suggestions
 * only — titles are real API data, never invented.
 */
export async function fetchChannelTitlesFor(channelId: string, signal?: AbortSignal): Promise<string[]> {
  if (!isYouTubeConfigured) return [];
  const cacheKey = channelId === OFFICIAL_CHANNEL.id ? TITLES_CACHE_KEY : `${TITLES_CACHE_KEY}:${channelId}`;
  const cached = await readCache<string[]>(cacheKey, TITLES_CACHE_TTL_MS);
  if (cached) return cached;

  const playlistId = uploadsPlaylistId(channelId);
  const data = await apiGet<PlaylistItemsResponse>(
    `playlistItems?part=snippet&playlistId=${playlistId}&maxResults=50`,
    signal,
  );
  const titles = (data.items ?? [])
    .map((item) => item.snippet.title)
    .filter((title) => !title.toLowerCase().includes('#shorts'));
  await writeCache(cacheKey, titles);
  return titles;
}

/** Back-compat wrapper for the original official channel. */
export async function fetchChannelTitles(signal?: AbortSignal): Promise<string[]> {
  return fetchChannelTitlesFor(OFFICIAL_CHANNEL.id, signal);
}
