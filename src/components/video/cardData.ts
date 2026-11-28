import { OFFICIAL_CHANNEL_HANDLE, OFFICIAL_CHANNEL_ID, type YouTubeVideoMetadata } from '../../lib/youtube';
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
  /**
   * This card IS the app's own Samagam session, playing now: the
   * thumbnail carries the red NOW PLAYING chip (the session is a
   * group playback of a recording, never labelled "LIVE"). Set only
   * by HomeScreen for the derived now_playing session — never for a
   * YouTube broadcast (those use broadcastState 'live').
   */
  nowPlayingSession?: boolean;
  /**
   * This card IS the app's own Samagam session, scheduled but not yet
   * started: the thumbnail carries a neutral UPCOMING chip and the
   * meta line carries the real scheduled start ("Today · 7:00 PM").
   * Set only by HomeScreen for the derived upcoming session.
   */
  upcomingSession?: boolean;
  /** @handle or channel name line. */
  channelLine: string;
  /** Real metadata line ("▷ 12K · 21 hr ago", "591 watching", a date…). */
  metaLine: string;
  channelAvatarUrl: string | null;
  /** Real YouTube video id (share / watch URLs are built from it). NULL for hosted rows (migration 0005) — they have no YouTube id and no YouTube URL may be built for them. */
  youtubeVideoId: string | null;
  /** Real channel id that published the video (avatar tap target). */
  channelId: string;
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
  return storedUrl ? downgradeYouTubeThumbnailUrl(storedUrl) : null;
}

/**
 * Rewrite a stored YouTube thumbnail URL to its list-sized mqdefault
 * (320×180) variant. Stored URLs are often maxresdefault (1280×720,
 * several× the bytes) — loading those in list rows was a real image-
 * weight problem (VideoListRow / PlaylistRow / SessionCard used the
 * stored URL directly). mqdefault is also the only true-16:9 small
 * variant, so rows keep the full thumbnail art uncropped (QA issue
 * 51). Non-YouTube URLs pass through unchanged.
 */
export function downgradeYouTubeThumbnailUrl(url: string): string {
  return url.replace(
    /(i\.ytimg\.com\/vi\/[^/]+\/)(?:maxresdefault|sddefault|hqdefault|mqdefault|default)(\.(?:jpg|webp))/,
    '$1mqdefault$2',
  );
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
  viewCount?: number | null,
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
          // Fault 5: catalogue rows used to show ONLY a date while
          // upload cards showed views — one card contract for the
          // whole feed. The caller backfills the row's real view
          // count (one batched statistics call); when it is known
          // the line is "▷ views · date", when genuinely unknown it
          // stays date-only — never an invented count.
          const date = formatDateLine(video.published_at ?? video.created_at);
          if (viewCount != null) {
            const views = `${formatCount(viewCount)} views`;
            return date ? `▷ ${views} · ${date}` : `▷ ${views}`;
          }
          return date ? `▷ ${date}` : '';
        })(),
    channelAvatarUrl,
    youtubeVideoId: video.youtube_video_id,
    channelId: OFFICIAL_CHANNEL_ID,
  };
}

export function apiCardData(
  meta: YouTubeVideoMetadata,
  channelAvatarUrl: string | null,
  overrides?: { viewCount?: number | null; liveMeta?: YouTubeVideoMetadata | null },
): CardVideoData {
  let metaLine: string;
  if (meta.liveBroadcastContent === 'live') {
    // One live count everywhere (fix round 5, #5): the screen's
    // refreshed live map wins over the count frozen into the feed
    // item when it was gathered — the card and the Watch page read
    // the same live source, refreshed on a timer.
    const viewers = overrides?.liveMeta?.concurrentViewers ?? meta.concurrentViewers;
    metaLine = viewers != null ? `${formatCount(viewers)} watching` : 'Live now';
  } else if (meta.liveBroadcastContent === 'upcoming') {
    metaLine = `Upcoming · ${formatDateLine(meta.publishedAt)}`;
  } else {
    const parts: string[] = [];
    const views = overrides?.viewCount ?? meta.viewCount;
    if (views != null) parts.push(`▷ ${formatCount(views)}`);
    const ago = timeAgo(meta.publishedAt);
    if (ago) parts.push(ago);
    metaLine = parts.join('\u00A0·\u00A0');
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
    youtubeVideoId: meta.youtubeVideoId,
    channelId: meta.channelId,
  };
}
