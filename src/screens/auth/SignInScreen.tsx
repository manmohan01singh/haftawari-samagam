import React, { useMemo, useRef, useState, type ElementRef } from 'react';
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
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { branding } from '../../config/branding';
import { goBackOrTab } from '../../navigation/safeBack';
import { isSupabaseConfigured, supabase } from '../../lib/supabase';
import { useAuth } from '../../features/auth/AuthContext';
import { GoogleSignInButton } from '../../features/auth/components/GoogleSignInButton';
import { OrDivider } from '../../features/auth/components/OrDivider';
import { authRedirectUrl, friendlyAuthError, type AuthErrorKind } from '../../features/auth/authHelpers';
import { radii, spacing, typography, useTheme, type ThemeColors } from '../../theme';
import type { RootStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'SignIn'>;

/**
 * Email sign-in (Supabase Auth). Failures are mapped to clear human
 * messages on the form (wrong credentials vs unconfirmed email vs
 * network vs rate limit) — previously the raw GoTrue string was shown
 * verbatim and an unconfirmed-email failure offered no way forward,
 * so every failure read as "login doesn't work".
 */
export function SignInScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  // Set when the user landed here from a FAILED email link (expired /
  // already used) — explains why they are signed out.
  const { linkError } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<AuthErrorKind | null>(null);
  const [resetBusy, setResetBusy] = useState(false);
  const [resetMessage, setResetMessage] = useState<string | null>(null);
  const [resendBusy, setResendBusy] = useState(false);
  const [resendMessage, setResendMessage] = useState<string | null>(null);

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const formValid = emailValid && password.length > 0;
  const invalidReason = !email.trim()
    ? 'Enter your email and password to sign in.'
    : !emailValid
      ? 'That email address does not look complete — check for an @ and a domain.'
      : !password
        ? 'Enter your password to sign in.'
        : null;

  const passwordRef = useRef<ElementRef<typeof TextInput>>(null);
  const submit = async () => {
    if (!supabase || !formValid) return;
    setBusy(true);
    setError(null);
    setErrorKind(null);
    setResendMessage(null);
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        // Email is an identifier: trim stray spaces and normalise
        // case. The password is passed EXACTLY as typed — never
        // trimmed (spaces can be part of a password).
        email: email.trim().toLowerCase(),
        password,
      });
      if (signInError) {
        const friendly = friendlyAuthError(signInError);
        setError(friendly.message);
        setErrorKind(friendly.kind);
        return;
      }
    } catch (e) {
      const friendly = friendlyAuthError(e);
      setError(friendly.message);
      setErrorKind(friendly.kind);
      return;
    } finally {
      setBusy(false);
    }
    goBackOrTab(navigation, 'Library');
  };

  // Resend the sign-up confirmation email (shown when sign-in fails
  // with "email not confirmed"). Same redirect target as sign-up.
  const resendConfirmation = async () => {
    if (!supabase || !emailValid) return;
    setResendBusy(true);
    setResendMessage(null);
    try {
      const { error: resendError } = await supabase.auth.resend({
        type: 'signup',
        email: email.trim().toLowerCase(),
        options: { emailRedirectTo: authRedirectUrl() },
      });
      if (resendError) {
        setResendMessage(friendlyAuthError(resendError).message);
        return;
      }
      setResendMessage('Confirmation email sent again — check your inbox and tap its link, then sign in.');
    } catch (e) {
      setResendMessage(friendlyAuthError(e).message);
    } finally {
      setResendBusy(false);
    }
  };

  // Real password reset via Supabase Auth (QA 105). The reset email
  // must link back to the PWA root itself (authRedirectUrl) — the old
  // code used origin + the CURRENT pathname, so tapping "Forgot
  // password?" from the /sign-in route produced a redirect target of
  // …/haftawari-samagam/sign-in, a path GitHub Pages cannot serve on
  // direct load (404) and which is not the allow-listed URL.
  const forgotPassword = async () => {
    if (!supabase) return;
    if (!emailValid) {
      setError('Enter your email address above first, then tap Forgot password again.');
      setErrorKind(null);
      return;
    }
    setResetBusy(true);
    setError(null);
    setErrorKind(null);
    setResetMessage(null);
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(
        email.trim().toLowerCase(),
        { redirectTo: authRedirectUrl() },
      );
      if (resetError) {
        const friendly = friendlyAuthError(resetError);
        setError(friendly.message);
        setErrorKind(friendly.kind);
        return;
      }
      setResetMessage(
        'Password reset email sent — check your email and tap the link. It brings you back here to set a new password.',
      );
    } catch (e) {
      const friendly = friendlyAuthError(e);
      setError(friendly.message);
      setErrorKind(friendly.kind);
    } finally {
      setResetBusy(false);
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
          <MaterialIcons name="arrow-back" size={24} color={colors.text} />
        </Pressable>
        <Pressable
          onPress={() => navigation.navigate('MainTabs', { screen: 'Home' })}
          hitSlop={10}
          accessibilityLabel="Go to Home"
          accessibilityRole="button"
        >
          <MaterialIcons name="home" size={24} color={colors.text} />
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
          <GoogleSignInButton
            onError={(message) => {
              setError(message);
              setErrorKind('oauth');
              setResendMessage(null);
              setResetMessage(null);
            }}
          />
          <OrDivider />
          <Text style={styles.label}>Email</Text>
          <TextInput
            style={styles.input}
            placeholder="you@example.com"
            placeholderTextColor={colors.textSecondary}
            autoCapitalize="none"
            autoComplete="email"
            textContentType="emailAddress"
            keyboardType="email-address"
            returnKeyType="next"
            onSubmitEditing={() => passwordRef.current?.focus()}
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
              placeholder="Your password"
              placeholderTextColor={colors.textSecondary}
              autoCapitalize="none"
              autoCorrect={false}
              ref={passwordRef}
              autoComplete="password"
              textContentType="password"
              returnKeyType="done"
              onSubmitEditing={() => {
                if (formValid && !busy) void submit();
              }}
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
                color={colors.textSecondary}
              />
            </Pressable>
          </View>
          {linkError && !error ? <Text style={styles.error}>{linkError}</Text> : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}
          {errorKind === 'not_confirmed' ? (
            <Pressable
              onPress={() => void resendConfirmation()}
              disabled={resendBusy}
              accessibilityRole="button"
              style={styles.resendRow}
            >
              <Text style={styles.forgotText}>
                {resendBusy ? 'Sending confirmation email…' : 'Resend confirmation email'}
              </Text>
            </Pressable>
          ) : null}
          {resendMessage ? <Text style={styles.success}>{resendMessage}</Text> : null}
          {resetMessage ? <Text style={styles.success}>{resetMessage}</Text> : null}
          <Pressable onPress={() => void forgotPassword()} disabled={resetBusy} accessibilityRole="button" style={styles.forgotRow}>
            <Text style={styles.forgotText}>{resetBusy ? 'Sending reset email…' : 'Forgot password?'}</Text>
          </Pressable>
          <Pressable
            style={[styles.primaryButton, (busy || !formValid) && styles.buttonDisabled]}
            onPress={submit}
            disabled={busy || !formValid}
            accessibilityRole="button"
          >
            {busy ? (
              <ActivityIndicator color={colors.subscribeText} />
            ) : (
              <Text style={styles.primaryButtonText}>Sign In</Text>
            )}
          </Pressable>
          {!formValid && invalidReason ? <Text style={styles.helper}>{invalidReason}</Text> : null}
          {busy ? <Text style={styles.helper}>Signing you in…</Text> : null}
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

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, paddingHorizontal: spacing.xl, width: '100%', maxWidth: 480, alignSelf: 'center' },
  topRow: { paddingTop: spacing.xl, marginBottom: spacing.lg, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  brand: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xxl },
  playMark: {
    width: 34,
    height: 24,
    borderRadius: 7,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wordmark: { fontSize: 21, fontWeight: '700', color: colors.text, letterSpacing: -0.3 },
  heading: { ...typography.watchTitle, color: colors.text, marginBottom: spacing.lg },
  input: {
    backgroundColor: colors.surfaceVariant,
    borderRadius: radii.card,
    paddingHorizontal: spacing.lg,
    paddingVertical: 14,
    fontSize: 16,
    color: colors.text,
    marginBottom: spacing.md,
  },
  error: { ...typography.body, color: colors.accent, marginBottom: spacing.md },
  label: { ...typography.chip, color: colors.text, marginBottom: spacing.xs, marginTop: spacing.sm },
  fieldError: { ...typography.metadata, color: colors.accent, marginBottom: spacing.sm },
  success: { ...typography.body, color: colors.text, marginBottom: spacing.md },
  helper: { ...typography.metadata, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.sm },
  forgotRow: { alignSelf: 'flex-end', paddingVertical: spacing.sm },
  resendRow: { alignSelf: 'flex-start', paddingVertical: spacing.sm },
  forgotText: { ...typography.chip, color: colors.text },
  passwordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceVariant,
    borderRadius: radii.card,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  passwordInput: { flex: 1, paddingVertical: 14, fontSize: 16, color: colors.text },
  primaryButton: {
    backgroundColor: colors.subscribeBackground,
    borderRadius: radii.pill,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  buttonDisabled: { opacity: 0.5 },
  primaryButtonText: { fontSize: 16, fontWeight: '600', color: colors.subscribeText },
  switchRow: { alignItems: 'center', marginTop: spacing.xl, paddingVertical: spacing.md, minHeight: 44, justifyContent: 'center' },
  switchText: { ...typography.body, color: colors.textSecondary },
  switchStrong: { color: colors.text, fontWeight: '600' },
});
