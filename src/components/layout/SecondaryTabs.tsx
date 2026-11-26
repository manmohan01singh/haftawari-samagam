import React, { memo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { lightColors, nativeApp, radii, spacing } from '../../theme';

export interface SecondaryTabItem {
  key: string;
  label: string;
}

interface SecondaryTabsProps {
  items: SecondaryTabItem[];
  selectedKey: string;
  onSelect: (key: string) => void;
}

/**
 * Secondary text-pill row under the top bar (reference §1): ~16px
 * text; the selected item sits on a pale pill, unselected items are
 * plain text with no background. Callers pass only sections that
 * really exist in this app.
 */
export const SecondaryTabs = memo(function SecondaryTabs({ items, selectedKey, onSelect }: SecondaryTabsProps) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.scroll}
      contentContainerStyle={styles.row}
    >
      {items.map((item) => {
        const selected = item.key === selectedKey;
        return (
          <Pressable
            key={item.key}
            onPress={() => onSelect(item.key)}
            style={[styles.item, selected && styles.itemSelected]}
            accessibilityRole="button"
            accessibilityState={{ selected }}
          >
            <Text style={styles.label}>{item.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
});

const styles = StyleSheet.create({
  scroll: { flexGrow: 0 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    gap: spacing.xs,
  },
  item: {
    paddingHorizontal: nativeApp.secondaryTabs.horizontalPadding,
    paddingVertical: 7,
    borderRadius: radii.pill,
  },
  itemSelected: { backgroundColor: '#F8E9EC' },
  label: { fontSize: nativeApp.secondaryTabs.textSize, color: lightColors.text },
});
