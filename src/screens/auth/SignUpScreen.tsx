import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { branding } from '../../config/branding';
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsConfirmation, setNeedsConfirmation] = useState(false);

  const submit = async () => {
    if (!supabase) return;
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
      navigation.goBack();
    } else {
      setNeedsConfirmation(true);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.topRow}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10} accessibilityLabel="Back">
          <MaterialIcons name="arrow-back" size={24} color={lightColors.text} />
        </Pressable>
      </View>
      <View style={styles.brand}>
        <View style={styles.playMark}>
          <MaterialIcons name="play-arrow" size={18} color="#FFFFFF" />
        </View>
        <Text style={styles.wordmark}>{branding.appName}</Text>
      </View>
      <Text style={styles.heading}>Create account</Text>
      {!isSupabaseConfigured ? (
        <Text style={styles.error}>Sign-up is not available: the backend is not configured.</Text>
      ) : needsConfirmation ? (
        <View>
          <Text style={styles.confirmText}>
            Account created. Please check your email and open the confirmation link, then sign in.
          </Text>
          <Pressable style={styles.primaryButton} onPress={() => navigation.replace('SignIn')}>
            <Text style={styles.primaryButtonText}>Go to sign in</Text>
          </Pressable>
        </View>
      ) : (
        <>
          <TextInput
            style={styles.input}
            placeholder="Display name (optional)"
            placeholderTextColor={lightColors.textSecondary}
            autoCapitalize="words"
            value={displayName}
            onChangeText={setDisplayName}
          />
          <TextInput
            style={styles.input}
            placeholder="Email"
            placeholderTextColor={lightColors.textSecondary}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
          />
          <TextInput
            style={styles.input}
            placeholder="Password"
            placeholderTextColor={lightColors.textSecondary}
            autoComplete="new-password"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Pressable
            style={[styles.primaryButton, (busy || !email || !password) && styles.buttonDisabled]}
            onPress={submit}
            disabled={busy || !email || !password}
            accessibilityRole="button"
          >
            {busy ? (
              <ActivityIndicator color={lightColors.subscribeText} />
            ) : (
              <Text style={styles.primaryButtonText}>Create account</Text>
            )}
          </Pressable>
          <Pressable onPress={() => navigation.replace('SignIn')} style={styles.switchRow}>
            <Text style={styles.switchText}>
              Already have an account? <Text style={styles.switchStrong}>Sign in</Text>
            </Text>
          </Pressable>
        </>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: lightColors.background, paddingHorizontal: spacing.xl },
  topRow: { paddingTop: spacing.xl, marginBottom: spacing.lg },
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
  switchRow: { alignItems: 'center', marginTop: spacing.xl, paddingVertical: spacing.md, minHeight: 44, justifyContent: 'center' },
  switchText: { ...typography.body, color: lightColors.textSecondary },
  switchStrong: { color: lightColors.text, fontWeight: '600' },
});
