import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { layout, lightColors, spacing, typography } from '../../theme';

/** Desktop sidebar items, in the audited order. */
export const SIDEBAR_ITEMS = [
  'Home',
  'Shorts',
  'Subscriptions',
  'History',
  'Playlists',
  'Your videos',
  'Watch later',
  'Liked videos',
] as const;

interface SidebarProps {
  collapsed?: boolean;
  activeItem?: (typeof SIDEBAR_ITEMS)[number];
}

/**
 * Desktop sidebar — 240px expanded / 72px mini guide (icons + tiny
 * labels). Phase 1 stub renders the item list; expand/collapse wiring
 * and the subscriptions section arrive with the Phase 2 home screen.
 */
export function Sidebar({ collapsed = false, activeItem = 'Home' }: SidebarProps) {
  return (
    <View style={[styles.container, { width: collapsed ? layout.sidebarCollapsedWidth : layout.sidebarExpandedWidth }]}>
      {SIDEBAR_ITEMS.map((item) => (
        <View key={item} style={[styles.row, item === activeItem && styles.rowActive]}>
          <Text style={styles.label} numberOfLines={collapsed ? 1 : undefined}>
            {collapsed ? item.charAt(0) : item}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: lightColors.surface,
    paddingVertical: spacing.sm,
  },
  row: {
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    borderRadius: 10,
    marginHorizontal: spacing.sm,
  },
  rowActive: { backgroundColor: lightColors.surfaceVariant },
  label: { ...typography.body, color: lightColors.text },
});
