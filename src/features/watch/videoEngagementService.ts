import { requireSupabase } from '../../lib/supabase';
import type { VideoComment } from '../../types/database';

/**
 * Comments + likes for RECORDED videos (Phase 13) — the data layer
 * behind the Watch page's Comments section and Like button.
 *
 * Backend: supabase/migrations/0005_video_comments.sql (tables
 * video_comments / video_likes, keyed by youtube_video_id — see the
 * migration header for why). Everything here reads/writes REAL rows
 * only; counts are computed from the tables, never stored.
 *
 * Until migration 0005 is applied the tables do not exist and every
 * call fails with a missing-table error; `isEngagementUnavailable`
 * recognises exactly that failure so the UI can show its clear
 * "not available yet" state instead of a generic error (the same
 * degrade-gracefully pattern as the channels migration).
 */

/** PostgREST / Postgres codes for "this relation does not exist". */
const MISSING_RELATION_CODES = new Set(['42P01', 'PGRST205', 'PGRST202']);

export function isEngagementUnavailable(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { code?: unknown; message?: unknown };
  if (typeof e.code === 'string' && MISSING_RELATION_CODES.has(e.code)) return true;
  const message = typeof e.message === 'string' ? e.message : '';
  return (
    /video_comments|video_likes|video_comment_authors/.test(message) &&
    /does not exist|not found|schema cache/i.test(message)
  );
}

export interface VideoCommentWithAuthor extends VideoComment {
  author: { displayName: string | null };
}

export interface CommentsPage {
  comments: VideoCommentWithAuthor[];
  /** Real total of non-removed comments on the video. */
  totalCount: number;
  hasMore: boolean;
}

const PAGE_SIZE = 30;

/**
 * Author display names for a video's commenters via the
 * `video_comment_authors` RPC (migration 0005). profiles RLS lets a
 * member read only their OWN row, so names must come from the
 * SECURITY DEFINER function, which returns names ONLY for users who
 * commented on this video. A failed RPC (e.g. function missing)
 * degrades to "name unknown" for everyone except the caller, whose
 * own profile row is always readable — callers pass their own name
 * in via `ownName`.
 */
async function fetchCommentAuthors(
  youtubeVideoId: string,
): Promise<Record<string, string | null>> {
  const supabase = requireSupabase();
  const { data, error } = await supabase.rpc('video_comment_authors', {
    p_youtube_video_id: youtubeVideoId,
  });
  if (error) throw error;
  const map: Record<string, string | null> = {};
  for (const row of (data ?? []) as { user_id: string; display_name: string | null }[]) {
    map[row.user_id] = row.display_name;
  }
  return map;
}

function withAuthors(
  rows: VideoComment[],
  authors: Record<string, string | null>,
  ownUserId: string | null,
  ownName: string | null,
): VideoCommentWithAuthor[] {
  return rows.map((row) => ({
    ...row,
    author: {
      displayName:
        row.user_id === ownUserId
          ? (ownName ?? authors[row.user_id] ?? null)
          : (authors[row.user_id] ?? null),
    },
  }));
}

/**
 * One page of a video's comments, NEWEST FIRST (YouTube's comments
 * order), plus the real total count. `beforeCreatedAt` pages older
 * comments. Removed comments are excluded by RLS + the explicit
 * filter; the count query applies the same filter, so the number
 * shown is always the number listable.
 */
export async function fetchVideoComments(
  youtubeVideoId: string,
  options: {
    beforeCreatedAt?: string;
    ownUserId?: string | null;
    ownName?: string | null;
  } = {},
): Promise<CommentsPage> {
  const supabase = requireSupabase();
  let query = supabase
    .from('video_comments')
    .select('*')
    .eq('youtube_video_id', youtubeVideoId)
    .eq('is_removed', false)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(PAGE_SIZE);
  if (options.beforeCreatedAt) {
    query = query.lt('created_at', options.beforeCreatedAt);
  }
  const [page, countResult, authors] = await Promise.all([
    query,
    supabase
      .from('video_comments')
      .select('*', { count: 'exact', head: true })
      .eq('youtube_video_id', youtubeVideoId)
      .eq('is_removed', false),
    // Author names are best-effort decoration on the real rows: an
    // RPC failure must not take the comments themselves down.
    fetchCommentAuthors(youtubeVideoId).catch(() => ({}) as Record<string, string | null>),
  ]);
  if (page.error) throw page.error;
  if (countResult.error) throw countResult.error;
  const rows = (page.data ?? []) as VideoComment[];
  return {
    comments: withAuthors(rows, authors, options.ownUserId ?? null, options.ownName ?? null),
    totalCount: countResult.count ?? 0,
    hasMore: rows.length === PAGE_SIZE,
  };
}

/** Post a comment as the signed-in user; returns the stored row. */
export async function postVideoComment(
  userId: string,
  youtubeVideoId: string,
  videoRowId: string | null,
  body: string,
): Promise<VideoComment> {
  const trimmed = body.trim();
  if (!trimmed) throw new Error('Comment must not be empty.');
  if (trimmed.length > 1000) throw new Error('Comment is too long (max 1000 characters).');
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('video_comments')
    .insert({
      youtube_video_id: youtubeVideoId,
      video_id: videoRowId,
      user_id: userId,
      body: trimmed,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as VideoComment;
}

/** Delete one's own comment (RLS also allows admins). */
export async function deleteVideoComment(commentId: string): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase.from('video_comments').delete().eq('id', commentId);
  if (error) throw error;
}

// ── Likes ────────────────────────────────────────────────────────────

export interface VideoLikeState {
  /** Real number of like rows for the video. */
  count: number;
  /** Whether the given user has a like row (false when signed out). */
  likedByMe: boolean;
}

export async function fetchVideoLikeState(
  youtubeVideoId: string,
  userId: string | null,
): Promise<VideoLikeState> {
  const supabase = requireSupabase();
  const [countResult, mineResult] = await Promise.all([
    supabase
      .from('video_likes')
      .select('*', { count: 'exact', head: true })
      .eq('youtube_video_id', youtubeVideoId),
    userId
      ? supabase
          .from('video_likes')
          .select('youtube_video_id')
          .eq('youtube_video_id', youtubeVideoId)
          .eq('user_id', userId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (countResult.error) throw countResult.error;
  if (mineResult.error) throw mineResult.error;
  return { count: countResult.count ?? 0, likedByMe: Boolean(mineResult.data) };
}

/** Create or remove the caller's like row. */
export async function setVideoLiked(
  userId: string,
  youtubeVideoId: string,
  videoRowId: string | null,
  liked: boolean,
): Promise<void> {
  const supabase = requireSupabase();
  if (liked) {
    const { error } = await supabase.from('video_likes').upsert(
      { youtube_video_id: youtubeVideoId, video_id: videoRowId, user_id: userId },
      { onConflict: 'youtube_video_id,user_id' },
    );
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from('video_likes')
      .delete()
      .eq('youtube_video_id', youtubeVideoId)
      .eq('user_id', userId);
    if (error) throw error;
  }
}
