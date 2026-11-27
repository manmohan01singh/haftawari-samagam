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
 * LAYERING LESSON (found by on-device QA, 27 Nov 2026): a backdrop
 * blur samples EVERYTHING painted beneath the blur element. A
 * near-opaque "fallback" layer UNDER the BlurView makes the blur
 * sample that layer instead of the scrolling content, and the bar
 * renders as a uniform solid slab. There must be NO backing layer
 * under the blur: the translucency lives in the BlurView's own
 * tint + background (0.68 white), which on web sits in the SAME
 * element as the backdrop-filter, so content colour genuinely
 * washes through. Where backdrop-filter is unsupported, the bar
 * degrades to that 0.68 translucent white with unblurred content
 * showing through — still glassy, never a solid slab and never
 * fully transparent.
 *
 * Performance: the blur is STATIC (fixed intensity, no animation,
 * no scroll-linked updates) — but a backdrop-filter must still be
 * re-composited for every scroll frame under BOTH bars, and cost
 * grows steeply with radius. Intensity 48 (perf3) keeps the same
 * milky look at materially lower cost, and low-core web devices
 * (hardwareConcurrency <= 4 — the low-end Android class the user
 * tests on) skip the BlurView entirely and keep the same 0.68
 * translucent tint as a plain layer. Icons render ABOVE this
 * layer, never inside it.
 */
const LOW_CORE_WEB =
  Platform.OS === 'web' &&
  typeof navigator !== 'undefined' &&
  typeof navigator.hardwareConcurrency === 'number' &&
  navigator.hardwareConcurrency <= 4;

export const BarBlurBackground = memo(function BarBlurBackground() {
  if (LOW_CORE_WEB) {
    return (
      <View
        style={[StyleSheet.absoluteFill, styles.tint]}
        pointerEvents="none"
      />
    );
  }
  return (
    <BlurView
      intensity={48}
      tint="light"
      experimentalBlurMethod="dimezisBlurView"
      style={[StyleSheet.absoluteFill, styles.tint]}
      pointerEvents="none"
    />
  );
});

const styles = StyleSheet.create({
  tint: { backgroundColor: 'rgba(255,255,255,0.68)' },
});
