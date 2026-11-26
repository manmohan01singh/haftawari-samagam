import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { lightColors, spacing, typography } from '../../theme';

interface EmptyStateProps {
  title: string;
  message?: string;
}

/**
 * Honest empty state. Every list screen renders this when the backend
 * returns nothing (or is not configured yet) — never placeholder content.
 */
export function EmptyState({ title, message }: EmptyStateProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      {message ? <Text style={styles.message}>{message}</Text> : null}
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
});
