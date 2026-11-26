import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { branding } from '../../config/branding';
import { useAuth } from '../../features/auth';
import { goBackOrTab } from '../../navigation/safeBack';
import { StackTabBar } from '../../components/layout/StackTabBar';
import type { RootStackParamList } from '../../navigation/types';
import { lightColors, spacing } from '../../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Settings'>;

type MaterialIconName = keyof typeof MaterialIcons.glyphMap;

interface SettingsRow {
  icon: MaterialIconName;
  label: string;
  onPress: () => void;
}

/**
 * Settings — previously a Phase-1 stub ("Settings will appear here")
 * with the app Header, NO back button and no bottom nav: a complete
 * dead end reachable from the Library tab's gear icon. It is now a
 * real, navigable hub: account, sessions and every library section,
 * reached with working rows, plus the app identity. It deliberately
 * contains no fake toggles — every row goes somewhere real.
 */
export function SettingsScreen({ navigation }: Props) {
  const { user, isAdmin } = useAuth();

  const rows: SettingsRow[] = [
    {
      icon: 'account-circle',
      label: user ? 'Account' : 'Sign in / Create account',
      onPress: () => navigation.navigate('Account'),
    },
    {
      icon: 'groups',
      label: 'Samagam Sessions',
      onPress: () => navigation.navigate('Sessions'),
    },
    {
      icon: 'history',
      label: 'History',
      onPress: () => navigation.navigate('History'),
    },
    {
      icon: 'bookmark',
      label: 'Saved',
      onPress: () => navigation.navigate('Saved'),
    },
    {
      icon: 'playlist-play',
      label: 'Playlists',
      onPress: () => navigation.navigate('Playlists'),
    },
  ];
  if (isAdmin) {
    rows.push({
      icon: 'admin-panel-settings',
      label: 'Admin dashboard',
      onPress: () => navigation.navigate('Admin', { screen: 'AdminOverview' }),
    });
  }

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <Pressable
          onPress={() => goBackOrTab(navigation, 'Library')}
          hitSlop={10}
          accessibilityLabel="Back"
          accessibilityRole="button"
        >
          <MaterialIcons name="arrow-back" size={24} color={lightColors.text} />
        </Pressable>
        <Text style={styles.topBarTitle}>Settings</Text>
        <View style={styles.topBarSpacer} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        {rows.map((row) => (
          <Pressable
            key={row.label}
            style={styles.row}
            onPress={row.onPress}
            accessibilityRole="button"
          >
            <MaterialIcons name={row.icon} size={24} color={lightColors.text} />
            <Text style={styles.rowText}>{row.label}</Text>
            <MaterialIcons name="chevron-right" size={22} color={lightColors.textSecondary} />
          </Pressable>
        ))}
        <Text style={styles.footer}>
          {branding.appName} · Playback uses the official YouTube player. Samagam
          Sessions are scheduled group playbacks of recordings, labelled
          UPCOMING, NOW PLAYING or COMPLETED.
        </Text>
      </ScrollView>
      <StackTabBar navigation={navigation} activeTab="Library" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: lightColors.background },
  topBar: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
  },
  topBarTitle: { fontSize: 17, fontWeight: '600', color: lightColors.text },
  topBarSpacer: { width: 24 },
  content: { padding: spacing.lg },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingVertical: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: lightColors.border,
  },
  rowText: { flex: 1, fontSize: 16, color: lightColors.text },
  footer: {
    fontSize: 13,
    lineHeight: 19,
    color: lightColors.textSecondary,
    marginTop: spacing.xxl,
  },
});
