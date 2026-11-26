import React, { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { MaterialIcons } from '@expo/vector-icons';
import { branding } from '../../config/branding';
import { layout, lightColors, spacing } from '../../theme';

interface AppHeaderProps {
  onSearchPress: () => void;
  onAccountPress: () => void;
  /** Signed-in user's avatar image, when one exists. */
  avatarUrl?: string | null;
  /** Fallback initial for the account slot. */
  avatarInitial?: string | null;
}

/**
 * Mobile top bar, geometry from the native-app reference (§1):
 * 56px, white, no bottom border; red play mark + app wordmark at the
 * left; actions at the right at 24px with ~22px spacing.
 *
 * Only actions with real destinations are rendered (Search, Account).
 * The reference's cast and notification-bell icons have no backend in
 * this app (no casting, no notifications), so they are omitted rather
 * than shown as dead buttons — see the Phase 2 report.
 */
export const AppHeader = memo(function AppHeader({
  onSearchPress,
  onAccountPress,
  avatarUrl,
  avatarInitial,
}: AppHeaderProps) {
  return (
    <View style={styles.bar}>
      <View style={styles.brand}>
        <View style={styles.playMark}>
          <MaterialIcons name="play-arrow" size={16} color="#FFFFFF" />
        </View>
        <Text style={styles.wordmark} numberOfLines={1}>
          {branding.appName}
        </Text>
      </View>
      <View style={styles.actions}>
        <Pressable onPress={onSearchPress} hitSlop={8} accessibilityLabel="Search">
          <MaterialIcons name="search" size={24} color={lightColors.text} />
        </Pressable>
        <Pressable onPress={onAccountPress} hitSlop={8} accessibilityLabel="Account">
          {avatarUrl ? (
            <Image source={{ uri: avatarUrl }} style={styles.avatar} contentFit="cover" cachePolicy="memory-disk" />
          ) : avatarInitial ? (
            <View style={[styles.avatar, styles.avatarFallback]}>
              <Text style={styles.avatarInitial}>{avatarInitial}</Text>
            </View>
          ) : (
            <View style={[styles.avatar, styles.avatarFallback]}>
              <MaterialIcons name="person" size={19} color={lightColors.textSecondary} />
            </View>
          )}
        </Pressable>
      </View>
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
  },
  brand: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexShrink: 1 },
  playMark: {
    width: 30,
    height: 21,
    borderRadius: 6,
    backgroundColor: lightColors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wordmark: { fontSize: 19, fontWeight: '700', color: lightColors.text, letterSpacing: -0.3 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 22 },
  avatar: { width: 28, height: 28, borderRadius: 14 },
  avatarFallback: {
    backgroundColor: lightColors.surfaceVariant,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: { fontSize: 13, fontWeight: '600', color: lightColors.textSecondary },
});
