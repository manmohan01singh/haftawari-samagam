import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { MainTabs } from './MainTabs';
import { AdminStack } from './AdminStack';
import { useAuth } from '../features/auth';
import { WatchScreen } from '../screens/watch';
import { SearchScreen, SearchResultsScreen } from '../screens/search';
import { SignInScreen, SignUpScreen } from '../screens/auth';
import { ChannelScreen } from '../screens/channel';
import { PlaylistScreen } from '../screens/playlist';
import { HistoryScreen } from '../screens/history';
import { SettingsScreen } from '../screens/settings';
import { AccountScreen } from '../screens/account';
import type { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  const { isAdmin } = useAuth();
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="MainTabs" component={MainTabs} />
      <Stack.Screen name="Watch" component={WatchScreen} />
      <Stack.Screen name="Search" component={SearchScreen} />
      <Stack.Screen name="SearchResults" component={SearchResultsScreen} />
      <Stack.Screen name="Channel" component={ChannelScreen} />
      <Stack.Screen name="Playlist" component={PlaylistScreen} />
      <Stack.Screen name="History" component={HistoryScreen} />
      <Stack.Screen name="Settings" component={SettingsScreen} />
      <Stack.Screen name="Account" component={AccountScreen} />
      <Stack.Screen name="SignIn" component={SignInScreen} />
      <Stack.Screen name="SignUp" component={SignUpScreen} />
      {/* Admin routes are only REGISTERED for admin-role users
          (profiles.role via AuthContext). Hiding routes is a UX guard;
          Row Level Security is the real enforcement. */}
      {isAdmin ? <Stack.Screen name="Admin" component={AdminStack} /> : null}
    </Stack.Navigator>
  );
}
