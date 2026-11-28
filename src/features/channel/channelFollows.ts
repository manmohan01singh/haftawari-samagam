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
 * Default seeding REMOVED (fix round 6, #18 — the user's own
 * "fix everything" order, 28 Nov 2026, after Chat 2 flagged it
 * twice): a fresh guest who never tapped anything was told they
 * already "Follow" every sangat channel, which is not honest.
 * Channels now start UNFOLLOWED; only a real tap follows.
 *
 * This function is now the one-time CLEANUP for devices the old
 * seeding already touched: every channel id in the seeded record
 * whose follow key still holds the seeded '1' is reset to
 * never-followed (key removed). An explicit unfollow ('0') is
 * untouched, and the cleanup runs once (DONE flag) — a follow the
 * user taps afterwards is theirs and stays.
 */
const UNSOW_DONE_KEY = 'hs.removedDefaultFollows.v1';

export async function ensureDefaultFollows(_channels: AppChannel[]): Promise<void> {
  try {
    if (await AsyncStorage.getItem(UNSOW_DONE_KEY)) return;
    const seeded = await readSeededIds();
    if (seeded.length > 0) {
      const entries = await AsyncStorage.multiGet(seeded.map(channelFollowKey));
      const toClear = entries.filter(([, v]) => v === '1').map(([k]) => k);
      if (toClear.length > 0) await AsyncStorage.multiRemove(toClear);
    }
    await AsyncStorage.setItem(UNSOW_DONE_KEY, '1');
  } catch {
    // Best-effort only — a blocked/full store must not break a screen.
  }
}

/**
 * Runs the default-follow cleanup for the app's active channels
 * (kept under its historical name — the screens that call it just
 * need follow state settled before they read it).
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
