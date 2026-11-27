/**
 * The app's channel panel, as data: WHICH YouTube channels appear in
 * the app is decided by the admin in the `channels` table
 * (supabase/migrations/0003_channels.sql) — Subscriptions and Search
 * read from here, never from a hard-coded list.
 *
 * Fallback contract: before the migration is applied (or when Supabase
 * is unreachable / unconfigured), the query fails and this module
 * returns the single original channel — Bhai Gursharan Singh Ji
 * official — so the app behaves exactly as it did before the panel
 * existed. A SUCCESSFUL query that returns zero active rows is the
 * admin's deliberate choice and is honoured as an empty list; it does
 * NOT resurrect the fallback.
 */

import { useEffect, useState } from 'react';

import { supabase } from '../../lib/supabase';
import { OFFICIAL_CHANNEL } from '../search/config';
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

/** Active panel channels, in admin-chosen order. */
export async function fetchActiveChannels(): Promise<AppChannel[]> {
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.channels;
  if (!supabase) return [FALLBACK_CHANNEL];
  if (!inflight) {
    inflight = (async () => {
      try {
        const { data, error } = await supabase
          .from('channels')
          .select('*')
          .eq('is_active', true)
          .order('sort_order', { ascending: true })
          .order('title', { ascending: true });
        if (error) throw error;
        // Successful query: honour the result even when it is empty.
        return ((data ?? []) as ChannelRecord[]).map(toAppChannel);
      } catch {
        // Table missing (migration not applied yet) or backend
        // unreachable: preserve the original single-channel behaviour.
        return [FALLBACK_CHANNEL];
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
