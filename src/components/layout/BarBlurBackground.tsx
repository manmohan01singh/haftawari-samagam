import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { BlurView } from 'expo-blur';

/**
 * Translucent blur material for the app bars (user request, 27 Nov
 * 2026: the real YouTube bars are not solid — content softly blurs
 * behind them while scrolling).
 *
 * One implementation, all platforms, via expo-blur's BlurView:
 * - Web/PWA: BlurView compiles to a CSS `backdrop-filter: blur()`
 *   element — the scrolling content behind the bar blurs for real.
 * - iOS: system UIVisualEffectView blur.
 * - Android: `experimentalBlurMethod="dimezisBlurView"` gives a real
 *   RenderEffect blur; without it Android would show only the tint.
 *
 * Performance: the blur is STATIC (fixed intensity, no animation,
 * no scroll-linked updates), which is the cheap configuration —
 * the GPU cost is one backdrop pass per bar. Intensity 72 / light
 * tint matches the reference bars' milky-white translucency while
 * keeping 24dp icons at full contrast (icons render ABOVE this
 * layer, never inside it).
 *
 * Fallback: under the BlurView sits a translucent white layer
 * (rgba 255,255,255,0.82). Where backdrop blur is unavailable
 * (older webviews without backdrop-filter, Android blur disabled),
 * the bar degrades to that near-solid translucent white — never to
 * transparent, so bar content stays legible.
 */
export const BarBlurBackground = memo(function BarBlurBackground() {
  return (
    <>
      <View style={[StyleSheet.absoluteFill, styles.fallback]} pointerEvents="none" />
      <BlurView
        intensity={72}
        tint="light"
        experimentalBlurMethod="dimezisBlurView"
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
    </>
  );
});

const styles = StyleSheet.create({
  fallback: { backgroundColor: 'rgba(255,255,255,0.82)' },
});
