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

export interface SearchHistoryEntry {
  text: string;
  /** Epoch ms when the search was submitted; null for legacy (v1) entries. */
  searchedAt: number | null;
}

/**
 * Recent searches with timestamps, most recent first.
 * Storage is v2 ({ text, searchedAt }) but v1 plain-string entries
 * written by earlier builds still parse (searchedAt = null) — existing
 * users keep their history across the upgrade.
 */
export async function listSearchHistoryEntries(
  userId?: string | null,
): Promise<SearchHistoryEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(storageKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const entries: SearchHistoryEntry[] = [];
    for (const entry of parsed) {
      if (typeof entry === 'string') {
        entries.push({ text: entry, searchedAt: null });
      } else if (
        entry !== null &&
        typeof entry === 'object' &&
        typeof (entry as { text?: unknown }).text === 'string'
      ) {
        const ts = (entry as { searchedAt?: unknown }).searchedAt;
        entries.push({
          text: (entry as { text: string }).text,
          searchedAt: typeof ts === 'number' ? ts : null,
        });
      }
    }
    return entries;
  } catch {
    return [];
  }
}

/** Recent searches, most recent first. [] when none / on read failure. */
export async function listSearchHistory(userId?: string | null): Promise<string[]> {
  return (await listSearchHistoryEntries(userId)).map((entry) => entry.text);
}

async function writeEntries(userId: string | null | undefined, entries: SearchHistoryEntry[]): Promise<void> {
  try {
    await AsyncStorage.setItem(storageKey(userId), JSON.stringify(entries.slice(0, MAX_ENTRIES)));
  } catch {
    // Best-effort: history must never break a search.
  }
}

/** Record a submitted search (moves an existing entry to the front). */
export async function addSearchHistory(text: string, userId?: string | null): Promise<string[]> {
  const entry = normalizeEntry(text);
  if (entry === '') return listSearchHistory(userId);
  const existing = await listSearchHistoryEntries(userId);
  const next: SearchHistoryEntry[] = [
    { text: entry, searchedAt: Date.now() },
    ...existing.filter((item) => item.text.toLowerCase() !== entry.toLowerCase()),
  ].slice(0, MAX_ENTRIES);
  await writeEntries(userId, next);
  return next.map((item) => item.text);
}

/** Remove one entry (exact text, case-insensitive). */
export async function removeSearchHistory(text: string, userId?: string | null): Promise<string[]> {
  const target = normalizeEntry(text).toLowerCase();
  const next = (await listSearchHistoryEntries(userId)).filter(
    (item) => item.text.toLowerCase() !== target,
  );
  await writeEntries(userId, next);
  return next.map((item) => item.text);
}

/** Clear the whole list ("Clear history" in the UI). */
export async function clearSearchHistory(userId?: string | null): Promise<void> {
  try {
    await AsyncStorage.removeItem(storageKey(userId));
  } catch {
    // Best-effort, as above.
  }
}
