import React, { memo, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { branding } from '../../config/branding';
import { layout, spacing, useTheme, type ThemeColors } from '../../theme';
import { ICON_HIT_SLOP } from '../../lib/touch';
import { BarBlurBackground } from './BarBlurBackground';

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
 * 56px, white, no bottom border; the app's OWN brand mark (jot
 * emblem tile, Phase 9 / audit D1 — the previous red play-rect was
 * a YouTube lookalike and is gone) + app wordmark at the left;
 * actions at the right at 24px with ~22px spacing. The wordmark
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
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  // Edge-to-edge Android draws under the status bar; the bar must
  // carry the top inset itself or the wordmark collides with the
  // system status icons (user report, 27 Nov 2026, first APK).
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { paddingTop: insets.top, height: layout.headerHeight + insets.top }]}>
      <BarBlurBackground />
      <View style={styles.brand}>
        <Image
          source={require('../../../assets/icon.png')}
          style={styles.brandMark}
          contentFit="cover"
          accessibilityLabel={branding.appName}
        />
        <Text style={styles.wordmark} numberOfLines={1}>
          {branding.shortName}
        </Text>
        <Text style={styles.wordmarkSuffix} numberOfLines={1}>
          {branding.wordmarkSuffix}
        </Text>
      </View>
      <View style={styles.actions}>
        <Pressable onPress={onSearchPress} hitSlop={ICON_HIT_SLOP} accessibilityLabel="Search" accessibilityRole="button">
          <MaterialIcons name="search" size={24} color={colors.text} />
        </Pressable>
        <Pressable onPress={onAccountPress} hitSlop={ICON_HIT_SLOP} accessibilityLabel="Account" accessibilityRole="button">
          {avatarUrl ? (
            <HeaderAvatarImage
              uri={avatarUrl}
              fallback={
                avatarInitial ? (
                  <View style={[styles.avatar, styles.avatarFallback]}>
                    <Text style={styles.avatarInitial}>{avatarInitial}</Text>
                  </View>
                ) : (
                  <View style={[styles.avatar, styles.avatarFallback]}>
                    <MaterialIcons name="person" size={18} color={colors.textSecondary} />
                  </View>
                )
              }
            />
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
              <MaterialIcons name="person" size={18} color={colors.textSecondary} />
            </View>
          )}
        </Pressable>
      </View>
    </View>
  );
});

/**
 * Account-slot photo with fallback: a failed load (stale Google DP
 * URL, offline) falls back to the initial/person treatment rather
 * than leaving a broken-image circle.
 */
function HeaderAvatarImage({ uri, fallback }: { uri: string; fallback: React.ReactNode }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  // Remember WHICH uri failed so a changed uri gets a fresh try.
  const [failedUri, setFailedUri] = React.useState<string | null>(null);
  if (failedUri === uri) return <>{fallback}</>;
  return (
    <Image
      source={{ uri }}
      style={styles.avatar}
      contentFit="cover"
      cachePolicy="memory-disk"
      onError={() => setFailedUri(uri)}
    />
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  bar: {
    height: layout.headerHeight,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    // Translucent blur material (BarBlurBackground), same as the
    // bottom bar — no solid fill (user request, 27 Nov 2026).
    overflow: 'hidden',
  },
  brand: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexShrink: 1 },
  brandMark: {
    width: 30,
    height: 30,
    borderRadius: 8,
  },
  // Round-2 measurement (ref-1): wordmark ~20dp, tight tracking,
  // sitting ~8dp from the brand mark; right-side icons 24dp.
  // letterSpacing -0.3 matches the web splash shell (public/index.html).
  wordmark: { fontSize: 20, fontWeight: '700', color: colors.text, letterSpacing: -0.5 },
  wordmarkSuffix: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textSecondary,
    marginLeft: 4,
    marginTop: 2,
    alignSelf: 'flex-start',
  },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 22 },
  avatar: { width: 28, height: 28, borderRadius: 14 },
  avatarFallback: {
    backgroundColor: colors.surfaceVariant,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
});
