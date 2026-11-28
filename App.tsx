import 'react-native-gesture-handler';
import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  DarkTheme,
  DefaultTheme,
  NavigationContainer,
  type NavigationContainerRef,
  type Theme as NavigationTheme,
} from '@react-navigation/native';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import { StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { RootNavigator } from './src/navigation';
import { appLinking } from './src/navigation/linking';
import type { RootStackParamList } from './src/navigation/types';
import { AuthProvider, useAuth } from './src/features/auth';
import { ThemeProvider, useTheme } from './src/theme';
import { registerServiceWorker } from './src/lib/registerServiceWorker';
import { PwaBanners } from './src/components/pwa/PwaBanners';
import { AppErrorBoundary } from './src/components/common/AppErrorBoundary';
import { PlaybackHost } from './src/components/video/PlaybackHost';
import { OrbBackground } from './src/components/layout/OrbBackground';
import { usePlaybackStore } from './src/features/playback/playbackStore';

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
/**
 * The red gradient orb (user, 28 Nov 2026): a soft red light from
 * the top-left corner that sits ON TOP of everything — header,
 * chips, every bar — like light falling over the app, never tucked
 * under a bar where it looks cheap. It is a root-level overlay
 * (pointer-events none, above the navigator) and hides ONLY on the
 * player surfaces (Watch, SessionWatch, Shorts), where the video
 * owns the screen. Route name comes from the playback store, which
 * App's container callbacks already keep current.
 */
const ORB_HIDDEN_ROUTES = new Set(['Watch', 'SessionWatch', 'Shorts']);

function OrbOverlay() {
  const routeName = usePlaybackStore((state) => state.routeName);
  if (routeName !== null && ORB_HIDDEN_ROUTES.has(routeName)) return null;
  return (
    <View pointerEvents="none" style={orbOverlayStyles.wrap}>
      <OrbBackground />
    </View>
  );
}

const orbOverlayStyles = StyleSheet.create({
  wrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 999 },
});

function ThemedNavigation() {
  const { colors, isDark } = useTheme();
  // Phase E: the persistent player host lives at the root and needs
  // (a) a navigation handle to re-open the Watch screen from the
  // mini bar, and (b) the current route name so the bar can hide on
  // the session/admin surfaces. Both flow through this ref + the
  // container's state-change callback into the playback store.
  const navigationRef = useRef<NavigationContainerRef<RootStackParamList> | null>(null);

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

  // The persistent player host needs the current route name, and
  // onStateChange does NOT fire for the initial state — on a fresh
  // deep link (or a refresh) straight onto a Watch page, routeName
  // stayed null forever, so the host parked the player off-screen
  // and the Watch slot spun forever (mobile sweep round 6
  // verification, 28 Nov 2026: fresh /watch deep link showed a
  // permanent spinner while the gate UI sat parked in the DOM).
  // onReady covers the initial route; onStateChange covers every
  // navigation after it.
  const syncRouteName = useCallback(() => {
    const name = navigationRef.current?.getCurrentRoute()?.name ?? null;
    usePlaybackStore.getState().setRouteName(name);
  }, []);

  return (
    <NavigationContainer
      ref={navigationRef}
      linking={appLinking}
      theme={navigationTheme}
      onReady={syncRouteName}
      onStateChange={syncRouteName}
    >
      <AppErrorBoundary>
        <RootNavigator />
      </AppErrorBoundary>
      <PlaybackHost navigationRef={navigationRef} />
      <OrbOverlay />
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

  // Langar (hand-lettered Gurmukhi display face) for the Ik Onkar
  // mark. Fire-and-forget: the mark falls back to the platform
  // Gurmukhi face until the font arrives, and on web the @font-face
  // in public/index.html usually wins the race anyway.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const Font = await import('expo-font');
        if (!cancelled) {
          await Font.loadAsync({
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            Langar: require('./assets/fonts/Langar-Regular.ttf'),
          });
        }
      } catch {
        // Font unavailable (older build) — fallback face applies.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
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
