import { useEffect, useState } from 'react';
import {
  OFFICIAL_CHANNEL_HANDLE,
  fetchChannelByHandle,
  type YouTubeChannelInfo,
} from '../../lib/youtube';

/**
 * The official channel's real API data, fetched once and cached at
 * module level so lists, cards and headers share a single request.
 * Returns null while loading or when the API is unreachable — callers
 * render honest fallbacks (initial-letter avatars), never fake data.
 */
let cached: YouTubeChannelInfo | null = null;
let inflight: Promise<YouTubeChannelInfo | null> | null = null;

export function loadOfficialChannel(): Promise<YouTubeChannelInfo | null> {
  if (cached) return Promise.resolve(cached);
  if (!inflight) {
    inflight = fetchChannelByHandle(OFFICIAL_CHANNEL_HANDLE)
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
