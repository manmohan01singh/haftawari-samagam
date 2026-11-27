import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { lightColors, spacing, typography } from '../../../theme';

/** "— or —" divider between the Google button and the email form. */
export function OrDivider() {
  return (
    <View style={styles.row} accessibilityElementsHidden>
      <View style={styles.line} />
      <Text style={styles.text}>or</Text>
      <View style={styles.line} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginVertical: spacing.lg,
  },
  line: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: lightColors.border },
  text: { ...typography.metadata, color: lightColors.textSecondary },
});
