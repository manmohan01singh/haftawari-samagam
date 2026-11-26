import type { NavigationProp } from '@react-navigation/native';
import type { MainTabParamList, RootStackParamList } from './types';

/**
 * Back behaviour for root-stack screens (UX fix, navlib stream).
 *
 * `navigation.goBack()` is a silent no-op when the screen is the first
 * entry in the stack — which is exactly what happens on the PWA when a
 * screen is opened from a shared/refreshed URL, or after sign-in
 * replaces the auth screens. Users hit a dead back arrow and felt
 * "stuck". Every in-scope screen therefore goes back through here:
 * pop when there is somewhere to pop to, otherwise land on a sensible
 * main tab (Library for library/auth/account screens, Home for
 * sessions) instead of doing nothing.
 */
export function goBackOrTab(
  navigation: NavigationProp<RootStackParamList>,
  fallbackTab: keyof MainTabParamList = 'Home',
): void {
  if (navigation.canGoBack()) {
    navigation.goBack();
    return;
  }
  navigation.navigate('MainTabs', { screen: fallbackTab });
}
