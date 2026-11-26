import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { lightColors, spacing, typography } from '../../theme';

interface ChipsRowProps {
  /** Category labels come from the `categories` table — never hard-coded content. */
  chips: string[];
  selected?: string;
  onSelect?: (chip: string) => void;
}

/** Horizontally scrolling category chips; the selected chip is inverted. */
export function ChipsRow({ chips, selected, onSelect }: ChipsRowProps) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.scroll}
      contentContainerStyle={styles.row}
    >
      {chips.map((chip) => {
        const isSelected = chip === selected;
        return (
          <Pressable
            key={chip}
            onPress={() => onSelect?.(chip)}
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

const styles = StyleSheet.create({
  // flexGrow 0 is load-bearing on web: without it a horizontal
  // ScrollView in a column stretches vertically and pushes the feed
  // down / leaves a tall empty band under the chips.
  scroll: { flexGrow: 0, flexShrink: 0 },
  row: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, gap: spacing.sm },
  chip: {
    backgroundColor: lightColors.surfaceVariant,
    // YouTube category chips are ~8px radius, 32px tall — not the
    // 12px card radius used for thumbnails.
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  chipSelected: { backgroundColor: lightColors.selectedChipBackground },
  label: { ...typography.chip, color: lightColors.text },
  labelSelected: { color: lightColors.selectedChipText },
});
