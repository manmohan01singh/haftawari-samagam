/**
 * Shared touch-target constants (UX tap audit, 26 Nov 2026).
 *
 * The reference UI's visual geometry stays exactly as measured — icons
 * are 24px, chips are ~32px tall — but every tappable must present at
 * least a 44px hit area (Apple HIG / Material minimum). `hitSlop`
 * grows the hit area WITHOUT changing layout or look, so it is the
 * preferred way to reach 44px on icon buttons and small pills.
 */

/** hitSlop for a 24px icon: 24 + 10 + 10 = 44px in both axes. */
export const ICON_HIT_SLOP = { top: 10, bottom: 10, left: 10, right: 10 } as const;

/** hitSlop for a 20px icon: 20 + 12 + 12 = 44px in both axes. */
export const SMALL_ICON_HIT_SLOP = { top: 12, bottom: 12, left: 12, right: 12 } as const;
