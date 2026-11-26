import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { MainTabs } from './MainTabs';
import { AdminStack } from './AdminStack';
import { WatchScreen } from '../screens/watch';
import { SearchScreen, SearchResultsScreen } from '../screens/search';
import { ChannelScreen } from '../screens/channel';
import { PlaylistScreen } from '../screens/playlist';
import { HistoryScreen } from '../screens/history';
import { SettingsScreen } from '../screens/settings';
import { AccountScreen } from '../screens/account';
import type { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
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
      <Stack.Screen name="Admin" component={AdminStack} />
    </Stack.Navigator>
  );
}
