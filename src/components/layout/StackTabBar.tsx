import React, { useCallback } from 'react';
import type { NavigationProp } from '@react-navigation/native';
import { BottomNav, type BottomNavItem } from './BottomNav';
import { useAuth } from '../../features/auth';
import type { MainTabParamList, RootStackParamList } from '../../navigation/types';

const CREATE_KEY = '__create';

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
 * back to MainTabs on that tab. The circled + keeps its MainTabs
 * meaning (official channel). NO Shorts slot, as everywhere.
 */
export function StackTabBar({ navigation, activeTab = null }: StackTabBarProps) {
  const { user, profile } = useAuth();
  const initial =
    profile?.display_name?.charAt(0)?.toUpperCase() ??
    user?.email?.charAt(0)?.toUpperCase() ??
    null;

  const onPress = useCallback(
    (key: string) => {
      if (key === CREATE_KEY) {
        navigation.navigate('Channel', {});
        return;
      }
      navigation.navigate('MainTabs', { screen: key as keyof MainTabParamList });
    },
    [navigation],
  );

  const items: BottomNavItem[] = [
    { key: 'Home', label: 'Home', icon: 'home' },
    { key: 'Subscriptions', label: 'Subscriptions', icon: 'subscriptions' },
    { key: CREATE_KEY, label: 'Official channel', kind: 'create' },
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
