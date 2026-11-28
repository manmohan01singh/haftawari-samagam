import React, { memo, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import Svg, { Path, Rect } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { layout, useTheme, type ThemeColors } from '../../theme';
import { BarBlurBackground } from './BarBlurBackground';

export interface BottomNavItem {
  key: string;
  /** Kept for accessibility; NOT rendered — the native reference bar is icon-only. */
  label: string;
  /** MaterialIcons glyph name for icon slots. */
  icon?: string;
  /**
   * Optional glyph shown instead of `icon` while the slot is active
   * (filled/outline state pair). NOTE: MaterialIcons' glyphMap has NO
   * 'home-outline' and NO 'subscriptions-outline' (verified against
   * @expo/vector-icons glyphmaps, Phase 9) — the pairs this app's
   * slots would need do not exist in this icon family, so no caller
   * currently passes activeIcon; the active cue stays colour (full
   * text colour vs textSecondary) + the avatar slot's ring. The prop
   * exists so a future pair can be wired without another API change.
   * Do NOT switch icon libraries for this.
   */
  activeIcon?: string;
  /** 'create' renders the circled-+ glyph in reference proportions (the slot opens the official channel in this app — destination unchanged, glyph matched to ref in round 2); 'avatar' renders the profile slot; 'shorts' renders the Shorts glyph (a rounded frame with a play triangle — no icon font carries YouTube's Shorts mark, so it is drawn as SVG). */
  kind?: 'icon' | 'create' | 'avatar' | 'shorts';
  avatarUrl?: string | null;
  avatarInitial?: string | null;
}

interface BottomNavProps {
  items: BottomNavItem[];
  activeKey: string;
  onPress: (key: string) => void;
  /**
   * Overlay mode (used by MainTabs): the bar is positioned absolutely
   * over the screen content so content scrolls UNDER it and the blur
   * material (BarBlurBackground) has something to blur — in-flow, a
   * backdrop blur samples only the bar's own background and the
   * effect is invisible. Callers in overlay mode must give their
   * scroll content bottom padding ≥ the bar height. Non-overlay
   * callers (StackTabBar, Search) keep the in-flow layout with the
   * same translucent blur-tinted material.
   */
  overlay?: boolean;
}

/**
 * Bottom navigation (native-app reference §1 + the user's 26 Nov 2026
 * decision): 4 ICON-ONLY slots, no text labels — Home, Subscriptions,
 * circled +, profile avatar. There is deliberately NO Shorts slot:
 * the user decided the app has no Shorts anywhere. Bar is white with
 * a faint top hairline; the bar applies the bottom safe-area inset
 * itself (see below).
 */
export const BottomNav = memo(function BottomNav({ items, activeKey, onPress, overlay }: BottomNavProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  // The bar must clear the device gesture/home area itself — the old
  // comment claimed "the caller applies safe-area padding", but no
  // caller did, so on gesture-nav Android the slots sat under the
  // system gesture pill and taps near the bottom felt swallowed.
  const insets = useSafeAreaInsets();
  // Floor the inset: some gesture-nav devices report a near-zero
  // bottom inset, which left the slots visually colliding with the
  // system gesture pill in the first APK (user report, 27 Nov 2026).
  const bottomInset = Math.max(insets.bottom, 12);
  return (
    <View
      style={[
        styles.bar,
        { height: layout.bottomNavHeight + bottomInset },
        overlay && styles.barOverlay,
      ]}
    >
      <BarBlurBackground />
      <View style={[styles.row, { paddingBottom: bottomInset }]}>
      {items.map((item) => {
        const active = item.key === activeKey;
        return (
          <Pressable
            key={item.key}
            style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}
            onPress={() => onPress(item.key)}
            accessibilityRole="button"
            accessibilityLabel={item.label}
            accessibilityState={{ selected: active }}
          >
            {item.kind === 'create' ? (
              // Round-2 pixel pass: the reference centre slot is a
              // circled + (thin circle ~28dp, plus glyph ~20dp) — the
              // merged build's play-arrow circle read wrong at a
              // glance. The slot's DESTINATION is unchanged (it still
              // opens the official channel; only the glyph matches
              // the reference geometry now).
              <View style={styles.createCircle}>
                <MaterialIcons name="add" size={20} color={colors.text} />
              </View>
            ) : item.kind === 'shorts' ? (
              <Svg width={24} height={24} viewBox="0 0 24 24">
                {active ? (
                  <>
                    <Rect x={4} y={3} width={16} height={18} rx={5} fill={colors.text} />
                    <Path d="M10.2 8.6v6.8L15.8 12z" fill={colors.background} />
                  </>
                ) : (
                  <>
                    <Rect
                      x={4.9}
                      y={3.9}
                      width={14.2}
                      height={16.2}
                      rx={4.2}
                      fill="none"
                      stroke={colors.textSecondary}
                      strokeWidth={1.8}
                    />
                    <Path d="M10.2 8.6v6.8L15.8 12z" fill={colors.textSecondary} />
                  </>
                )}
              </Svg>
            ) : item.kind === 'avatar' ? (
              item.avatarUrl ? (
                <NavAvatarImage
                  uri={item.avatarUrl}
                  style={[styles.avatar, active && styles.avatarActive]}
                  fallback={
                    item.avatarInitial ? (
                      <View style={[styles.avatar, styles.avatarFallback, active && styles.avatarActive]}>
                        <Text style={styles.avatarInitial}>{item.avatarInitial}</Text>
                      </View>
                    ) : (
                      <View style={[styles.avatar, styles.avatarFallback, active && styles.avatarActive]}>
                        <MaterialIcons name="person" size={18} color={colors.textSecondary} />
                      </View>
                    )
                  }
                />
              ) : item.avatarInitial ? (
                <View style={[styles.avatar, styles.avatarFallback, active && styles.avatarActive]}>
                  <Text style={styles.avatarInitial}>{item.avatarInitial}</Text>
                </View>
              ) : (
                // Signed out (QA issues 19/46/50): no "?" placeholder —
                // a person glyph inside the avatar circle, the same
                // treatment the header account slot uses, app-wide.
                <View style={[styles.avatar, styles.avatarFallback, active && styles.avatarActive]}>
                  <MaterialIcons name="person" size={18} color={colors.textSecondary} />
                </View>
              )
            ) : (
              // Round-2 pixel pass: the reference has NO pill behind
              // the active icon (that was a QA-21 addition; the
              // round-2 master prompt's selected-state-as-in-ref
              // instruction overrides it). Active = full-strength
              // black glyph, inactive = dimmed glyph, both 24dp,
              // no background shape — exactly the ref-1 bottom bar.
              <MaterialIcons
                name={((active && item.activeIcon) || item.icon || 'home') as keyof typeof MaterialIcons.glyphMap}
                size={24}
                color={active ? colors.text : colors.textSecondary}
              />
            )}
          </Pressable>
        );
      })}
      </View>
    </View>
  );
});

/**
 * Avatar photo with an honest fallback: if the URL fails to load
 * (stale Google DP URL, no network) the slot falls back to the
 * initial/person treatment instead of a broken-image circle.
 */
function NavAvatarImage({
  uri,
  style,
  fallback,
}: {
  uri: string;
  style: React.ComponentProps<typeof Image>['style'];
  fallback: React.ReactNode;
}) {
  // Remember WHICH uri failed so a changed uri gets a fresh try.
  const [failedUri, setFailedUri] = React.useState<string | null>(null);
  if (failedUri === uri) return <>{fallback}</>;
  return (
    <Image
      source={{ uri }}
      style={style}
      contentFit="cover"
      cachePolicy="memory-disk"
      onError={() => setFailedUri(uri)}
    />
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  bar: {
    height: layout.bottomNavHeight,
    // No solid background: BarBlurBackground (translucent white +
    // backdrop blur) is the bar's material now (user request,
    // 27 Nov 2026). Geometry from round 2 is unchanged.
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    overflow: 'hidden',
  },
  barOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 10,
    elevation: 10,
  },
  row: { flex: 1, flexDirection: 'row' },
  item: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  // Pressed feedback (Phase 9): the bar previously gave NO visual
  // response to a tap. Opacity dip, matching StackHeader's back.
  itemPressed: { opacity: 0.6 },
  createCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.text,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatar: { width: 28, height: 28, borderRadius: 14 },
  // Active-state cue for the avatar slot (QA 50): a 2px ring in the
  // primary text colour; icon slots cue by glyph colour only (full
  // text colour active vs textSecondary inactive — NO pill, per ref).
  avatarActive: { borderWidth: 2, borderColor: colors.text },
  avatarFallback: {
    backgroundColor: colors.surfaceVariant,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
});
