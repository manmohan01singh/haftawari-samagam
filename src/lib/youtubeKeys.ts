/**
 * YouTube Data API key pool.
 *
 * The app can ship with several API keys (EXPO_PUBLIC_YOUTUBE_API_KEYS,
 * comma-separated; falls back to the single EXPO_PUBLIC_YOUTUBE_API_KEY).
 * YouTube grants quota per Google Cloud PROJECT, so each key only adds
 * capacity when it comes from its own project — five keys in one project
 * share one quota.
 *
 * When a key's daily quota is exhausted (quotaExceeded), the pool marks
 * it dead and callers move on to the next key, so the app keeps working
 * instead of dying until the daily reset (~13:30 IST). A dead key is
 * probed again after an hour (a failed probe costs no quota).
 */

const DEAD_KEY_RETRY_MS = 60 * 60 * 1000;

let cachedKeys: string[] | null = null;

export function getYouTubeApiKeys(): string[] {
  if (cachedKeys) return cachedKeys;
  const rawMulti: string = String(process.env.EXPO_PUBLIC_YOUTUBE_API_KEYS ?? '');
  const multi: string[] = rawMulti
    .split(',')
    .map((k: string) => k.trim())
    .filter(Boolean);
  const single: string = String(process.env.EXPO_PUBLIC_YOUTUBE_API_KEY ?? '').trim();
  const keys: string[] = multi.length > 0 ? multi : single ? [single] : [];
  cachedKeys = [...new Set<string>(keys)];
  return cachedKeys;
}

const deadAt = new Map<string, number>();
let currentKey: string | null = null;

/** Keys in try-order: the last working key first, dead keys skipped. */
export function orderedYouTubeApiKeys(): string[] {
  const keys = getYouTubeApiKeys();
  const now = Date.now();
  const alive = keys.filter((k) => {
    const at = deadAt.get(k);
    return at === undefined || now - at > DEAD_KEY_RETRY_MS;
  });
  const pool = alive.length > 0 ? alive : keys;
  if (currentKey && pool.includes(currentKey)) {
    return [currentKey, ...pool.filter((k) => k !== currentKey)];
  }
  return pool;
}

export function noteYouTubeKeyWorked(key: string): void {
  currentKey = key;
  deadAt.delete(key);
}

export function noteYouTubeKeyQuotaDead(key: string): void {
  deadAt.set(key, Date.now());
  if (currentKey === key) currentKey = null;
}
