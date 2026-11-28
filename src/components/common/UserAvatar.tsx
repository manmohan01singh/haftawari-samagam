import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useTheme, type ThemeColors } from '../../theme';

interface UserAvatarProps {
  /** Real profile photo URL (e.g. the synced Google DP), when one exists. */
  avatarUrl?: string | null;
  /** Fallback initial (display name / email first letter). */
  initial?: string | null;
  size?: number;
  /** Font size of the fallback initial; defaults to ~40% of size. */
  initialFontSize?: number;
}

/**
 * The signed-in user's avatar for the surfaces that render it by
 * hand (Library/You header, Account, Settings): the real photo when
 * one exists, the coloured-initial treatment otherwise. If the photo
 * URL fails to load (a stale Google URL, no network), it falls back
 * to the initial instead of leaving a broken-image circle — the
 * header/nav components (AppHeader, BottomNav) apply the same rule
 * in their own avatar slots.
 */
export function UserAvatar({ avatarUrl, initial, size = 40, initialFontSize }: UserAvatarProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  // Remember WHICH url failed: a new URL (sign-in as someone else,
  // DP changed) automatically gets a fresh try, no effect needed.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  const circle = { width: size, height: size, borderRadius: size / 2 };
  if (avatarUrl && failedUrl !== avatarUrl) {
    return (
      <Image
        source={{ uri: avatarUrl }}
        style={circle}
        contentFit="cover"
        cachePolicy="memory-disk"
        onError={() => setFailedUrl(avatarUrl)}
      />
    );
  }
  return (
    <View style={[styles.fallback, circle]}>
      {initial ? (
        <Text style={[styles.initial, { fontSize: initialFontSize ?? Math.round(size * 0.4) }]}>
          {initial}
        </Text>
      ) : (
        <MaterialIcons name="person" size={Math.round(size * 0.6)} color={colors.subscribeText} />
      )}
    </View>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  fallback: {
    backgroundColor: colors.subscribeBackground,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initial: { fontWeight: '600', color: colors.subscribeText },
});
