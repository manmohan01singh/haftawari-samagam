/**
 * YouTube Data API v3 client skeleton.
 *
 * Read-only metadata access ONLY, using the official API:
 *   - validate a video id / URL the admin pasted
 *   - fetch permitted metadata (title, description, thumbnails, duration)
 * Playback always uses the official YouTube embedded player — this module
 * never downloads, scrapes or extracts streams, and never hides ads,
 * attribution or player controls.
 *
 * The API key comes from EXPO_PUBLIC_YOUTUBE_API_KEY (see .env.example).
 * No key is hard-coded. When the key is absent, every method throws
 * `YouTubeNotConfiguredError` so callers can show an honest empty state.
 */

const API_BASE = 'https://www.googleapis.com/youtube/v3';

export class YouTubeNotConfiguredError extends Error {
  constructor() {
    super(
      'YouTube Data API is not configured. Set EXPO_PUBLIC_YOUTUBE_API_KEY (see .env.example).',
    );
    this.name = 'YouTubeNotConfiguredError';
  }
}

function requireApiKey(): string {
  const key = process.env.EXPO_PUBLIC_YOUTUBE_API_KEY;
  if (!key) throw new YouTubeNotConfiguredError();
  return key;
}

export const isYouTubeConfigured: boolean = Boolean(process.env.EXPO_PUBLIC_YOUTUBE_API_KEY);

/** Metadata the API is permitted to return for a video. */
export interface YouTubeVideoMetadata {
  youtubeVideoId: string;
  title: string;
  description: string;
  channelId: string;
  channelTitle: string;
  publishedAt: string; // ISO 8601, as returned by the API
  durationIso8601: string; // e.g. "PT2H5M27S", as returned by the API
  thumbnailUrl: string | null; // best available thumbnail URL from the API
  liveBroadcastContent: 'none' | 'live' | 'upcoming';
}

/** Extract a video id from a bare id or a youtube.com / youtu.be URL. */
export function parseYouTubeVideoId(input: string): string | null {
  const trimmed = input.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(trimmed)) return trimmed;
  const patterns = [
    /[?&]v=([A-Za-z0-9_-]{11})/,
    /youtu\.be\/([A-Za-z0-9_-]{11})/,
    /youtube\.com\/(?:embed|shorts|live)\/([A-Za-z0-9_-]{11})/,
  ];
  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match) return match[1];
  }
  return null;
}

interface VideosListResponse {
  items?: {
    id: string;
    snippet: {
      title: string;
      description: string;
      channelId: string;
      channelTitle: string;
      publishedAt: string;
      liveBroadcastContent: 'none' | 'live' | 'upcoming';
      thumbnails: Record<string, { url: string; width: number } | undefined>;
    };
    contentDetails: { duration: string };
  }[];
}

/**
 * Fetch metadata for one video. Returns null when the API reports no such
 * video (invalid / private / deleted) — callers must treat that as a
 * validation failure, not substitute placeholder data.
 */
export async function fetchVideoMetadata(
  youtubeVideoId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<YouTubeVideoMetadata | null> {
  const key = requireApiKey();
  const url =
    `${API_BASE}/videos?part=snippet,contentDetails&id=${encodeURIComponent(youtubeVideoId)}` +
    `&key=${encodeURIComponent(key)}`;
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`YouTube Data API request failed with HTTP ${response.status}.`);
  }
  const data = (await response.json()) as VideosListResponse;
  const item = data.items?.[0];
  if (!item) return null;
  const thumbs = item.snippet.thumbnails;
  const bestThumb =
    thumbs.maxres ?? thumbs.standard ?? thumbs.high ?? thumbs.medium ?? thumbs.default;
  return {
    youtubeVideoId: item.id,
    title: item.snippet.title,
    description: item.snippet.description,
    channelId: item.snippet.channelId,
    channelTitle: item.snippet.channelTitle,
    publishedAt: item.snippet.publishedAt,
    durationIso8601: item.contentDetails.duration,
    thumbnailUrl: bestThumb?.url ?? null,
    liveBroadcastContent: item.snippet.liveBroadcastContent,
  };
}

/** Validate an admin-pasted URL/id: parse it, then confirm via the API. */
export async function validateVideoUrlOrId(
  input: string,
  fetchImpl: typeof fetch = fetch,
): Promise<YouTubeVideoMetadata | null> {
  const id = parseYouTubeVideoId(input);
  if (!id) return null;
  return fetchVideoMetadata(id, fetchImpl);
}
