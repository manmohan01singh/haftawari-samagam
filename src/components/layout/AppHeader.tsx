import React, { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { branding } from '../../config/branding';
import { layout, lightColors, spacing } from '../../theme';
import { ICON_HIT_SLOP } from '../../lib/touch';

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
 * left; actions at the right at 24px with ~22px spacing. The wordmark
 * uses branding.shortName — the full app name overflowed/squeezed the
 * action icons on mobile-width web (branding.ts reserves shortName
 * for exactly this compact header).
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
          {branding.shortName}
        </Text>
      </View>
      <View style={styles.actions}>
        <Pressable onPress={onSearchPress} hitSlop={ICON_HIT_SLOP} accessibilityLabel="Search" accessibilityRole="button">
          <MaterialIcons name="search" size={24} color={lightColors.text} />
        </Pressable>
        <Pressable onPress={onAccountPress} hitSlop={ICON_HIT_SLOP} accessibilityLabel="Account" accessibilityRole="button">
          {avatarUrl ? (
            <Image source={{ uri: avatarUrl }} style={styles.avatar} contentFit="cover" cachePolicy="memory-disk" />
          ) : avatarInitial ? (
            <View style={[styles.avatar, styles.avatarFallback]}>
              <Text style={styles.avatarInitial}>{avatarInitial}</Text>
            </View>
          ) : (
            // Signed out (QA issues 19/46): the fallback used to render
            // a literal "?" in a grey circle, which reads as a broken
            // image. A person glyph inside the avatar circle is the
            // honest signed-out affordance — the same treatment the
            // bottom-nav avatar slot uses, app-wide.
            <View style={[styles.avatar, styles.avatarFallback]}>
              <MaterialIcons name="person" size={18} color={lightColors.textSecondary} />
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
  // Round-2 measurement (ref-1): wordmark ~20dp, tight tracking,
  // sitting ~8dp from the play mark; right-side icons 24dp.
  wordmark: { fontSize: 20, fontWeight: '700', color: lightColors.text, letterSpacing: -0.5 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 22 },
  avatar: { width: 28, height: 28, borderRadius: 14 },
  avatarFallback: {
    backgroundColor: lightColors.surfaceVariant,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: { fontSize: 13, fontWeight: '600', color: lightColors.textSecondary },
});
