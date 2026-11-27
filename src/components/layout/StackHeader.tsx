import React, { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { layout, lightColors, spacing, typography } from '../../theme';

interface StackHeaderProps {
  /** Optional screen title shown beside the back button (16/600). */
  title?: string;
  /** Back action — callers pass their existing goBackOrTab handler unchanged. */
  onBack: () => void;
  /** Optional right-side actions (search icon, gear, …), rendered as-is. */
  right?: React.ReactNode;
}

/**
 * Shared header for stack screens (Phase 9, forensic audit §11 item 3):
 * ONE back placement for every stacked screen — back arrow at the left
 * edge, 24dp glyph in a 48×48 target, optional title beside it, caller
 * actions at the right. Replaces the per-screen hand-rolled back rows,
 * whose positions/sizes had drifted screen to screen.
 *
 * Geometry matches AppHeader: 56dp tall, 16dp horizontal padding,
 * surface background with a hairline bottom border.
 */
/**
 * The ONE back control used across the app (Phase 9): 24dp glyph in a
 * 48×48 target, pressed opacity 0.6. StackHeader renders it at the
 * bar's left edge; the Watch / SessionWatch sheets render it in their
 * header zone above the title (a full StackHeader bar cannot live
 * inside a rounded sheet, but the control itself stays identical).
 */
export const BackButton = memo(function BackButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
      accessibilityLabel="Back"
      accessibilityRole="button"
    >
      <MaterialIcons name="arrow-back" size={24} color={lightColors.text} />
    </Pressable>
  );
});

export const StackHeader = memo(function StackHeader({ title, onBack, right }: StackHeaderProps) {
  return (
    <View style={styles.bar}>
      <View style={styles.left}>
        <BackButton onPress={onBack} />
        {title ? (
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
        ) : null}
      </View>
      {right ? <View style={styles.right}>{right}</View> : null}
    </View>
  );
});

const styles = StyleSheet.create({
  bar: {
    height: layout.headerHeight,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    backgroundColor: lightColors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: lightColors.border,
  },
  left: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexShrink: 1 },
  // 48×48 target with the glyph centred; negative left margin pulls the
  // GLYPH to the same 16dp inset the bar padding gives other content,
  // while the touch area extends to the screen edge side.
  backButton: {
    width: 48,
    height: 48,
    marginLeft: -12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.6 },
  title: {
    fontSize: typography.cardTitle.fontSize,
    fontWeight: typography.cardTitle.fontWeight,
    color: lightColors.text,
    flexShrink: 1,
  },
  right: { flexDirection: 'row', alignItems: 'center', gap: 22 },
});
