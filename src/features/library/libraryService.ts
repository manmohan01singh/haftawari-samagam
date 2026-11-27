/**
 * Library data access — watch history, saved videos and playlists.
 *
 * Every function runs against the LIVE Supabase backend with the anon
 * key; Row Level Security is the enforcement (history/saves are
 * owner-only, playlist writes are owner-or-admin, public playlists are
 * readable by everyone). No function invents or seeds data.
 */
import { requireSupabase } from '../../lib/supabase';
import type { Playlist, Profile, Video } from '../../types/database';
import type {
  HistoryItem,
  PlaylistDetail,
  PlaylistDetailItem,
  PlaylistMembership,
  PlaylistSummary,
  SavedItem,
} from './types';

// ── Profile ──────────────────────────────────────────────────────────

export async function fetchProfile(userId: string): Promise<Profile | null> {
  const client = requireSupabase();
  const { data, error } = await client
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Profile | null) ?? null;
}

// ── Watch history ────────────────────────────────────────────────────

export async function fetchHistory(userId: string, limit = 100): Promise<HistoryItem[]> {
  const client = requireSupabase();
  const { data, error } = await client
    .from('watch_history')
    .select('*, video:videos(*)')
    .eq('user_id', userId)
    .order('watched_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as (HistoryItem['entry'] & { video: Video | null })[];
  return rows
    .filter((r): r is HistoryItem['entry'] & { video: Video } => Boolean(r.video))
    .map((r) => ({ entry: r, video: r.video }));
}

/**
 * Merge device-local history entries into the signed-in account's
 * watch_history (sign-in merge). Only entries that carry a catalogue
 * row id can merge — watch_history.video_id is a FK to videos(id), so
 * live/API watches with no catalogue row can never be written there
 * and must stay device-local. The caller passes only entries whose
 * video is NOT already in the account history, so the upsert never
 * demotes a newer server watched_at with an older local one.
 * watched_at is preserved from the local entry (when it was watched,
 * not when it merged).
 */
export async function mergeLocalHistoryEntries(
  userId: string,
  entries: { videoRowId: string; watchedAt: string }[],
): Promise<void> {
  if (entries.length === 0) return;
  const client = requireSupabase();
  const rows = entries.map((e) => ({
    user_id: userId,
    video_id: e.videoRowId,
    last_position_seconds: 0,
    watched_at: e.watchedAt,
  }));
  const { error } = await client
    .from('watch_history')
    .upsert(rows, { onConflict: 'user_id,video_id' });
  if (error) throw new Error(error.message);
}

/** Remove ONE history entry (the user's own row; RLS enforces ownership). */
export async function removeHistoryEntry(userId: string, videoId: string): Promise<void> {
  const client = requireSupabase();
  const { error } = await client
    .from('watch_history')
    .delete()
    .eq('user_id', userId)
    .eq('video_id', videoId);
  if (error) throw new Error(error.message);
}

/** Remove ALL of the user's history entries. */
export async function clearHistory(userId: string): Promise<void> {
  const client = requireSupabase();
  const { error } = await client.from('watch_history').delete().eq('user_id', userId);
  if (error) throw new Error(error.message);
}

// ── Saved videos ─────────────────────────────────────────────────────

export async function fetchSavedItems(userId: string, limit = 100): Promise<SavedItem[]> {
  const client = requireSupabase();
  const { data, error } = await client
    .from('saved_videos')
    .select('*, video:videos(*)')
    .eq('user_id', userId)
    .order('saved_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as (SavedItem['entry'] & { video: Video | null })[];
  return rows
    .filter((r): r is SavedItem['entry'] & { video: Video } => Boolean(r.video))
    .map((r) => ({ entry: r, video: r.video }));
}

/** Unsave a recording (deletes the user's own saved_videos row). */
export async function removeSavedVideo(userId: string, videoId: string): Promise<void> {
  const client = requireSupabase();
  const { error } = await client
    .from('saved_videos')
    .delete()
    .eq('user_id', userId)
    .eq('video_id', videoId);
  if (error) throw new Error(error.message);
}

// ── Playlists ────────────────────────────────────────────────────────

/**
 * Playlists for the library: the user's own (any visibility) plus all
 * public ones, own first then newest. Aggregates (item count, cover
 * thumbnail) are computed from real playlist_items rows.
 */
export async function fetchPlaylistSummaries(userId: string | null): Promise<PlaylistSummary[]> {
  const client = requireSupabase();
  const lists = new Map<string, Playlist>();

  if (userId) {
    const { data, error } = await client
      .from('playlists')
      .select('*')
      .eq('created_by', userId)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    for (const p of (data ?? []) as Playlist[]) lists.set(p.id, p);
  }
  {
    const { data, error } = await client
      .from('playlists')
      .select('*')
      .eq('is_public', true)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    for (const p of (data ?? []) as Playlist[]) {
      if (!lists.has(p.id)) lists.set(p.id, p);
    }
  }

  const playlists = [...lists.values()];
  if (playlists.length === 0) return [];

  const ids = playlists.map((p) => p.id);
  const { data: itemRows, error: itemsError } = await client
    .from('playlist_items')
    .select('playlist_id, position, video:videos(thumbnail_url)')
    .in('playlist_id', ids)
    .order('position', { ascending: true });
  if (itemsError) throw new Error(itemsError.message);

  const counts = new Map<string, number>();
  const covers = new Map<string, string | null>();
  const rows = (itemRows ?? []) as unknown as {
    playlist_id: string;
    video: { thumbnail_url: string | null } | null;
  }[];
  for (const row of rows) {
    counts.set(row.playlist_id, (counts.get(row.playlist_id) ?? 0) + 1);
    if (!covers.has(row.playlist_id)) {
      covers.set(row.playlist_id, row.video?.thumbnail_url ?? null);
    }
  }

  return playlists.map((playlist) => ({
    playlist,
    itemCount: counts.get(playlist.id) ?? 0,
    coverThumbnailUrl: covers.get(playlist.id) ?? null,
    isOwn: userId !== null && playlist.created_by === userId,
  }));
}

/** Create a playlist owned by the user (RLS requires created_by = caller). */
export async function createPlaylist(
  userId: string,
  title: string,
  isPublic: boolean,
): Promise<Playlist> {
  const client = requireSupabase();
  const { data, error } = await client
    .from('playlists')
    .insert({ title: title.trim(), is_public: isPublic, created_by: userId })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return data as Playlist;
}

/**
 * Delete a playlist the user owns (RLS: creator-or-admin write policy;
 * playlist_items rows cascade with the playlist). Used by the
 * playlist row's ⋮ menu — without it that menu had no real action.
 */
export async function deletePlaylist(playlistId: string): Promise<void> {
  const client = requireSupabase();
  const { error } = await client.from('playlists').delete().eq('id', playlistId);
  if (error) throw new Error(error.message);
}

export async function fetchPlaylistDetail(playlistId: string): Promise<PlaylistDetail | null> {
  const client = requireSupabase();
  const { data: playlist, error } = await client
    .from('playlists')
    .select('*')
    .eq('id', playlistId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!playlist) return null;

  const { data: itemData, error: itemsError } = await client
    .from('playlist_items')
    .select('*, video:videos(*)')
    .eq('playlist_id', playlistId)
    .order('position', { ascending: true });
  if (itemsError) throw new Error(itemsError.message);
  const rows = (itemData ?? []) as unknown as (PlaylistDetailItem['item'] & {
    video: Video | null;
  })[];
  const items = rows
    .filter((r): r is PlaylistDetailItem['item'] & { video: Video } => Boolean(r.video))
    .map((r) => ({ item: r, video: r.video }));
  return { playlist: playlist as Playlist, items };
}

/** Remove one item from a playlist (owner-or-admin via RLS). */
export async function removePlaylistItem(playlistId: string, videoId: string): Promise<void> {
  const client = requireSupabase();
  const { error } = await client
    .from('playlist_items')
    .delete()
    .eq('playlist_id', playlistId)
    .eq('video_id', videoId);
  if (error) throw new Error(error.message);
}

/**
 * Append a video to a playlist at the next free position. Throws a
 * plain-language error when the video is already in the playlist
 * (the (playlist_id, video_id) primary key rejects the insert).
 */
export async function addVideoToPlaylist(playlistId: string, videoId: string): Promise<void> {
  const client = requireSupabase();
  const { data: last, error: posError } = await client
    .from('playlist_items')
    .select('position')
    .eq('playlist_id', playlistId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (posError) throw new Error(posError.message);
  const nextPosition = ((last as { position: number } | null)?.position ?? -1) + 1;
  const { error } = await client
    .from('playlist_items')
    .insert({ playlist_id: playlistId, video_id: videoId, position: nextPosition });
  if (error) {
    if (error.code === '23505') throw new Error('This recording is already in that playlist.');
    throw new Error(error.message);
  }
}

/**
 * The user's OWN playlists annotated with whether `videoId` is already
 * in each — drives the add-to-playlist sheet's checkmarks.
 */
export async function fetchPlaylistsForVideo(
  userId: string,
  videoId: string,
): Promise<PlaylistMembership[]> {
  const client = requireSupabase();
  const { data, error } = await client
    .from('playlists')
    .select('*')
    .eq('created_by', userId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  const own = (data ?? []) as Playlist[];
  if (own.length === 0) return [];

  const { data: itemRows, error: itemsError } = await client
    .from('playlist_items')
    .select('playlist_id, video_id')
    .in(
      'playlist_id',
      own.map((p) => p.id),
    );
  if (itemsError) throw new Error(itemsError.message);
  const rows = (itemRows ?? []) as { playlist_id: string; video_id: string }[];
  const counts = new Map<string, number>();
  const contains = new Set<string>();
  for (const row of rows) {
    counts.set(row.playlist_id, (counts.get(row.playlist_id) ?? 0) + 1);
    if (row.video_id === videoId) contains.add(row.playlist_id);
  }
  return own.map((playlist) => ({
    playlist,
    itemCount: counts.get(playlist.id) ?? 0,
    containsVideo: contains.has(playlist.id),
  }));
}
