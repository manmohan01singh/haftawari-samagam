import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { layout, lightColors, spacing, typography } from '../../theme';

export interface BottomNavItem {
  key: string;
  label: string;
  icon: string; // text glyph placeholder until the icon set lands in Phase 2
}

interface BottomNavProps {
  items: BottomNavItem[];
  activeKey: string;
  onPress: (key: string) => void;
}

/**
 * Mobile bottom navigation (native-app pattern from the audit):
 * Home · Shorts · Create · Subscriptions · You/Library.
 * Rendered by the tab navigator; safe-area padding is applied by the
 * navigator container.
 */
export function BottomNav({ items, activeKey, onPress }: BottomNavProps) {
  return (
    <View style={styles.bar}>
      {items.map((item) => {
        const active = item.key === activeKey;
        return (
          <Pressable
            key={item.key}
            style={styles.item}
            onPress={() => onPress(item.key)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
          >
            <Text style={[styles.icon, active && styles.iconActive]}>{item.icon}</Text>
            <Text style={[styles.label, active && styles.labelActive]}>{item.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    height: layout.bottomNavHeight,
    flexDirection: 'row',
    backgroundColor: lightColors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: lightColors.border,
    paddingBottom: spacing.xs,
  },
  item: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  icon: { fontSize: 20, color: lightColors.textSecondary },
  iconActive: { color: lightColors.text },
  label: { ...typography.metadata, color: lightColors.textSecondary },
  labelActive: { color: lightColors.text, fontWeight: '600' },
});
