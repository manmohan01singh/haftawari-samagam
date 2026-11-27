/**
 * Row types mirroring supabase/migrations/0001_init.sql exactly.
 * Keep these in sync with the SQL schema by hand until generated types
 * (`supabase gen types typescript`) are wired up in a later phase.
 */

export type UserRole = 'member' | 'admin';

export type PublishState = 'draft' | 'published' | 'unpublished';

/** Session status — the ONLY labels a session may carry in the UI. */
export type SessionStatus = 'upcoming' | 'now_playing' | 'completed' | 'cancelled';

export type ParticipantState = 'joined' | 'left';

export interface Profile {
  id: string; // auth.users id
  display_name: string | null;
  /**
   * Real profile photo URL (migration 0004) — e.g. the Google avatar
   * synced from auth user metadata. Optional in the type because rows
   * fetched before 0004 is applied have no such key at runtime; the
   * app merges the metadata avatar in that case (see AuthContext).
   */
  avatar_url?: string | null;
  role: UserRole;
  created_at: string;
  updated_at: string;
}

export interface Category {
  id: string;
  slug: string; // e.g. 'haftawari', 'amritvela', 'evening-kirtan'
  name: string;
  sort_order: number;
  created_at: string;
}

export interface Video {
  id: string;
  youtube_video_id: string;
  title: string;
  description: string | null;
  category_id: string | null;
  thumbnail_url: string | null;
  duration_seconds: number | null;
  publish_state: PublishState;
  is_featured: boolean;
  published_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Playlist {
  id: string;
  title: string;
  description: string | null;
  is_public: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface PlaylistItem {
  playlist_id: string;
  video_id: string;
  position: number;
  added_at: string;
}

export interface SamagamSession {
  id: string;
  video_id: string;
  title: string | null;
  scheduled_start_at: string; // ISO 8601 timestamptz
  scheduled_end_at: string | null;
  status: SessionStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface SessionParticipant {
  session_id: string;
  user_id: string;
  state: ParticipantState;
  joined_at: string;
  last_seen_at: string;
}

export interface ChatMessage {
  id: string;
  session_id: string;
  user_id: string;
  body: string;
  is_removed: boolean;
  created_at: string;
}

export interface WatchHistoryEntry {
  user_id: string;
  video_id: string;
  last_position_seconds: number;
  watched_at: string;
}

export interface SavedVideo {
  user_id: string;
  video_id: string;
  saved_at: string;
}

export interface AuditLog {
  id: string;
  actor_id: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
}
