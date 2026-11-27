import React, { memo, useMemo } from 'react';
import { StyleSheet } from 'react-native';
import { BlurView } from 'expo-blur';

import { useTheme } from '../../theme';

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
 * tint + background, which on web sits in the SAME element as the
 * backdrop-filter, so content colour genuinely washes through.
 * Where backdrop-filter is unsupported, the bar degrades to that
 * translucent tint with unblurred content showing through — still
 * glassy, never a solid slab and never fully transparent.
 *
 * Performance: the blur is STATIC (fixed intensity, no animation,
 * no scroll-linked updates) — but a backdrop-filter must still be
 * re-composited for every scroll frame under BOTH bars, and cost
 * grows steeply with radius. Intensity 48 (perf3) keeps the same
 * milky look at materially lower cost.
 *
 * Phase 12: the material is theme-aware — in dark mode the tint is
 * near-black (#0F0F0F, the dark background token) and the BlurView
 * tint flips to 'dark', so the bars read as dark glass.
 *
 * Phase 13 (user order): the blur is UNCONDITIONAL. The Phase 12
 * "Blur effects" switch and the low-core-web plain-tint fallback
 * are removed — the glass is always there, on every bar, on every
 * device class, and never disappears. The dark tint alpha rises
 * 0.68 → 0.85: at 0.68 nearly a third of whatever bright thumbnail
 * sat under the bar bled through the dark glass and washed it a
 * muddy grey-brown (the user's "dark mode ganda lagda" report);
 * at 0.85 the bars read as dark glass — content still visibly
 * washes through, but the bar's own tone wins. Light stays at the
 * measured 0.68, pixel-identical to before.
 */
export const BarBlurBackground = memo(function BarBlurBackground() {
  const { isDark } = useTheme();

  const tintStyle = useMemo(
    () => ({
      backgroundColor: isDark
        ? 'rgba(15,15,15,0.85)'
        : 'rgba(255,255,255,0.68)',
    }),
    [isDark],
  );

  return (
    <BlurView
      intensity={48}
      tint={isDark ? 'dark' : 'light'}
      experimentalBlurMethod="dimezisBlurView"
      style={[StyleSheet.absoluteFill, tintStyle]}
      pointerEvents="none"
    />
  );
});
