import { OFFICIAL_CHANNEL_HANDLE, type YouTubeVideoMetadata } from '../../lib/youtube';
import { formatCount, timeAgo } from '../../lib/format';
import type { Video } from '../../types/database';

/**
 * Normalized display data for video cards. Every field is a REAL value
 * from Supabase or the YouTube Data API — cards render exactly what
 * they are given and never invent counts, views or dates.
 */
export interface CardVideoData {
  /** Stable list key. */
  key: string;
  title: string;
  /** List-sized thumbnail (never a full-res original in lists). */
  thumbnailUrl: string | null;
  durationSeconds: number | null;
  /** The video's OWN YouTube broadcast state, from the API. Archive rows are 'none'. */
  broadcastState: 'none' | 'live' | 'upcoming';
  /** @handle or channel name line. */
  channelLine: string;
  /** Real metadata line ("▷ 12K · 21 hr ago", "591 watching", a date…). */
  metaLine: string;
  channelAvatarUrl: string | null;
}

/**
 * List-sized thumbnail: hqdefault (480×360) derived from the video id —
 * the stored maxres original is reserved for hero/watch surfaces so
 * lists stay light and smooth.
 */
export function listThumbnailUrl(youtubeVideoId: string | null, storedUrl: string | null): string | null {
  if (youtubeVideoId) return `https://i.ytimg.com/vi/${youtubeVideoId}/hqdefault.jpg`;
  return storedUrl;
}

export function formatDateLine(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function supabaseCardData(video: Video, channelAvatarUrl: string | null): CardVideoData {
  return {
    key: `sb-${video.id}`,
    title: video.title,
    thumbnailUrl: listThumbnailUrl(video.youtube_video_id, video.thumbnail_url),
    durationSeconds: video.duration_seconds,
    broadcastState: 'none',
    channelLine: OFFICIAL_CHANNEL_HANDLE,
    metaLine: formatDateLine(video.published_at ?? video.created_at),
    channelAvatarUrl,
  };
}

export function apiCardData(meta: YouTubeVideoMetadata, channelAvatarUrl: string | null): CardVideoData {
  let metaLine: string;
  if (meta.liveBroadcastContent === 'live') {
    metaLine =
      meta.concurrentViewers != null ? `${formatCount(meta.concurrentViewers)} watching` : 'Live now';
  } else if (meta.liveBroadcastContent === 'upcoming') {
    metaLine = `Upcoming · ${formatDateLine(meta.publishedAt)}`;
  } else {
    const parts: string[] = [];
    if (meta.viewCount != null) parts.push(`▷ ${formatCount(meta.viewCount)}`);
    const ago = timeAgo(meta.publishedAt);
    if (ago) parts.push(ago);
    metaLine = parts.join('  ·  ');
  }
  return {
    key: `yt-${meta.youtubeVideoId}`,
    title: meta.title,
    thumbnailUrl: listThumbnailUrl(meta.youtubeVideoId, meta.thumbnailUrl),
    durationSeconds: meta.liveBroadcastContent === 'live' ? null : meta.durationSeconds,
    broadcastState: meta.liveBroadcastContent,
    channelLine: meta.channelTitle,
    metaLine,
    channelAvatarUrl,
  };
}
