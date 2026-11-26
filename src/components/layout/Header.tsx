import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { branding } from '../../config/branding';
import { layout, lightColors, spacing, typography } from '../../theme';

/**
 * Top header — audited geometry: 56px sticky bar.
 * Desktop: menu control · product identity · centred search · actions.
 * Mobile: identity · search icon · avatar (rendered by the same bar;
 * responsive collapsing is a Phase 2 layout task).
 * Phase 1 stub: identity + search affordance slots, no behaviour yet.
 */
export function Header() {
  return (
    <View style={styles.bar}>
      <Text style={styles.menu} accessibilityLabel="Open menu">
        ☰
      </Text>
      <Text style={styles.brand}>
        <Text style={styles.playMark}>▶</Text> {branding.appName}
      </Text>
      <View style={styles.searchSlot}>
        <Text style={styles.searchPlaceholder}>Search</Text>
      </View>
      <View style={styles.actions} />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    height: layout.headerHeight,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    backgroundColor: lightColors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: lightColors.border,
  },
  menu: { fontSize: 20, color: lightColors.text, marginRight: spacing.lg },
  brand: { ...typography.cardTitle, color: lightColors.text },
  playMark: { color: lightColors.accent },
  searchSlot: {
    flex: 1,
    marginHorizontal: spacing.xl,
    height: 40,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: lightColors.border,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  searchPlaceholder: { ...typography.body, color: lightColors.textSecondary },
  actions: { width: 96 },
});
