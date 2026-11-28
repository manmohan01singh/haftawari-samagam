import React, { useEffect, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../theme';

interface IkOnkarMarkProps {
  /** Optional line under the mark (e.g. "Searching for …"). */
  label?: string;
  size?: number;
}

/**
 * The red ੴ shown while the Home page is blank and loading (user,
 * 28 Nov 2026): a dignified Ik Onkar in red, gently breathing,
 * holds the screen until the content arrives. Set in Noto Serif
 * Gurmukhi — the user rejected the earlier hand-lettered face as
 * 'bekar' and asked for a proper Punjabi font, a smaller mark, a
 * calmer pulse, and the mark ONLY on Home (and the splash), never
 * on every page (28 Nov 2026). Loaded in App.tsx with the platform
 * Gurmukhi face as fallback.
 */
export function IkOnkarMark({ label, size = 84 }: IkOnkarMarkProps) {
  const { colors } = useTheme();
  const [pulse] = useState(() => new Animated.Value(0));

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1600, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 1600, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.78, 1] });
  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.99, 1.01] });

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
  mark: { fontFamily: 'NotoSerifGurmukhi', color: '#E8112D', lineHeight: undefined },
  label: { fontSize: 15, marginTop: 10 },
});
