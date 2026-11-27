import React, { memo } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
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
 * no scroll-linked updates) — but a backdrop-filter must still be
 * re-composited for every scroll frame under BOTH bars, and cost
 * grows steeply with radius. Intensity was 72; perf3 lowered it to
 * 48 (same milky look, materially cheaper) and low-core web devices
 * (hardwareConcurrency <= 4 — the low-end Android class the user
 * tests on) skip the BlurView entirely and keep the translucent
 * fallback below. Icons render ABOVE this layer, never inside it.
 *
 * Fallback: under the BlurView sits a translucent white layer
 * (rgba(255,255,255,0.82)). Where backdrop blur is unavailable
 * (older webviews without backdrop-filter, Android blur disabled),
 * the bar degrades to that near-solid translucent white — never to
 * transparent, so bar content stays legible.
 */
const LOW_CORE_WEB =
  Platform.OS === 'web' &&
  typeof navigator !== 'undefined' &&
  typeof navigator.hardwareConcurrency === 'number' &&
  navigator.hardwareConcurrency <= 4;

export const BarBlurBackground = memo(function BarBlurBackground() {
  return (
    <>
      <View style={[StyleSheet.absoluteFill, styles.fallback]} pointerEvents="none" />
      {LOW_CORE_WEB ? null : (
        <BlurView
          intensity={48}
          tint="light"
          experimentalBlurMethod="dimezisBlurView"
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
      )}
    </>
  );
});

const styles = StyleSheet.create({
  fallback: { backgroundColor: 'rgba(255,255,255,0.82)' },
});
