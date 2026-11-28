import React, { useCallback } from 'react';
import { createBottomTabNavigator, type BottomTabBarProps } from '@react-navigation/bottom-tabs';
import type { NavigationProp } from '@react-navigation/native';
import { BottomNav, type BottomNavItem } from '../components/layout/BottomNav';
import { useAuth } from '../features/auth';
import { HomeScreen } from '../screens/home';
import { ShortsScreen } from '../screens/shorts';
import { SubscriptionsScreen } from '../screens/subscriptions';
import { LibraryScreen } from '../screens/library';
import type { MainTabParamList } from './types';

const Tab = createBottomTabNavigator<MainTabParamList>();

/**
 * Main tabs under the app-owned BottomNav: 4 icon-only slots —
 * Home · Shorts · Subscriptions · profile avatar (the Library/"You"
 * tab). The centre +/channel slot is GONE and Shorts are IN (user,
 * 28 Nov 2026 — reversing the 26 Nov no-Shorts decision): Shorts
 * shows only the app's own sangat channels' short videos.
 */
export function MainTabs() {
  const { user, profile } = useAuth();
  const rawInitial =
    profile?.display_name?.charAt(0)?.toUpperCase() ??
    user?.email?.charAt(0)?.toUpperCase() ??
    null;
  const initial = rawInitial && /\p{L}/u.test(rawInitial) ? rawInitial : null;
  // Real profile photo (synced Google DP) when one exists; the slot
  // falls back to the initial when it does not or fails to load.
  const avatarUrl = profile?.avatar_url ?? null;

  const renderTabBar = useCallback(
    ({ state, navigation }: BottomTabBarProps) => {
      const nav = navigation as unknown as NavigationProp<MainTabParamList>;
      const activeRoute = state.routes[state.index];
      const items: BottomNavItem[] = [
        { key: 'Home', label: 'Home', icon: activeRoute.name === 'Home' ? 'home' : 'home' },
        { key: 'Shorts', label: 'Shorts', kind: 'shorts' },
        { key: 'Subscriptions', label: 'Subscriptions', icon: 'subscriptions' },
        { key: 'Library', label: 'You', kind: 'avatar', avatarUrl, avatarInitial: initial },
      ];
      return (
        <BottomNav
          overlay
          items={items}
          activeKey={activeRoute.name}
          onPress={(key) => {
            nav.navigate(key as keyof MainTabParamList);
          }}
        />
      );
    },
    [initial, avatarUrl],
  );

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        // Freeze inactive tabs (react-native-screens): a backgrounded
        // tab stops re-rendering on shared state changes (auth, channel
        // load) instead of doing invisible work — part of the UX perf
        // pass against the "everything feels heavy" reports.
        freezeOnBlur: true,
        lazy: true,
      }}
      tabBar={renderTabBar}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Shorts" component={ShortsScreen} />
      <Tab.Screen name="Subscriptions" component={SubscriptionsScreen} />
      <Tab.Screen name="Library" component={LibraryScreen} />
    </Tab.Navigator>
  );
}
