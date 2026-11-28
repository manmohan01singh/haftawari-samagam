import type { RealtimeChannel } from '@supabase/supabase-js';
import { requireSupabase } from '../../lib/supabase';
import { uniqueTopic } from '../sessions/sessionService';
import type { PresenceMember, PresenceSnapshot } from './types';

/**
 * Presence service — Supabase Realtime Presence on
 * `session-presence:<sessionId>`.
 *
 * The participant count shown in the UI is exactly the number of
 * tracked presence entries. Presence entries expire automatically when
 * a client disconnects (Realtime removes them), and the app also calls
 * `leavePresence` on a clean exit. Reconnection = re-track + re-sync.
 */

export function joinPresence(
  sessionId: string,
  me: PresenceMember,
  onSync: (snapshot: PresenceSnapshot) => void,
): RealtimeChannel {
  const supabase = requireSupabase();
  // The topic MUST be unique per join (audit P0, 28 Nov 2026): with a
  // fixed topic, channel() returns the previous still-registered
  // channel whenever a viewer leaves-and-returns quickly or swaps
  // guest->member identity, and .on('presence') then throws the
  // P10 'cannot add callbacks after subscribe()' error straight
  // into the screen — a signed-in viewer opening a Samagam could
  // hit the error boundary. Same lesson sessionService learned.
  const channel = supabase.channel(uniqueTopic(`session-presence:${sessionId}`), {
    config: { presence: { key: me.userId } },
  });

  const emit = () => {
    const state = channel.presenceState<PresenceMember>();
    const members = Object.values(state).flat();
    onSync({ sessionId, participantCount: members.length, members });
  };

  channel
    .on('presence', { event: 'sync' }, emit)
    .on('presence', { event: 'join' }, emit)
    .on('presence', { event: 'leave' }, emit)
    .subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await channel.track(me);
      }
    });
  return channel;
}

export async function leavePresence(channel: RealtimeChannel): Promise<void> {
  // Teardown-safe (mirrors sessionService.unsubscribe): every step
  // is best-effort so a slow untrack can never strand the channel
  // in the client registry to poison the next join.
  try {
    await channel.untrack();
  } catch {
    // Best-effort — removal below still runs.
  }
  const supabase = requireSupabase();
  try {
    await supabase.removeChannel(channel);
  } catch {
    // Best-effort — the teardown fallback below still runs.
  }
  try {
    if (supabase.getChannels().includes(channel)) {
      channel.teardown();
    }
  } catch {
    // Cleanup fallback only — never break unmount.
  }
}
