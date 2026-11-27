import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { goBackOrTab } from '../../navigation/safeBack';
import { StackHeader } from '../../components/layout/StackHeader';
import { StackTabBar } from '../../components/layout/StackTabBar';
import { UserAvatar } from '../../components/common/UserAvatar';
import { useAuth } from '../../features/auth';
import { radii, spacing, typography, useTheme, type ThemeColors } from '../../theme';
import type { RootStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Account'>;

/**
 * Account screen: the signed-in user's real profile (display name,
 * email, role from `profiles`), an Admin entry that appears ONLY for
 * admin-role users (route registration + RLS enforce it server-side),
 * and sign-out. Signed-out visitors get sign-in / sign-up entries.
 */
export function AccountScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { user, profile, isAdmin, loading, signOut } = useAuth();
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    setSignOutError(null);
    try {
      await signOut();
      goBackOrTab(navigation, 'Library');
    } catch (e) {
      // Before this, a failed sign-out was an unhandled rejection and
      // the tap appeared to do nothing at all.
      setSignOutError(e instanceof Error ? e.message : 'Could not sign out. Please try again.');
      setSigningOut(false);
    }
  };

  return (
    <View style={styles.container}>
      <StackHeader title="Account" onBack={() => goBackOrTab(navigation, 'Library')} />
      <ScrollView contentContainerStyle={styles.content}>
        {loading ? (
          <Text style={styles.meta}>Loading…</Text>
        ) : user ? (
          <>
            <View style={styles.profileBlock}>
              <View style={styles.avatarWrap}>
                <UserAvatar
                  avatarUrl={profile?.avatar_url ?? null}
                  initial={(profile?.display_name ?? user.email ?? '?').charAt(0).toUpperCase()}
                  size={72}
                  initialFontSize={28}
                />
              </View>
              <Text style={styles.name}>{profile?.display_name ?? 'Sangat member'}</Text>
              <Text style={styles.meta}>{user.email}</Text>
              <View style={styles.roleChip}>
                <Text style={styles.roleText}>{isAdmin ? 'Admin' : 'Member'}</Text>
              </View>
            </View>

            <Pressable style={styles.row} onPress={() => navigation.navigate('EditProfile')} accessibilityRole="button">
              <MaterialIcons name="edit" size={24} color={colors.text} />
              <Text style={styles.rowText}>Edit profile</Text>
              <MaterialIcons name="chevron-right" size={22} color={colors.textSecondary} />
            </Pressable>
            <Pressable style={styles.row} onPress={() => navigation.navigate('History')} accessibilityRole="button">
              <MaterialIcons name="history" size={24} color={colors.text} />
              <Text style={styles.rowText}>History</Text>
              <MaterialIcons name="chevron-right" size={22} color={colors.textSecondary} />
            </Pressable>
            <Pressable
              style={styles.row}
              onPress={() => navigation.navigate('MainTabs', { screen: 'Library' })}
              accessibilityRole="button"
            >
              <MaterialIcons name="video-library" size={24} color={colors.text} />
              <Text style={styles.rowText}>Your library</Text>
              <MaterialIcons name="chevron-right" size={22} color={colors.textSecondary} />
            </Pressable>
            {isAdmin ? (
              <Pressable
                style={styles.row}
                onPress={() => navigation.navigate('Admin', { screen: 'AdminOverview' })}
                accessibilityRole="button"
              >
                <MaterialIcons name="admin-panel-settings" size={24} color={colors.text} />
                <Text style={styles.rowText}>Admin dashboard</Text>
                <MaterialIcons name="chevron-right" size={22} color={colors.textSecondary} />
              </Pressable>
            ) : null}

            {signOutError ? <Text style={styles.signOutError}>{signOutError}</Text> : null}
            <Pressable
              style={styles.signOutButton}
              onPress={() => void handleSignOut()}
              disabled={signingOut}
              accessibilityRole="button"
            >
              <Text style={styles.signOutText}>{signingOut ? 'Signing out…' : 'Sign out'}</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Text style={styles.name}>You are signed out</Text>
            <Text style={styles.meta}>
              Sign in to keep your history, save samagams, and join Samagam sessions.
            </Text>
            <Pressable
              style={styles.primaryButton}
              onPress={() => navigation.navigate('SignIn')}
              accessibilityRole="button"
            >
              <Text style={styles.primaryButtonText}>Sign in</Text>
            </Pressable>
            <Pressable
              style={styles.outlineButton}
              onPress={() => navigation.navigate('SignUp')}
              accessibilityRole="button"
            >
              <Text style={styles.outlineButtonText}>Create account</Text>
            </Pressable>
          </>
        )}
      </ScrollView>
      <StackTabBar navigation={navigation} activeTab="Library" />
    </View>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg },
  profileBlock: { alignItems: 'center', paddingVertical: spacing.lg },
  avatarWrap: { marginBottom: spacing.md },
  name: { fontSize: 20, fontWeight: '700', color: colors.text, textAlign: 'center' },
  meta: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  roleChip: {
    backgroundColor: colors.surfaceVariant,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    marginTop: spacing.sm,
  },
  roleText: { fontSize: 13, fontWeight: '600', color: colors.text },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingVertical: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowText: { flex: 1, fontSize: 16, color: colors.text },
  signOutButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.pill,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: spacing.xxl,
  },
  signOutText: { fontSize: 15, fontWeight: '600', color: colors.text },
  signOutError: { fontSize: 13, color: colors.accent, textAlign: 'center', marginTop: spacing.xl },
  primaryButton: {
    backgroundColor: colors.subscribeBackground,
    borderRadius: radii.pill,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: spacing.xl,
  },
  primaryButtonText: { fontSize: 16, fontWeight: '600', color: colors.subscribeText },
  outlineButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.pill,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: spacing.md,
  },
  outlineButtonText: { fontSize: 16, fontWeight: '600', color: colors.text },
});
