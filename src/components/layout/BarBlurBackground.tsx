import React, { memo } from 'react';
import { StyleSheet } from 'react-native';
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
 * blur samples EVERYTHING painted beneath the blur element. The
 * first version put a rgba(255,255,255,0.82) "fallback" layer UNDER
 * the BlurView — the blur then sampled that near-opaque white layer
 * instead of the scrolling content, and the bar rendered as a
 * perfectly uniform solid white on the owner's phone even with a
 * bright poster scrolling directly behind it. There must be NO
 * backing layer under the blur: the translucency lives in the
 * BlurView's own tint + background (0.68 white), which on web sits
 * in the SAME element as the backdrop-filter, so content colour
 * genuinely washes through. Where backdrop-filter is unsupported,
 * the bar degrades to that 0.68 translucent white with unblurred
 * content showing through — still glassy, never a solid slab and
 * never fully transparent.
 *
 * Performance: the blur is STATIC (fixed intensity, no animation,
 * no scroll-linked updates) — one backdrop pass per bar. Intensity
 * 80 keeps the wash-through clearly visible while 24dp icons above
 * the layer stay at full contrast.
 */
export const BarBlurBackground = memo(function BarBlurBackground() {
  return (
    <BlurView
      intensity={80}
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
