import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { nativeApp } from '../../../theme';

interface ChatAvatarProps {
  userId: string;
  /** Real display name, or null when not knowable under RLS. */
  displayName: string | null;
  size?: number;
}

/**
 * Fill colours seen in the reference chat (screenshot 07): teal, green,
 * magenta, purple, orange… The colour is chosen by a stable hash of the
 * REAL user id, so a member keeps one colour everywhere — the colour is
 * decoration, never identity data.
 */
const AVATAR_COLORS = [
  '#00897B',
  '#43A047',
  '#C2185B',
  '#5E35B1',
  '#E64A19',
  '#00695C',
  '#7B1FA2',
  '#2E7D32',
] as const;

export function avatarColorFor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i += 1) {
    hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

/**
 * Circular chat avatar (36px per the reference). With a known name it
 * shows the member's real first initial on their colour; with an
 * unknown name it shows a neutral person glyph — never a made-up
 * initial.
 */
export function ChatAvatar({ userId, displayName, size = nativeApp.chatSheet.avatarSize }: ChatAvatarProps) {
  const initial = displayName?.trim().charAt(0).toUpperCase();
  return (
    <View
      style={[
        styles.circle,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: avatarColorFor(userId) },
      ]}
    >
      {initial ? (
        <Text style={[styles.initial, { fontSize: size * 0.45 }]}>{initial}</Text>
      ) : (
        <MaterialIcons name="person" size={size * 0.6} color="#FFFFFF" />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  circle: {
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  initial: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
});
