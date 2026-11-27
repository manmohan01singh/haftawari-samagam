/**
 * The app's channel panel, as data: WHICH YouTube channels appear in
 * the app is decided by the admin in the `channels` table
 * (supabase/migrations/0003_channels.sql) — Subscriptions and Search
 * read from here.
 *
 * Built-in registry (user order, 27 Nov 2026): the app ALWAYS carries
 * its sangat channels — Bhai Gursharan Singh Ji (official), Amritvela
 * Trust Live, Amritvela Trust, and Sakhiyan (Bhai Gursharan Singh Ji)
 * — even before migration 0003 is applied. DB rows, when the table
 * exists, are UNIONED with the registry (a DB row wins over the
 * registry entry for the same YouTube channel id, so the admin can
 * still rename/reorder). Before this order, the fallback was the
 * single official channel only.
 *
 * The Sakhiyan channel id is resolved from its handle at runtime
 * (channels.list?forHandle, one quota unit, cached with the module
 * cache below); if resolution fails (e.g. quota), that one channel
 * is skipped for the cycle and retried on the next.
 */

import { useEffect, useState } from 'react';

import { supabase } from '../../lib/supabase';
import { fetchChannelByHandle } from '../../lib/youtube';
import { OFFICIAL_CHANNEL } from '../search/config';
import { SUGGESTED_CHANNELS } from './suggested';
import type { ChannelRecord } from '../../types/database';

/** UI-facing shape of one panel channel. */
export interface AppChannel {
  /** Supabase row id; null for the code-level fallback channel. */
  rowId: string | null;
  youtubeChannelId: string;
  handle: string | null;
  title: string;
  avatarUrl: string | null;
  /** Search-matching name forms (never displayed). */
  aliases: string[];
  sortOrder: number;
}

export const FALLBACK_CHANNEL: AppChannel = {
  rowId: null,
  youtubeChannelId: OFFICIAL_CHANNEL.id,
  handle: OFFICIAL_CHANNEL.handle,
  title: OFFICIAL_CHANNEL.title,
  avatarUrl: null,
  aliases: [...OFFICIAL_CHANNEL.aliases],
  sortOrder: 0,
};

/**
 * The built-in sangat channels (user order, 27 Nov 2026). The
 * Sakhiyan entry carries an empty youtubeChannelId until its handle
 * is resolved at runtime — see resolveRegistryChannels().
 */
export const APP_REGISTRY_CHANNELS: AppChannel[] = [
  FALLBACK_CHANNEL,
  ...SUGGESTED_CHANNELS.map((s, i) => ({
    rowId: null,
    youtubeChannelId: s.youtubeChannelId,
    handle: s.handle,
    title: s.title,
    avatarUrl: s.avatarUrl,
    aliases: [] as string[],
    sortOrder: i + 1,
  })),
  {
    rowId: null,
    youtubeChannelId: '',
    handle: '@sakhiyanbhaigursharansinghji',
    title: 'Sakhiyan - Bhai Gursharan Singh Ji',
    avatarUrl: null,
    aliases: ['sakhiyan', 'sakhi', 'haadbiti', 'hadbiti'],
    sortOrder: 3,
  },
];

/** Registry with the Sakhiyan handle resolved to a real channel id. */
async function resolveRegistryChannels(): Promise<AppChannel[]> {
  const out: AppChannel[] = [];
  for (const ch of APP_REGISTRY_CHANNELS) {
    if (ch.youtubeChannelId) {
      out.push(ch);
      continue;
    }
    if (!ch.handle) continue;
    try {
      const info = await fetchChannelByHandle(ch.handle);
      if (info?.channelId) {
        out.push({
          ...ch,
          youtubeChannelId: info.channelId,
          title: info.title || ch.title,
          avatarUrl: info.avatarUrl ?? ch.avatarUrl,
        });
      }
    } catch {
      // Quota / network: skip this channel for this cycle only.
    }
  }
  return out;
}

function toAppChannel(row: ChannelRecord): AppChannel {
  return {
    rowId: row.id,
    youtubeChannelId: row.youtube_channel_id,
    handle: row.handle,
    title: row.title,
    avatarUrl: row.avatar_url,
    aliases: row.aliases ?? [],
    sortOrder: row.sort_order,
  };
}

const CACHE_TTL_MS = 5 * 60 * 1000;
let cached: { fetchedAt: number; channels: AppChannel[] } | null = null;
let inflight: Promise<AppChannel[]> | null = null;

/** Drop the module cache (the admin panel calls this after a mutation). */
export function invalidateChannelsCache(): void {
  cached = null;
}

/** Active panel channels: built-in registry ∪ admin DB rows. */
export async function fetchActiveChannels(): Promise<AppChannel[]> {
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.channels;
  if (!inflight) {
    inflight = (async () => {
      const registry = await resolveRegistryChannels();
      if (!supabase) return registry;
      try {
        const { data, error } = await supabase
          .from('channels')
          .select('*')
          .eq('is_active', true)
          .order('sort_order', { ascending: true })
          .order('title', { ascending: true });
        if (error) throw error;
        const dbChannels = ((data ?? []) as ChannelRecord[]).map(toAppChannel);
        if (dbChannels.length === 0) return registry;
        // Union: DB row wins for the same YouTube channel id.
        const dbIds = new Set(dbChannels.map((c) => c.youtubeChannelId));
        return [
          ...dbChannels,
          ...registry.filter((c) => !dbIds.has(c.youtubeChannelId)),
        ].sort((a, b) => a.sortOrder - b.sortOrder);
      } catch {
        // Table missing (migration not applied yet) or backend
        // unreachable: the built-in registry still applies.
        return registry;
      }
    })()
      .then((channels) => {
        cached = { fetchedAt: Date.now(), channels };
        return channels;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

/** React hook form of fetchActiveChannels. */
export function useActiveChannels(): { channels: AppChannel[]; loading: boolean } {
  // Seed from the module cache when present (fetchActiveChannels
  // revalidates against its TTL in the effect below).
  const [channels, setChannels] = useState<AppChannel[]>(cached?.channels ?? []);
  const [loading, setLoading] = useState(cached === null);
  useEffect(() => {
    let active = true;
    void fetchActiveChannels().then((result) => {
      if (active) {
        setChannels(result);
        setLoading(false);
      }
    });
    return () => {
      active = false;
    };
  }, []);
  return { channels, loading };
}

/** Uploads playlist id for a channel: "UU" + channel id minus "UC". */
export function uploadsPlaylistIdFor(youtubeChannelId: string): string {
  return `UU${youtubeChannelId.slice(2)}`;
}
