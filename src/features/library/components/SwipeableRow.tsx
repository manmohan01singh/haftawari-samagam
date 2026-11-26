/* eslint-disable react-hooks/refs --
 * This component is the classic stable-instance pattern: the
 * PanResponder is created once in a ref and its handlers (plus the
 * snap helper they share) touch the Animated value / offset refs ONLY
 * inside gesture and press callbacks, never during render. The
 * react-hooks/refs rule cannot prove that, so it is disabled for this
 * file only. */
import React, { useRef, useState } from 'react';
import {
  Animated,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { lightColors } from '../../../theme';

const ACTION_WIDTH = 88;
const OPEN_THRESHOLD = 40;

interface SwipeableRowProps {
  /** Called when the revealed Remove action is tapped. */
  onRemove: () => void;
  removeLabel?: string;
  children: React.ReactNode;
}

/**
 * Swipe-left-to-reveal-remove row, built on PanResponder + Animated so
 * it behaves the same on Android, iOS and web with no extra native
 * dependencies. A horizontal-dominant drag moves the row; releasing
 * past the threshold snaps the Remove action open, otherwise the row
 * snaps shut. Vertical drags are never claimed, so list scrolling is
 * unaffected. Tapping the row content while open just closes it.
 */
export function SwipeableRow({ onRemove, removeLabel = 'Remove', children }: SwipeableRowProps) {
  const translateX = useRef(new Animated.Value(0)).current;
  const offsetRef = useRef(0);
  const [open, setOpen] = useState(false);

  const snapTo = (to: number) => {
    offsetRef.current = to;
    setOpen(to !== 0);
    Animated.spring(translateX, {
      toValue: to,
      useNativeDriver: true,
      bounciness: 0,
      speed: 20,
    }).start();
  };

  const panResponder = useRef(
    PanResponder.create({
      // Never claim a tap or a vertical scroll: only a clearly
      // horizontal left-drag becomes the swipe. Claiming taps here
      // (onStartShouldSet / capture) is what made row taps feel dead
      // on web, where the PanResponder view wraps the row Pressable.
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_evt, gesture) =>
        gesture.dx < -8 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5,
      onPanResponderTerminationRequest: () => true,
      onPanResponderMove: (_evt, gesture) => {
        const next = Math.max(-ACTION_WIDTH, Math.min(0, offsetRef.current + gesture.dx));
        translateX.setValue(next);
      },
      onPanResponderRelease: (_evt, gesture) => {
        const resting = offsetRef.current + gesture.dx;
        snapTo(resting < -OPEN_THRESHOLD ? -ACTION_WIDTH : 0);
      },
      onPanResponderTerminate: () => snapTo(offsetRef.current),
    }),
  ).current;

  return (
    <View style={styles.container}>
      <View style={styles.action}>
        <Pressable
          style={styles.actionButton}
          onPress={() => {
            snapTo(0);
            onRemove();
          }}
          accessibilityRole="button"
          accessibilityLabel={removeLabel}
        >
          <MaterialIcons name="delete-outline" size={22} color={lightColors.subscribeText} />
          <Text style={styles.actionText}>{removeLabel}</Text>
        </Pressable>
      </View>
      <Animated.View
        style={[styles.foreground, { transform: [{ translateX }] }]}
        {...panResponder.panHandlers}
      >
        {children}
        {open ? (
          <Pressable
            style={styles.closeOverlay}
            onPress={() => snapTo(0)}
            accessibilityRole="button"
            accessibilityLabel="Close actions"
          />
        ) : null}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { position: 'relative', overflow: 'hidden' },
  action: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    width: ACTION_WIDTH,
    backgroundColor: lightColors.text,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionButton: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  actionText: { color: lightColors.subscribeText, fontSize: 12, fontWeight: '600' },
  foreground: { backgroundColor: lightColors.background },
  closeOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
});
