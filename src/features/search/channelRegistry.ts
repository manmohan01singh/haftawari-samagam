/**
 * Table-driven channel registry for search: the identities the channel
 * leg matches against are the ACTIVE rows of the admin `channels`
 * table (via features/channels), not a hard-coded singleton. The
 * original official channel keeps its hand-tuned alias list from
 * config.ts (merged in when its row is present); other channels match
 * on the aliases the admin seeded plus their title/handle. When the
 * table is unreachable the channels service falls back to the
 * built-in sangat registry, so search keeps covering those channels.
 */

import { fetchActiveChannels } from '../channels/channelsService';
import { OFFICIAL_CHANNEL } from './config';
import type { ChannelIdentity } from './youtubeSearch';

/**
 * Cap on how many channels the 100-unit search.list leg fans out to
 * per query. The channel CARD has no such cap (matching is local and
 * free); the cap only bounds quota — see docs/CHANNELS.md.
 *
 * The cap MUST cover the built-in sangat registry (Bhai Gursharan
 * Singh Ji official, Amritvela Trust Live, Amritvela Trust,
 * Sakhiyan, SGPC Darbar Sahib, Bangla Sahib, Hazur Sahib, Amritvela
 * TV = 8): at 3 the fourth channel (Sakhiyan) was silently dropped
 * from the fan-out and its uploads could never appear in search
 * results (Phase 11 fix). A channel beyond the cap gets no
 * search.list leg (it is still card-matched locally), so raise this
 * if the registry grows. Quota note: each leg is a 100-unit
 * search.list call, but results are cached and the uploads fallback
 * covers any leg that fails on quota.
 */
export const MAX_YOUTUBE_SEARCH_CHANNELS = 9;

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
