import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isSupabaseConfigured } from '../../lib/supabase';
import {
  deleteVideoComment,
  fetchVideoComments,
  fetchVideoLikeState,
  isEngagementUnavailable,
  postVideoComment,
  setVideoLiked,
  type VideoCommentWithAuthor,
} from './videoEngagementService';

export type EngagementStatus = 'loading' | 'ready' | 'unavailable' | 'error';
export type ToggleLikeOutcome = 'ok' | 'unavailable' | 'failed';

export interface EngagementUser {
  id: string;
  displayName: string | null;
}

interface CommentsData {
  status: EngagementStatus;
  comments: VideoCommentWithAuthor[];
  count: number | null;
  hasMore: boolean;
}

interface LikeData {
  status: EngagementStatus;
  count: number;
  likedByMe: boolean;
}

/** Rejection used when the backend is not configured at all. */
const UNAVAILABLE_SENTINEL = new Error('engagement backend unavailable');

/**
 * Last-known like state per load key, MODULE-level (fix round 5,
 * fault 53): Shorts mount the engagement hook only while a short
 * is active, so every swipe back remounted it into 'loading' and
 * the count flickered "1" → blank → "1". A remount now starts
 * from the cached value and revalidates in the background; the
 * cache only ever holds values the backend actually returned.
 */
const likeStateCache = new Map<string, LikeData>();

function statusForFailure(reason: unknown): EngagementStatus {
  return reason === UNAVAILABLE_SENTINEL || isEngagementUnavailable(reason)
    ? 'unavailable'
    : 'error';
}

/**
 * Comments + like state for ONE recorded video (Watch page, Phase 13).
 *
 * State is stored KEYED by (youtubeVideoId, userId) and the visible
 * values are derived from whether the stored entry matches the
 * current key — the same pattern as WatchScreen's resolved-watch
 * state and useSessionChat's keyed history — so switching videos
 * shows 'loading' without any synchronous setState in an effect.
 *
 * Both halves degrade independently to 'unavailable' when migration
 * 0005 has not been applied yet (missing-table error) or Supabase is
 * not configured — the UI then shows its clear "not available yet"
 * state and never invents a count. Any other failure is 'error'
 * (comments) / a rolled-back toggle (likes).
 *
 * Hosted-only videos (user, 28 Nov 2026 — "everything should work"):
 * a hosted recording has no YouTube id, so it keys its engagement by
 * `hosted:<videos row id>` instead. The 0005 tables' key column is
 * an opaque text key — counts, RLS and the authors RPC behave
 * identically — so hosted Watch pages get real comments and likes
 * with no schema change.
 */
export function useVideoEngagement(
  youtubeVideoId: string | null,
  videoRowId: string | null,
  user: EngagementUser | null,
) {
  const userId = user?.id ?? null;
  const userName = user?.displayName ?? null;
  /** The engagement key: the YouTube id, or `hosted:<row id>` for a
   *  hosted-only recording; null when the watch resolved to neither. */
  const engagementKey =
    youtubeVideoId ?? (videoRowId ? `hosted:${videoRowId}` : null);
  const loadKey = `${engagementKey ?? ''}|${userId ?? ''}`;

  const [commentsEntry, setCommentsEntry] = useState<{ key: string; data: CommentsData } | null>(
    null,
  );
  const [likeEntry, setLikeEntry] = useState<{ key: string; data: LikeData } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  // Guards a double-tap racing its own optimistic update.
  const likeBusyRef = useRef(false);

  const commentsData: CommentsData = useMemo(
    () =>
      commentsEntry?.key === loadKey
        ? commentsEntry.data
        : { status: 'loading', comments: [], count: null, hasMore: false },
    [commentsEntry, loadKey],
  );
  const likeData: LikeData = useMemo(
    () =>
      likeEntry?.key === loadKey
        ? likeEntry.data
        : (likeStateCache.get(loadKey) ?? { status: 'loading', count: 0, likedByMe: false }),
    [likeEntry, loadKey],
  );

  // ── Load comments + likes for the current video ────────────────────
  // Every setState sits behind the awaited allSettled: an
  // unconfigured backend rejects through the same path as a
  // missing-table error (both mean 'unavailable'), so the effect
  // below never calls setState synchronously.
  const load = useCallback(async () => {
    const fetchComments = async (): Promise<CommentsData> => {
      if (!engagementKey || !isSupabaseConfigured) throw UNAVAILABLE_SENTINEL;
      const page = await fetchVideoComments(engagementKey, {
        ownUserId: userId,
        ownName: userName,
      });
      return {
        status: 'ready',
        comments: page.comments,
        count: page.totalCount,
        hasMore: page.hasMore,
      };
    };
    const fetchLikes = async (): Promise<LikeData> => {
      if (!engagementKey || !isSupabaseConfigured) throw UNAVAILABLE_SENTINEL;
      const state = await fetchVideoLikeState(engagementKey, userId);
      return { status: 'ready', count: state.count, likedByMe: state.likedByMe };
    };
    const [commentsResult, likesResult] = await Promise.allSettled([
      fetchComments(),
      fetchLikes(),
    ]);
    if (commentsResult.status === 'fulfilled') {
      setCommentsEntry({ key: loadKey, data: commentsResult.value });
    } else {
      setCommentsEntry({
        key: loadKey,
        data: {
          status: statusForFailure(commentsResult.reason),
          comments: [],
          count: null,
          hasMore: false,
        },
      });
    }
    if (likesResult.status === 'fulfilled') {
      likeStateCache.set(loadKey, likesResult.value);
      setLikeEntry({ key: loadKey, data: likesResult.value });
    } else {
      setLikeEntry({
        key: loadKey,
        data: { status: statusForFailure(likesResult.reason), count: 0, likedByMe: false },
      });
    }
  }, [engagementKey, userId, userName, loadKey]);

  useEffect(() => {
    // No cleanup needed: load() writes KEYED entries, so a stale
    // video's late result lands under its own key and is simply
    // never read (derived values only match the current key). The
    // microtask hop keeps every setState inside load()'s async
    // continuations rather than the effect body itself.
    void Promise.resolve().then(load);
  }, [load]);

  /** Manual retry (comments error state): back to loading, then load. */
  const retryLoad = useCallback(() => {
    setCommentsEntry({ key: loadKey, data: { status: 'loading', comments: [], count: null, hasMore: false } });
    void load();
  }, [load, loadKey]);

  // ── Comments: page older, post, delete ─────────────────────────────
  const loadMoreComments = useCallback(async () => {
    if (!engagementKey || loadingMore || !commentsData.hasMore || commentsData.comments.length === 0) {
      return;
    }
    setLoadingMore(true);
    try {
      const page = await fetchVideoComments(engagementKey, {
        beforeCreatedAt: commentsData.comments[commentsData.comments.length - 1].created_at,
        beforeId: commentsData.comments[commentsData.comments.length - 1].id,
        ownUserId: userId,
        ownName: userName,
      });
      setCommentsEntry((prev) => {
        if (prev?.key !== loadKey) return prev;
        const seen = new Set(prev.data.comments.map((c) => c.id));
        return {
          key: loadKey,
          data: {
            ...prev.data,
            comments: [...prev.data.comments, ...page.comments.filter((c) => !seen.has(c.id))],
            hasMore: page.hasMore,
          },
        };
      });
    } catch {
      // Keep what is loaded; the footer simply stops offering more.
      setCommentsEntry((prev) =>
        prev?.key === loadKey ? { key: loadKey, data: { ...prev.data, hasMore: false } } : prev,
      );
    } finally {
      setLoadingMore(false);
    }
  }, [engagementKey, loadingMore, commentsData, userId, userName, loadKey]);

  const postComment = useCallback(
    async (body: string): Promise<boolean> => {
      if (!engagementKey || !userId || posting) return false;
      setPosting(true);
      setPostError(null);
      try {
        const row = await postVideoComment(userId, engagementKey, videoRowId, body);
        setCommentsEntry((prev) =>
          prev?.key === loadKey
            ? {
                key: loadKey,
                data: {
                  ...prev.data,
                  comments: [{ ...row, author: { displayName: userName } }, ...prev.data.comments],
                  count: prev.data.count == null ? prev.data.count : prev.data.count + 1,
                },
              }
            : prev,
        );
        return true;
      } catch (e) {
        setPostError(
          isEngagementUnavailable(e)
            ? 'Comments are not available yet — nothing was posted.'
            : e instanceof Error
              ? e.message
              : 'Could not post your comment. Please try again.',
        );
        return false;
      } finally {
        setPosting(false);
      }
    },
    [engagementKey, userId, videoRowId, posting, userName, loadKey],
  );

  const deleteComment = useCallback(
    async (commentId: string): Promise<boolean> => {
      const existing = commentsData.comments.find((c) => c.id === commentId);
      if (!existing) return false;
      // Optimistic remove; restored in place on failure.
      const applyRemove = (remove: boolean) =>
        setCommentsEntry((prev) => {
          if (prev?.key !== loadKey) return prev;
          const has = prev.data.comments.some((c) => c.id === commentId);
          if (remove === has) return prev;
          const comments = remove
            ? prev.data.comments.filter((c) => c.id !== commentId)
            : [...prev.data.comments, existing].sort((a, b) =>
                a.created_at < b.created_at ? 1 : -1,
              );
          return {
            key: loadKey,
            data: {
              ...prev.data,
              comments,
              count:
                prev.data.count == null
                  ? prev.data.count
                  : Math.max(0, prev.data.count + (remove ? -1 : 1)),
            },
          };
        });
      applyRemove(true);
      try {
        await deleteVideoComment(commentId);
        return true;
      } catch {
        applyRemove(false);
        return false;
      }
    },
    [commentsData.comments, loadKey],
  );

  // ── Like toggle: optimistic, persisted, rolled back on failure ────
  const toggleLike = useCallback(async (): Promise<ToggleLikeOutcome> => {
    if (!engagementKey || !userId || likeBusyRef.current) return 'failed';
    if (likeData.status === 'unavailable') return 'unavailable';
    // Never toggle from a not-yet-loaded state (audit P2, 28 Nov
    // 2026): the optimistic apply() no-ops against the placeholder
    // entry, the DB write still lands, and the in-flight initial
    // fetch then resolves with pre-toggle state — the like visibly
    // vanished until reload even though the row existed.
    if (likeData.status !== 'ready') return 'failed';
    likeBusyRef.current = true;
    const next = !likeData.likedByMe;
    const apply = (liked: boolean, countDelta: number, status?: EngagementStatus) => {
      // Keep the module cache in step (fault 53): a remount must
      // show the toggled value, not the pre-toggle fetch.
      const cached = likeStateCache.get(loadKey);
      if (cached) {
        likeStateCache.set(loadKey, {
          status: status ?? cached.status,
          likedByMe: liked,
          count: Math.max(0, cached.count + countDelta),
        });
      }
      setLikeEntry((prev) =>
        prev?.key === loadKey
          ? {
              key: loadKey,
              data: {
                status: status ?? prev.data.status,
                likedByMe: liked,
                count: Math.max(0, prev.data.count + countDelta),
              },
            }
          : prev,
      );
    };
    apply(next, next ? 1 : -1);
    try {
      await setVideoLiked(userId, engagementKey, videoRowId, next);
      return 'ok';
    } catch (e) {
      apply(!next, next ? -1 : 1, isEngagementUnavailable(e) ? 'unavailable' : undefined);
      return isEngagementUnavailable(e) ? 'unavailable' : 'failed';
    } finally {
      likeBusyRef.current = false;
    }
  }, [engagementKey, userId, videoRowId, likeData, loadKey]);

  return {
    commentsStatus: commentsData.status,
    comments: commentsData.comments,
    commentCount: commentsData.count,
    commentsHasMore: commentsData.hasMore,
    loadingMore,
    loadMoreComments,
    posting,
    postError,
    postComment,
    deleteComment,
    retryLoad,
    likeStatus: likeData.status,
    likeCount: likeData.count,
    likedByMe: likeData.likedByMe,
    toggleLike,
  };
}
