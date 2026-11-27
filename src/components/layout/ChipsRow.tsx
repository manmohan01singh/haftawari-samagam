import React, { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { radii, spacing, typography, useTheme, type ThemeColors } from '../../theme';

interface ChipsRowProps {
  /** Category labels come from the `categories` table — never hard-coded content. */
  chips: string[];
  selected?: string;
  onSelect?: (chip: string) => void;
}

/** Horizontally scrolling category chips; the selected chip is inverted. */
export function ChipsRow({ chips, selected, onSelect }: ChipsRowProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.scroll}
      contentContainerStyle={styles.row}
      keyboardShouldPersistTaps="handled"
    >
      {chips.map((chip) => {
        const isSelected = chip === selected;
        return (
          <Pressable
            key={chip}
            onPress={() => onSelect?.(chip)}
            hitSlop={{ top: 6, bottom: 6, left: 2, right: 2 }}
            style={[styles.chip, isSelected && styles.chipSelected]}
            accessibilityRole="button"
            accessibilityState={{ selected: isSelected }}
          >
            <Text style={[styles.label, isSelected && styles.labelSelected]}>{chip}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  // flexGrow 0 is load-bearing on web: without it a horizontal
  // ScrollView in a column stretches vertically and pushes the feed
  // down / leaves a tall empty band under the chips.
  scroll: { flexGrow: 0, flexShrink: 0 },
  row: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, gap: spacing.sm },
  chip: {
    backgroundColor: colors.surfaceVariant,
    // YouTube category chips are ~8px radius, 32px tall — not the
    // 12px card radius used for thumbnails. Phase 9 W2: radii.chipRadius.
    borderRadius: radii.chipRadius,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  chipSelected: { backgroundColor: colors.selectedChipBackground },
  label: { ...typography.chip, color: colors.text },
  labelSelected: { color: colors.selectedChipText },
});
