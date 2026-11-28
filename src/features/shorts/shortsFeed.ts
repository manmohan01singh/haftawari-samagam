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

export async function fetchShorts(limit = 90): Promise<ShortItem[]> {
  const channels = await fetchActiveChannels();
  const perChannel = await Promise.all(
    channels
      .filter((ch) => ch.youtubeChannelId)
      .map(async (ch): Promise<ShortItem[]> => {
        try {
          const playlistId = uploadsPlaylistIdFor(ch.youtubeChannelId);
          const first = await getUploadsPageCached(playlistId);
          let videos = first.videos;
          // THREE pages per channel (fix round 6 — the user asked
          // for MORE Shorts): ~150 uploads scanned per channel
          // through the same SWR cache the app already keeps.
          let token = first.nextPageToken;
          for (let page = 0; page < 2 && token; page++) {
            try {
              const next = await getUploadsPageCached(playlistId, token);
              videos = [...videos, ...next.videos];
              token = next.nextPageToken;
            } catch {
              break; // Fewer pages is a fine pool for this channel.
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
  // Cross-channel pass (fix round 5.1, #23; TITLE-ONLY in fix
  // round 6): the same clip is often carried by TWO sangat
  // channels under the identical title (the Takhat Sahib evening
  // kirtan showed twice — same channel AND across channels, at
  // different durations) — channel-keyed dedupe can never pair
  // those, and the ±15 s duration tolerance still let the pair
  // through when the copies were cut differently. For the Shorts
  // pool an identical hard title is the same clip to a viewer,
  // full stop: the first copy wins, every later one drops. Dated
  // series titles differ by their date text, so episodes stay
  // distinct.
  const titleSeen = new Set<string>();
  const crossDeduped = all.filter((it) => {
    const key = normaliseTitleHard(it.meta.title);
    if (!key) return true;
    if (titleSeen.has(key)) return false;
    titleSeen.add(key);
    return true;
  });
  return spreadByChannel(crossDeduped).slice(0, limit);
}
