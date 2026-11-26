import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { lightColors, radii, spacing, typography } from '../../theme';

interface ChipsRowProps {
  /** Category labels come from the `categories` table — never hard-coded content. */
  chips: string[];
  selected?: string;
  onSelect?: (chip: string) => void;
}

/** Horizontally scrolling category chips; the selected chip is inverted. */
export function ChipsRow({ chips, selected, onSelect }: ChipsRowProps) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
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
  row: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, gap: spacing.sm },
  chip: {
    backgroundColor: lightColors.surfaceVariant,
    borderRadius: radii.card,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
  },
  chipSelected: { backgroundColor: lightColors.selectedChipBackground },
  label: { ...typography.chip, color: lightColors.text },
  labelSelected: { color: lightColors.selectedChipText },
});
