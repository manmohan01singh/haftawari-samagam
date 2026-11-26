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
 * List-sized thumbnail: mqdefault (320×180) derived from the video
 * id. QA issue 51: the previous hqdefault is 480×360 (4:3) — shown
 * cover-fit in a 16:9 frame it crops top/bottom, cutting off the
 * thumbnail's own in-image text. mqdefault is true 16:9, so the full
 * thumbnail art shows uncropped. The stored maxres original stays
 * reserved for hero/watch surfaces.
 */
export function listThumbnailUrl(youtubeVideoId: string | null, storedUrl: string | null): string | null {
  if (youtubeVideoId) return `https://i.ytimg.com/vi/${youtubeVideoId}/mqdefault.jpg`;
  return storedUrl;
}

export function formatDateLine(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function supabaseCardData(
  video: Video,
  channelAvatarUrl: string | null,
  liveMeta?: YouTubeVideoMetadata | null,
): CardVideoData {
  // QA issue 49: LIVE badge + "watching" count on Home cards. Archive
  // rows carry no live state, so this comes ONLY from a real YouTube
  // API live lookup for the same video id (fetchChannelLiveAndUpcoming)
  // passed in by the caller — never inferred or invented.
  const isLive = liveMeta?.liveBroadcastContent === 'live' && liveMeta.youtubeVideoId === video.youtube_video_id;
  return {
    key: `sb-${video.id}`,
    title: video.title,
    thumbnailUrl: listThumbnailUrl(video.youtube_video_id, video.thumbnail_url),
    durationSeconds: isLive ? null : video.duration_seconds,
    broadcastState: isLive ? 'live' : 'none',
    channelLine: OFFICIAL_CHANNEL_HANDLE,
    // Reference correction (screenshot 01): recorded-item metadata
    // lines open with the ▷ glyph ("▷ 12K · 21 hr ago"). Archive rows
    // carry no view count, so the real value shown after ▷ is the
    // recording's date — never an invented count. A genuinely live
    // item instead shows its real concurrent-viewer count.
    metaLine: isLive
      ? liveMeta.concurrentViewers != null
        ? `${formatCount(liveMeta.concurrentViewers)} watching`
        : 'Live now'
      : (() => {
          const date = formatDateLine(video.published_at ?? video.created_at);
          return date ? `▷ ${date}` : '';
        })(),
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
