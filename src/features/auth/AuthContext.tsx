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
import { authCallbackInfo, isSupabaseConfigured, supabase } from '../../lib/supabase';
import { authLinkErrorMessage } from './authHelpers';
import {
  extractMetadataProfile,
  mergeProfileWithMetadata,
  syncProfileFromMetadata,
} from './profileSync';
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
  /**
   * Human message when the user landed back from an email link that
   * FAILED (expired / already used), or null. Without this the app
   * silently showed a signed-out screen and the tap looked broken.
   */
  linkError: string | null;
  /**
   * True when the current session arrived via a password-recovery
   * email link. RootNavigator gates the app on the set-new-password
   * form while this is set.
   */
  passwordRecovery: boolean;
  clearPasswordRecovery: () => void;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  session: null,
  user: null,
  profile: null,
  isAdmin: false,
  loading: true,
  linkError: null,
  passwordRecovery: false,
  clearPasswordRecovery: () => undefined,
  signOut: async () => undefined,
  refreshProfile: async () => undefined,
});

/**
 * Remove auth-callback leftovers (tokens, codes, link errors) from
 * the address bar once the session has been picked up, so a reload
 * does not re-present spent credentials and the tokens do not linger
 * in history. supabase-js already clears the hash on an implicit
 * success; this covers error landings and any residue. Only auth
 * params are removed — the app path and unrelated params stay.
 */
function cleanAuthParamsFromUrl(): void {
  if (typeof window === 'undefined' || !window.history?.replaceState) return;
  try {
    const url = new URL(window.location.href);
    const authKeys = [
      'access_token',
      'refresh_token',
      'expires_in',
      'expires_at',
      'token_type',
      'type',
      'code',
      'error',
      'error_code',
      'error_description',
    ];
    let changed = false;
    const hashParams = new URLSearchParams(url.hash.replace(/^#/, ''));
    for (const key of authKeys) {
      if (hashParams.has(key)) {
        hashParams.delete(key);
        changed = true;
      }
      if (url.searchParams.has(key)) {
        url.searchParams.delete(key);
        changed = true;
      }
    }
    if (!changed) return;
    const rest = hashParams.toString();
    url.hash = rest ? `#${rest}` : '';
    window.history.replaceState(window.history.state, '', url.toString());
  } catch {
    // URL hygiene only — never break the app over it.
  }
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  // When Supabase is not configured there is no session to look up, so
  // loading starts false and the effect below stays out of the way.
  const [loading, setLoading] = useState(isSupabaseConfigured);
  // Seeded from the URL snapshot (module load, before supabase-js
  // consumed the params): a recovery landing sets the flag even if
  // the PASSWORD_RECOVERY event fired before this provider mounted.
  const [passwordRecovery, setPasswordRecovery] = useState(
    () => authCallbackInfo.type === 'recovery',
  );
  const [linkError, setLinkError] = useState<string | null>(() =>
    authLinkErrorMessage(
      authCallbackInfo.error,
      authCallbackInfo.errorCode,
      authCallbackInfo.errorDescription,
    ),
  );
  const profileForUser = useRef<string | null>(null);

  const clearPasswordRecovery = useCallback(() => setPasswordRecovery(false), []);

  const loadProfile = useCallback(async (user: User) => {
    if (!supabase) return;
    // Retry on failure: this fetch previously read only `data` and
    // ignored `error`, so one transient failure (network blip, cold
    // backend) silently set profile=null — and with it isAdmin=false:
    // the Library "Admin dashboard" entry vanished and the Admin
    // route was never registered, with nothing ever retrying. Now a
    // failed fetch retries with backoff, and a failure NEVER clobbers
    // an already-loaded profile with null.
    const delaysMs = [0, 600, 1800];
    for (let attempt = 0; attempt < delaysMs.length; attempt += 1) {
      if (delaysMs[attempt] > 0) {
        await new Promise((resolve) => setTimeout(resolve, delaysMs[attempt]));
      }
      // Abandon retries if the signed-in user changed meanwhile.
      if (profileForUser.current !== user.id) return;
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();
      if (error) continue;
      // Ignore stale responses if the signed-in user changed meanwhile.
      if (profileForUser.current !== user.id) return;
      const row = (data as Profile | null) ?? null;
      // Expose the metadata-merged row immediately: a Google user's DP
      // shows even before the sync write lands — and even before
      // migration 0004 adds the avatar_url column (see profileSync).
      setProfile(mergeProfileWithMetadata(row, extractMetadataProfile(user)));
      // Persist the metadata name/photo onto the row (no-op when the
      // metadata carries neither, e.g. a plain email account). The
      // guard is re-checked so a sign-out mid-sync cannot resurrect a
      // stale profile.
      const synced = await syncProfileFromMetadata(user, row);
      if (profileForUser.current === user.id && synced) {
        setProfile(synced);
      }
      return;
    }
    // All attempts failed: keep whatever profile is already loaded
    // (possibly null on a first-ever sign-in). The next auth event or
    // an explicit refreshProfile() call re-runs this fetch.
  }, []);

  useEffect(() => {
    if (!supabase || !isSupabaseConfigured) {
      return;
    }
    let active = true;
    // Subscribe FIRST, then getSession: an email-link landing makes
    // supabase-js emit SIGNED_IN / PASSWORD_RECOVERY as soon as its
    // initialize finishes, and subscribing after awaiting getSession
    // could miss the event (getSession still returns the session, so
    // sign-in itself survived — but the recovery gate did not exist
    // at all before, and the event is its primary trigger).
    const { data: subscription } = supabase.auth.onAuthStateChange((event, next) => {
      // A successful sign-in retires any stale landing link error
      // (audit P2, 28 Nov 2026): it used to resurface for the rest
      // of the page session, telling a happily signed-in user their
      // email link had expired.
      if (event === 'SIGNED_IN') setLinkError(null);
      if (!active) return;
      if (event === 'PASSWORD_RECOVERY') {
        setPasswordRecovery(true);
      }
      setSession(next);
      profileForUser.current = next?.user.id ?? null;
      if (next?.user) {
        void loadProfile(next.user);
      } else {
        setProfile(null);
      }
      setLoading(false);
      if (next) cleanAuthParamsFromUrl();
    });
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!active) return;
        setSession(data.session);
        profileForUser.current = data.session?.user.id ?? null;
        if (data.session?.user) void loadProfile(data.session.user);
        setLoading(false);
        if (data.session) cleanAuthParamsFromUrl();
      })
      .catch(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, [loadProfile]);

  const signOut = useCallback(async () => {
    if (!supabase) return;
    try {
      await supabase.auth.signOut();
    } catch {
      // A missing/already-expired session makes signOut throw; the
      // user asked to be signed out, so local state is cleared either
      // way instead of surfacing a stuck "signed in" UI.
    } finally {
      setSession(null);
      setProfile(null);
      profileForUser.current = null;
    }
  }, []);

  const refreshProfile = useCallback(async () => {
    if (session?.user) await loadProfile(session.user);
  }, [loadProfile, session]);

  const value = useMemo<AuthState>(
    () => ({
      session,
      user: session?.user ?? null,
      profile,
      isAdmin: profile?.role === 'admin',
      loading,
      linkError,
      passwordRecovery,
      clearPasswordRecovery,
      signOut,
      refreshProfile,
    }),
    [session, profile, loading, linkError, passwordRecovery, clearPasswordRecovery, signOut, refreshProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
