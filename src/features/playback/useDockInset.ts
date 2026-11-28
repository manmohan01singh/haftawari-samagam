import { usePlaybackStore } from './playbackStore';

/** Height of the mini dock strip (PlaybackHost's miniDock). */
export const MINI_DOCK_HEIGHT = 64;

/**
 * Bottom inset a tab screen must add to its scroll content while
 * the mini dock is visible, so the last rows can scroll clear of
 * the dock instead of hiding under it (fix round 5, N-3 — the
 * dock covered the Sessions row in You, lower Settings rows, and
 * the bottom row of Home cards, and ate their taps).
 */
export function useDockInset(): number {
  const dockVisible = usePlaybackStore((s) => s.dockVisible);
  return dockVisible ? MINI_DOCK_HEIGHT : 0;
}
