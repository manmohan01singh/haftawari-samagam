import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Supabase client — created ONLY from public env vars:
 *   EXPO_PUBLIC_SUPABASE_URL
 *   EXPO_PUBLIC_SUPABASE_ANON_KEY
 * (see .env.example). No URL or key is hard-coded, and no service-role
 * key must ever ship in the app — admin powers are granted by Row Level
 * Security policies checking the caller's profile role (see
 * supabase/migrations/0001_init.sql).
 *
 * If the env vars are absent the app runs in a clearly-signalled
 * "not configured" state: `supabase` is null and `isSupabaseConfigured`
 * is false. Callers must surface the not-configured empty state instead
 * of inventing data.
 */
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

export const isSupabaseConfigured: boolean = Boolean(supabaseUrl && supabaseAnonKey);

/**
 * Snapshot of the auth-callback parameters in the landing URL, taken
 * synchronously at module load — i.e. at client construction, before
 * supabase-js consumes (and clears) them during its own initialize.
 *
 * Email links (confirmation / password recovery) and OAuth returns
 * (Google sign-in) land back on the PWA base URL with the result
 * encoded in the URL:
 *   success: #access_token=…&refresh_token=…&type=signup|recovery
 *   failure: #error=…&error_code=otp_expired&error_description=…
 * supabase-js surfaces a failed callback only as an initialize error
 * that nothing in the app could see, so a user tapping an expired or
 * already-used link landed on a silently signed-out app and concluded
 * "login doesn't work". AuthContext reads this snapshot to explain
 * what happened (linkError) and to route recovery landings to the
 * set-new-password form even if the PASSWORD_RECOVERY event raced.
 */
export interface AuthCallbackInfo {
  /** `type` param of a successful callback: 'signup' | 'recovery' | … */
  type: string | null;
  /** Raw `error` param of a failed callback (e.g. 'access_denied'). */
  error: string | null;
  errorCode: string | null;
  errorDescription: string | null;
}

function snapshotAuthCallback(): AuthCallbackInfo {
  const empty: AuthCallbackInfo = { type: null, error: null, errorCode: null, errorDescription: null };
  if (typeof window === 'undefined' || !window.location) return empty;
  try {
    const params = new URLSearchParams();
    const hash = window.location.hash.replace(/^#/, '');
    for (const [k, v] of new URLSearchParams(hash)) params.set(k, v);
    for (const [k, v] of new URLSearchParams(window.location.search)) {
      if (!params.has(k)) params.set(k, v);
    }
    return {
      type: params.get('type'),
      error: params.get('error'),
      errorCode: params.get('error_code'),
      errorDescription: params.get('error_description'),
    };
  } catch {
    return empty;
  }
}

export const authCallbackInfo: AuthCallbackInfo = snapshotAuthCallback();

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(supabaseUrl as string, supabaseAnonKey as string, {
      auth: {
        storage: AsyncStorage,
        autoRefreshToken: true,
        persistSession: true,
        // URL-based session detection only applies on web auth redirects;
        // harmless on native, required for the PWA.
        detectSessionInUrl: true,
        // Implicit flow, explicitly: email links must work even when
        // the user opens the mail in a DIFFERENT browser/webview than
        // the one that requested it. PKCE would strand the code
        // verifier in the requesting browser's storage and the
        // exchange on landing would fail outright. (This is also the
        // supabase-js default; it is pinned here so a library default
        // change cannot silently break email auth.)
        flowType: 'implicit',
      },
      realtime: {
        params: { eventsPerSecond: 10 },
      },
    })
  : null;

/** Throwing guard for service modules that cannot work unconfigured. */
export function requireSupabase(): SupabaseClient {
  if (!supabase) {
    throw new Error(
      'Supabase is not configured. Set EXPO_PUBLIC_SUPABASE_URL and ' +
        'EXPO_PUBLIC_SUPABASE_ANON_KEY (see .env.example) and restart the app.',
    );
  }
  return supabase;
}
