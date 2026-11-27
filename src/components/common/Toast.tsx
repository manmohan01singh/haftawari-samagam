/* eslint-disable react-hooks/refs, react-hooks/set-state-in-effect --
 * P9/W4 fade in/out: the opacity Animated.Value lives in a ref and is
 * only touched inside effects; the effect also mirrors the incoming
 * message into local state so the pill can stay mounted while it
 * fades out after the hook clears it. Both are effect-only patterns
 * the two rules cannot prove safe, so they are disabled for this
 * file only (refs precedent: SwipeableRow). */
import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
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
  // P9/W4: fade in/out. The component keeps the last message rendered
  // while it fades out (200ms) after `message` clears, then unmounts;
  // fade-in is 180ms. API unchanged — callers still pass the hook's
  // toast string (or null).
  const opacity = useRef(new Animated.Value(0)).current;
  const [rendered, setRendered] = useState<string | null>(null);

  useEffect(() => {
    if (message) {
      setRendered(message);
      Animated.timing(opacity, {
        toValue: 1,
        duration: 180,
        useNativeDriver: true,
      }).start();
      return;
    }
    if (rendered) {
      Animated.timing(opacity, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setRendered(null);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message, opacity]);

  if (!rendered) return null;
  return (
    <View style={styles.wrap} pointerEvents="none">
      <Animated.View style={[styles.pill, { opacity }]}>
        <Text style={styles.text}>{rendered}</Text>
      </Animated.View>
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
