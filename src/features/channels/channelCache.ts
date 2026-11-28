/**
 * Quota-saving caches for per-channel YouTube data (see
 * docs/CHANNELS.md for the full strategy and unit budget).
 *
 * Everything is AsyncStorage-backed with a TTL, mirroring the search
 * stream's cache helpers:
 *   - channel metadata (channels.list, 1 unit)      — 6 hours
 *   - first uploads page (playlistItems 1 + videos 1) — 30 minutes
 *   - live/upcoming check (search.list, 100 units ×2) — 5 minutes,
 *     and callers additionally stagger checks so opening
 *     Subscriptions never fires every channel's check at once.
 *
 * Live state is only ever what the API reported at fetch time; the
 * short TTL keeps that honest (a stale "live" can survive at most
 * 5 minutes, and the badge always means "YouTube reported this
 * broadcast as live", never a session label).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  fetchChannelById,
  fetchChannelLiveAndUpcoming,
  fetchChannelUploads,
  fetchChannelsByIds,
  searchChannelVideoPage,
  type YouTubeChannelInfo,
  type YouTubeVideoMetadata,
} from '../../lib/youtube';

const PREFIX = '@haftawari/channels:v1:';
export const CHANNEL_INFO_TTL_MS = 6 * 60 * 60 * 1000;
export const UPLOADS_TTL_MS = 30 * 60 * 1000;
export const LIVE_TTL_MS = 10 * 60 * 1000;

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
    // Best-effort: a full/blocked store must not fail the screen.
  }
}

/** Cache entry WITH its age — the stale-while-revalidate reads below need it. */
async function readCacheEntry<T>(key: string): Promise<{ value: T; ageMs: number } | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { fetchedAt: number; value: T };
    return { value: parsed.value, ageMs: Date.now() - parsed.fetchedAt };
  } catch {
    return null;
  }
}

const inflight = new Map<string, Promise<unknown>>();

function dedupe<T>(key: string, run: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;
  const promise = run().finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}

/** Channel metadata, cached 6h (channels.list = 1 unit). */
export async function getChannelInfoCached(channelId: string): Promise<YouTubeChannelInfo | null> {
  const key = `${PREFIX}info:${channelId}`;
  const cached = await readCache<YouTubeChannelInfo>(key, CHANNEL_INFO_TTL_MS);
  if (cached) return cached;
  return dedupe(key, async () => {
    const info = await fetchChannelById(channelId).catch(() => null);
    if (info) {
      await writeCache(key, info);
      return info;
    }
    // The live fetch failed (e.g. the day's YouTube quota is gone):
    // serve the last persisted copy at ANY age rather than nothing —
    // a channel's name and DP change rarely, and a blank channel row
    // on Watch is worse than a slightly old copy (mobile sweep,
    // 27 Nov 2026: Watch channel row rendered an empty avatar circle
    // and no name while Home, fed by the uploads cache, was fine).
    const stale = await readCacheEntry<YouTubeChannelInfo>(key);
    return stale?.value ?? null;
  });
}

/**
 * Avatar (DP) urls for a batch of channels, cached 6h per channel
 * (same TTL as channel info). ONE channels.list call covers every
 * uncached id (1 unit per 50 ids) — this is how the built-in
 * registry channels, which carry no stored avatar, get their real
 * YouTube DP at the source (channelsService feeds the result into
 * fetchActiveChannels, so every surface — Subscriptions rail, Home
 * cards, channel lists — shows the DP without per-screen lookups).
 * A channel the API does not return, or a failed call, maps to null
 * and the caller's letter/initial fallback applies; failures are
 * NOT cached, so the next fetch retries.
 */
export async function getChannelAvatarsCached(
  channelIds: string[],
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  const missing: string[] = [];
  for (const id of channelIds) {
    if (!id) continue;
    const cached = await readCache<string | null>(`${PREFIX}avatar:${id}`, CHANNEL_INFO_TTL_MS);
    if (cached !== null) out.set(id, cached);
    else missing.push(id);
  }
  if (missing.length > 0) {
    try {
      const infos = await fetchChannelsByIds(missing);
      const byId = new Map(infos.map((i) => [i.channelId, i.avatarUrl]));
      for (const id of missing) {
        const avatarUrl = byId.get(id) ?? null;
        out.set(id, avatarUrl);
        if (avatarUrl) {
          await writeCache<string | null>(`${PREFIX}avatar:${id}`, avatarUrl);
        }
      }
    } catch {
      for (const id of missing) out.set(id, null);
    }
  }
  return out;
}

/** First page of a channel's uploads, cached 30 min (2 units). */
export async function getUploadsCached(
  channelId: string,
  uploadsPlaylistId: string,
): Promise<YouTubeVideoMetadata[]> {
  const page = await getUploadsPageCached(uploadsPlaylistId);
  return page.videos;
}

export interface UploadsPage {
  videos: YouTubeVideoMetadata[];
  nextPageToken: string | null;
}

/** How long a stale uploads page may be SERVED while it refreshes. */
export const UPLOADS_SWR_MS = 6 * 60 * 60 * 1000;

/**
 * ANY page of a channel's uploads (page 1 = no token), cached with
 * stale-while-revalidate — the "loads fast" fix (user, 27 Nov 2026):
 *
 * - Fresh (≤30 min): served from disk, zero API calls.
 * - Stale (30 min – 6 h): served from disk INSTANTLY and refreshed
 *   in the background (deduped), so the next open is fresh — the
 *   screen never waits on YouTube for data it already showed once.
 * - Older / missing: fetched live (2 units), then cached.
 *
 * Before this, only page 1 was cached and every deeper page — the
 * topic-chip scans, Channel paging, Watch's Up Next — went live to
 * the API on every single visit: slow on mobile data and the main
 * drain on the app's daily YouTube quota. Failures are never
 * cached; a failed background refresh simply keeps the stale page.
 */
export async function getUploadsPageCached(
  uploadsPlaylistId: string,
  pageToken?: string,
): Promise<UploadsPage> {
  const key = `${PREFIX}page:${uploadsPlaylistId}:${pageToken ?? 'first'}`;
  const entry = await readCacheEntry<UploadsPage>(key);
  if (entry && entry.ageMs <= UPLOADS_TTL_MS) return entry.value;
  if (entry && entry.ageMs <= UPLOADS_SWR_MS) {
    void dedupe(key, async () => {
      const page = await fetchChannelUploads(uploadsPlaylistId, pageToken);
      await writeCache(key, page);
      return page;
    }).catch(() => undefined);
    return entry.value;
  }
  return dedupe(key, async () => {
    try {
      const page = await fetchChannelUploads(uploadsPlaylistId, pageToken);
      await writeCache(key, page);
      return page;
    } catch (e) {
      // Last-resort stale source for page 1: the pre-SWR cache
      // entries (videos only, no continuation token) written by
      // getUploadsCached before this function existed. Serving one
      // during an API outage (e.g. the daily quota window) keeps
      // the feed alive on data the device already had, instead of
      // collapsing to the catalogue alone; the missing token just
      // means this channel contributes its first page until a
      // fresh fetch succeeds again.
      if (!pageToken && uploadsPlaylistId.startsWith('UU')) {
        const legacy = await readCacheEntry<YouTubeVideoMetadata[]>(
          `${PREFIX}uploads:UC${uploadsPlaylistId.slice(2)}`,
        );
        if (legacy && legacy.ageMs <= UPLOADS_SWR_MS) {
          return { videos: legacy.value, nextPageToken: null };
        }
      }
      throw e;
    }
  });
}

/** Topic-search first pages (Home chips) — 60 min: topics move slowly. */
export const TOPIC_TTL_MS = 60 * 60 * 1000;

export interface TopicSearchPage {
  videos: YouTubeVideoMetadata[];
  nextPageToken: string | null;
}

/**
 * First page of a within-channel topic search, cached 60 minutes
 * (search.list has its own small daily bucket — repeat chip taps
 * within the hour must be free). Deeper pages fetch directly via
 * searchChannelVideoPage; only page 1 is cached, mirroring uploads.
 */
export async function getTopicSearchPageCached(
  channelId: string,
  query: string,
): Promise<TopicSearchPage> {
  const key = `${PREFIX}topic:${channelId}:${query.toLowerCase()}`;
  const cached = await readCache<TopicSearchPage>(key, TOPIC_TTL_MS);
  if (cached) return cached;
  return dedupe(key, async () => {
    const page = await searchChannelVideoPage(channelId, query);
    await writeCache(key, page);
    return page;
  });
}

/**
 * A channel's live-now + upcoming broadcasts AS REPORTED BY YOUTUBE
 * (search.list eventType, 100 units each), cached 10 min. This is the
 * most expensive call in the app — never call it per keystroke or in a
 * tight loop; Subscriptions staggers it across channels.
 */
export async function getLiveCached(channelId: string): Promise<YouTubeVideoMetadata[]> {
  const key = `${PREFIX}live:${channelId}`;
  const cached = await readCache<YouTubeVideoMetadata[]>(key, LIVE_TTL_MS);
  if (cached) return cached;
  return dedupe(key, async () => {
    const items = await fetchChannelLiveAndUpcoming(channelId).catch(
      () => [] as YouTubeVideoMetadata[],
    );
    await writeCache(key, items);
    return items;
  });
}
