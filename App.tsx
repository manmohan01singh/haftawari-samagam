import 'react-native-gesture-handler';
import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { RootNavigator } from './src/navigation';

/**
 * Haftawari Samagam — Phase 1 scaffold.
 * Navigation shell + honest empty-state screens. Real data arrives via
 * Supabase once the project is configured (see .env.example and
 * docs/ARCHITECTURE.md). No placeholder content is shown anywhere.
 */
export default function App() {
  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <RootNavigator />
        <StatusBar style="auto" />
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
