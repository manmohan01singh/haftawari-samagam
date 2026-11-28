import React, { useCallback } from 'react';
import type { NavigationProp } from '@react-navigation/native';
import { BottomNav, type BottomNavItem } from './BottomNav';
import { useAuth } from '../../features/auth';
import type { MainTabParamList, RootStackParamList } from '../../navigation/types';

interface StackTabBarProps {
  navigation: NavigationProp<RootStackParamList>;
  /** Which main tab this stack screen belongs to (highlighted slot). */
  activeTab?: keyof MainTabParamList | null;
}

/**
 * The main bottom bar, rendered at the foot of root-stack screens
 * (History, Saved, Playlists, Playlist, Channel, Account, Settings,
 * Sessions). In the reference app these screens keep the bottom bar;
 * here they previously had none, so the only way back to a tab was
 * repeated Back taps (QA: "dead-end screens", "stranded without
 * Back/reload", "two Back taps to return"). One tap on any slot pops
 * back to MainTabs on that tab.
 */
export function StackTabBar({ navigation, activeTab = null }: StackTabBarProps) {
  const { user, profile } = useAuth();
  const initial =
    profile?.display_name?.charAt(0)?.toUpperCase() ??
    user?.email?.charAt(0)?.toUpperCase() ??
    null;

  const onPress = useCallback(
    (key: string) => {
      navigation.navigate('MainTabs', { screen: key as keyof MainTabParamList });
    },
    [navigation],
  );

  // The SAME four slots as MainTabs — Home, Shorts, Subscriptions,
  // You (audit fix, 28 Nov 2026). This bar previously kept the old
  // pre-Shorts set with a circled-+ 'Official channel' slot the user
  // removed from the app, so stack screens showed a different nav
  // than the tabs and Shorts vanished there.
  const items: BottomNavItem[] = [
    { key: 'Home', label: 'Home', icon: 'home' },
    { key: 'Shorts', label: 'Shorts', kind: 'shorts' },
    { key: 'Subscriptions', label: 'Subscriptions', icon: 'subscriptions' },
    {
      key: 'Library',
      label: 'You',
      kind: 'avatar',
      avatarUrl: profile?.avatar_url ?? null,
      avatarInitial: initial,
    },
  ];

  return <BottomNav items={items} activeKey={activeTab ?? ''} onPress={onPress} />;
}
