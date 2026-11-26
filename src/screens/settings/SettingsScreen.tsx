import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { branding } from '../../config/branding';
import { useAuth } from '../../features/auth';
import { lightColors, spacing } from '../../theme';
import type { RootStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Settings'>;

interface Row {
  key: string;
  label: string;
  icon: string;
  onPress: () => void;
}

/**
 * Settings (QA 28/29): this was a dead-end placeholder ("Settings will
 * appear here.") behind a dead ☰ stub header. There are no app
 * preference backends to toggle yet, so — rather than fake switches —
 * Settings is an honest index of REAL destinations: account, your
 * library sections, Samagam Sessions and (for admins) the dashboard,
 * plus sign-in/out which are real auth actions. Every row navigates
 * somewhere real, and the screen has a working back button.
 */
export function SettingsScreen({ navigation }: Props) {
  const { user, profile, isAdmin, signOut } = useAuth();

  const rows: Row[] = [
    {
      key: 'account',
      label: user ? 'Account' : 'Sign in / Create account',
      icon: 'person-outline',
      onPress: () => navigation.navigate(user ? 'Account' : 'SignIn'),
    },
    {
      key: 'sessions',
      label: 'Samagam Sessions',
      icon: 'groups',
      onPress: () => navigation.navigate('Sessions'),
    },
    {
      key: 'history',
      label: 'Watch history',
      icon: 'history',
      onPress: () => navigation.navigate('History'),
    },
    {
      key: 'saved',
      label: 'Saved recordings',
      icon: 'bookmark-border',
      onPress: () => navigation.navigate('Saved'),
    },
    {
      key: 'playlists',
      label: 'Your playlists',
      icon: 'playlist-play',
      onPress: () => navigation.navigate('Playlists'),
    },
    ...(isAdmin
      ? [
          {
            key: 'admin',
            label: 'Admin dashboard',
            icon: 'dashboard',
            onPress: () => navigation.navigate('Admin', { screen: 'AdminOverview' }),
          } as Row,
        ]
      : []),
  ];

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <Pressable
          onPress={() => navigation.goBack()}
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
        {user ? (
          <View style={styles.profileBlock}>
            <Text style={styles.profileName} numberOfLines={1}>
              {profile?.display_name ?? 'Sangat member'}
            </Text>
            <Text style={styles.profileMeta} numberOfLines={1}>
              {user.email ?? ''}
            </Text>
          </View>
        ) : null}

        {rows.map((row) => (
          <Pressable
            key={row.key}
            style={styles.row}
            onPress={row.onPress}
            accessibilityRole="button"
          >
            <MaterialIcons
              name={row.icon as keyof typeof MaterialIcons.glyphMap}
              size={24}
              color={lightColors.text}
            />
            <Text style={styles.rowText}>{row.label}</Text>
            <MaterialIcons name="chevron-right" size={22} color={lightColors.textSecondary} />
          </Pressable>
        ))}

        {user ? (
          <Pressable
            style={styles.signOutButton}
            onPress={() => {
              void signOut();
            }}
            accessibilityRole="button"
          >
            <Text style={styles.signOutText}>Sign out</Text>
          </Pressable>
        ) : null}

        <Text style={styles.about}>
          {branding.appName} — samagams from the official channel of Bhai Gursharan Singh Ji.
          Playback uses the official YouTube player.
        </Text>
      </ScrollView>
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
  content: { paddingBottom: spacing.xxl },
  profileBlock: { paddingHorizontal: spacing.lg, paddingVertical: spacing.lg },
  profileName: { fontSize: 18, fontWeight: '700', color: lightColors.text },
  profileMeta: { fontSize: 14, color: lightColors.textSecondary, marginTop: 2 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    minHeight: 56,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: lightColors.border,
  },
  rowText: { flex: 1, fontSize: 16, color: lightColors.text },
  signOutButton: {
    borderWidth: 1,
    borderColor: lightColors.border,
    borderRadius: 999,
    minHeight: 48,
    justifyContent: 'center',
    alignItems: 'center',
    marginHorizontal: spacing.lg,
    marginTop: spacing.xxl,
  },
  signOutText: { fontSize: 15, fontWeight: '600', color: lightColors.text },
  about: {
    fontSize: 13,
    lineHeight: 19,
    color: lightColors.textSecondary,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.xxl,
  },
});
