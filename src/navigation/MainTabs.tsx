import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { BottomNav, type BottomNavItem } from '../components/layout/BottomNav';
import { HomeScreen } from '../screens/home';
import { ShortsScreen } from '../screens/shorts';
import { SubscriptionsScreen } from '../screens/subscriptions';
import { LibraryScreen } from '../screens/library';
import type { MainTabParamList } from './types';

const Tab = createBottomTabNavigator<MainTabParamList>();

const ITEMS: Record<keyof MainTabParamList, BottomNavItem> = {
  Home: { key: 'Home', label: 'Home', icon: '⌂' },
  Shorts: { key: 'Shorts', label: 'Shorts', icon: '▶' },
  Subscriptions: { key: 'Subscriptions', label: 'Subscriptions', icon: '▤' },
  Library: { key: 'Library', label: 'Library', icon: '☰' },
};

/**
 * Main tabs with the app-owned BottomNav as the tab bar, so the mobile
 * navigation matches the audited native-app pattern exactly.
 * (Desktop/web uses the sidebar layout — Phase 2 responsive shell.)
 */
export function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={{ headerShown: false }}
      tabBar={({ state, navigation }) => {
        const activeRoute = state.routes[state.index];
        return (
          <BottomNav
            items={state.routes.map((route) => ITEMS[route.name as keyof MainTabParamList])}
            activeKey={activeRoute.name}
            onPress={(key) => navigation.navigate(key as keyof MainTabParamList)}
          />
        );
      }}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Shorts" component={ShortsScreen} />
      <Tab.Screen name="Subscriptions" component={SubscriptionsScreen} />
      <Tab.Screen name="Library" component={LibraryScreen} />
    </Tab.Navigator>
  );
}
