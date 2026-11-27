/**
 * Search engine types. The SearchScreen consumes exactly these shapes;
 * see docs/SEARCH.md for the wiring contract.
 */

import type { MatchKind } from './fuzzy';
import type { YouTubeErrorClass } from './youtubeError';

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
  youtubeVideoId: string | null;
  title: string;
  thumbnailUrl: string | null;
  durationSeconds: number | null;
  /** ISO timestamp of publication when known. */
  publishedAt: string | null;
  /** From YouTube snippet.liveBroadcastContent; 'none' for local rows. */
  liveBroadcastContent: 'none' | 'live' | 'upcoming';
  /** Owning channel for YouTube-leg results (multi-channel panel). */
  channelId?: string;
  channelTitle?: string;
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
  /**
   * Classified cause of the channel leg's failure (quota / rateLimit /
   * referrer / config / network / timeout / http), or null when the leg
   * succeeded. The degraded banner's wording comes from this — a banner
   * may only appear when this is set by a real failure.
   */
  youtubeError: YouTubeErrorClass | null;
  /**
   * True when the YouTube results came from the degraded fallback
   * (fuzzy match over the channel's latest uploads) because search.list
   * failed. The screen must label them as latest-upload matches —
   * coverage is partial by construction.
   */
  youtubeFallback: boolean;
  /**
   * Real correction derived from known titles (local catalogue +
   * cached channel titles + channel aliases) when the typed query
   * fuzzy-matches a known word — e.g. "haftawri" → "haftawari".
   * Null when no correction was derived. Never invented.
   */
  didYouMean: string | null;
}

export interface SearchOptions {
  signal?: AbortSignal;
  /** Max merged video results to return. Default 25. */
  limit?: number;
  /** Skip the 100-unit YouTube search leg (e.g. for suggestion typing). */
  localOnly?: boolean;
  /**
   * Run ONLY the channel legs (card + YouTube videos), skipping the
   * local catalogue — used by the results screen's banner Retry, which
   * must re-run the failed leg and not the whole search.
   */
  youtubeOnly?: boolean;
}

export interface Suggestion {
  text: string;
  source: 'history' | 'local' | 'channel';
}
