import { isShortVideo, type YouTubeVideoMetadata } from '../../lib/youtube';
import { dedupeByContentFuzzy, normaliseTitleHard } from '../../lib/contentDedupe';
import {
  fetchActiveChannels,
  getUploadsPageCached,
  uploadsPlaylistIdFor,
} from '../channels';

/**
 * Shorts feed (user, 28 Nov 2026 — Shorts return, but ONLY from the
 * app's own channels): every active panel channel's uploads are
 * scanned through the SWR uploads cache (first TWO pages per
 * channel — no search.list, no extra quota beyond the cached pages
 * the rest of the app already fetches) and filtered with the app's
 * own isShortVideo rule (#shorts tag, or a real duration of 60 s or
 * less; live/upcoming broadcasts are never Shorts).
 *
 * Order (user, 28 Nov 2026): latest first, but CHANNEL-MIXED — the
 * feed must not run one channel's shorts in a block; a greedy
 * spread always takes the newest remaining short whose channel
 * differs from the previous pick, so swiping moves between channels
 * the way YouTube's Shorts feed does. The screen loops the pool, so
 * the feed never runs out.
 */
export interface ShortItem {
  meta: YouTubeVideoMetadata;
  channelId: string;
  channelTitle: string;
  channelAvatarUrl: string | null;
}

/** Newest-first with channel variety: never two in a row from the
 *  same channel while another channel still has shorts left. */
export function spreadByChannel(items: ShortItem[]): ShortItem[] {
  const remaining = [...items].sort(
    (a, b) => Date.parse(b.meta.publishedAt) - Date.parse(a.meta.publishedAt),
  );
  const out: ShortItem[] = [];
  let lastChannel: string | null = null;
  while (remaining.length > 0) {
    let idx = remaining.findIndex((it) => it.channelId !== lastChannel);
    if (idx === -1) idx = 0;
    const [picked] = remaining.splice(idx, 1);
    out.push(picked);
    lastChannel = picked.channelId;
  }
  return out;
}

export async function fetchShorts(limit = 60): Promise<ShortItem[]> {
  const channels = await fetchActiveChannels();
  const perChannel = await Promise.all(
    channels
      .filter((ch) => ch.youtubeChannelId)
      .map(async (ch): Promise<ShortItem[]> => {
        try {
          const playlistId = uploadsPlaylistIdFor(ch.youtubeChannelId);
          const first = await getUploadsPageCached(playlistId);
          let videos = first.videos;
          if (first.nextPageToken) {
            try {
              const second = await getUploadsPageCached(playlistId, first.nextPageToken);
              videos = [...videos, ...second.videos];
            } catch {
              // Page 1 alone is a fine pool for this channel.
            }
          }
          return videos
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
  const seen = new Set<string>();
  const byId = perChannel.flat().filter((it) => {
    if (seen.has(it.meta.youtubeVideoId)) return false;
    seen.add(it.meta.youtubeVideoId);
    return true;
  });
  // Content dedupe (fault 23/N10): the same clip re-uploaded under
  // a different id appears ONCE — which also stops its like counts
  // "flapping" between copies, since only one copy is ever shown.
  // Fuzzy (fix round 4): ±3 s duration tolerance + hard title
  // normalisation — exact-second keys missed re-uploads trimmed
  // by a second or two, so one Hazoor Sahib clip showed 3×.
  const all = dedupeByContentFuzzy(byId, (it) => ({
    channelId: it.meta.channelId,
    title: it.meta.title,
    durationSeconds: it.meta.durationSeconds,
  }));
  // Cross-channel pass (fix round 5.1, #23): the same clip is
  // often carried by TWO sangat channels under the identical title
  // (the Takhat Sahib evening kirtan showed at 836 and 5.4K views
  // from two sources) — channel-keyed dedupe can never pair those.
  // For the Shorts pool, an identical hard title with a compatible
  // duration (within ±15 s, or either side unknown) is the same
  // clip to a viewer, whichever channel carries it. Dated series
  // titles differ by their date text, so episodes stay distinct.
  const titleSeen = new Map<string, number | null>();
  const crossDeduped = all.filter((it) => {
    const key = normaliseTitleHard(it.meta.title);
    if (!key) return true;
    const prevDuration = titleSeen.get(key);
    if (prevDuration !== undefined) {
      const d = it.meta.durationSeconds;
      if (prevDuration == null || d == null || Math.abs(prevDuration - d) <= 15) return false;
    }
    titleSeen.set(key, it.meta.durationSeconds);
    return true;
  });
  return spreadByChannel(crossDeduped).slice(0, limit);
}
