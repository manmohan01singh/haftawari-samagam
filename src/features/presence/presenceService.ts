import type { RealtimeChannel } from '@supabase/supabase-js';
import { requireSupabase } from '../../lib/supabase';
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
  const channel = supabase.channel(`session-presence:${sessionId}`, {
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
  await channel.untrack();
  const supabase = requireSupabase();
  await supabase.removeChannel(channel);
}
