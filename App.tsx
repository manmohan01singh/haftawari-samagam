import 'react-native-gesture-handler';
import React, { useEffect, useMemo, useRef } from 'react';
import {
  DarkTheme,
  DefaultTheme,
  NavigationContainer,
  type Theme as NavigationTheme,
} from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { RootNavigator } from './src/navigation';
import { appLinking } from './src/navigation/linking';
import { AuthProvider, useAuth } from './src/features/auth';
import { ThemeProvider, useTheme } from './src/theme';
import { registerServiceWorker } from './src/lib/registerServiceWorker';
import { PwaBanners } from './src/components/pwa/PwaBanners';
import { AppErrorBoundary } from './src/components/common/AppErrorBoundary';

// Phase 9 (forensic audit §11.1): a real native splash. Hold the
// OS splash (assets/splash-icon.png on white, configured via the
// expo-splash-screen plugin in app.json) until the auth session has
// resolved, then fade it out. Every call is guarded: on web the
// module is a no-op/stub and must never throw into app startup —
// the PWA keeps its own static splash shell in public/index.html.
try {
  SplashScreen.preventAutoHideAsync().catch(() => undefined);
} catch {
  // Splash control unavailable (web) — startup continues regardless.
}
try {
  SplashScreen.setOptions({ duration: 200, fade: true });
} catch {
  // Same guard as above.
}

/**
 * Lives inside AuthProvider: hides the splash as soon as auth
 * loading resolves, with a 3.5s safety timeout so a slow or stuck
 * session check can never hold the splash forever.
 */
function SplashGate() {
  const { loading } = useAuth();
  const hiddenRef = useRef(false);

  useEffect(() => {
    const hide = () => {
      if (hiddenRef.current) return;
      hiddenRef.current = true;
      try {
        SplashScreen.hideAsync().catch(() => undefined);
      } catch {
        // Web / unavailable — nothing to hide.
      }
    };
    if (!loading) {
      hide();
      return undefined;
    }
    const timer = setTimeout(hide, 3500);
    return () => clearTimeout(timer);
  }, [loading]);

  return null;
}

/**
 * Phase 12: the navigation shell, themed. React Navigation gets a
 * theme built from the SAME tokens the screens use (background,
 * surface-as-card, text, border), so navigator-owned surfaces —
 * screen backgrounds during transitions, stack cards — match the
 * resolved palette instead of flashing the framework defaults. The
 * status bar style follows the resolved theme too ('light' = light
 * content on dark backgrounds).
 */
function ThemedNavigation() {
  const { colors, isDark } = useTheme();

  const navigationTheme = useMemo<NavigationTheme>(() => {
    const base = isDark ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        primary: colors.accent,
        background: colors.background,
        card: colors.surface,
        text: colors.text,
        border: colors.border,
        notification: colors.accent,
      },
    };
  }, [colors, isDark]);

  return (
    <NavigationContainer linking={appLinking} theme={navigationTheme}>
      <AppErrorBoundary>
        <RootNavigator />
      </AppErrorBoundary>
      <StatusBar style={isDark ? 'light' : 'dark'} />
    </NavigationContainer>
  );
}

/**
 * Haftawari Samagam.
 * Phase 2: real auth session (Supabase), home feed from the published
 * catalogue, watch screen with the official YouTube embed, search and
 * the official channel — all real data, honest empty states.
 * On web, the offline-shell service worker is registered (production
 * only; the .web variant of registerServiceWorker does the work).
 * Phase 12: ThemeProvider wraps the whole tree — every screen reads
 * its palette from useTheme() (System / Light / Dark, persisted).
 */
export default function App() {
  useEffect(() => {
    registerServiceWorker();
  }, []);

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AuthProvider>
          <SplashGate />
          <ThemedNavigation />
          <PwaBanners />
        </AuthProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
