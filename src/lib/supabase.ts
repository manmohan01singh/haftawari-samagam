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

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(supabaseUrl as string, supabaseAnonKey as string, {
      auth: {
        storage: AsyncStorage,
        autoRefreshToken: true,
        persistSession: true,
        // URL-based session detection only applies on web auth redirects;
        // harmless on native, required for the PWA.
        detectSessionInUrl: true,
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
