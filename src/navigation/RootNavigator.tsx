import React, { useEffect, useState } from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { MainTabs } from './MainTabs';
import { AdminStack } from './AdminStack';
import { useAuth } from '../features/auth';
import { WatchScreen } from '../screens/watch';
import { SearchScreen, SearchResultsScreen } from '../screens/search';
import { SetNewPasswordScreen, SignInScreen, SignUpScreen } from '../screens/auth';
import { ChannelScreen } from '../screens/channel';
import { PlaylistScreen } from '../screens/playlist';
import { SavedScreen } from '../screens/saved';
import { PlaylistsScreen } from '../screens/playlists';
import { SessionWatchScreen, SessionsListScreen } from '../screens/sessions';
import { HistoryScreen } from '../screens/history';
import { SettingsScreen } from '../screens/settings';
import { AccountScreen, EditProfileScreen } from '../screens/account';
import type { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  const { isAdmin, passwordRecovery, loading, user } = useAuth();

  // "Back to sign in" landing (P10 leftover fix): SetNewPassword's
  // escape signs the recovery session out and clears the gate. This
  // navigator unmounts/remounts when the gate flips, so when it lifts
  // with NO signed-in user after having shown the recovery gate, the
  // main stack must open on SignIn — not MainTabs. (Completing the
  // reset or "Skip for now" keeps a signed-in user, so those exits
  // still land on MainTabs as before.) The flag is consumed once the
  // gate has lifted; initialRouteName is ignored after first mount.
  const [recoveryGateSeen, setRecoveryGateSeen] = useState(false);
  useEffect(() => {
    // Deferred one tick, matching the codebase's pattern for state
    // resets inside effects (see HomeScreen's saved-ids reset).
    if (passwordRecovery && !recoveryGateSeen) {
      const t = setTimeout(() => setRecoveryGateSeen(true), 0);
      return () => clearTimeout(t);
    }
    if (!passwordRecovery && recoveryGateSeen) {
      const t = setTimeout(() => setRecoveryGateSeen(false), 0);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [passwordRecovery, recoveryGateSeen]);
  const startOnSignIn = recoveryGateSeen && !passwordRecovery && !user;

  // Password-recovery gate: a user who landed from a reset email has
  // a live session but came here to SET A NEW PASSWORD — before this
  // gate existed no screen did that, so the reset flow dead-ended.
  // While the flag is set, the set-new-password form is the whole
  // app; it clears the flag on success (or explicit skip).
  if (passwordRecovery && !loading) {
    return (
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="SetNewPassword" component={SetNewPasswordScreen} />
      </Stack.Navigator>
    );
  }

  return (
    <Stack.Navigator
      initialRouteName={startOnSignIn ? 'SignIn' : 'MainTabs'}
      screenOptions={{ headerShown: false, animation: 'slide_from_right', animationDuration: 280 }}
    >
      <Stack.Screen name="MainTabs" component={MainTabs} />
      <Stack.Screen name="Watch" component={WatchScreen} />
      <Stack.Screen name="Search" component={SearchScreen} />
      <Stack.Screen name="SearchResults" component={SearchResultsScreen} />
      <Stack.Screen name="Channel" component={ChannelScreen} />
      <Stack.Screen name="Playlist" component={PlaylistScreen} />
      <Stack.Screen name="Saved" component={SavedScreen} />
      <Stack.Screen name="Playlists" component={PlaylistsScreen} />
      <Stack.Screen name="Sessions" component={SessionsListScreen} />
      <Stack.Screen name="SessionWatch" component={SessionWatchScreen} />
      <Stack.Screen name="History" component={HistoryScreen} />
      <Stack.Screen name="Settings" component={SettingsScreen} />
      <Stack.Screen name="Account" component={AccountScreen} />
      <Stack.Screen name="EditProfile" component={EditProfileScreen} />
      <Stack.Screen name="SignIn" component={SignInScreen} />
      <Stack.Screen name="SignUp" component={SignUpScreen} />
      {/* Admin routes are only REGISTERED for admin-role users
          (profiles.role via AuthContext). Hiding routes is a UX guard;
          Row Level Security is the real enforcement. */}
      {isAdmin ? <Stack.Screen name="Admin" component={AdminStack} /> : null}
    </Stack.Navigator>
  );
}
