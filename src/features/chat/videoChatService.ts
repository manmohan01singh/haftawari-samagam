/**
 * Live chat for YouTube LIVE broadcasts on the Watch page (fault
 * 42): session chat is scoped to the app's own Samagam Sessions,
 * so a channel's live broadcast gets this video-keyed chat instead
 * (migration 0008, table video_chat_messages).
 *
 * Graceful degradation: until 0008 is applied the table does not
 * exist and every call here fails with a missing-table error —
 * callers treat that as "chat not set up yet" and render nothing.
 * No message is ever fabricated; an empty chat is an empty chat.
 */
import { isSupabaseConfigured, requireSupabase } from '../../lib/supabase';
import { uniqueTopic } from '../sessions/sessionService';

export interface VideoChatMessage {
  id: string;
  userId: string;
  authorName: string | null;
  body: string;
  createdAt: string;
}

/** True when the failure is the not-yet-applied migration. */
export function isVideoChatUnavailable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /video_chat_messages/.test(message) && /(does not exist|not found|schema cache)/i.test(message);
}

interface RawRow {
  id: string;
  user_id: string;
  body: string;
  created_at: string;
}

async function withAuthors(rows: RawRow[]): Promise<VideoChatMessage[]> {
  const client = requireSupabase();
  const ids = [...new Set(rows.map((r) => r.user_id))];
  const names = new Map<string, string | null>();
  if (ids.length > 0) {
    const { data } = await client.from('profiles').select('id, display_name').in('id', ids);
    for (const row of (data ?? []) as { id: string; display_name: string | null }[]) {
      names.set(row.id, row.display_name);
    }
  }
  return rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    authorName: names.get(r.user_id) ?? null,
    body: r.body,
    createdAt: r.created_at,
  }));
}

/** The most recent messages for one broadcast, oldest first. */
export async function fetchVideoChatMessages(
  youtubeVideoId: string,
  limit = 100,
): Promise<VideoChatMessage[]> {
  const client = requireSupabase();
  const { data, error } = await client
    .from('video_chat_messages')
    .select('id, user_id, body, created_at')
    .eq('youtube_video_id', youtubeVideoId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  const rows = ((data ?? []) as RawRow[]).slice().reverse();
  return withAuthors(rows);
}

export async function postVideoChatMessage(
  youtubeVideoId: string,
  userId: string,
  body: string,
): Promise<void> {
  const client = requireSupabase();
  const { error } = await client
    .from('video_chat_messages')
    .insert({ youtube_video_id: youtubeVideoId, user_id: userId, body });
  if (error) throw new Error(error.message);
}

/**
 * Subscribe to new messages for one broadcast. Returns an
 * unsubscribe function. Uses a unique channel topic (the codebase
 * rule: a fixed topic reused across remounts throws once
 * subscribe() has run) and re-fetches on every (re)SUBSCRIBED so
 * messages missed during a reconnect gap are recovered.
 */
export function subscribeVideoChat(
  youtubeVideoId: string,
  onChange: () => void,
): () => void {
  if (!isSupabaseConfigured) return () => undefined;
  const client = requireSupabase();
  const channel = client
    .channel(uniqueTopic(`video-chat:${youtubeVideoId}`))
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'video_chat_messages',
        filter: `youtube_video_id=eq.${youtubeVideoId}`,
      },
      () => onChange(),
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') onChange();
    });
  return () => {
    void client.removeChannel(channel);
  };
}
