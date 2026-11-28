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
import type { Profile } from '../../types/database';
import {
  fetchHistory,
  fetchPlaylistDetail,
  fetchPlaylistSummaries,
  fetchProfile,
  fetchLikedItems,
  fetchSavedItems,
} from './libraryService';
import type { HistoryItem, LikedItem, PlaylistDetail, PlaylistSummary, SavedItem } from './types';

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

/** The signed-in user's profile row (display name, role), or null. */
export function useProfile(userId: string | null): { profile: Profile | null; reload: () => void } {
  const [profile, setProfile] = useState<Profile | null>(null);
  const reload = useCallback(() => {
    if (!userId || !isSupabaseConfigured) return;
    fetchProfile(userId)
      .then(setProfile)
      .catch(() => setProfile(null));
  }, [userId]);
  useEffect(reload, [reload]);
  // Never leak a previous user's profile after sign-out / account switch.
  return { profile: userId ? profile : null, reload };
}

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

export function useLikedItems(userId: string | null): ListResource<LikedItem> {
  return useListResource(
    userId && isSupabaseConfigured ? () => fetchLikedItems(userId) : null,
    `liked:${userId ?? 'none'}`,
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
