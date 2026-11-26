import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { lightColors, radii, spacing, typography } from '../../../theme';

interface ScreenMessageProps {
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
}

/**
 * Centred full-screen message with an optional action button — the
 * library screens' loading / error / signed-out / empty surfaces.
 * (EmptyState has no button; this is its actionable sibling.)
 */
export function ScreenMessage({ title, message, actionLabel, onAction }: ScreenMessageProps) {
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

export function ScreenLoading({ label = 'Loading…' }: { label?: string }) {
  return (
    <View style={styles.container}>
      <ActivityIndicator color={lightColors.text} />
      <Text style={[styles.message, styles.loadingLabel]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    backgroundColor: lightColors.background,
  },
  title: { ...typography.sectionTitle, color: lightColors.text, textAlign: 'center' },
  message: {
    ...typography.body,
    color: lightColors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  loadingLabel: { marginTop: spacing.md },
  button: {
    backgroundColor: lightColors.subscribeBackground,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.xl,
    paddingVertical: 11,
    minHeight: 44,
    justifyContent: 'center',
    marginTop: spacing.lg,
  },
  buttonText: { fontSize: 15, fontWeight: '600', color: lightColors.subscribeText },
});
