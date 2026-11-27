/**
 * YouTube Data API v3 client.
 *
 * Read-only metadata access ONLY, using the official API:
 *   - validate a video id / URL the admin pasted
 *   - fetch permitted metadata (title, description, thumbnails, duration,
 *     view/like counts, live-streaming details — all real API values)
 *   - resolve + describe the official channel, list its uploads, and
 *     search within it (Phase 2 channel + search screens)
 * Playback always uses the official YouTube embedded player — this module
 * never downloads, scrapes or extracts streams, and never hides ads,
 * attribution or player controls.
 *
 * The API key comes from EXPO_PUBLIC_YOUTUBE_API_KEY (see .env.example).
 * No key is hard-coded. When the key is absent, every method throws
 * `YouTubeNotConfiguredError` so callers can show an honest empty state.
 */

import { parseIso8601Duration } from './format';

const API_BASE = 'https://www.googleapis.com/youtube/v3';

/** The one channel this app's archive belongs to (resolved via the API). */
export const OFFICIAL_CHANNEL_HANDLE = '@bhaigursharansinghjiofficial';
/** UC id of the official channel, resolved via channels?forHandle on 2026-11-26. */
export const OFFICIAL_CHANNEL_ID = 'UCu7xpk9fOQRs4AvYEOakBfg';

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

async function apiGet<T>(path: string, fetchImpl: typeof fetch = fetch): Promise<T> {
  const key = requireApiKey();
  const separator = path.includes('?') ? '&' : '?';
  const response = await fetchImpl(`${API_BASE}/${path}${separator}key=${encodeURIComponent(key)}`);
  if (!response.ok) {
    throw new Error(`YouTube Data API request failed with HTTP ${response.status}.`);
  }
  return (await response.json()) as T;
}

type ThumbnailSet = Record<string, { url: string; width: number } | undefined>;

function bestThumbnail(thumbs: ThumbnailSet): string | null {
  const best = thumbs.maxres ?? thumbs.standard ?? thumbs.high ?? thumbs.medium ?? thumbs.default;
  return best?.url ?? null;
}

/** Metadata the API is permitted to return for a video. */
export interface YouTubeVideoMetadata {
  youtubeVideoId: string;
  title: string;
  description: string;
  channelId: string;
  channelTitle: string;
  publishedAt: string; // ISO 8601, as returned by the API
  durationIso8601: string; // e.g. "PT2H5M27S", as returned by the API
  durationSeconds: number | null;
  thumbnailUrl: string | null; // best available thumbnail URL from the API
  /** 'live'/'upcoming' describe the video's OWN YouTube broadcast state. */
  liveBroadcastContent: 'none' | 'live' | 'upcoming';
  /** Real statistics from the API (null when the API omits them). */
  viewCount: number | null;
  likeCount: number | null;
  /** Real concurrent viewers — present only for a broadcast live right now. */
  concurrentViewers: number | null;
}

/** Extract a video id from a bare id or a youtube.com / youtu.be URL. */
export function parseYouTubeVideoId(input: string): string | null {
  const trimmed = input.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(trimmed)) return trimmed;
  const patterns = [
    /[?&]v=([A-Za-z0-9_-]{11})/,
    /youtu\.be\/([A-Za-z0-9_-]{11})/,
    /youtube\.com\/(?:embed|live)\/([A-Za-z0-9_-]{11})/,
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
      thumbnails: ThumbnailSet;
    };
    contentDetails: { duration: string };
    statistics?: { viewCount?: string; likeCount?: string };
    liveStreamingDetails?: { concurrentViewers?: string };
  }[];
}

type VideosListItem = NonNullable<VideosListResponse['items']>[number];

function toVideoMetadata(item: VideosListItem): YouTubeVideoMetadata {
  return {
    youtubeVideoId: item.id,
    title: item.snippet.title,
    description: item.snippet.description,
    channelId: item.snippet.channelId,
    channelTitle: item.snippet.channelTitle,
    publishedAt: item.snippet.publishedAt,
    durationIso8601: item.contentDetails.duration,
    durationSeconds: parseIso8601Duration(item.contentDetails.duration),
    thumbnailUrl: bestThumbnail(item.snippet.thumbnails),
    liveBroadcastContent: item.snippet.liveBroadcastContent,
    viewCount: item.statistics?.viewCount == null ? null : Number(item.statistics.viewCount),
    likeCount: item.statistics?.likeCount == null ? null : Number(item.statistics.likeCount),
    concurrentViewers:
      item.liveStreamingDetails?.concurrentViewers == null
        ? null
        : Number(item.liveStreamingDetails.concurrentViewers),
  };
}

const VIDEO_PARTS = 'snippet,contentDetails,statistics,liveStreamingDetails';

/**
 * Fetch metadata for one video. Returns null when the API reports no such
 * video (invalid / private / deleted) — callers must treat that as a
 * validation failure, not substitute placeholder data.
 */
export async function fetchVideoMetadata(
  youtubeVideoId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<YouTubeVideoMetadata | null> {
  const data = await apiGet<VideosListResponse>(
    `videos?part=${VIDEO_PARTS}&id=${encodeURIComponent(youtubeVideoId)}`,
    fetchImpl,
  );
  const item = data.items?.[0];
  return item ? toVideoMetadata(item) : null;
}

/** Batch metadata fetch (one API call for up to 50 ids). Missing ids are omitted. */
export async function fetchVideosMetadata(
  youtubeVideoIds: string[],
  fetchImpl: typeof fetch = fetch,
): Promise<YouTubeVideoMetadata[]> {
  if (youtubeVideoIds.length === 0) return [];
  const out: YouTubeVideoMetadata[] = [];
  for (let i = 0; i < youtubeVideoIds.length; i += 50) {
    const chunk = youtubeVideoIds.slice(i, i + 50);
    const data = await apiGet<VideosListResponse>(
      `videos?part=${VIDEO_PARTS}&id=${chunk.map(encodeURIComponent).join(',')}`,
      fetchImpl,
    );
    for (const item of data.items ?? []) out.push(toVideoMetadata(item));
  }
  // Preserve the caller's ordering (the API does not guarantee it).
  const byId = new Map(out.map((v) => [v.youtubeVideoId, v]));
  return youtubeVideoIds.map((id) => byId.get(id)).filter((v): v is YouTubeVideoMetadata => Boolean(v));
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

// ── Channel ──────────────────────────────────────────────────────────

export interface YouTubeChannelInfo {
  channelId: string;
  title: string;
  handle: string | null; // e.g. "@bhaigursharansinghjiofficial"
  description: string;
  avatarUrl: string | null;
  bannerUrl: string | null;
  subscriberCount: number | null; // null when the channel hides it
  videoCount: number | null;
  viewCount: number | null;
  uploadsPlaylistId: string | null;
}

interface ChannelsListResponse {
  items?: {
    id: string;
    snippet: {
      title: string;
      description: string;
      customUrl?: string;
      thumbnails: ThumbnailSet;
    };
    statistics: {
      subscriberCount?: string;
      hiddenSubscriberCount?: boolean;
      videoCount?: string;
      viewCount?: string;
    };
    contentDetails: { relatedPlaylists: { uploads?: string } };
    brandingSettings?: { image?: { bannerExternalUrl?: string; bannerMobileImageUrl?: string } };
  }[];
}

/**
 * Banner display URL (round-2 letterbox fix, verified live against
 * the official channel's real banner on 2026-11-26):
 * bannerExternalUrl serves the full 2560x1440 TV banner, whose actual
 * artwork is only a thin centre band — the rest is background pattern,
 * so rendering it directly leaves big empty bands above/below the art
 * (screenshot cur-3). The API no longer returns bannerMobileImageUrl,
 * but the yt3.googleusercontent.com URL accepts YouTube's own banner
 * crop parameters: appending
 * "=w1546-fcrop64=1,00005a57ffffa5a8-k-c0xffffffff-no-nd-rj" returns
 * the 1546x256 centre crop containing ONLY the artwork band (the same
 * crop YouTube serves for channel banners). Non-googleusercontent
 * URLs and URLs that already carry parameters pass through unchanged.
 */
export function bannerDisplayUrl(raw: string | null): string | null {
  if (!raw) return null;
  if (!raw.includes('googleusercontent.com') || raw.includes('=')) return raw;
  return `${raw}=w1546-fcrop64=1,00005a57ffffa5a8-k-c0xffffffff-no-nd-rj`;
}

function toChannelInfo(item: NonNullable<ChannelsListResponse['items']>[number]): YouTubeChannelInfo {
  const stats = item.statistics;
  return {
    channelId: item.id,
    title: item.snippet.title,
    handle: item.snippet.customUrl ?? null,
    description: item.snippet.description,
    avatarUrl: bestThumbnail(item.snippet.thumbnails),
    bannerUrl: bannerDisplayUrl(
      item.brandingSettings?.image?.bannerMobileImageUrl ??
        item.brandingSettings?.image?.bannerExternalUrl ??
        null,
    ),
    subscriberCount:
      stats.hiddenSubscriberCount || stats.subscriberCount == null
        ? null
        : Number(stats.subscriberCount),
    videoCount: stats.videoCount == null ? null : Number(stats.videoCount),
    viewCount: stats.viewCount == null ? null : Number(stats.viewCount),
    uploadsPlaylistId: item.contentDetails.relatedPlaylists.uploads ?? null,
  };
}

const CHANNEL_PARTS = 'snippet,statistics,contentDetails,brandingSettings';

/** Resolve a channel by its @handle (e.g. the official channel). */
export async function fetchChannelByHandle(
  handle: string,
  fetchImpl: typeof fetch = fetch,
): Promise<YouTubeChannelInfo | null> {
  const data = await apiGet<ChannelsListResponse>(
    `channels?part=${CHANNEL_PARTS}&forHandle=${encodeURIComponent(handle)}`,
    fetchImpl,
  );
  const item = data.items?.[0];
  return item ? toChannelInfo(item) : null;
}

/** Fetch a channel by its UC… id. */
export async function fetchChannelById(
  channelId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<YouTubeChannelInfo | null> {
  const data = await apiGet<ChannelsListResponse>(
    `channels?part=${CHANNEL_PARTS}&id=${encodeURIComponent(channelId)}`,
    fetchImpl,
  );
  const item = data.items?.[0];
  return item ? toChannelInfo(item) : null;
}

/** Fetch several channels in ONE channels.list call (1 unit per 50 ids). */
export async function fetchChannelsByIds(
  channelIds: string[],
  fetchImpl: typeof fetch = fetch,
): Promise<YouTubeChannelInfo[]> {
  if (channelIds.length === 0) return [];
  const out: YouTubeChannelInfo[] = [];
  for (let i = 0; i < channelIds.length; i += 50) {
    const chunk = channelIds.slice(i, i + 50);
    const data = await apiGet<ChannelsListResponse>(
      `channels?part=${CHANNEL_PARTS}&id=${chunk.map(encodeURIComponent).join(',')}`,
      fetchImpl,
    );
    for (const item of data.items ?? []) out.push(toChannelInfo(item));
  }
  const byId = new Map(out.map((c) => [c.channelId, c]));
  return channelIds.map((id) => byId.get(id)).filter((c): c is YouTubeChannelInfo => Boolean(c));
}

/** Legacy username lookup (channels without a @handle). May return null. */
export async function fetchChannelByUsername(
  username: string,
  fetchImpl: typeof fetch = fetch,
): Promise<YouTubeChannelInfo | null> {
  const data = await apiGet<ChannelsListResponse>(
    `channels?part=${CHANNEL_PARTS}&forUsername=${encodeURIComponent(username)}`,
    fetchImpl,
  );
  const item = data.items?.[0];
  return item ? toChannelInfo(item) : null;
}

// ── Admin channel input parsing ──────────────────────────────────────

export type ChannelInputRef =
  | { kind: 'id'; value: string }
  | { kind: 'handle'; value: string }
  | { kind: 'username'; value: string };

/**
 * Parse what an admin pasted into the Channels panel: a UC… channel id,
 * an @handle (with or without the @), or a youtube.com URL —
 * /channel/UC…, /@handle, /c/<name> or /user/<name>. Returns null when
 * the input is none of those (the panel then says so, honestly).
 */
export function parseChannelInput(input: string): ChannelInputRef | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (/^UC[A-Za-z0-9_-]{22}$/.test(trimmed)) return { kind: 'id', value: trimmed };
  if (/^@[A-Za-z0-9._-]{3,30}$/.test(trimmed)) return { kind: 'handle', value: trimmed };
  const urlMatch = trimmed.match(
    /(?:youtube\.com|www\.youtube\.com|m\.youtube\.com)\/(?:channel\/(UC[A-Za-z0-9_-]{22})|(@[A-Za-z0-9._-]{3,30})|c\/([A-Za-z0-9._-]{1,60})|user\/([A-Za-z0-9._-]{1,60}))/i,
  );
  if (urlMatch) {
    if (urlMatch[1]) return { kind: 'id', value: urlMatch[1] };
    if (urlMatch[2]) return { kind: 'handle', value: urlMatch[2] };
    return { kind: 'username', value: urlMatch[3] ?? urlMatch[4] };
  }
  // A bare handle typed without the @ (letters/dots/underscores only).
  if (/^[A-Za-z0-9._-]{3,30}$/.test(trimmed)) return { kind: 'handle', value: `@${trimmed}` };
  return null;
}

/**
 * Resolve an admin's channel input to REAL API data via channels.list.
 * A /c/<name> or /user/<name> input first tries forUsername; when that
 * legacy lookup finds nothing it falls back to treating the name as a
 * handle. Returns null when YouTube reports no such channel.
 */
export async function resolveChannelInput(
  input: string,
  fetchImpl: typeof fetch = fetch,
): Promise<YouTubeChannelInfo | null> {
  const ref = parseChannelInput(input);
  if (!ref) return null;
  if (ref.kind === 'id') return fetchChannelById(ref.value, fetchImpl);
  if (ref.kind === 'handle') return fetchChannelByHandle(ref.value, fetchImpl);
  const byUsername = await fetchChannelByUsername(ref.value, fetchImpl).catch(() => null);
  if (byUsername) return byUsername;
  return fetchChannelByHandle(`@${ref.value}`, fetchImpl).catch(() => null);
}

// ── Uploads + search ─────────────────────────────────────────────────

interface PlaylistItemsResponse {
  nextPageToken?: string;
  items?: {
    snippet: { resourceId: { videoId: string } };
  }[];
}

export interface ChannelUploadsPage {
  videos: YouTubeVideoMetadata[];
  nextPageToken: string | null;
}

/** One page of a channel's uploads (newest first), with full metadata. */
export async function fetchChannelUploads(
  uploadsPlaylistId: string,
  pageToken?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ChannelUploadsPage> {
  const tokenPart = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '';
  const data = await apiGet<PlaylistItemsResponse>(
    `playlistItems?part=snippet&maxResults=25&playlistId=${encodeURIComponent(uploadsPlaylistId)}${tokenPart}`,
    fetchImpl,
  );
  const ids = (data.items ?? []).map((i) => i.snippet.resourceId.videoId);
  const videos = await fetchVideosMetadata(ids, fetchImpl);
  return { videos, nextPageToken: data.nextPageToken ?? null };
}

interface SearchListResponse {
  items?: {
    id: { videoId?: string };
  }[];
}

async function searchVideoIds(params: string, fetchImpl: typeof fetch): Promise<string[]> {
  const data = await apiGet<SearchListResponse>(
    `search?part=snippet&type=video&maxResults=25&${params}`,
    fetchImpl,
  );
  return (data.items ?? []).map((i) => i.id.videoId).filter((v): v is string => Boolean(v));
}

/** Search WITHIN one channel (the official channel), API relevance order. */
export async function searchChannelVideos(
  channelId: string,
  query: string,
  fetchImpl: typeof fetch = fetch,
): Promise<YouTubeVideoMetadata[]> {
  const ids = await searchVideoIds(
    `channelId=${encodeURIComponent(channelId)}&q=${encodeURIComponent(query)}&order=relevance`,
    fetchImpl,
  );
  return fetchVideosMetadata(ids, fetchImpl);
}

/**
 * A channel's genuinely live-now and scheduled-upcoming broadcasts, as
 * reported by YouTube itself (eventType search). This describes real
 * YouTube broadcasts of the channel — it is NOT this app's Samagam
 * session state, which uses its own UPCOMING / NOW PLAYING / COMPLETED
 * labels.
 */
export async function fetchChannelLiveAndUpcoming(
  channelId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<YouTubeVideoMetadata[]> {
  const [liveIds, upcomingIds] = await Promise.all([
    searchVideoIds(`channelId=${encodeURIComponent(channelId)}&eventType=live`, fetchImpl),
    searchVideoIds(`channelId=${encodeURIComponent(channelId)}&eventType=upcoming`, fetchImpl),
  ]);
  const ids = [...liveIds, ...upcomingIds.filter((id) => !liveIds.includes(id))];
  return fetchVideosMetadata(ids, fetchImpl);
}

/**
 * Shorts exclusion heuristic — the SAME rule the search stream uses
 * (src/features/search/youtubeSearch.ts): the Data API has no isShort
 * flag, so a video counts as a Short when its title/description carries
 * "#shorts" or its real duration is 60 seconds or less. The user has
 * banned Shorts from the app entirely, so Subscriptions and Channel
 * uploads filter with this too, not just Search.
 */
export function isShortVideo(meta: YouTubeVideoMetadata): boolean {
  if (meta.title.toLowerCase().includes('#shorts')) return true;
  if (meta.description.toLowerCase().includes('#shorts')) return true;
  // A live/upcoming broadcast is never a Short: its duration parses
  // from 'P0D' to 0, which the bare <= 60 check misclassified and the
  // feeds silently dropped the sangat channels' 24/7 live streams
  // (Phase 13 follow-up, found by the chips audit over 1,610 titles).
  if (meta.liveBroadcastContent !== 'none') return false;
  return (
    meta.durationSeconds !== null &&
    meta.durationSeconds > 0 &&
    meta.durationSeconds <= 60
  );
}
