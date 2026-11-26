import 'react-native-gesture-handler';
import React, { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { RootNavigator } from './src/navigation';
import { AuthProvider } from './src/features/auth';
import { registerServiceWorker } from './src/lib/registerServiceWorker';

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
        <NavigationContainer>
          <RootNavigator />
          <StatusBar style="auto" />
        </NavigationContainer>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
