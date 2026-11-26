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
            hitSlop={{ top: 4, bottom: 4, left: 2, right: 2 }}
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
  // Round-2 pixel pass, measured from ref-1-home.jpg (1080px-wide
  // capture, ÷2.62 for dp): the tab row is DENSE — selected pill
  // ~36dp tall with ~14dp horizontal padding, unselected labels
  // ~10-12dp apart, row ~38dp tall overall. The old geometry
  // (16dp item padding + 16dp row padding) spread Home/Subs/Live
  // across the whole width and read sparse next to the reference.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
    gap: 2,
  },
  item: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radii.pill,
  },
  itemSelected: { backgroundColor: '#F8E9EC' },
  label: { fontSize: nativeApp.secondaryTabs.textSize, color: lightColors.text },
});
