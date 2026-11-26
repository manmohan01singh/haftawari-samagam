import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { lightColors, radii, spacing } from '../../theme';

/**
 * Minimal toast hook + view: transient visible feedback for actions
 * whose result is otherwise invisible (Share, undo, …). QA issue 30 /
 * 109: a tap with NO visible feedback reads as a dead tap, so every
 * such action surfaces its outcome here.
 */
export function useToast(durationMs = 2600): {
  toast: string | null;
  showToast: (message: string) => void;
} {
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), durationMs);
    return () => clearTimeout(t);
  }, [toast, durationMs]);
  return { toast, showToast: setToast };
}

export function Toast({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <View style={styles.wrap} pointerEvents="none">
      <View style={styles.pill}>
        <Text style={styles.text}>{message}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: spacing.xxl,
    alignItems: 'center',
    zIndex: 50,
  },
  pill: {
    backgroundColor: lightColors.text,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    maxWidth: '88%',
  },
  text: { color: lightColors.subscribeText, fontSize: 14, fontWeight: '500', textAlign: 'center' },
});
