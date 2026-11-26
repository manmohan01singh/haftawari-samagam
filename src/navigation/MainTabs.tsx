import React, { useCallback } from 'react';
import { createBottomTabNavigator, type BottomTabBarProps } from '@react-navigation/bottom-tabs';
import type { NavigationProp } from '@react-navigation/native';
import { BottomNav, type BottomNavItem } from '../components/layout/BottomNav';
import { useAuth } from '../features/auth';
import { HomeScreen } from '../screens/home';
import { SubscriptionsScreen } from '../screens/subscriptions';
import { LibraryScreen } from '../screens/library';
import type { MainTabParamList, RootStackParamList } from './types';

const Tab = createBottomTabNavigator<MainTabParamList>();

/** Pseudo-key for the circled + slot — an action, not a tab route. */
const CREATE_KEY = '__create';

/**
 * Main tabs under the app-owned BottomNav: 4 icon-only slots —
 * Home · Subscriptions · circled + · profile avatar (the Library/"You"
 * tab). NO Shorts slot (user decision, 26 Nov 2026).
 *
 * The circled + is retained from the reference geometry; this app has
 * no user uploads, so in Haftawari Samagam it opens the official
 * channel — the app's content home. Documented divergence, see
 * docs/ARCHITECTURE.md Phase 2 notes.
 */
export function MainTabs() {
  const { user, profile } = useAuth();
  const initial =
    profile?.display_name?.charAt(0)?.toUpperCase() ??
    user?.email?.charAt(0)?.toUpperCase() ??
    null;

  const renderTabBar = useCallback(
    ({ state, navigation }: BottomTabBarProps) => {
      const nav = navigation as unknown as NavigationProp<MainTabParamList>;
      const activeRoute = state.routes[state.index];
      const items: BottomNavItem[] = [
        { key: 'Home', label: 'Home', icon: activeRoute.name === 'Home' ? 'home' : 'home' },
        { key: 'Subscriptions', label: 'Subscriptions', icon: 'subscriptions' },
        { key: CREATE_KEY, label: 'Official channel', kind: 'create' },
        { key: 'Library', label: 'You', kind: 'avatar', avatarInitial: initial },
      ];
      return (
        <BottomNav
          items={items}
          activeKey={activeRoute.name}
          onPress={(key) => {
            if (key === CREATE_KEY) {
              const parent = nav.getParent<NavigationProp<RootStackParamList>>();
              parent?.navigate('Channel', {});
              return;
            }
            nav.navigate(key as keyof MainTabParamList);
          }}
        />
      );
    },
    [initial],
  );

  return (
    <Tab.Navigator screenOptions={{ headerShown: false }} tabBar={renderTabBar}>
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Subscriptions" component={SubscriptionsScreen} />
      <Tab.Screen name="Library" component={LibraryScreen} />
    </Tab.Navigator>
  );
}
