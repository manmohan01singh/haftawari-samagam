import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RealtimeChannel, User } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabase } from '../../lib/supabase';
import { extractMetadataProfile } from '../auth/profileSync';
import type { ChatMessage } from '../../types/database';
import * as chatService from './chatService';
import type { ChatAuthor, ChatMessageWithAuthor } from './types';

/** The signed-in user as chat needs them. */
export interface ChatUser {
  id: string;
  displayName: string | null;
  /**
   * The user's OWN real profile photo (profiles.avatar_url, i.e. the
   * synced Google DP) when known. Only ever populated for the
   * signed-in user themselves — other participants' rows carry no
   * avatar data (session_participant_names returns names only), so
   * their rows keep the coloured-initial treatment.
   */
  avatarUrl?: string | null;
  /** From profiles.role when known; admins may read chat without joining. */
  isAdmin: boolean;
}

export interface UseSessionChatOptions {
  /**
   * Real participant count supplied by the host (e.g. the session's
   * Realtime Presence snapshot). Takes precedence over the table count.
   * Leave undefined to let the hook derive it — the derived count is
   * only shown when the caller may read the roster under RLS (joined
   * participant or admin); otherwise the count stays `null` (hidden),
   * never guessed.
   */
  participantCount?: number;
  /**
   * Signed-in user supplied by the host (e.g. from the app AuthContext).
   * `undefined` = the hook resolves auth itself from Supabase;
   * `null` = definitely signed out.
   */
  currentUser?: ChatUser | null;
  /**
   * Whether the user has joined the session. `undefined` = the hook
   * checks `session_participants` for the signed-in user.
   */
  hasJoined?: boolean;
  /**
   * Extra author names the host knows out-of-band — e.g. the Presence
   * roster, where members broadcast their own display name. Profile
   * reads win; this map fills the gaps.
   */
  authorNames?: Record<string, string | null>;
  /** History page size (default 50). */
  pageSize?: number;
}

export interface UseSessionChatResult {
  /** False when Supabase env vars are missing — chat cannot run. */
  configured: boolean;
  authLoading: boolean;
  user: ChatUser | null;
  /** null while unknown/checking. Admins count as able to read chat. */
  hasJoined: boolean | null;
  /** Real count, or null when not knowable — UI must hide it then. */
  participantCount: number | null;
  messages: ChatMessageWithAuthor[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  loadMore: () => void;
  listError: string | null;
  sending: boolean;
  sendError: string | null;
  /** Resolves true when the message was stored; false keeps the draft. */
  send: (body: string) => Promise<boolean>;
}

const DEFAULT_PAGE_SIZE = 50;

function sortMessages(list: ChatMessage[]): ChatMessage[] {
  return list.slice().sort((a, b) => {
    const byTime = a.created_at.localeCompare(b.created_at);
    return byTime !== 0 ? byTime : a.id.localeCompare(b.id);
  });
}

/**
 * Resolve the signed-in chat user from Supabase Auth + the caller's own
 * profile. Used by SessionChat when the host passes no `currentUser`,
 * and by ChatPreviewCard on its own. When `externalUser` is provided
 * (including `null`) it is used verbatim and no auth lookup happens.
 */
export function useCurrentChatUser(externalUser?: ChatUser | null): {
  user: ChatUser | null;
  authLoading: boolean;
} {
  const hasExternal = externalUser !== undefined;
  const [resolvedUser, setResolvedUser] = useState<ChatUser | null>(null);
  const [resolvedLoading, setResolvedLoading] = useState(
    !hasExternal && isSupabaseConfigured,
  );

  useEffect(() => {
    if (hasExternal || !supabase || !isSupabaseConfigured) return;
    let active = true;
    const client = supabase;

    const resolveProfile = async (sessionUser: User) => {
      const userId = sessionUser.id;
      // Pre-migration-0004 the row has no avatar_url; the Google DP
      // still reaches the user's own chat rows via auth metadata.
      const metaAvatar = extractMetadataProfile(sessionUser).avatarUrl;
      try {
        const profile = await chatService.fetchOwnProfile(userId);
        if (!active) return;
        setResolvedUser({
          id: userId,
          displayName: profile?.display_name ?? null,
          avatarUrl: profile?.avatar_url ?? metaAvatar,
          isAdmin: profile?.role === 'admin',
        });
      } catch {
        if (active) {
          setResolvedUser({ id: userId, displayName: null, avatarUrl: metaAvatar, isAdmin: false });
        }
      }
    };

    client.auth
      .getSession()
      .then(({ data }) => {
        if (!active) return;
        const sessionUser = data.session?.user ?? null;
        if (sessionUser) {
          void resolveProfile(sessionUser);
        } else {
          setResolvedUser(null);
        }
        setResolvedLoading(false);
      })
      .catch(() => {
        if (active) setResolvedLoading(false);
      });

    const { data: subscription } = client.auth.onAuthStateChange((_event, next) => {
      if (!active) return;
      const sessionUser = next?.user ?? null;
      if (sessionUser) {
        void resolveProfile(sessionUser);
      } else {
        setResolvedUser(null);
      }
      setResolvedLoading(false);
    });

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, [hasExternal]);

  if (hasExternal) {
    return { user: externalUser ?? null, authLoading: false };
  }
  return { user: resolvedUser, authLoading: resolvedLoading };
}

interface KeyedHistory {
  key: string;
  messages: ChatMessage[];
  hasMore: boolean;
}

export function useSessionChat(
  sessionId: string,
  options: UseSessionChatOptions = {},
): UseSessionChatResult {
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const { user, authLoading } = useCurrentChatUser(options.currentUser);

  const [fetchedJoined, setFetchedJoined] = useState<{
    key: string;
    value: boolean;
  } | null>(null);
  const [fetchedCount, setFetchedCount] = useState<{
    sessionId: string;
    value: number | null;
  } | null>(null);
  const [history, setHistory] = useState<KeyedHistory>({
    key: '',
    messages: [],
    hasMore: false,
  });
  const [errorState, setErrorState] = useState<{ key: string; message: string } | null>(
    null,
  );
  const [authors, setAuthors] = useState<Record<string, string | null>>({});
  const [loadingMore, setLoadingMore] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const authorsRef = useRef(authors);
  useEffect(() => {
    authorsRef.current = authors;
  }, [authors]);
  const authorNamesRef = useRef(options.authorNames);
  useEffect(() => {
    authorNamesRef.current = options.authorNames;
  }, [options.authorNames]);

  // ── Join state: host prop > admin > signed-out > fetched row ──────
  const joinKey = user ? `${sessionId}:${user.id}` : null;
  const hasJoined: boolean | null =
    options.hasJoined ??
    (authLoading
      ? null
      : !user
        ? false
        : user.isAdmin
          ? true
          : fetchedJoined && joinKey && fetchedJoined.key === joinKey
            ? fetchedJoined.value
            : null);

  useEffect(() => {
    if (options.hasJoined !== undefined || !isSupabaseConfigured) return;
    if (authLoading || !user || user.isAdmin || !joinKey) return;
    let active = true;
    chatService
      .fetchHasJoined(sessionId, user.id)
      .then((joined) => {
        if (active) setFetchedJoined({ key: joinKey, value: joined });
      })
      .catch(() => {
        if (active) setFetchedJoined({ key: joinKey, value: false });
      });
    return () => {
      active = false;
    };
  }, [options.hasJoined, sessionId, user, authLoading, joinKey]);

  const canRead = Boolean(user) && hasJoined === true;

  // History is keyed by (session, readability): a stale key means "not
  // loaded for this context yet", which drives both the list contents
  // and the loading flag without synchronous setState in effects.
  const loadKey = `${sessionId}:${canRead ? 'in' : 'out'}`;
  const loadKeyRef = useRef(loadKey);
  useEffect(() => {
    loadKeyRef.current = loadKey;
  }, [loadKey]);
  const historyRef = useRef(history);
  useEffect(() => {
    historyRef.current = history;
  }, [history]);

  const rawMessages = useMemo(
    () => (history.key === loadKey ? history.messages : []),
    [history, loadKey],
  );
  const hasMore = history.key === loadKey ? history.hasMore : false;
  const listError =
    errorState && errorState.key === loadKey ? errorState.message : null;
  const loading = canRead && history.key !== loadKey && listError === null;

  /** Merge one stored row into the list (insert, echo, or update). */
  const mergeMessage = useCallback((incoming: ChatMessage) => {
    setHistory((prev) => {
      if (prev.key !== loadKeyRef.current) return prev;
      if (incoming.is_removed) {
        return { ...prev, messages: prev.messages.filter((m) => m.id !== incoming.id) };
      }
      const index = prev.messages.findIndex((m) => m.id === incoming.id);
      if (index >= 0) {
        const next = prev.messages.slice();
        next[index] = incoming;
        return { ...prev, messages: next };
      }
      return { ...prev, messages: sortMessages([...prev.messages, incoming]) };
    });
  }, []);

  /** Resolve and cache author names for any not-yet-known user ids. */
  const resolveAuthors = useCallback(
    async (userIds: string[]) => {
      const missing = userIds.filter(
        (id) => !(id in authorsRef.current) && !(id in (authorNamesRef.current ?? {})),
      );
      if (missing.length === 0) return;
      try {
        // Preferred source: the session_participant_names RPC
        // (migration 0002) — it can name every participant of this
        // session, which plain profile reads cannot (RLS limits
        // members to their own row). When the RPC is unavailable or
        // leaves ids unanswered, fall back to the direct profile read
        // for the remainder (own row + anything admins may read).
        let found: Record<string, string | null> = {};
        try {
          found = await chatService.fetchParticipantNames(sessionId, missing);
        } catch {
          found = {};
        }
        const unanswered = missing.filter((id) => !(id in found));
        if (unanswered.length > 0) {
          const fallback = await chatService.fetchAuthors(unanswered).catch(() => ({}));
          found = { ...fallback, ...found };
        }
        setAuthors((prev) => {
          const next = { ...prev };
          for (const id of missing) {
            // Only cache ids a query actually answered for; the rest
            // stay unknown (and are retried if the caller gains access).
            if (id in found) next[id] = found[id];
          }
          return next;
        });
      } catch {
        // Name resolution is best-effort: messages still render with the
        // neutral fallback label. Never fabricate a name on failure.
      }
    },
    [sessionId],
  );

  // ── Participant count from the roster (only when readable) ───────
  useEffect(() => {
    if (options.participantCount !== undefined || !canRead) return;
    let active = true;
    chatService
      .fetchJoinedParticipantCount(sessionId)
      .then((count) => {
        if (active) setFetchedCount({ sessionId, value: count });
      })
      .catch(() => {
        if (active) setFetchedCount({ sessionId, value: null });
      });
    return () => {
      active = false;
    };
  }, [options.participantCount, sessionId, canRead]);

  const tableCount =
    fetchedCount && fetchedCount.sessionId === sessionId ? fetchedCount.value : null;

  // ── Initial history load ───────────────────────────────────────────
  useEffect(() => {
    if (!isSupabaseConfigured || !canRead) return;
    let active = true;
    chatService
      .listMessagesPage(sessionId, { limit: pageSize })
      .then((page) => {
        if (!active) return;
        setHistory({ key: loadKey, messages: page.messages, hasMore: page.hasMore });
        setErrorState((prev) => (prev && prev.key === loadKey ? null : prev));
        void resolveAuthors(page.messages.map((m) => m.user_id));
      })
      .catch(() => {
        if (!active) return;
        setHistory({ key: loadKey, messages: [], hasMore: false });
        setErrorState({
          key: loadKey,
          message: 'Messages could not be loaded. Please try again.',
        });
      });
    return () => {
      active = false;
    };
  }, [sessionId, canRead, pageSize, resolveAuthors, loadKey]);

  // ── Realtime: inserts + moderation updates ────────────────────────
  useEffect(() => {
    if (!isSupabaseConfigured || !canRead) return;
    let channel: RealtimeChannel | null = null;
    try {
      let firstSubscribe = true;
      channel = chatService.subscribeToChatEvents(sessionId, {
        onInsert: (message) => {
          mergeMessage(message);
          void resolveAuthors([message.user_id]);
        },
        onUpdate: (message) => {
          mergeMessage(message);
        },
        // GAP RECOVERY (deep-research finding, 28 Nov 2026):
        // Realtime does not replay messages missed while the socket
        // was down — a 30s disconnect silently loses chat. On every
        // RE-subscribe, refetch the latest page and merge it in
        // (mergeMessage dedupes by id). The first subscribe is
        // covered by the initial history load above.
        onSubscribed: () => {
          if (firstSubscribe) {
            firstSubscribe = false;
            return;
          }
          chatService
            .listMessagesPage(sessionId, { limit: pageSize })
            .then((page) => {
              for (const message of page.messages) mergeMessage(message);
              void resolveAuthors(page.messages.map((m) => m.user_id));
            })
            .catch(() => undefined);
        },
      });
    } catch {
      // Subscription failure leaves history + remount reload working;
      // the chat simply is not live until the next mount.
      channel = null;
    }
    return () => {
      if (channel) void chatService.unsubscribeChat(channel);
    };
  }, [sessionId, canRead, mergeMessage, resolveAuthors, pageSize]);

  // ── Pagination: walk backwards from the oldest loaded message ────
  const loadMore = useCallback(() => {
    const current = historyRef.current;
    if (!canRead || loadingMore || current.key !== loadKeyRef.current) return;
    if (!current.hasMore || current.messages.length === 0) return;
    const oldest = current.messages[0];
    const keyAtStart = current.key;
    setLoadingMore(true);
    chatService
      .listMessagesPage(sessionId, {
        limit: pageSize,
        beforeCreatedAt: oldest.created_at,
      })
      .then((page) => {
        setHistory((prev) => {
          if (prev.key !== keyAtStart) return prev;
          const known = new Set(prev.messages.map((m) => m.id));
          const fresh = page.messages.filter((m) => !known.has(m.id));
          return {
            ...prev,
            messages: sortMessages([...fresh, ...prev.messages]),
            hasMore: page.hasMore,
          };
        });
        void resolveAuthors(page.messages.map((m) => m.user_id));
      })
      .catch(() => {
        setErrorState({
          key: keyAtStart,
          message: 'Older messages could not be loaded. Please try again.',
        });
      })
      .finally(() => setLoadingMore(false));
  }, [canRead, loadingMore, sessionId, pageSize, resolveAuthors]);

  // ── Send ───────────────────────────────────────────────────────────
  const send = useCallback(
    async (body: string): Promise<boolean> => {
      if (!user || hasJoined !== true || sending) return false;
      const trimmed = body.trim();
      if (!trimmed) return false;
      setSending(true);
      setSendError(null);
      try {
        const stored = await chatService.sendMessageReturning(sessionId, user.id, trimmed);
        mergeMessage(stored);
        return true;
      } catch {
        setSendError('Your message could not be sent. Please try again.');
        return false;
      } finally {
        setSending(false);
      }
    },
    [user, hasJoined, sending, sessionId, mergeMessage],
  );

  // ── Attach authors (profile read > host map > own name > unknown) ─
  const messages = useMemo<ChatMessageWithAuthor[]>(
    () =>
      rawMessages.map((message) => {
        const author: ChatAuthor = {
          userId: message.user_id,
          displayName:
            authors[message.user_id] ??
            options.authorNames?.[message.user_id] ??
            (user && message.user_id === user.id ? user.displayName : null),
        };
        return { ...message, author };
      }),
    [rawMessages, authors, options.authorNames, user],
  );

  return {
    configured: isSupabaseConfigured,
    authLoading,
    user,
    hasJoined,
    participantCount: options.participantCount ?? tableCount,
    messages,
    loading,
    loadingMore,
    hasMore,
    loadMore,
    listError,
    sending,
    sendError,
    send,
  };
}
