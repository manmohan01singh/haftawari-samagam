import type { RealtimeChannel } from '@supabase/supabase-js';
import { requireSupabase } from '../../lib/supabase';
import type { ChatMessage, Profile } from '../../types/database';

/**
 * Session chat service — interfaces wired to Supabase.
 * Phase 1: queries + Realtime subscription are real; rate limiting /
 * spam protection are enforced server-side in a later phase (documented
 * in docs/ARCHITECTURE.md). Messages are always real user messages —
 * nothing is seeded or fabricated.
 */

export async function listMessages(
  sessionId: string,
  limit = 100,
): Promise<ChatMessage[]> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('chat_messages')
    .select('*')
    .eq('session_id', sessionId)
    .eq('is_removed', false)
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as ChatMessage[];
}

export async function sendMessage(
  sessionId: string,
  userId: string,
  body: string,
): Promise<void> {
  const supabase = requireSupabase();
  const trimmed = body.trim();
  if (!trimmed) throw new Error('Message body must not be empty.');
  const { error } = await supabase
    .from('chat_messages')
    .insert({ session_id: sessionId, user_id: userId, body: trimmed });
  if (error) throw error;
}

/** Admin-only (RLS enforces the role); removes a message from view. */
export async function removeMessage(messageId: string): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase
    .from('chat_messages')
    .update({ is_removed: true })
    .eq('id', messageId);
  if (error) throw error;
}

export interface ListMessagesPageOptions {
  /** Page size (default 50). */
  limit?: number;
  /** Cursor: only messages strictly older than this ISO timestamp. */
  beforeCreatedAt?: string;
}

export interface ListMessagesPage {
  /** Messages in ascending chronological order (oldest first). */
  messages: ChatMessage[];
  /** True when a full page came back, i.e. older messages may exist. */
  hasMore: boolean;
}

/**
 * One page of chat history, newest page first by default. Pass the
 * oldest loaded message's `created_at` as `beforeCreatedAt` to walk
 * backwards (scroll-up pagination). Removed messages are excluded —
 * members never see them (RLS enforces the same rule server-side).
 */
export async function listMessagesPage(
  sessionId: string,
  options: ListMessagesPageOptions = {},
): Promise<ListMessagesPage> {
  const supabase = requireSupabase();
  const limit = options.limit ?? 50;
  let query = supabase
    .from('chat_messages')
    .select('*')
    .eq('session_id', sessionId)
    .eq('is_removed', false)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (options.beforeCreatedAt) {
    query = query.lt('created_at', options.beforeCreatedAt);
  }
  const { data, error } = await query;
  if (error) throw error;
  const rows = ((data ?? []) as ChatMessage[]).slice().reverse();
  return { messages: rows, hasMore: rows.length === limit };
}

/**
 * Send a message and return the stored row (real id + server
 * timestamp), so the UI can merge it immediately and de-duplicate the
 * Realtime echo by id. RLS rejects the insert unless the caller is a
 * joined participant of the session posting as themselves.
 */
export async function sendMessageReturning(
  sessionId: string,
  userId: string,
  body: string,
): Promise<ChatMessage> {
  const supabase = requireSupabase();
  const trimmed = body.trim();
  if (!trimmed) throw new Error('Message body must not be empty.');
  if (trimmed.length > 1000) throw new Error('Message is too long (max 1000 characters).');
  const { data, error } = await supabase
    .from('chat_messages')
    .insert({ session_id: sessionId, user_id: userId, body: trimmed })
    .select('*')
    .single();
  if (error) throw error;
  return data as ChatMessage;
}

/**
 * Resolve display names for a set of author ids from `profiles`.
 * Returns a map containing ONLY the rows the caller may read: RLS
 * limits members to their own profile (admins read all), so ids absent
 * from the map are genuinely unknowable to this caller — callers must
 * treat them as "name unknown", never guess.
 */
export async function fetchAuthors(
  userIds: string[],
): Promise<Record<string, string | null>> {
  const unique = Array.from(new Set(userIds)).filter(Boolean);
  if (unique.length === 0) return {};
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('profiles')
    .select('id, display_name')
    .in('id', unique);
  if (error) throw error;
  const map: Record<string, string | null> = {};
  for (const row of (data ?? []) as Pick<Profile, 'id' | 'display_name'>[]) {
    map[row.id] = row.display_name;
  }
  return map;
}

/**
 * Display names of a session's participants via the
 * `session_participant_names` RPC (migration 0002). The function is
 * SECURITY DEFINER and returns names ONLY for participants of the
 * session, and only when the caller is a participant or an admin —
 * precisely the set of chat authors a reader may legitimately label.
 * Throws when the RPC is unavailable (e.g. migration not applied yet)
 * so callers can fall back to `fetchAuthors`.
 */
export async function fetchParticipantNames(
  sessionId: string,
  userIds: string[],
): Promise<Record<string, string | null>> {
  const wanted = new Set(Array.from(new Set(userIds)).filter(Boolean));
  if (wanted.size === 0) return {};
  const supabase = requireSupabase();
  const { data, error } = await supabase.rpc('session_participant_names', {
    p_session_id: sessionId,
  });
  if (error) throw error;
  const map: Record<string, string | null> = {};
  for (const row of (data ?? []) as { user_id: string; display_name: string | null }[]) {
    if (wanted.has(row.user_id)) map[row.user_id] = row.display_name;
  }
  return map;
}

/** The caller's own profile row (always readable under RLS), or null. */
export async function fetchOwnProfile(userId: string): Promise<Profile | null> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return (data as Profile | null) ?? null;
}

/**
 * Whether `userId` currently has a `joined` participant row for the
 * session. A user can always read their own participant row under RLS,
 * so this is reliable for the caller themselves.
 */
export async function fetchHasJoined(sessionId: string, userId: string): Promise<boolean> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('session_participants')
    .select('state')
    .eq('session_id', sessionId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data?.state === 'joined';
}

/**
 * REAL joined-participant count from `session_participants`.
 * Only meaningful when the caller is themselves a participant or an
 * admin — the roster is readable to them under RLS. For anyone else
 * RLS hides the roster and this count would be wrong, so callers must
 * gate on `fetchHasJoined` / admin role and otherwise show no count.
 */
export async function fetchJoinedParticipantCount(sessionId: string): Promise<number> {
  const supabase = requireSupabase();
  const { count, error } = await supabase
    .from('session_participants')
    .select('*', { count: 'exact', head: true })
    .eq('session_id', sessionId)
    .eq('state', 'joined');
  if (error) throw error;
  return count ?? 0;
}

export interface ChatSubscriptionHandlers {
  onInsert?: (message: ChatMessage) => void;
  /** Fires on updates — e.g. an admin setting `is_removed`. */
  onUpdate?: (message: ChatMessage) => void;
}

/**
 * Subscribe to inserts AND updates on a session's chat. The update
 * stream is how a moderation removal reaches already-open chats; note
 * Supabase Realtime applies RLS to change events, so a member may not
 * receive the update for a row that just became invisible to them —
 * the list also self-heals on the next history fetch.
 */
export function subscribeToChatEvents(
  sessionId: string,
  handlers: ChatSubscriptionHandlers,
): RealtimeChannel {
  const supabase = requireSupabase();
  const channel = supabase.channel(`chat:${sessionId}`);
  if (handlers.onInsert) {
    channel.on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'chat_messages',
        filter: `session_id=eq.${sessionId}`,
      },
      (payload) => handlers.onInsert?.(payload.new as ChatMessage),
    );
  }
  if (handlers.onUpdate) {
    channel.on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'chat_messages',
        filter: `session_id=eq.${sessionId}`,
      },
      (payload) => handlers.onUpdate?.(payload.new as ChatMessage),
    );
  }
  return channel.subscribe();
}

/** Remove a channel created by subscribeToChat / subscribeToChatEvents. */
export async function unsubscribeChat(channel: RealtimeChannel): Promise<void> {
  const supabase = requireSupabase();
  await supabase.removeChannel(channel);
}

export function subscribeToChat(
  sessionId: string,
  onMessage: (message: ChatMessage) => void,
): RealtimeChannel {
  const supabase = requireSupabase();
  return supabase
    .channel(`chat:${sessionId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'chat_messages',
        filter: `session_id=eq.${sessionId}`,
      },
      (payload) => onMessage(payload.new as ChatMessage),
    )
    .subscribe();
}
