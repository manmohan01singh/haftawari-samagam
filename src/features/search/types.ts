/**
 * Search engine types. The SearchScreen consumes exactly these shapes;
 * see docs/SEARCH.md for the wiring contract.
 */

import type { MatchKind } from './fuzzy';

/** The official channel as a search result card (reference screenshot 03). */
export interface ChannelResult {
  kind: 'channel';
  channelId: string;
  title: string;
  handle: string;
  avatarUrl: string | null;
  subscriberCount: number | null;
  videoCount: number | null;
  /** Why the channel matched (exact name, alias, acronym, …). */
  matchKind: MatchKind;
  score: number;
}

/** A video result, from either the local catalogue or the channel API. */
export interface VideoResult {
  kind: 'video';
  source: 'local' | 'youtube';
  /** Row id when source is 'local'; null for YouTube-only results. */
  videoRowId: string | null;
  youtubeVideoId: string;
  title: string;
  thumbnailUrl: string | null;
  durationSeconds: number | null;
  /** ISO timestamp of publication when known. */
  publishedAt: string | null;
  /** From YouTube snippet.liveBroadcastContent; 'none' for local rows. */
  liveBroadcastContent: 'none' | 'live' | 'upcoming';
  score: number;
  matchKind: MatchKind;
}

export interface SearchResults {
  query: string;
  /** Present only when the query matches the official channel. */
  channel: ChannelResult | null;
  /** Merged, ranked, de-duplicated (local row wins over its API twin). */
  videos: VideoResult[];
  /**
   * True when the YouTube leg was skipped (no key, quota guard, offline,
   * or aborted) — the screen should say results may be incomplete rather
   * than pretending this is everything.
   */
  youtubeSkipped: boolean;
}

export interface SearchOptions {
  signal?: AbortSignal;
  /** Max merged video results to return. Default 25. */
  limit?: number;
  /** Skip the 100-unit YouTube search leg (e.g. for suggestion typing). */
  localOnly?: boolean;
}

export interface Suggestion {
  text: string;
  source: 'history' | 'local' | 'channel';
}
