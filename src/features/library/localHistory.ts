/**
 * Device-local watch history for signed-out users (QA issue 78).
 *
 * Signed-in history lives in Supabase `watch_history` (owner-only via
 * RLS) and is untouched by this module. But a signed-out user who
 * watched recordings and then opened History met a bare "Sign in to
 * see your history" — the app had in fact remembered nothing at all.
 * This store keeps the last 50 opened recordings ON THIS DEVICE ONLY
 * (AsyncStorage; on web, localStorage under the app origin), so the
 * History screen and the Library shelf can honestly show "history on
 * this device" with a clear sign-in prompt beside it. Nothing here is
 * uploaded anywhere, and entries are snapshots of what was opened
 * (title/thumbnail as shown at the time) — real local data, never
 * fabricated rows.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'hs.localHistory.v1';
const MAX_ENTRIES = 50;

export interface LocalHistoryEntry {
  youtubeVideoId: string;
  /** Supabase catalogue row id when the recording is an archive row. */
  videoRowId: string | null;
  title: string;
  thumbnailUrl: string | null;
  durationSeconds: number | null;
  watchedAt: string; // ISO 8601
}

async function readAll(): Promise<LocalHistoryEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as LocalHistoryEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeAll(entries: LocalHistoryEntry[]): Promise<boolean> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    return true;
  } catch {
    // Storage full/blocked: local history is best-effort, never a crash.
    // Report failure so destructive callers (remove / clear) can roll
    // back their optimistic UI instead of pretending it worked.
    return false;
  }
}

/** Record (or move to the front) an opened recording. Fire-and-forget safe. */
export async function recordLocalWatch(entry: Omit<LocalHistoryEntry, 'watchedAt'>): Promise<void> {
  const stamped: LocalHistoryEntry = { ...entry, watchedAt: new Date().toISOString() };
  const entries = await readAll();
  const next = [
    stamped,
    ...entries.filter((e) => e.youtubeVideoId !== entry.youtubeVideoId),
  ].slice(0, MAX_ENTRIES);
  // Merge against a FRESH re-read just before writing: with the app
  // open in two tabs, a blind overwrite dropped whatever the other
  // tab recorded in between (seen live as history entries flickering
  // between visits). Entries that appeared meanwhile are kept;
  // youtubeVideoId is the key and the newest watchedAt wins.
  const fresh = await readAll();
  const byId = new Map<string, LocalHistoryEntry>();
  for (const e of [...next, ...fresh]) {
    const prev = byId.get(e.youtubeVideoId);
    if (!prev || e.watchedAt > prev.watchedAt) byId.set(e.youtubeVideoId, e);
  }
  const merged = [...byId.values()]
    .sort((a, b) => (a.watchedAt < b.watchedAt ? 1 : -1))
    .slice(0, MAX_ENTRIES);
  await writeAll(merged);
}

export async function fetchLocalHistory(): Promise<LocalHistoryEntry[]> {
  return readAll();
}

/** Resolves true when the removal was actually persisted. */
export async function removeLocalHistoryEntry(youtubeVideoId: string): Promise<boolean> {
  const entries = await readAll();
  return writeAll(entries.filter((e) => e.youtubeVideoId !== youtubeVideoId));
}

/** Resolves true when the clear was actually persisted. */
export async function clearLocalHistory(): Promise<boolean> {
  return writeAll([]);
}

/** Hook form for screens: reload() refetches from storage (call on focus). */
export function useLocalHistory(): {
  entries: LocalHistoryEntry[];
  loading: boolean;
  refreshing: boolean;
  reload: () => void;
  refresh: () => void;
  setEntries: (next: LocalHistoryEntry[]) => void;
} {
  const [entries, setEntries] = useState<LocalHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const reload = useCallback(() => {
    void readAll()
      .then(setEntries)
      .finally(() => setLoading(false));
  }, []);

  const refresh = useCallback(() => {
    setRefreshing(true);
    void readAll()
      .then(setEntries)
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  }, []);

  useEffect(() => {
    const t = setTimeout(reload, 0);
    return () => clearTimeout(t);
  }, [reload]);

  return { entries, loading, refreshing, reload, refresh, setEntries };
}
