import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { goBackOrTab } from '../../navigation/safeBack';
import { StackHeader } from '../../components/layout/StackHeader';
import { StackTabBar } from '../../components/layout/StackTabBar';
import { Toast, useToast } from '../../components/common/Toast';
import { UserAvatar } from '../../components/common/UserAvatar';
import { useAuth } from '../../features/auth';
import { supabase } from '../../lib/supabase';
import { radii, spacing, useTheme, type ThemeColors } from '../../theme';
import type { RootStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'EditProfile'>;

export const MAX_DISPLAY_NAME_LENGTH = 50;

/**
 * Edit Profile — the user changing their OWN account details.
 *
 * What is editable here is exactly what the app owns: the display
 * name on the caller's own `profiles` row (profiles_update_own RLS
 * allows the write; the role-guard trigger still blocks role
 * changes, and `role` is never sent). Saving calls refreshProfile()
 * so the new name shows immediately everywhere the profile is read —
 * headers, the You page, Settings, Account — and chat picks it up
 * from the same row via the 0002 SECURITY DEFINER name function.
 *
 * The name the user saves here is FINAL: profileSync seeds
 * display_name from Google metadata only while the stored value is
 * empty, so a later Google sign-in can never overwrite this edit.
 *
 * The avatar is shown (real Google DP when synced, initial
 * otherwise) but is NOT editable here — there is no photo-upload
 * backend, so no fake "Change photo" button. The email is shown
 * read-only: changing it needs Supabase's confirmation-email flow,
 * which is not wired up (NOT IMPLEMENTED, stated on screen rather
 * than faked).
 */
export function EditProfileScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { user, profile, refreshProfile } = useAuth();
  const { toast, showToast } = useToast();

  const currentName = profile?.display_name ?? '';
  const [name, setName] = useState<string | null>(null); // null = untouched, prefill from profile
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const value = name ?? currentName;
  const trimmed = value.trim();
  const dirty = trimmed !== (currentName ?? '').trim();
  const initial = (trimmed || user?.email || 'S').charAt(0).toUpperCase();

  const save = async () => {
    if (saving) return;
    if (!trimmed) {
      setError('Please enter a name — it can’t be empty.');
      return;
    }
    if (trimmed.length > MAX_DISPLAY_NAME_LENGTH) {
      setError(`Please keep the name to ${MAX_DISPLAY_NAME_LENGTH} characters or fewer.`);
      return;
    }
    if (!user || !supabase) {
      setError('You need to be signed in to edit your profile.');
      return;
    }
    setError(null);
    setSaving(true);
    const { error: updateError } = await supabase
      .from('profiles')
      .update({ display_name: trimmed })
      .eq('id', user.id);
    if (updateError) {
      setSaving(false);
      setError('Couldn’t save your name. Check your connection and try again.');
      return;
    }
    // Pull the row back through AuthContext so every surface that
    // reads the profile (header, You, Settings, Account, chat
    // identity) shows the new name without a restart.
    await refreshProfile();
    setSaving(false);
    showToast('Profile saved');
    goBackOrTab(navigation, 'Library');
  };

  return (
    <View style={styles.container}>
      <StackHeader title="Edit profile" onBack={() => goBackOrTab(navigation, 'Library')} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {!user ? (
          <>
            <Text style={styles.note}>
              You&apos;re signed out. Sign in to see and edit your profile.
            </Text>
            <Pressable
              style={styles.saveButton}
              onPress={() => navigation.navigate('SignIn')}
              accessibilityRole="button"
            >
              <Text style={styles.saveButtonText}>Sign in</Text>
            </Pressable>
          </>
        ) : (
          <>
            <View style={styles.avatarBlock}>
              <UserAvatar
                avatarUrl={profile?.avatar_url ?? null}
                initial={initial}
                size={96}
                initialFontSize={38}
              />
              <Text style={styles.avatarNote}>
                {profile?.avatar_url
                  ? 'Your photo comes from your Google account.'
                  : 'When you sign in with Google, your photo appears here.'}
              </Text>
            </View>

            <Text style={styles.label}>Display name</Text>
            <TextInput
              style={styles.input}
              value={value}
              onChangeText={(text) => {
                setName(text);
                if (error) setError(null);
              }}
              placeholder="Your name"
              placeholderTextColor={colors.textSecondary}
              autoCapitalize="words"
              autoCorrect={false}
              maxLength={MAX_DISPLAY_NAME_LENGTH + 10}
              returnKeyType="done"
              onSubmitEditing={() => {
                void save();
              }}
              accessibilityLabel="Display name"
            />
            <Text style={styles.hint}>
              This is the name the sangat sees next to your messages. {trimmed.length}/
              {MAX_DISPLAY_NAME_LENGTH}
            </Text>
            {error ? <Text style={styles.error}>{error}</Text> : null}

            <Text style={styles.label}>Email</Text>
            <View style={styles.readOnlyBox}>
              <Text style={styles.readOnlyText}>{user.email ?? ''}</Text>
            </View>
            <Text style={styles.hint}>
              Your email can&apos;t be changed inside the app yet.
            </Text>

            <Pressable
              style={[
                styles.saveButton,
                (!dirty || saving) && styles.saveButtonDisabled,
              ]}
              onPress={() => {
                void save();
              }}
              disabled={!dirty || saving}
              accessibilityRole="button"
              accessibilityState={{ disabled: !dirty || saving, busy: saving }}
            >
              {saving ? (
                <ActivityIndicator color={colors.subscribeText} />
              ) : (
                <Text style={styles.saveButtonText}>Save</Text>
              )}
            </Pressable>
          </>
        )}
      </ScrollView>
      <StackTabBar navigation={navigation} activeTab="Library" />
      <Toast message={toast} />
    </View>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
    avatarBlock: { alignItems: 'center', marginTop: spacing.xl, marginBottom: spacing.lg },
    avatarNote: {
      fontSize: 13,
      color: colors.textSecondary,
      marginTop: spacing.sm,
      textAlign: 'center',
    },
    label: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.text,
      marginTop: spacing.lg,
      marginBottom: spacing.sm,
    },
    input: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.card,
      minHeight: 52,
      paddingHorizontal: spacing.md,
      fontSize: 16,
      color: colors.text,
      backgroundColor: colors.surface,
    },
    readOnlyBox: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.card,
      minHeight: 52,
      paddingHorizontal: spacing.md,
      justifyContent: 'center',
      backgroundColor: colors.surfaceVariant,
    },
    readOnlyText: { fontSize: 16, color: colors.textSecondary },
    hint: { fontSize: 13, color: colors.textSecondary, marginTop: spacing.sm },
    error: { fontSize: 14, color: colors.accent, marginTop: spacing.sm },
    note: { fontSize: 15, lineHeight: 21, color: colors.text, marginTop: spacing.xl },
    saveButton: {
      backgroundColor: colors.subscribeBackground,
      borderRadius: radii.pill,
      minHeight: 48,
      justifyContent: 'center',
      alignItems: 'center',
      marginTop: spacing.xl,
    },
    saveButtonDisabled: { opacity: 0.45 },
    saveButtonText: { fontSize: 15, fontWeight: '600', color: colors.subscribeText },
  });
