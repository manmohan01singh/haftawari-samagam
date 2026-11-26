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
import { MaterialIcons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { branding } from '../../config/branding';
import { goBackOrTab } from '../../navigation/safeBack';
import { isSupabaseConfigured, supabase } from '../../lib/supabase';
import { lightColors, radii, spacing, typography } from '../../theme';
import type { RootStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'SignUp'>;

/**
 * Email sign-up (Supabase Auth). The profile row is created by the
 * on_auth_user_created trigger (always role 'member'); the optional
 * display name is passed as user metadata, which the trigger copies
 * into the profile. This project's auth settings require email
 * confirmation (mailer_autoconfirm is off), so when sign-up returns
 * no session the screen says so honestly instead of pretending the
 * account is signed in.
 */
export function SignUpScreen({ navigation }: Props) {
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsConfirmation, setNeedsConfirmation] = useState(false);

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  // Supabase Auth's enforced minimum for this project is 6 characters;
  // the rule is shown under the field and validated before submit.
  const passwordValid = password.length >= 6;
  const formValid = emailValid && passwordValid;
  const invalidReason = !email.trim()
    ? 'Enter an email and a password (at least 6 characters) to sign up.'
    : !emailValid
      ? 'That email address does not look complete — check for an @ and a domain.'
      : !passwordValid
        ? 'Your password needs at least 6 characters.'
        : null;

  const submit = async () => {
    if (!supabase || !formValid) return;
    setBusy(true);
    setError(null);
    const { data, error: signUpError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { display_name: displayName.trim() || undefined } },
    });
    setBusy(false);
    if (signUpError) {
      setError(signUpError.message);
      return;
    }
    if (data.session) {
      goBackOrTab(navigation, 'Library');
    } else {
      setNeedsConfirmation(true);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <View style={styles.topRow}>
        <Pressable onPress={() => goBackOrTab(navigation, 'Library')} hitSlop={10} accessibilityLabel="Back">
          <MaterialIcons name="arrow-back" size={24} color={lightColors.text} />
        </Pressable>
        <Pressable
          onPress={() => navigation.navigate('MainTabs', { screen: 'Home' })}
          hitSlop={10}
          accessibilityLabel="Go to Home"
          accessibilityRole="button"
        >
          <MaterialIcons name="home" size={24} color={lightColors.text} />
        </Pressable>
      </View>
      <View style={styles.brand}>
        <View style={styles.playMark}>
          <MaterialIcons name="play-arrow" size={18} color="#FFFFFF" />
        </View>
        <Text style={styles.wordmark}>{branding.appName}</Text>
      </View>
      <Text style={styles.heading}>Sign Up</Text>
      {!isSupabaseConfigured ? (
        <Text style={styles.error}>Sign-up is not available: the backend is not configured.</Text>
      ) : needsConfirmation ? (
        <View>
          <Text style={styles.confirmText}>
            Account created. Please check your email and open the confirmation link, then sign in.
          </Text>
          <Pressable style={styles.primaryButton} onPress={() => navigation.replace('SignIn')}>
            <Text style={styles.primaryButtonText}>Go to Sign In</Text>
          </Pressable>
        </View>
      ) : (
        <>
          <Text style={styles.label}>Display name (optional)</Text>
          <TextInput
            style={styles.input}
            placeholder="How your name appears in chat"
            placeholderTextColor={lightColors.textSecondary}
            autoCapitalize="words"
            value={displayName}
            onChangeText={setDisplayName}
          />
          <Text style={styles.label}>Email</Text>
          <TextInput
            style={styles.input}
            placeholder="you@example.com"
            placeholderTextColor={lightColors.textSecondary}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
          />
          {email && !emailValid ? (
            <Text style={styles.fieldError}>Enter a complete email address (with @ and a domain).</Text>
          ) : null}
          <Text style={styles.label}>Password</Text>
          <View style={styles.passwordRow}>
            <TextInput
              style={styles.passwordInput}
              placeholder="At least 6 characters"
              placeholderTextColor={lightColors.textSecondary}
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
          <Text style={styles.rules}>Password rules: at least 6 characters. Longer is stronger — mix letters and numbers if you can.</Text>
          {password && !passwordValid ? (
            <Text style={styles.fieldError}>Password is too short — at least 6 characters are required.</Text>
          ) : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Pressable
            style={[styles.primaryButton, (busy || !formValid) && styles.buttonDisabled]}
            onPress={submit}
            disabled={busy || !formValid}
            accessibilityRole="button"
          >
            {busy ? (
              <ActivityIndicator color={lightColors.subscribeText} />
            ) : (
              <Text style={styles.primaryButtonText}>Sign Up</Text>
            )}
          </Pressable>
          {!formValid && invalidReason ? <Text style={styles.helper}>{invalidReason}</Text> : null}
          <Pressable onPress={() => navigation.replace('SignIn')} style={styles.switchRow}>
            <Text style={styles.switchText}>
              Already have an account? <Text style={styles.switchStrong}>Sign In</Text>
            </Text>
          </Pressable>
        </>
      )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: lightColors.background, paddingHorizontal: spacing.xl, width: '100%', maxWidth: 480, alignSelf: 'center' },
  topRow: { paddingTop: spacing.xl, marginBottom: spacing.lg, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  brand: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xxl },
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
  rules: { ...typography.metadata, color: lightColors.textSecondary, marginBottom: spacing.sm },
  helper: { ...typography.metadata, color: lightColors.textSecondary, textAlign: 'center', marginTop: spacing.sm },
  passwordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: lightColors.surfaceVariant,
    borderRadius: radii.card,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  passwordInput: { flex: 1, paddingVertical: 14, fontSize: 16, color: lightColors.text },
  confirmText: { ...typography.body, color: lightColors.text, marginBottom: spacing.lg },
  primaryButton: {
    backgroundColor: lightColors.subscribeBackground,
    borderRadius: radii.pill,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  buttonDisabled: { opacity: 0.5 },
  primaryButtonText: { fontSize: 16, fontWeight: '600', color: lightColors.subscribeText },
  switchRow: { alignItems: 'center', marginTop: spacing.xl },
  switchText: { ...typography.body, color: lightColors.textSecondary },
  switchStrong: { color: lightColors.text, fontWeight: '600' },
});
