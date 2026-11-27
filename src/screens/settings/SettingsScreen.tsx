import React, { useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import appJson from '../../../app.json';
import { branding } from '../../config/branding';
import { useAuth } from '../../features/auth';
import { ConfirmModal } from '../../features/library/components/ConfirmModal';
import { OFFICIAL_CHANNEL_ID } from '../../lib/youtube';
import { goBackOrTab } from '../../navigation/safeBack';
import { StackHeader } from '../../components/layout/StackHeader';
import { StackTabBar } from '../../components/layout/StackTabBar';
import { Toast, useToast } from '../../components/common/Toast';
import { UserAvatar } from '../../components/common/UserAvatar';
import type { RootStackParamList } from '../../navigation/types';
import { lightColors, radii, spacing } from '../../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Settings'>;

type MaterialIconName = keyof typeof MaterialIcons.glyphMap;

interface SettingsRow {
  icon: MaterialIconName;
  label: string;
  onPress: () => void;
}

const APP_VERSION = (appJson as { expo?: { version?: string } }).expo?.version ?? '';

/**
 * Settings — rebuilt after the user found the LIVE page was still the
 * Phase-1 stub ("Settings will appear here", desktop header, no back,
 * no bottom nav: a total dead end). This screen contains ONLY real
 * things, every one of them wired:
 *
 *  - Account block: the real signed-in profile (tap → Account), or,
 *    signed out, a real prompt with Sign in / Create account buttons.
 *  - Library rows: Sessions, History, Saved, Playlists — all real
 *    screens. Admin dashboard row for admins only.
 *  - Sign out: confirmation, busy state, error toast on failure, and
 *    on success the user is taken back to the Home tab.
 *  - About: app name + real version (from app.json), the official
 *    channel inside the app, the channel on YouTube, and the honest
 *    playback note.
 *
 * Deliberately NOT here (no fake controls): an appearance/theme
 * toggle — the app has no theme engine (every screen uses the light
 * palette directly), so a switch would do nothing; and notification
 * settings — there is no notification backend. Both need a product
 * decision before they can exist honestly.
 */
export function SettingsScreen({ navigation }: Props) {
  const { user, profile, isAdmin, signOut } = useAuth();
  const { toast, showToast } = useToast();
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const libraryRows: SettingsRow[] = [
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

  const doSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
      setConfirmingSignOut(false);
      // Land somewhere sane: the Home tab, signed out.
      navigation.navigate('MainTabs', { screen: 'Home' });
    } catch {
      setConfirmingSignOut(false);
      showToast("Couldn't sign out. Check your connection and try again.");
    } finally {
      setSigningOut(false);
    }
  };

  const displayName = profile?.display_name ?? 'Sangat member';
  const initial = displayName.trim().charAt(0).toUpperCase() || 'S';

  return (
    <View style={styles.container}>
      <StackHeader title="Settings" onBack={() => goBackOrTab(navigation, 'Library')} />

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.sectionLabel}>Account</Text>
        {user ? (
          <Pressable
            style={styles.profileRow}
            onPress={() => navigation.navigate('Account')}
            accessibilityRole="button"
            accessibilityLabel="Account"
          >
            {profile?.avatar_url ? (
              <UserAvatar avatarUrl={profile.avatar_url} initial={initial} size={40} initialFontSize={17} />
            ) : (
              <View style={styles.avatar}>
                <Text style={styles.avatarInitial}>{initial}</Text>
              </View>
            )}
            <View style={styles.profileLines}>
              <Text style={styles.profileName} numberOfLines={1}>
                {displayName}
              </Text>
              <Text style={styles.profileMeta} numberOfLines={1}>
                {user.email ?? ''}
              </Text>
            </View>
            <MaterialIcons name="chevron-right" size={22} color={lightColors.textSecondary} />
          </Pressable>
        ) : (
          <View>
            <Pressable
              style={styles.profileRow}
              onPress={() => navigation.navigate('SignIn')}
              accessibilityRole="button"
              accessibilityLabel="Sign in"
            >
              <View style={[styles.avatar, styles.avatarGuest]}>
                <MaterialIcons name="person" size={24} color={lightColors.textSecondary} />
              </View>
              <View style={styles.profileLines}>
                <Text style={styles.profileName}>You&apos;re signed out</Text>
                <Text style={styles.profileMeta}>
                  Sign in to sync your history, saved videos and playlists.
                </Text>
              </View>
              <MaterialIcons name="chevron-right" size={22} color={lightColors.textSecondary} />
            </Pressable>
            <View style={styles.authButtons}>
              <Pressable
                style={styles.primaryButton}
                onPress={() => navigation.navigate('SignIn')}
                accessibilityRole="button"
              >
                <Text style={styles.primaryButtonText}>Sign in</Text>
              </Pressable>
              <Pressable
                style={styles.secondaryButton}
                onPress={() => navigation.navigate('SignUp')}
                accessibilityRole="button"
              >
                <Text style={styles.secondaryButtonText}>Create account</Text>
              </Pressable>
            </View>
          </View>
        )}

        <Text style={styles.sectionLabel}>Library</Text>
        {libraryRows.map((row) => (
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

        {isAdmin ? (
          <>
            <Text style={styles.sectionLabel}>Admin</Text>
            <Pressable
              style={styles.row}
              onPress={() => navigation.navigate('Admin', { screen: 'AdminOverview' })}
              accessibilityRole="button"
            >
              <MaterialIcons name="admin-panel-settings" size={24} color={lightColors.text} />
              <Text style={styles.rowText}>Admin dashboard</Text>
              <MaterialIcons name="chevron-right" size={22} color={lightColors.textSecondary} />
            </Pressable>
          </>
        ) : null}

        {user ? (
          <Pressable
            style={styles.signOutButton}
            onPress={() => setConfirmingSignOut(true)}
            accessibilityRole="button"
          >
            <Text style={styles.signOutText}>Sign out</Text>
          </Pressable>
        ) : null}

        <Text style={styles.sectionLabel}>About</Text>
        <View style={styles.aboutRow}>
          <View style={styles.profileLines}>
            <Text style={styles.aboutName}>{branding.appName}</Text>
            {APP_VERSION ? <Text style={styles.profileMeta}>Version {APP_VERSION}</Text> : null}
          </View>
        </View>
        <Pressable
          style={styles.row}
          onPress={() => navigation.navigate('Channel', { channelId: OFFICIAL_CHANNEL_ID })}
          accessibilityRole="button"
        >
          <MaterialIcons name="smart-display" size={24} color={lightColors.text} />
          <Text style={styles.rowText}>Official channel</Text>
          <MaterialIcons name="chevron-right" size={22} color={lightColors.textSecondary} />
        </Pressable>
        <Pressable
          style={styles.row}
          onPress={() => {
            void Linking.openURL(`https://www.youtube.com/channel/${OFFICIAL_CHANNEL_ID}`);
          }}
          accessibilityRole="button"
        >
          <MaterialIcons name="open-in-new" size={24} color={lightColors.text} />
          <Text style={styles.rowText}>Bhai Gursharan Singh Ji on YouTube</Text>
          <MaterialIcons name="chevron-right" size={22} color={lightColors.textSecondary} />
        </Pressable>
        <Text style={styles.aboutNote}>
          Playback uses the official YouTube player. Samagam Sessions are scheduled group
          playbacks of recordings, labelled UPCOMING, NOW PLAYING or COMPLETED.
        </Text>
      </ScrollView>

      <StackTabBar navigation={navigation} activeTab="Library" />
      <ConfirmModal
        visible={confirmingSignOut}
        title="Sign out?"
        message="Your history, saved videos and playlists stay in your account and will be there when you sign back in."
        confirmLabel="Sign out"
        busy={signingOut}
        onConfirm={() => {
          void doSignOut();
        }}
        onCancel={() => setConfirmingSignOut(false)}
      />
      <Toast message={toast} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: lightColors.background },
  content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
  sectionLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: lightColors.textSecondary,
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 64,
    paddingVertical: spacing.sm,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: lightColors.subscribeBackground,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarGuest: { backgroundColor: lightColors.surfaceVariant },
  avatarInitial: { fontSize: 17, fontWeight: '600', color: lightColors.subscribeText },
  profileLines: { flex: 1 },
  profileName: { fontSize: 16, fontWeight: '600', color: lightColors.text },
  profileMeta: { fontSize: 13, color: lightColors.textSecondary, marginTop: 2 },
  authButtons: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
  primaryButton: {
    backgroundColor: lightColors.subscribeBackground,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.lg,
    minHeight: 40,
    justifyContent: 'center',
  },
  primaryButtonText: { fontSize: 14, fontWeight: '600', color: lightColors.subscribeText },
  secondaryButton: {
    backgroundColor: lightColors.surfaceVariant,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.lg,
    minHeight: 40,
    justifyContent: 'center',
  },
  secondaryButtonText: { fontSize: 14, fontWeight: '600', color: lightColors.text },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    minHeight: 56,
  },
  rowText: { flex: 1, fontSize: 16, color: lightColors.text },
  signOutButton: {
    borderWidth: 1,
    borderColor: lightColors.border,
    borderRadius: radii.pill,
    minHeight: 48,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: spacing.xl,
  },
  signOutText: { fontSize: 15, fontWeight: '600', color: lightColors.text },
  aboutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
  },
  aboutName: { fontSize: 16, fontWeight: '600', color: lightColors.text },
  aboutNote: {
    fontSize: 13,
    lineHeight: 19,
    color: lightColors.textSecondary,
    marginTop: spacing.lg,
  },
});
