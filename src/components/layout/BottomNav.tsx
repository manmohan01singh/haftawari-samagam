import React, { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { layout, lightColors } from '../../theme';

export interface BottomNavItem {
  key: string;
  /** Kept for accessibility; NOT rendered — the native reference bar is icon-only. */
  label: string;
  /** MaterialIcons glyph name for icon slots. */
  icon?: string;
  /** 'create' renders the circled + ; 'avatar' renders the profile slot. */
  kind?: 'icon' | 'create' | 'avatar';
  avatarUrl?: string | null;
  avatarInitial?: string | null;
}

interface BottomNavProps {
  items: BottomNavItem[];
  activeKey: string;
  onPress: (key: string) => void;
}

/**
 * Bottom navigation (native-app reference §1 + the user's 26 Nov 2026
 * decision): 4 ICON-ONLY slots, no text labels — Home, Subscriptions,
 * circled +, profile avatar. There is deliberately NO Shorts slot:
 * the user decided the app has no Shorts anywhere. Bar is white with
 * a faint top hairline; the bar applies the bottom safe-area inset
 * itself (see below).
 */
export const BottomNav = memo(function BottomNav({ items, activeKey, onPress }: BottomNavProps) {
  // The bar must clear the device gesture/home area itself — the old
  // comment claimed "the caller applies safe-area padding", but no
  // caller did, so on gesture-nav Android the slots sat under the
  // system gesture pill and taps near the bottom felt swallowed.
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { height: layout.bottomNavHeight + insets.bottom, paddingBottom: insets.bottom }]}>
      {items.map((item) => {
        const active = item.key === activeKey;
        return (
          <Pressable
            key={item.key}
            style={styles.item}
            onPress={() => onPress(item.key)}
            accessibilityRole="button"
            accessibilityLabel={item.label}
            accessibilityState={{ selected: active }}
          >
            {item.kind === 'create' ? (
              <View style={styles.createCircle}>
                <MaterialIcons name="add" size={22} color={lightColors.text} />
              </View>
            ) : item.kind === 'avatar' ? (
              item.avatarUrl ? (
                <Image
                  source={{ uri: item.avatarUrl }}
                  style={styles.avatar}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                />
              ) : item.avatarInitial ? (
                <View style={[styles.avatar, styles.avatarFallback]}>
                  <Text style={styles.avatarInitial}>{item.avatarInitial}</Text>
                </View>
              ) : (
                // Signed out: a person glyph, never a bare "?". A "?"
                // avatar reads as a broken/unknown button; the person
                // icon is the universal "you / account" affordance and
                // matches the AppHeader account slot.
                <View style={[styles.avatar, styles.avatarFallback]}>
                  <MaterialIcons name="person" size={18} color={lightColors.textSecondary} />
                </View>
              )
            ) : (
              <MaterialIcons
                name={(item.icon ?? 'home') as keyof typeof MaterialIcons.glyphMap}
                size={26}
                color={active ? lightColors.text : lightColors.textSecondary}
              />
            )}
          </Pressable>
        );
      })}
    </View>
  );
});

const styles = StyleSheet.create({
  bar: {
    height: layout.bottomNavHeight,
    flexDirection: 'row',
    backgroundColor: lightColors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: lightColors.border,
  },
  item: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  createCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1.5,
    borderColor: lightColors.text,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatar: { width: 28, height: 28, borderRadius: 14 },
  avatarFallback: {
    backgroundColor: lightColors.surfaceVariant,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: { fontSize: 13, fontWeight: '600', color: lightColors.textSecondary },
});
