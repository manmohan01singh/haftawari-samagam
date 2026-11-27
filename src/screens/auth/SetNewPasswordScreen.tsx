import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { branding } from '../../config/branding';
import { isSupabaseConfigured, supabase } from '../../lib/supabase';
import { useAuth } from '../../features/auth/AuthContext';
import { friendlyAuthError } from '../../features/auth/authHelpers';
import { lightColors, radii, spacing, typography } from '../../theme';

/**
 * Set-a-new-password form, shown when the user lands back from a
 * password-recovery email link (PASSWORD_RECOVERY / type=recovery).
 *
 * Before this screen existed the recovery link DID create a session
 * via detectSessionInUrl — and then nothing: no form anywhere called
 * updateUser, so the "reset" silently signed the user in with the old
 * password still in place and the flow looked broken. This screen is
 * rendered as a gate by RootNavigator while AuthContext reports a
 * recovery session; on success the gate clears and the (already
 * signed-in) user continues into the app.
 */
export function SetNewPasswordScreen() {
  const { clearPasswordRecovery } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const passwordValid = password.length >= 6;
  const formValid = passwordValid && confirm === password;

  const submit = async () => {
    if (!supabase || !formValid) return;
    setBusy(true);
    setError(null);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        setError(friendlyAuthError(updateError).message);
        return;
      }
      setDone(true);
    } catch (e) {
      setError(friendlyAuthError(e).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={styles.brand}>
          <View style={styles.playMark}>
            <MaterialIcons name="play-arrow" size={18} color="#FFFFFF" />
          </View>
          <Text style={styles.wordmark}>{branding.appName}</Text>
        </View>
        <Text style={styles.heading}>Set a new password</Text>
        {!isSupabaseConfigured ? (
          <Text style={styles.error}>Password reset is not available: the backend is not configured.</Text>
        ) : done ? (
          <View>
            <Text style={styles.confirmText}>
              Your password has been updated and you are signed in. Use the new password next time you
              sign in.
            </Text>
            <Pressable style={styles.primaryButton} onPress={clearPasswordRecovery}>
              <Text style={styles.primaryButtonText}>Continue to the app</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <Text style={styles.intro}>
              You opened a password-reset link, so you are signed in for this step. Choose a new
              password to finish.
            </Text>
            <Text style={styles.label}>New password</Text>
            <View style={styles.passwordRow}>
              <TextInput
                style={styles.passwordInput}
                placeholder="At least 6 characters"
                placeholderTextColor={lightColors.textSecondary}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="new-password"
                secureTextEntry={!showPassword}
                value={password}
                onChangeText={setPassword}
              />
              <Pressable
                onPress={() => setShowPassword((v) => !v)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
              >
                <MaterialIcons
                  name={showPassword ? 'visibility-off' : 'visibility'}
                  size={22}
                  color={lightColors.textSecondary}
                />
              </Pressable>
            </View>
            {password && !passwordValid ? (
              <Text style={styles.fieldError}>Password is too short — at least 6 characters are required.</Text>
            ) : null}
            <Text style={styles.label}>Confirm new password</Text>
            <TextInput
              style={styles.input}
              placeholder="Type the same password again"
              placeholderTextColor={lightColors.textSecondary}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="new-password"
              secureTextEntry={!showPassword}
              value={confirm}
              onChangeText={setConfirm}
            />
            {confirm && confirm !== password ? (
              <Text style={styles.fieldError}>The two passwords do not match yet.</Text>
            ) : null}
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Pressable
              style={[styles.primaryButton, (busy || !formValid) && styles.buttonDisabled]}
              onPress={() => void submit()}
              disabled={busy || !formValid}
              accessibilityRole="button"
            >
              {busy ? (
                <ActivityIndicator color={lightColors.subscribeText} />
              ) : (
                <Text style={styles.primaryButtonText}>Update password</Text>
              )}
            </Pressable>
            {!formValid ? (
              <Text style={styles.helper}>
                {!passwordValid
                  ? 'Enter a new password of at least 6 characters, then confirm it.'
                  : 'Type the same password again to confirm it.'}
              </Text>
            ) : null}
            <Pressable onPress={clearPasswordRecovery} style={styles.switchRow}>
              <Text style={styles.switchText}>Skip for now — keep my old password</Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: lightColors.background, paddingHorizontal: spacing.xl, width: '100%', maxWidth: 480, alignSelf: 'center' },
  brand: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xxl, paddingTop: spacing.xl },
  playMark: {
    width: 34,
    height: 24,
    borderRadius: 7,
    backgroundColor: lightColors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wordmark: { fontSize: 21, fontWeight: '700', color: lightColors.text, letterSpacing: -0.3 },
  heading: { ...typography.watchTitle, color: lightColors.text, marginBottom: spacing.lg },
  intro: { ...typography.body, color: lightColors.textSecondary, marginBottom: spacing.lg },
  input: {
    backgroundColor: lightColors.surfaceVariant,
    borderRadius: radii.card,
    paddingHorizontal: spacing.lg,
    paddingVertical: 14,
    fontSize: 16,
    color: lightColors.text,
    marginBottom: spacing.md,
  },
  error: { ...typography.body, color: lightColors.accent, marginBottom: spacing.md },
  label: { ...typography.chip, color: lightColors.text, marginBottom: spacing.xs, marginTop: spacing.sm },
  fieldError: { ...typography.metadata, color: lightColors.accent, marginBottom: spacing.sm },
  helper: { ...typography.metadata, color: lightColors.textSecondary, textAlign: 'center', marginTop: spacing.sm },
  confirmText: { ...typography.body, color: lightColors.text, marginBottom: spacing.lg },
  passwordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: lightColors.surfaceVariant,
    borderRadius: radii.card,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  passwordInput: { flex: 1, paddingVertical: 14, fontSize: 16, color: lightColors.text },
  primaryButton: {
    backgroundColor: lightColors.subscribeBackground,
    borderRadius: radii.pill,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  buttonDisabled: { opacity: 0.5 },
  primaryButtonText: { fontSize: 16, fontWeight: '600', color: lightColors.subscribeText },
  switchRow: { alignItems: 'center', marginTop: spacing.xl, paddingVertical: spacing.md, minHeight: 44, justifyContent: 'center' },
  switchText: { ...typography.body, color: lightColors.textSecondary },
});
