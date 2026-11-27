/**
 * React hooks over libraryService. Each list hook exposes:
 *  - data / loading (first load) / refreshing (pull-to-refresh) / error
 *  - reload()  — full refetch (used on focus and by retry buttons)
 *  - refresh() — refetch with the RefreshControl spinner state
 *  - setData() — for optimistic updates after a mutation succeeds
 *
 * When Supabase is not configured, hooks settle immediately with empty
 * data so screens render their honest "not configured" state.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabase } from '../../lib/supabase';
import {
  fetchHistory,
  fetchPlaylistDetail,
  fetchPlaylistSummaries,
  fetchSavedItems,
} from './libraryService';
import type { HistoryItem, PlaylistDetail, PlaylistSummary, SavedItem } from './types';

/** The signed-in Supabase user (or null), kept in sync with auth state. */
export function useCurrentUser(): { user: User | null; loading: boolean } {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(isSupabaseConfigured);

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setUser(data.session?.user ?? null);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      setUser(session?.user ?? null);
      setLoading(false);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return { user, loading };
}

/**
 * NOTE: there is deliberately no useProfile hook here any more.
 * The profile has ONE source of truth — AuthContext (useAuth) —
 * after the Library header kept a private one-shot copy that went
 * stale when Edit Profile saved a new name (Account showed the new
 * name, the You header kept the old one). Screens must read
 * `profile` from useAuth(), never fetch their own copy.
 */

interface ListResource<T> {
  data: T[];
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  reload: () => void;
  refresh: () => void;
  setData: (next: T[]) => void;
}

function useListResource<T>(fetcher: (() => Promise<T[]>) | null, depsKey: string): ListResource<T> {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(Boolean(fetcher));
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetcherRef = useRef(fetcher);
  // Keep the ref current from an effect (refs are not written in render).
  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  const run = useCallback((mode: 'load' | 'refresh') => {
    const fn = fetcherRef.current;
    if (!fn) {
      setData([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }
    if (mode === 'refresh') setRefreshing(true);
    else setLoading(true);
    fn()
      .then((rows) => {
        setData(rows);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Something went wrong.'))
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  }, []);

  useEffect(() => {
    // Deferred one tick so the load's setState calls land in a timer
    // callback, not synchronously in the effect (react-hooks rule; the
    // same pattern the Phase 2 screens use).
    const t = setTimeout(() => run('load'), 0);
    return () => clearTimeout(t);
  }, [depsKey, run]);

  const reload = useCallback(() => run('load'), [run]);
  const refresh = useCallback(() => run('refresh'), [run]);
  const update = useCallback((next: T[]) => setData(next), []);

  return { data, loading, refreshing, error, reload, refresh, setData: update };
}

export function useHistory(userId: string | null): ListResource<HistoryItem> {
  return useListResource(
    userId && isSupabaseConfigured ? () => fetchHistory(userId) : null,
    `history:${userId ?? 'none'}`,
  );
}

export function useSavedItems(userId: string | null): ListResource<SavedItem> {
  return useListResource(
    userId && isSupabaseConfigured ? () => fetchSavedItems(userId) : null,
    `saved:${userId ?? 'none'}`,
  );
}

export function usePlaylistSummaries(userId: string | null): ListResource<PlaylistSummary> {
  return useListResource(
    isSupabaseConfigured ? () => fetchPlaylistSummaries(userId) : null,
    `playlists:${userId ?? 'none'}`,
  );
}

export function usePlaylistDetail(playlistId: string | null): {
  detail: PlaylistDetail | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  notFound: boolean;
  reload: () => void;
  refresh: () => void;
  setDetail: (next: PlaylistDetail | null) => void;
} {
  const [detail, setDetail] = useState<PlaylistDetail | null>(null);
  const [loading, setLoading] = useState(Boolean(playlistId && isSupabaseConfigured));
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  const run = useCallback(
    (mode: 'load' | 'refresh') => {
      if (!playlistId || !isSupabaseConfigured) {
        setLoading(false);
        setRefreshing(false);
        return;
      }
      if (mode === 'refresh') setRefreshing(true);
      else setLoading(true);
      fetchPlaylistDetail(playlistId)
        .then((d) => {
          setDetail(d);
          setNotFound(d === null);
          setError(null);
        })
        .catch((e) => setError(e instanceof Error ? e.message : 'Something went wrong.'))
        .finally(() => {
          setLoading(false);
          setRefreshing(false);
        });
    },
    [playlistId],
  );

  useEffect(() => {
    const t = setTimeout(() => run('load'), 0);
    return () => clearTimeout(t);
  }, [run]);

  return {
    detail,
    loading,
    refreshing,
    error,
    notFound,
    reload: useCallback(() => run('load'), [run]),
    refresh: useCallback(() => run('refresh'), [run]),
    setDetail,
  };
}
