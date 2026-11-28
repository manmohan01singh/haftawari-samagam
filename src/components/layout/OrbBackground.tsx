import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import { useTheme } from '../../theme';

/**
 * The red "magical orb" glow (user, 28 Nov 2026): a soft red light
 * blooming from the top-left corner behind the page content, on
 * every browsing page — deliberately NOT on the player pages
 * (Watch / SessionWatch / Shorts), where the video owns the screen.
 *
 * Render it as the FIRST child of a screen's root view; it is
 * absolutely positioned and never intercepts touches. Strength is
 * theme-aware: a clear glow on the dark page, a whisper on light.
 */
export const OrbBackground = memo(function OrbBackground() {
  const { isDark } = useTheme();
  const core = isDark ? 0.44 : 0.24;
  return (
    <View pointerEvents="none" style={styles.wrap} accessibilityElementsHidden>
      <Svg width={470} height={470}>
        <Defs>
          <RadialGradient id="orbGlow" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor="#FF2020" stopOpacity={core} />
            <Stop offset="55%" stopColor="#FF2020" stopOpacity={core * 0.38} />
            <Stop offset="100%" stopColor="#FF2020" stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={235} cy={235} r={235} fill="url(#orbGlow)" />
      </Svg>
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: -185,
    left: -185,
    width: 470,
    height: 470,
    zIndex: 0,
  },
});
