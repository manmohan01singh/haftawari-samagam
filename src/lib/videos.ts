/**
 * Supabase data access for the published video catalogue, watch history
 * and saved videos. Everything here reads/writes REAL rows only; RLS is
 * the enforcement (published videos are public-read, history/saves are
 * owner-only, video writes are admin-only).
 */
import { requireSupabase, supabase } from './supabase';
import type { Category, Video, WatchHistoryEntry } from '../types/database';

/** One page of the published catalogue (featured first, then newest). */
export async function fetchPublishedVideos(limit = 25, offset = 0): Promise<Video[]> {
  const client = requireSupabase();
  const { data, error } = await client
    .from('videos')
    .select('*')
    .eq('publish_state', 'published')
    .order('is_featured', { ascending: false })
    .order('published_at', { ascending: false, nullsFirst: false })
    .range(offset, offset + limit - 1);
  if (error) throw new Error(error.message);
  return (data ?? []) as Video[];
}

export async function fetchVideoByRowId(rowId: string): Promise<Video | null> {
  const client = requireSupabase();
  const { data, error } = await client.from('videos').select('*').eq('id', rowId).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Video | null) ?? null;
}

/** Other published recordings for the watch page's Up Next list. */
export async function fetchUpNext(excludeRowId: string | null, limit = 15): Promise<Video[]> {
  const client = requireSupabase();
  let query = client
    .from('videos')
    .select('*')
    .eq('publish_state', 'published')
    .order('published_at', { ascending: false, nullsFirst: false })
    .limit(limit);
  if (excludeRowId) query = query.neq('id', excludeRowId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as Video[];
}

export async function fetchCategories(): Promise<Category[]> {
  const client = requireSupabase();
  const { data, error } = await client
    .from('categories')
    .select('*')
    .order('sort_order', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as Category[];
}

/** Local catalogue search (published rows whose title matches). */
export async function searchPublishedVideos(query: string, limit = 25): Promise<Video[]> {
  const client = requireSupabase();
  const { data, error } = await client
    .from('videos')
    .select('*')
    .eq('publish_state', 'published')
    .ilike('title', `%${query.replace(/[%_]/g, '')}%`)
    .order('published_at', { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as Video[];
}

/**
 * Record (or refresh) a watch-history row for the signed-in user.
 * Position tracking inside the official embed is not exposed to the
 * host app, so the stored position stays 0 — the row records THAT the
 * recording was opened and when, which is all the history UI claims.
 */
export async function recordWatchHistory(userId: string, videoRowId: string): Promise<void> {
  const client = requireSupabase();
  const { error } = await client.from('watch_history').upsert(
    {
      user_id: userId,
      video_id: videoRowId,
      last_position_seconds: 0,
      watched_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,video_id' },
  );
  if (error) throw new Error(error.message);
}

export interface HistoryItem {
  entry: WatchHistoryEntry;
  video: Video;
}

export async function fetchWatchHistory(userId: string, limit = 50): Promise<HistoryItem[]> {
  const client = requireSupabase();
  const { data, error } = await client
    .from('watch_history')
    .select('*, video:videos(*)')
    .eq('user_id', userId)
    .order('watched_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as (WatchHistoryEntry & { video: Video | null })[];
  return rows
    .filter((r): r is WatchHistoryEntry & { video: Video } => Boolean(r.video))
    .map((r) => ({ entry: r, video: r.video }));
}

// ── Saved videos (the bookmark action; owner-only via RLS) ───────────

export async function fetchSavedVideoIds(userId: string): Promise<Set<string>> {
  const client = requireSupabase();
  const { data, error } = await client.from('saved_videos').select('video_id').eq('user_id', userId);
  if (error) throw new Error(error.message);
  return new Set((data ?? []).map((r) => (r as { video_id: string }).video_id));
}

export async function fetchSavedVideos(userId: string, limit = 50): Promise<Video[]> {
  const client = requireSupabase();
  const { data, error } = await client
    .from('saved_videos')
    .select('saved_at, video:videos(*)')
    .eq('user_id', userId)
    .order('saved_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as { video: Video | null }[];
  return rows.map((r) => r.video).filter((v): v is Video => Boolean(v));
}

export async function setVideoSaved(userId: string, videoRowId: string, saved: boolean): Promise<void> {
  const client = requireSupabase();
  if (saved) {
    const { error } = await client
      .from('saved_videos')
      .upsert({ user_id: userId, video_id: videoRowId }, { onConflict: 'user_id,video_id' });
    if (error) throw new Error(error.message);
  } else {
    const { error } = await client
      .from('saved_videos')
      .delete()
      .eq('user_id', userId)
      .eq('video_id', videoRowId);
    if (error) throw new Error(error.message);
  }
}

/** True when Supabase is configured (screens use this for empty states). */
export function videosBackendReady(): boolean {
  return supabase !== null;
}
