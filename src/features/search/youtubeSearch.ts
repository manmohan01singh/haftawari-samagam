/**
 * YouTube Data API v3 leg of search — the official channel only.
 *
 * QUOTA (see docs/SEARCH.md): search.list costs 100 units per call — by
 * far the most expensive call we make. It is therefore:
 *   - cached in AsyncStorage for 10 minutes per normalized query;
 *   - only fired by searchAll() on an explicit search, never per keystroke
 *     (suggestions are local + cached titles only);
 *   - de-duplicated while in flight.
 * channels.list and videos.list cost 1 unit each; playlistItems.list
 * costs 1 unit per page. Those are cached for hours / a day.
 *
 * Shorts exclusion: the Data API exposes no "isShort" flag. We drop any
 * result whose title/description carries "#shorts" or whose real
 * duration (videos.list) is 60 seconds or less. This is a heuristic and
 * is documented as such in docs/SEARCH.md.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { isYouTubeConfigured } from '../../lib/youtube';
import { OFFICIAL_CHANNEL, uploadsPlaylistId } from './config';
import { scoreTitle } from './fuzzy';
import type { ChannelResult, VideoResult } from './types';

const API_BASE = 'https://www.googleapis.com/youtube/v3';
const SEARCH_CACHE_TTL_MS = 10 * 60 * 1000;
const CHANNEL_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const TITLES_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const SEARCH_CACHE_PREFIX = '@haftawari/yt-search:v1:';
const CHANNEL_CACHE_KEY = '@haftawari/yt-channel:v1';
const TITLES_CACHE_KEY = '@haftawari/yt-titles:v1';

function apiKey(): string {
  const key = process.env.EXPO_PUBLIC_YOUTUBE_API_KEY;
  if (!key) throw new Error('YouTube Data API is not configured.');
  return key;
}

async function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  const separator = path.includes('?') ? '&' : '?';
  const response = await fetch(`${API_BASE}/${path}${separator}key=${encodeURIComponent(apiKey())}`, {
    signal,
  });
  if (!response.ok) {
    throw new Error(`YouTube Data API request failed with HTTP ${response.status}.`);
  }
  return (await response.json()) as T;
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

/** Channel-scoped search with 10-minute cache + in-flight de-duping, for ANY panel channel. */
export async function searchChannelVideosFor(channelId: string, queryText: string, signal?: AbortSignal): Promise<VideoResult[]> {
  if (!isYouTubeConfigured) return [];
  const cacheKey = `${SEARCH_CACHE_PREFIX}${channelId}:${queryText.trim().toLowerCase()}`;
  const cached = await readCache<VideoResult[]>(cacheKey, SEARCH_CACHE_TTL_MS);
  if (cached) return cached;

  const existing = inFlight.get(cacheKey);
  if (existing) return existing;

  const promise = searchChannelUncached(channelId, queryText, signal)
    .then(async (results) => {
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
