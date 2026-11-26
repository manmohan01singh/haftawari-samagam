/**
 * Per-user recent searches — LOCAL ONLY.
 *
 * There is deliberately no Supabase table for search history (the schema
 * in supabase/migrations/0001_init.sql has none), so searches live in
 * AsyncStorage on the device, most-recent first, capped at 20, de-duped
 * case-insensitively. "Per-user" = per signed-in profile on this device:
 * the storage key carries the user id when known, so two people sharing
 * a phone do not see each other's searches. Nothing is synced anywhere.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY_PREFIX = '@haftawari/search-history:v1:';
const MAX_ENTRIES = 20;

function storageKey(userId?: string | null): string {
  return `${KEY_PREFIX}${userId ?? 'guest'}`;
}

function normalizeEntry(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

/** Recent searches, most recent first. [] when none / on read failure. */
export async function listSearchHistory(userId?: string | null): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(storageKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string => typeof entry === 'string');
  } catch {
    return [];
  }
}

/** Record a submitted search (moves an existing entry to the front). */
export async function addSearchHistory(text: string, userId?: string | null): Promise<string[]> {
  const entry = normalizeEntry(text);
  if (entry === '') return listSearchHistory(userId);
  const existing = await listSearchHistory(userId);
  const next = [
    entry,
    ...existing.filter((item) => item.toLowerCase() !== entry.toLowerCase()),
  ].slice(0, MAX_ENTRIES);
  try {
    await AsyncStorage.setItem(storageKey(userId), JSON.stringify(next));
  } catch {
    // Best-effort: history must never break a search.
  }
  return next;
}

/** Remove one entry (exact text, case-insensitive). */
export async function removeSearchHistory(text: string, userId?: string | null): Promise<string[]> {
  const target = normalizeEntry(text).toLowerCase();
  const next = (await listSearchHistory(userId)).filter(
    (item) => item.toLowerCase() !== target,
  );
  try {
    await AsyncStorage.setItem(storageKey(userId), JSON.stringify(next));
  } catch {
    // Best-effort, as above.
  }
  return next;
}

/** Clear the whole list ("Clear history" in the UI). */
export async function clearSearchHistory(userId?: string | null): Promise<void> {
  try {
    await AsyncStorage.removeItem(storageKey(userId));
  } catch {
    // Best-effort, as above.
  }
}
