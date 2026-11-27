import { useEffect, useState } from 'react';
import { OFFICIAL_CHANNEL_ID, type YouTubeChannelInfo } from '../../lib/youtube';
import { getChannelInfoCached } from '../channels/channelCache';

/**
 * The official channel's real API data, shared at module level so
 * lists, cards and headers resolve it once. Backed by the persisted
 * channel-info cache (6h TTL, stale copy served when the API is
 * unreachable — e.g. the day's YouTube quota is gone), so channel
 * rows keep their real name and DP instead of rendering blank.
 * Returns null only while loading or when nothing was ever fetched —
 * callers render honest fallbacks (initial-letter avatars), never
 * fake data.
 */
let cached: YouTubeChannelInfo | null = null;
let inflight: Promise<YouTubeChannelInfo | null> | null = null;

export function loadOfficialChannel(): Promise<YouTubeChannelInfo | null> {
  if (cached) return Promise.resolve(cached);
  if (!inflight) {
    inflight = getChannelInfoCached(OFFICIAL_CHANNEL_ID)
      .then((info) => {
        cached = info;
        return info;
      })
      .catch(() => null)
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

export function useOfficialChannel(): YouTubeChannelInfo | null {
  const [info, setInfo] = useState<YouTubeChannelInfo | null>(cached);
  useEffect(() => {
    let active = true;
    void loadOfficialChannel().then((result) => {
      if (active) setInfo(result);
    });
    return () => {
      active = false;
    };
  }, []);
  return info;
}
