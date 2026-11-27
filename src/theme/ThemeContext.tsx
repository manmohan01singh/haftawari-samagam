/**
 * Appearance / theme system (Phase 12, user order 27 Nov 2026).
 *
 * Until now the app imported `lightColors` statically in ~63 files
 * and baked it into module-level StyleSheets, so the `darkColors`
 * tokens in tokens.ts were dead code. This provider is the single
 * source of truth for the resolved palette:
 *
 * - preference: 'system' | 'light' | 'dark', persisted in
 *   AsyncStorage (hs.appearance.theme.v1); 'system' follows the OS
 *   via useColorScheme and is the default.
 *
 * Components read `const { colors } = useTheme()` and build their
 * color-bearing styles from a `createStyles(colors)` factory
 * (memoized on colors). Light mode resolves to the exact same
 * lightColors values as before — pixel-identical by construction.
 *
 * The context has a light default value so a component rendered
 * outside the provider (tests, error boundary edge cases) still
 * renders the pre-Phase-12 look instead of crashing.
 *
 * Phase 13: the Phase 12 "Blur effects" switch is GONE on the
 * user's order — the glass blur on the bars is unconditional, so
 * there is no blur preference to store or read any more. (The old
 * hs.appearance.blur.v1 key is simply never read again; a value a
 * user stored during Phase 12 is inert.)
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useColorScheme } from 'react-native';

import { darkColors, lightColors, type ThemeColors } from './tokens';

export type ThemePreference = 'system' | 'light' | 'dark';

export const THEME_PREFERENCE_KEY = 'hs.appearance.theme.v1';

export interface ThemeContextValue {
  /** The resolved palette for the current preference + OS scheme. */
  colors: ThemeColors;
  /** The stored choice; 'system' means "follow the OS". */
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
  /** True when the resolved palette is the dark one. */
  isDark: boolean;
}

const defaultValue: ThemeContextValue = {
  colors: lightColors,
  preference: 'system',
  setPreference: () => undefined,
  isDark: false,
};

export const ThemeContext = createContext<ThemeContextValue>(defaultValue);

function isThemePreference(value: string | null): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>('system');

  // Load the persisted theme choice once. Until this resolves the
  // provider renders with the default (system), which matches a
  // fresh install exactly.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const storedTheme = await AsyncStorage.getItem(THEME_PREFERENCE_KEY);
        if (cancelled) return;
        if (isThemePreference(storedTheme)) setPreferenceState(storedTheme);
      } catch {
        // Storage unavailable (web private mode etc.) — keep defaults.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    AsyncStorage.setItem(THEME_PREFERENCE_KEY, next).catch(() => undefined);
  }, []);

  const isDark =
    preference === 'dark' ||
    (preference === 'system' && systemScheme === 'dark');
  const colors = isDark ? darkColors : lightColors;

  const value = useMemo<ThemeContextValue>(
    () => ({
      colors,
      preference,
      setPreference,
      isDark,
    }),
    [colors, preference, setPreference, isDark],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
