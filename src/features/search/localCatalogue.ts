/**
 * Local catalogue leg of search: the app's own published videos in
 * Supabase. Costs no YouTube quota and works offline-of-YouTube, so it
 * always runs first. Results are fuzzy-ranked locally.
 */

import { supabase } from '../../lib/supabase';
import type { Video } from '../../types/database';
import { rankByTitle } from './fuzzy';
import type { VideoResult } from './types';

const CACHE_TTL_MS = 5 * 60 * 1000;

let cache: { fetchedAt: number; videos: Video[] } | null = null;

/** Drop the in-memory catalogue cache (e.g. after admin publishes). */
export function invalidateCatalogueCache(): void {
  cache = null;
}

/**
 * All published videos, newest first. Returns [] when Supabase is not
 * configured — an honest empty catalogue, never invented rows.
 */
let catalogueInFlight: Promise<Video[]> | null = null;

export async function fetchPublishedVideos(signal?: AbortSignal): Promise<Video[]> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache.videos;
  if (!supabase) return [];
  // Share one in-flight fetch (audit P2, 28 Nov 2026): stage-1
  // search, the correction pass and a retry could otherwise fire
  // the same Supabase query concurrently on a cold cache.
  if (catalogueInFlight) return catalogueInFlight;
  catalogueInFlight = fetchPublishedVideosUncached(signal).finally(() => {
    catalogueInFlight = null;
  });
  return catalogueInFlight;
}

async function fetchPublishedVideosUncached(signal?: AbortSignal): Promise<Video[]> {
  if (!supabase) return [];

  let query = supabase
    .from('videos')
    .select('*')
    .eq('publish_state', 'published')
    // Deterministic order, same keys as src/lib/videos.ts (P10):
    // published_at ties must not reshuffle between loads.
    .order('published_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(500);
  if (signal) query = query.abortSignal(signal);

  const { data, error } = await query;
  if (error) throw new Error(`Catalogue fetch failed: ${error.message}`);
  const videos = (data ?? []) as Video[];
  cache = { fetchedAt: Date.now(), videos };
  return videos;
}

/**
 * Shorts exclusion for the local catalogue: admin-curated samagams are
 * long recordings, but the rule is applied anyway so a stray short can
 * never surface — a "#shorts" tag or a duration of 60s or less.
 */
export function isShortForm(video: Pick<Video, 'title' | 'duration_seconds'>): boolean {
  if (video.title.toLowerCase().includes('#shorts')) return true;
  return video.duration_seconds !== null && video.duration_seconds <= 60;
}

/** Fuzzy-search the local catalogue. */
export async function searchLocalCatalogue(
  queryText: string,
  signal?: AbortSignal,
): Promise<VideoResult[]> {
  const videos = await fetchPublishedVideos(signal);
  const eligible = videos.filter((video) => !isShortForm(video));
  return rankByTitle(queryText, eligible, (video) => video.title).map(({ item, score, kind }) => ({
    kind: 'video' as const,
    source: 'local' as const,
    videoRowId: item.id,
    youtubeVideoId: item.youtube_video_id,
    title: item.title,
    thumbnailUrl: item.thumbnail_url,
    durationSeconds: item.duration_seconds,
    publishedAt: item.published_at,
    liveBroadcastContent: 'none' as const,
    score,
    matchKind: kind,
  }));
}
