import React, { useState, useMemo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { supabase } from '../../../lib/supabase';
import { authRedirectUrl, friendlyAuthError } from '../authHelpers';
import { radii, spacing, useTheme, type ThemeColors } from '../../../theme';
import { GoogleGIcon } from './GoogleGIcon';

interface GoogleSignInButtonProps {
  /** Surface a failure on the hosting form — never fail silently. */
  onError: (message: string) => void;
}

/**
 * "Continue with Google" — Supabase OAuth (provider: google).
 *
 * On web this is a full-page redirect: the browser leaves for
 * Google's account picker (prompt=select_account, so the member
 * chooses which Google account to use) and returns to the PWA root
 * (authRedirectUrl — the same allow-listed target the email links
 * use), where detectSessionInUrl picks the session up and the app
 * lands signed-in on the main tabs. A failure BEFORE the redirect
 * (provider not yet enabled, network, …) comes back as an error
 * from signInWithOAuth and is shown on the form via onError; a
 * failure DURING the flow returns with error params in the URL and
 * is surfaced by AuthContext's linkError on the sign-in screen.
 */
export function GoogleSignInButton({ onError }: GoogleSignInButtonProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [busy, setBusy] = useState(false);

  const handlePress = async () => {
    if (busy) return;
    if (!supabase) {
      onError('Sign-in is not available: the backend is not configured.');
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: authRedirectUrl(),
          queryParams: { prompt: 'select_account' },
        },
      });
      if (error) {
        onError(friendlyAuthError(error).message);
        setBusy(false);
      }
      // No error: the browser is navigating to Google. Keep the
      // spinner — the page is leaving; re-enabling would invite a
      // double-tap that restarts the flow.
    } catch (e) {
      onError(friendlyAuthError(e).message);
      setBusy(false);
    }
  };

  return (
    <Pressable
      style={[styles.button, busy && styles.buttonBusy]}
      onPress={() => void handlePress()}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel="Continue with Google"
      accessibilityState={{ disabled: busy, busy }}
    >
      {busy ? (
        <ActivityIndicator size="small" color={colors.textSecondary} />
      ) : (
        <GoogleGIcon size={20} />
      )}
      <Text style={styles.label}>{busy ? 'Opening Google…' : 'Continue with Google'}</Text>
      {/* Keeps the label optically centred against the leading icon. */}
      <View style={styles.spacer} />
    </Pressable>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.pill,
    paddingVertical: 12,
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  buttonBusy: { opacity: 0.7 },
  label: { flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '600', color: colors.text },
  spacer: { width: 20 },
});
