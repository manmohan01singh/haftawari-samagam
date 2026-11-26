/**
 * Library feature types — compositions of the database row types in
 * src/types/database.ts with the joined `videos` rows the library UI
 * renders. Everything here is real backend data; nothing is fabricated.
 */
import type {
  Playlist,
  PlaylistItem,
  SavedVideo,
  Video,
  WatchHistoryEntry,
} from '../../types/database';

/** One watch_history row joined with the recording it points at. */
export interface HistoryItem {
  entry: WatchHistoryEntry;
  video: Video;
}

/** One saved_videos row joined with the recording it points at. */
export interface SavedItem {
  entry: SavedVideo;
  video: Video;
}

/** A playlist plus the real aggregates the library rows display. */
export interface PlaylistSummary {
  playlist: Playlist;
  /** Real count of playlist_items rows for this playlist. */
  itemCount: number;
  /** Thumbnail of the first item (by position), or null when empty. */
  coverThumbnailUrl: string | null;
  /** True when the signed-in user owns this playlist. */
  isOwn: boolean;
}

/** One playlist_items row joined with its recording. */
export interface PlaylistDetailItem {
  item: PlaylistItem;
  video: Video;
}

export interface PlaylistDetail {
  playlist: Playlist;
  items: PlaylistDetailItem[];
}

/** One of the user's own playlists, annotated for the add-to-playlist sheet. */
export interface PlaylistMembership {
  playlist: Playlist;
  itemCount: number;
  /** True when the given video is already an item of this playlist. */
  containsVideo: boolean;
}
