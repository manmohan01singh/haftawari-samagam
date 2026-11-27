import 'react-native-gesture-handler';
import React, { useEffect, useRef } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { RootNavigator } from './src/navigation';
import { appLinking } from './src/navigation/linking';
import { AuthProvider, useAuth } from './src/features/auth';
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
 * Haftawari Samagam.
 * Phase 2: real auth session (Supabase), home feed from the published
 * catalogue, watch screen with the official YouTube embed, search and
 * the official channel — all real data, honest empty states.
 * On web, the offline-shell service worker is registered (production
 * only; the .web variant of registerServiceWorker does the work).
 */
export default function App() {
  useEffect(() => {
    registerServiceWorker();
  }, []);

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <SplashGate />
        <NavigationContainer linking={appLinking}>
          <AppErrorBoundary>
            <RootNavigator />
          </AppErrorBoundary>
          <StatusBar style="auto" />
        </NavigationContainer>
        <PwaBanners />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
