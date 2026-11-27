import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { spacing, typography, useTheme, type ThemeColors } from '../../../theme';

/** "— or —" divider between the Google button and the email form. */
export function OrDivider() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.row} accessibilityElementsHidden>
      <View style={styles.line} />
      <Text style={styles.text}>or</Text>
      <View style={styles.line} />
    </View>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginVertical: spacing.lg,
  },
  line: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  text: { ...typography.metadata, color: colors.textSecondary },
});
