import { isShortVideo, type YouTubeVideoMetadata } from '../../lib/youtube';
import {
  fetchActiveChannels,
  getUploadsPageCached,
  uploadsPlaylistIdFor,
} from '../channels';

/**
 * Shorts feed (user, 28 Nov 2026 — Shorts return, but ONLY from the
 * app's own channels): every active panel channel's uploads are
 * scanned through the SWR uploads cache (first page per channel —
 * no search.list, no extra quota beyond the cached page the rest of
 * the app already fetches) and filtered with the app's own
 * isShortVideo rule (#shorts tag, or a real duration of 60 s or
 * less; live/upcoming broadcasts are never Shorts). Newest first.
 */
export interface ShortItem {
  meta: YouTubeVideoMetadata;
  channelId: string;
  channelTitle: string;
  channelAvatarUrl: string | null;
}

export async function fetchShorts(limit = 40): Promise<ShortItem[]> {
  const channels = await fetchActiveChannels();
  const perChannel = await Promise.all(
    channels
      .filter((ch) => ch.youtubeChannelId)
      .map(async (ch): Promise<ShortItem[]> => {
        try {
          const page = await getUploadsPageCached(
            uploadsPlaylistIdFor(ch.youtubeChannelId),
          );
          return page.videos
            .filter(isShortVideo)
            .map((meta) => ({
              meta,
              channelId: ch.youtubeChannelId,
              channelTitle: ch.title,
              channelAvatarUrl: ch.avatarUrl,
            }));
        } catch {
          return [];
        }
      }),
  );
  return perChannel
    .flat()
    .sort((a, b) => Date.parse(b.meta.publishedAt) - Date.parse(a.meta.publishedAt))
    .slice(0, limit);
}
