import type { RealtimeChannel } from '@supabase/supabase-js';
import { requireSupabase } from '../../lib/supabase';
import type { SamagamSession } from '../../types/database';
import { deriveOffsetSeconds, deriveStatus } from './stateMachine';
import type { SessionPlaybackPosition } from './types';

/**
 * Synchronized Samagam session service.
 *
 * Phase 1: real interfaces wired to Supabase queries / Realtime channel
 * names. No mock data is returned anywhere — an unconfigured backend or
 * an empty table surfaces as an error / empty list to the UI, which
 * renders an honest empty state.
 *
 * Design (full detail in docs/ARCHITECTURE.md):
 *  - One Postgres row per session is the source of truth.
 *  - Clients subscribe to `session:<id>` (postgres_changes on the row)
 *    and to the presence channel `session-presence:<id>`.
 *  - Playback position is DERIVED from the scheduled start + server
 *    clock, not streamed per-second — reconnection and late joining are
 *    therefore just "recompute the offset".
 *  - Synchronization with the official embedded YouTube player is
 *    best-effort: seek to the derived offset on join / drift correction.
 */

export async function listSessions(): Promise<SamagamSession[]> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('sessions')
    .select('*')
    .order('scheduled_start_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as SamagamSession[];
}

export async function getSession(sessionId: string): Promise<SamagamSession | null> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('sessions')
    .select('*')
    .eq('id', sessionId)
    .maybeSingle();
  if (error) throw error;
  return (data as SamagamSession | null) ?? null;
}

/**
 * Server clock, via a HEAD request's Date header, so offsets do not
 * depend on a device clock being correct. Falls back to the local clock
 * only when the request itself fails (documented best-effort).
 */
export async function getServerNow(fetchImpl: typeof fetch = fetch): Promise<number> {
  try {
    const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
    if (!url) return Date.now();
    const res = await fetchImpl(url, { method: 'HEAD' });
    const dateHeader = res.headers.get('date');
    return dateHeader ? Date.parse(dateHeader) : Date.now();
  } catch {
    return Date.now();
  }
}

export async function getPlaybackPosition(
  session: SamagamSession,
  durationSeconds: number | null,
): Promise<SessionPlaybackPosition> {
  const nowMs = await getServerNow();
  return {
    sessionId: session.id,
    offsetSeconds: deriveOffsetSeconds({
      scheduledStartAt: session.scheduled_start_at,
      durationSeconds,
      nowMs,
    }),
    durationSeconds,
    status: deriveStatus({
      storedStatus: session.status,
      scheduledStartAt: session.scheduled_start_at,
      scheduledEndAt: session.scheduled_end_at,
      durationSeconds,
      nowMs,
    }),
  };
}

/** Record that the signed-in user joined a session (participants table). */
export async function joinSession(sessionId: string, userId: string): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase.from('session_participants').upsert(
    {
      session_id: sessionId,
      user_id: userId,
      state: 'joined',
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: 'session_id,user_id' },
  );
  if (error) throw error;
}

export async function leaveSession(sessionId: string, userId: string): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase
    .from('session_participants')
    .update({ state: 'left', last_seen_at: new Date().toISOString() })
    .eq('session_id', sessionId)
    .eq('user_id', userId);
  if (error) throw error;
}

/** Subscribe to stored-status changes for one session row. */
export function subscribeToSession(
  sessionId: string,
  onChange: (session: SamagamSession) => void,
): RealtimeChannel {
  const supabase = requireSupabase();
  const channel = supabase
    .channel(`session:${sessionId}`)
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'sessions', filter: `id=eq.${sessionId}` },
      (payload) => onChange(payload.new as SamagamSession),
    )
    .subscribe();
  return channel;
}

export async function unsubscribe(channel: RealtimeChannel): Promise<void> {
  const supabase = requireSupabase();
  await supabase.removeChannel(channel);
}
