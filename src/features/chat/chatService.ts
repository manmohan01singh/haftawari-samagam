import type { RealtimeChannel } from '@supabase/supabase-js';
import { requireSupabase } from '../../lib/supabase';
import type { ChatMessage } from '../../types/database';

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
