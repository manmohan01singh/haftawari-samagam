import React, { useEffect, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../theme';

interface IkOnkarMarkProps {
  /** Optional line under the mark (e.g. "Searching for …"). */
  label?: string;
  size?: number;
}

/**
 * The big red ੴ shown while a page is blank and loading (user,
 * 28 Nov 2026): when a search is running or a page has not filled
 * yet, a large Ik Onkar in red, gently breathing, holds the screen;
 * when the content arrives it gives way to the content. Set in
 * Langar, a hand-lettered Gurmukhi display face (user asked for a
 * Punjabi hastlikhat look, 28 Nov 2026), loaded in App.tsx with the
 * platform Gurmukhi face as fallback.
 */
export function IkOnkarMark({ label, size = 120 }: IkOnkarMarkProps) {
  const { colors } = useTheme();
  const [pulse] = useState(() => new Animated.Value(0));

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1100, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 1100, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] });
  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1.03] });

  return (
    <View style={styles.wrap} accessibilityElementsHidden>
      <Animated.Text style={[styles.mark, { fontSize: size, opacity, transform: [{ scale }] }]}>
        {'ੴ'}
      </Animated.Text>
      {label ? <Text style={[styles.label, { color: colors.textSecondary }]}>{label}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center', paddingVertical: 28 },
  // The app's own accent red — the mark the user asked for, in red,
  // large, in the platform Gurmukhi face.
  mark: { fontFamily: 'Langar', color: '#E8112D', lineHeight: undefined },
  label: { fontSize: 15, marginTop: 10 },
});
