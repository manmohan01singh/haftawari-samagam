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
    if (!supabase) return;
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
    navigation.goBack();
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
  switchRow: { alignItems: 'center', marginTop: spacing.xl, paddingVertical: spacing.md, minHeight: 44, justifyContent: 'center' },
  switchText: { ...typography.body, color: lightColors.textSecondary },
  switchStrong: { color: lightColors.text, fontWeight: '600' },
});
