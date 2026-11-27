import AsyncStorage from '@react-native-async-storage/async-storage';

import { fetchActiveChannels, type AppChannel } from '../channels/channelsService';

/**
 * Device-local follow SET over the per-channel keys that
 * useChannelFollow writes (`channel-follow:<id>` = '1' | '0'), plus
 * the Phase 11 default seeding (user order, 27 Nov 2026): the app's
 * own channels appear SUBSCRIBED by default.
 *
 * Seeding rules — one-time, honest, and never resurrecting:
 *  - A persisted record (SEEDED_KEY) lists every channel id that has
 *    already been seeded. A channel is seeded at most once, ever.
 *  - Seeding only fills an ABSENT follow key with '1'. A key that
 *    already exists ('1' or '0') is the user's own earlier choice
 *    and is left exactly as it is.
 *  - Unfollowing writes '0' under the channel's follow key; because
 *    the id stays in the seeded record, the default is never
 *    re-applied — an unfollowed channel stays unfollowed.
 * These are real device-local follows (the same state the Channel
 * screen's Subscribe pill toggles) — no counts change and nothing
 * is presented as a YouTube subscription.
 */

export function channelFollowKey(youtubeChannelId: string): string {
  return `channel-follow:${youtubeChannelId}`;
}

const SEEDED_KEY = 'hs.seededDefaultFollows.v1';

async function readSeededIds(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(SEEDED_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Seed default follows for any of the given channels not yet seeded.
 * Best-effort: storage failures leave follow state as-is rather than
 * failing the calling screen.
 */
export async function ensureDefaultFollows(channels: AppChannel[]): Promise<void> {
  try {
    const targets = channels.filter((c) => c.youtubeChannelId);
    if (targets.length === 0) return;
    const seeded = new Set(await readSeededIds());
    const fresh = targets.filter((c) => !seeded.has(c.youtubeChannelId));
    if (fresh.length === 0) return;
    const existing = await AsyncStorage.multiGet(fresh.map((c) => channelFollowKey(c.youtubeChannelId)));
    const writes: [string, string][] = [];
    for (const [key, value] of existing) {
      if (value === null) writes.push([key, '1']);
    }
    if (writes.length > 0) await AsyncStorage.multiSet(writes);
    for (const c of fresh) seeded.add(c.youtubeChannelId);
    await AsyncStorage.setItem(SEEDED_KEY, JSON.stringify([...seeded]));
  } catch {
    // Best-effort only — a blocked/full store must not break a screen.
  }
}

/**
 * Seed defaults for the app's active channels (built-in registry ∪
 * admin DB rows, via the channels service's own cache). For screens
 * that show a single channel and don't otherwise load the panel.
 */
export async function ensureDefaultFollowsSeeded(): Promise<void> {
  const channels = await fetchActiveChannels().catch(() => [] as AppChannel[]);
  await ensureDefaultFollows(channels);
}

/** The subset of the given channel ids currently followed on this device. */
export async function readFollowedChannelIds(channelIds: string[]): Promise<Set<string>> {
  const followed = new Set<string>();
  if (channelIds.length === 0) return followed;
  try {
    const entries = await AsyncStorage.multiGet(channelIds.map(channelFollowKey));
    for (const [key, value] of entries) {
      if (value === '1') followed.add(key.slice('channel-follow:'.length));
    }
  } catch {
    // Unreadable store: report "follows nothing" rather than crash;
    // the caller's empty state stays honest.
  }
  return followed;
}
