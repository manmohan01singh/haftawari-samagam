import type { RealtimeChannel } from '@supabase/supabase-js';
import { requireSupabase } from '../../lib/supabase';
import { isUuid } from '../../lib/uuid';
import type { Profile, SamagamSession, Video } from '../../types/database';
import { deriveOffsetSeconds, deriveStatus } from './stateMachine';
import type { SessionPlaybackPosition } from './types';

/** A session row joined with the recording it plays. */
export interface SessionWithVideo {
  session: SamagamSession;
  video: Video | null;
}

type SessionRowWithVideo = SamagamSession & { video: Video | null };

function toSessionWithVideo(row: SessionRowWithVideo): SessionWithVideo {
  const { video, ...session } = row;
  return { session: session as SamagamSession, video: video ?? null };
}

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

/** All sessions with their recording joined (list screen source). */
export async function listSessionsWithVideos(): Promise<SessionWithVideo[]> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('sessions')
    .select('*, video:videos(*)')
    .order('scheduled_start_at', { ascending: true });
  if (error) throw error;
  return ((data ?? []) as SessionRowWithVideo[]).map(toSessionWithVideo);
}

/** One session with its recording joined (watch screen source). */
export async function getSessionWithVideo(
  sessionId: string,
): Promise<SessionWithVideo | null> {
  // A malformed id is not a session: return null (friendly "not found")
  // instead of letting PostgREST's raw uuid-syntax error reach the UI.
  if (!isUuid(sessionId)) return null;
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('sessions')
    .select('*, video:videos(*)')
    .eq('id', sessionId)
    .maybeSingle();
  if (error) throw error;
  return data ? toSessionWithVideo(data as SessionRowWithVideo) : null;
}

/**
 * REAL roster count: rows in session_participants currently marked
 * 'joined'. This is a database count of actual join records — never a
 * stored, editable counter on the session row.
 *
 * Staleness guard: a row only counts while it is ALIVE — the watch
 * screen heartbeats `last_seen_at` every 60s for joined viewers and
 * deregisters on unmount / web pagehide, so a row untouched for over
 * 5 minutes belongs to a client that vanished without leaving (tab
 * crash, killed app) and must not inflate the count forever.
 */
const JOINED_ALIVE_WINDOW_MS = 5 * 60 * 1000;

export async function getJoinedParticipantCount(sessionId: string): Promise<number> {
  const supabase = requireSupabase();
  const aliveSince = new Date(Date.now() - JOINED_ALIVE_WINDOW_MS).toISOString();
  const { count, error } = await supabase
    .from('session_participants')
    .select('*', { count: 'exact', head: true })
    .eq('session_id', sessionId)
    .eq('state', 'joined')
    .gte('last_seen_at', aliveSince);
  if (error) throw error;
  return count ?? 0;
}

/** The signed-in user + their profile, or null when signed out. */
export async function getCurrentSessionUser(): Promise<{
  userId: string;
  displayName: string | null;
} | null> {
  const supabase = requireSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();
  return {
    userId: user.id,
    displayName: (profile as Profile | null)?.display_name ?? null,
  };
}

/**
 * Realtime channel topics must be UNIQUE per subscription instance
 * (P10 leftover fix — Sessions blank page on second visit).
 *
 * Evidence for the root cause, verified against the installed
 * @supabase/realtime-js source:
 *  - RealtimeClient.channel(topic) returns the EXISTING channel when
 *    a channel with the same topic is already registered — it does
 *    not create a fresh one.
 *  - RealtimeChannel.on() THROWS `cannot add 'postgres_changes'
 *    callbacks for realtime:<topic> after 'subscribe()'` when the
 *    channel is already joined/joining.
 *  - The list screen's cleanup was fire-and-forget
 *    (`void unsubscribe(channel)`), and removeChannel() only tears a
 *    channel down after its async unsubscribe resolves — so a quick
 *    leave-and-return (a SECOND visit within one page load) called
 *    channel('sessions:list') while the first channel was still
 *    registered and subscribed, .on() threw synchronously inside the
 *    effect, and React unmounted the screen to a blank page.
 *
 * A monotonic per-instance suffix makes channel() always create a
 * fresh, unsubscribed channel, so .on() can never hit that throw;
 * unsubscribe() below additionally force-tears-down a channel whose
 * async removal did not complete, so stale channels cannot pile up
 * in the client registry either.
 */
let realtimeChannelSeq = 0;
export function uniqueTopic(base: string): string {
  realtimeChannelSeq += 1;
  return `${base}:${realtimeChannelSeq}`;
}

/** Subscribe to ANY session schedule change (list screen refresh). */
export function subscribeToSessionList(onChange: () => void): RealtimeChannel {
  const supabase = requireSupabase();
  const channel = supabase
    .channel(uniqueTopic('sessions:list'))
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'sessions' },
      () => onChange(),
    )
    .subscribe();
  return channel;
}

/** Subscribe to roster changes for one session (real join/leave rows). */
export function subscribeToParticipants(
  sessionId: string,
  onChange: () => void,
): RealtimeChannel {
  const supabase = requireSupabase();
  const channel = supabase
    .channel(uniqueTopic(`session-participants:${sessionId}`))
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'session_participants',
        filter: `session_id=eq.${sessionId}`,
      },
      () => onChange(),
    )
    .subscribe();
  return channel;
}

/**
 * The signed-in user's own roster state for one session ('joined' /
 * 'left'), or null when they have no participant row. The watch screen
 * uses this to open in the correct Join/Joined state — before this it
 * always opened as "Join Samagam", even for a user who had already
 * joined, and tapping Join then upserted blindly.
 */
export async function getMyParticipantState(
  sessionId: string,
  userId: string,
): Promise<'joined' | 'left' | null> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('session_participants')
    .select('state')
    .eq('session_id', sessionId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  const state = (data as { state?: string } | null)?.state;
  return state === 'joined' || state === 'left' ? state : null;
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
    .channel(uniqueTopic(`session:${sessionId}`))
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'sessions', filter: `id=eq.${sessionId}` },
      (payload) => onChange(payload.new as SamagamSession),
    )
    .subscribe();
  return channel;
}

/**
 * Remove a channel created by the subscribe* helpers. Never throws:
 * removeChannel() only tears a channel down when its async
 * unsubscribe resolves 'ok', so on a timeout/error the channel would
 * otherwise stay registered forever (the reuse hazard above). When
 * it is still registered after the attempt, force teardown() so the
 * registry is clean for the next subscription.
 */
export async function unsubscribe(channel: RealtimeChannel | null): Promise<void> {
  if (!channel) return;
  const supabase = requireSupabase();
  try {
    await supabase.removeChannel(channel);
  } catch {
    // Removal is best-effort — the teardown fallback below still runs.
  }
  try {
    if (supabase.getChannels().includes(channel)) {
      channel.teardown();
    }
  } catch {
    // Teardown is a cleanup fallback only — never break unmount.
  }
}
