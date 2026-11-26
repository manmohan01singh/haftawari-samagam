import { useCallback, useEffect, useRef, useState } from 'react';
import { isSupabaseConfigured, supabase } from '../../lib/supabase';
import type { Profile } from '../../types/database';
import { fetchOwnProfile } from './adminService';

/**
 * Admin gate state machine. The dashboard is usable only when ALL of
 * these hold: Supabase is configured, a user is signed in, and that
 * user's `profiles.role` is 'admin'. This hook is a UX gate only —
 * Row Level Security enforces the same rule server-side for every
 * query the admin screens make.
 */
export type AdminGateState =
  | { status: 'loading' }
  | { status: 'unconfigured' }
  | { status: 'signed-out' }
  | { status: 'error'; message: string }
  | { status: 'not-admin'; profile: Profile | null }
  | { status: 'admin'; userId: string; profile: Profile };

/** Resolve the current gate state from the backend (no sync setState). */
async function resolveGateState(): Promise<AdminGateState> {
  if (!isSupabaseConfigured || !supabase) return { status: 'unconfigured' };
  try {
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) throw sessionError;
    const user = sessionData.session?.user;
    if (!user) return { status: 'signed-out' };
    const profile = await fetchOwnProfile(user.id);
    if (profile?.role === 'admin') {
      return { status: 'admin', userId: user.id, profile };
    }
    return { status: 'not-admin', profile };
  } catch (err) {
    return {
      status: 'error',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export function useAdminGate(): { gate: AdminGateState; refresh: () => void } {
  const [gate, setGate] = useState<AdminGateState>({ status: 'loading' });
  const runId = useRef(0);

  const refresh = useCallback(() => {
    const myRun = ++runId.current;
    setGate({ status: 'loading' });
    void (async () => {
      const next = await resolveGateState();
      if (runId.current === myRun) setGate(next);
    })();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const myRun = ++runId.current;
    void (async () => {
      const next = await resolveGateState();
      if (!cancelled && runId.current === myRun) setGate(next);
    })();
    if (!supabase) return () => {
      cancelled = true;
    };
    const { data } = supabase.auth.onAuthStateChange(() => {
      void (async () => {
        const next = await resolveGateState();
        if (!cancelled) setGate(next);
      })();
    });
    return () => {
      cancelled = true;
      data.subscription.unsubscribe();
    };
  }, []);

  return { gate, refresh };
}
