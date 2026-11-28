import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import { useTheme } from '../../theme';

/**
 * The red "magical orb" glow (user, 28 Nov 2026): a soft red light
 * at the top-left corner. The user asked for it, then corrected it
 * the same day with screenshots: it must be VERY minimal — a faint
 * edge warmth, barely visible — and it belongs ONLY on the Home
 * and Profile (Library) pages (see OrbOverlay in App.tsx), never
 * on player pages and not sprayed across every screen.
 */
export const OrbBackground = memo(function OrbBackground() {
  const { isDark } = useTheme();
  // MUCH subtler (user, 28 Nov 2026, with screenshots): the glow
  // was 'bahut zyada' — too bright, too present. It now only
  // whispers at the very corner edge: a faint warmth you notice
  // only if you look for it, never a red wash over the page.
  const core = isDark ? 0.15 : 0.06;
  return (
    <View pointerEvents="none" style={styles.wrap} accessibilityElementsHidden>
      <Svg width={400} height={400}>
        <Defs>
          <RadialGradient id="orbGlow" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor="#FF2020" stopOpacity={core} />
            <Stop offset="55%" stopColor="#FF2020" stopOpacity={core * 0.32} />
            <Stop offset="100%" stopColor="#FF2020" stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={200} cy={200} r={200} fill="url(#orbGlow)" />
      </Svg>
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: -170,
    left: -170,
    width: 400,
    height: 400,
    zIndex: 0,
  },
});
