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

/** Where a video's media actually lives (migration 0005). */
export type VideoSource = 'youtube' | 'hosted';

export interface Video {
  id: string;
  /**
   * YouTube id for source='youtube' rows. NULL for hosted rows
   * (migration 0005 made the column nullable) — never invent one.
   * Optional because rows fetched before 0005 is applied have no
   * `source` key at runtime; treat a missing source as 'youtube'.
   */
  youtube_video_id: string | null;
  source?: VideoSource;
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

export type HostedAssetStatus = 'uploaded' | 'processing' | 'ready' | 'failed';

/**
 * The R2 media behind one hosted video (migration 0005). Object keys
 * are storage identifiers, NEVER playback URLs — playback uses
 * short-lived signed URLs minted by the r2-playback Edge Function.
 */
export interface HostedAsset {
  id: string;
  video_id: string;
  r2_object_key: string;
  hls_master_key: string | null;
  original_filename: string | null;
  content_type: string | null;
  size_bytes: number | null;
  duration_seconds: number | null;
  status: HostedAssetStatus;
  publish_at: string | null;
  expires_at: string | null;
  replacement_of: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Recorded permission from the rights holder (migration 0005).
 * Admin-only table in the database (RLS grants members nothing);
 * a hosted video cannot be published without one of these rows —
 * the publish gate is a database trigger, not a UI convention.
 */
export interface ContentAuthorization {
  id: string;
  video_id: string;
  rights_holder: string;
  permission_note: string;
  permission_reference: string | null;
  permission_date: string; // date (YYYY-MM-DD)
  recorded_by: string | null;
  created_at: string;
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

/**
 * A real member comment on a recorded video
 * (supabase/migrations/0005_video_comments.sql). Keyed by
 * youtube_video_id — the identifier every watch resolves to —
 * because most watches are API-only videos with no catalogue row;
 * video_id carries the catalogue row id when one exists.
 */
export interface VideoComment {
  id: string;
  youtube_video_id: string;
  video_id: string | null;
  user_id: string;
  body: string;
  is_removed: boolean;
  created_at: string;
}

/** A real member like on a recorded video (migration 0005). */
export interface VideoLike {
  youtube_video_id: string;
  video_id: string | null;
  user_id: string;
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

/**
 * A YouTube channel the admin has chosen for the app
 * (supabase/migrations/0003_channels.sql). Title/avatar are an API
 * snapshot taken when the channel was added/refreshed; live state is
 * NEVER stored here — it always comes from the YouTube API at read time.
 */
export interface ChannelRecord {
  id: string;
  youtube_channel_id: string; // UC… id
  handle: string | null; // e.g. '@amritvelatrust'
  title: string;
  avatar_url: string | null;
  /** Extra typed name forms for search matching only; never displayed. */
  aliases: string[];
  is_active: boolean;
  sort_order: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
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
