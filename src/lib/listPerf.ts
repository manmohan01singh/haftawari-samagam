/**
 * Shared FlatList/SectionList performance tuning (UX perf pass,
 * 26 Nov 2026). One place so every list in the app scrolls the same
 * way; spread into a list's props: `<FlatList {...FEED_LIST_PERF} />`.
 *
 * Why these values:
 * - `windowSize` is measured in viewports of content kept mounted
 *   around the visible area. React Native's default (21) keeps ~10
 *   screens of heavy full-bleed cards alive — the main source of the
 *   "everything feels heavy / gets stuck" reports on the PWA.
 * - `maxToRenderPerBatch` caps how many NEW cells mount in one batch
 *   during a fast scroll. The default (10) mounts 10 full-bleed
 *   thumbnail cards in a single frame — a visible hitch. Feed cards
 *   batch at 4; light rows batch at 8.
 * - `updateCellsBatchingPeriod: 50` lets those batches land on their
 *   own frames instead of blocking the scroll frame.
 * - `removeClippedSubviews` unmounts off-window cell content (safe on
 *   Android; inert-to-helpful on web) — already used by several lists,
 *   now applied consistently.
 * - `initialNumToRender` matches roughly one screenful so first paint
 *   is fast and the rest streams in.
 */

/** Full-bleed feed cards (Home, Watch Up Next, Channel, Search results). */
export const FEED_LIST_PERF = {
  windowSize: 7,
  initialNumToRender: 4,
  maxToRenderPerBatch: 4,
  updateCellsBatchingPeriod: 50,
  removeClippedSubviews: true,
} as const;

/** Compact rows (History, Saved, Playlist, Playlists, Sessions, sheets). */
export const ROW_LIST_PERF = {
  windowSize: 9,
  initialNumToRender: 10,
  maxToRenderPerBatch: 8,
  updateCellsBatchingPeriod: 50,
  removeClippedSubviews: true,
} as const;

/** Short horizontal carousels/rails (bounded item counts). */
export const H_LIST_PERF = {
  windowSize: 5,
  initialNumToRender: 6,
  maxToRenderPerBatch: 6,
  updateCellsBatchingPeriod: 50,
} as const;
