import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { lightColors, radii, spacing } from '../../../theme';
import type { SessionStatus } from '../../../types/database';
import { SESSION_LABELS } from '../types';

interface SessionStatusBadgeProps {
  status: Exclude<SessionStatus, 'cancelled'>;
}

/**
 * Truthful session badge. NOW PLAYING uses the red badge styling (per
 * the reference live UI) but the WORDS stay truthful — a session plays a
 * prerecorded recording together and is never labelled "LIVE".
 */
export function SessionStatusBadge({ status }: SessionStatusBadgeProps) {
  return (
    <View
      style={[
        styles.badge,
        status === 'now_playing'
          ? styles.badgePlaying
          : status === 'upcoming'
            ? styles.badgeUpcoming
            : styles.badgeCompleted,
      ]}
    >
      {status === 'now_playing' ? <View style={styles.dot} /> : null}
      <Text style={status === 'now_playing' ? styles.textOnAccent : styles.textMuted}>
        {SESSION_LABELS[status]}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderRadius: radii.badge + 2,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  badgePlaying: { backgroundColor: lightColors.accent },
  badgeUpcoming: { backgroundColor: 'rgba(0,0,0,0.8)' },
  badgeCompleted: { backgroundColor: 'rgba(0,0,0,0.8)' },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: lightColors.onAccent,
  },
  textOnAccent: { color: lightColors.onAccent, fontSize: 11, fontWeight: '700', letterSpacing: 0.4 },
  textMuted: { color: '#FFFFFF', fontSize: 11, fontWeight: '700', letterSpacing: 0.4 },
});
