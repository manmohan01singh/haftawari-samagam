import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabase } from '../../lib/supabase';
import type { Profile } from '../../types/database';

/**
 * Auth state for the whole app: the Supabase session plus the caller's
 * `profiles` row (auto-created by the on_auth_user_created trigger).
 * `isAdmin` comes from profiles.role — the same value RLS checks — and
 * only gates UI/routes; RLS remains the real enforcement.
 */
export interface AuthState {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  isAdmin: boolean;
  /** True until the first session lookup completes. */
  loading: boolean;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  session: null,
  user: null,
  profile: null,
  isAdmin: false,
  loading: true,
  signOut: async () => undefined,
  refreshProfile: async () => undefined,
});

export function useAuth(): AuthState {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  // When Supabase is not configured there is no session to look up, so
  // loading starts false and the effect below stays out of the way.
  const [loading, setLoading] = useState(isSupabaseConfigured);
  const profileForUser = useRef<string | null>(null);

  const loadProfile = useCallback(async (userId: string) => {
    if (!supabase) return;
    const { data } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
    // Ignore stale responses if the signed-in user changed meanwhile.
    if (profileForUser.current === userId) {
      setProfile((data as Profile | null) ?? null);
    }
  }, []);

  useEffect(() => {
    if (!supabase || !isSupabaseConfigured) {
      return;
    }
    let active = true;
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!active) return;
        setSession(data.session);
        profileForUser.current = data.session?.user.id ?? null;
        if (data.session?.user.id) void loadProfile(data.session.user.id);
        setLoading(false);
      })
      .catch(() => {
        if (active) setLoading(false);
      });
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!active) return;
      setSession(next);
      profileForUser.current = next?.user.id ?? null;
      if (next?.user.id) {
        void loadProfile(next.user.id);
      } else {
        setProfile(null);
      }
    });
    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, [loadProfile]);

  const signOut = useCallback(async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    setProfile(null);
  }, []);

  const refreshProfile = useCallback(async () => {
    if (session?.user.id) await loadProfile(session.user.id);
  }, [loadProfile, session]);

  const value = useMemo<AuthState>(
    () => ({
      session,
      user: session?.user ?? null,
      profile,
      isAdmin: profile?.role === 'admin',
      loading,
      signOut,
      refreshProfile,
    }),
    [session, profile, loading, signOut, refreshProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
