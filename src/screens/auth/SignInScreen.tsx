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
import { goBackOrTab } from '../../navigation/safeBack';
import { branding } from '../../config/branding';
import { isSupabaseConfigured, supabase } from '../../lib/supabase';
import { lightColors, radii, spacing, typography } from '../../theme';
import type { RootStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'SignIn'>;

/**
 * Email sign-in (Supabase Auth). Errors are shown exactly as Supabase
 * returns them — no invented messages, no fake success states.
 */
export function SignInScreen({ navigation }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!supabase || busy) return;
    // Clear, immediate feedback for the common typo instead of a
    // round-trip to Supabase for a raw server error.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Please enter a valid email address.');
      return;
    }
    setBusy(true);
    setError(null);
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setBusy(false);
    if (signInError) {
      setError(signInError.message);
      return;
    }
    // goBack() alone was a dead end when SignIn was the entry screen
    // (shared/refreshed URL): the user signed in and stayed on the
    // form. Fall back to the Library tab, where sign-in matters most.
    goBackOrTab(navigation, 'Library');
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
      </View>
      <View style={styles.brand}>
        <View style={styles.playMark}>
          <MaterialIcons name="play-arrow" size={18} color="#FFFFFF" />
        </View>
        <Text style={styles.wordmark}>{branding.appName}</Text>
      </View>
      <Text style={styles.heading}>Sign in</Text>
      {!isSupabaseConfigured ? (
        <Text style={styles.error}>Sign-in is not available: the backend is not configured.</Text>
      ) : (
        <>
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
            autoComplete="password"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
            returnKeyType="go"
            onSubmitEditing={submit}
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
              <Text style={styles.primaryButtonText}>Sign in</Text>
            )}
          </Pressable>
          <Pressable onPress={() => navigation.replace('SignUp')} style={styles.switchRow}>
            <Text style={styles.switchText}>
              New here? <Text style={styles.switchStrong}>Create an account</Text>
            </Text>
          </Pressable>
        </>
      )}
      </ScrollView>
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
