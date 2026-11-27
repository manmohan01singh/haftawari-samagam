/**
 * Table-driven channel registry for search: the identities the channel
 * leg matches against are the ACTIVE rows of the admin `channels`
 * table (via features/channels), not a hard-coded singleton. The
 * original official channel keeps its hand-tuned alias list from
 * config.ts (merged in when its row is present); other channels match
 * on the aliases the admin seeded plus their title/handle. When the
 * table is unreachable the channels service already falls back to the
 * single original channel, so search degrades to its old behaviour.
 */

import { fetchActiveChannels } from '../channels/channelsService';
import { OFFICIAL_CHANNEL } from './config';
import type { ChannelIdentity } from './youtubeSearch';

/**
 * Cap on how many channels the 100-unit search.list leg fans out to
 * per query. The channel CARD has no such cap (matching is local and
 * free); the cap only bounds quota — see docs/CHANNELS.md.
 */
export const MAX_YOUTUBE_SEARCH_CHANNELS = 3;

export async function loadSearchChannels(): Promise<ChannelIdentity[]> {
  const active = await fetchActiveChannels().catch(() => []);
  const identities: ChannelIdentity[] = active.map((c) => {
    const isOfficial = c.youtubeChannelId === OFFICIAL_CHANNEL.id;
    const aliases = new Set<string>(c.aliases);
    if (isOfficial) {
      for (const alias of OFFICIAL_CHANNEL.aliases) aliases.add(alias);
    }
    return {
      id: c.youtubeChannelId,
      title: c.title,
      handle: c.handle ?? '',
      aliases: [...aliases],
    };
  });
  if (identities.length === 0) {
    return [
      {
        id: OFFICIAL_CHANNEL.id,
        title: OFFICIAL_CHANNEL.title,
        handle: OFFICIAL_CHANNEL.handle,
        aliases: [...OFFICIAL_CHANNEL.aliases],
      },
    ];
  }
  return identities;
}
