import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { lightColors, radii, spacing, typography } from '../../theme';

interface EmptyStateProps {
  title: string;
  message?: string;
  /** Optional action button (e.g. "Try again", "Sign in") — an error or
   * signed-out state with no action on screen is a dead end. */
  actionLabel?: string;
  onAction?: () => void;
}

/**
 * Honest empty state. Every list screen renders this when the backend
 * returns nothing (or is not configured yet) — never placeholder content.
 */
export function EmptyState({ title, message, actionLabel, onAction }: EmptyStateProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      {message ? <Text style={styles.message}>{message}</Text> : null}
      {actionLabel && onAction ? (
        <Pressable style={styles.button} onPress={onAction} accessibilityRole="button">
          <Text style={styles.buttonText}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    // Transparent: the host screen owns the page ground (Home's feed
    // ground is light grey; a hard-coded white here painted a white
    // box over it).
    backgroundColor: 'transparent',
  },
  title: {
    ...typography.sectionTitle,
    color: lightColors.text,
    textAlign: 'center',
  },
  message: {
    ...typography.body,
    color: lightColors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  button: {
    backgroundColor: lightColors.subscribeBackground,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.xl,
    paddingVertical: 11,
    marginTop: spacing.lg,
  },
  buttonText: { fontSize: 15, fontWeight: '600', color: lightColors.subscribeText },
});
