import React, { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { layout, lightColors } from '../../theme';

export interface BottomNavItem {
  key: string;
  /** Kept for accessibility; NOT rendered — the native reference bar is icon-only. */
  label: string;
  /** MaterialIcons glyph name for icon slots. */
  icon?: string;
  /** 'create' renders the circled-+ glyph in reference proportions (the slot opens the official channel in this app — destination unchanged, glyph matched to ref in round 2); 'avatar' renders the profile slot. */
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
              // Round-2 pixel pass: the reference centre slot is a
              // circled + (thin circle ~28dp, plus glyph ~20dp) — the
              // merged build's play-arrow circle read wrong at a
              // glance. The slot's DESTINATION is unchanged (it still
              // opens the official channel; only the glyph matches
              // the reference geometry now).
              <View style={styles.createCircle}>
                <MaterialIcons name="add" size={20} color={lightColors.text} />
              </View>
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
                        <MaterialIcons name="person" size={18} color={lightColors.textSecondary} />
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
                  <MaterialIcons name="person" size={18} color={lightColors.textSecondary} />
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
                name={(item.icon ?? 'home') as keyof typeof MaterialIcons.glyphMap}
                size={24}
                color={active ? lightColors.text : lightColors.textSecondary}
              />
            )}
          </Pressable>
        );
      })}
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

const styles = StyleSheet.create({
  bar: {
    height: layout.bottomNavHeight,
    flexDirection: 'row',
    backgroundColor: lightColors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: lightColors.border,
  },
  item: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  createCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: lightColors.text,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatar: { width: 28, height: 28, borderRadius: 14 },
  // Active-state cue for the avatar slot (QA 50): a 2px ring in the
  // primary text colour; icon slots cue via the pill behind the icon.
  avatarActive: { borderWidth: 2, borderColor: lightColors.text },
  avatarFallback: {
    backgroundColor: lightColors.surfaceVariant,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: { fontSize: 13, fontWeight: '600', color: lightColors.textSecondary },
});
