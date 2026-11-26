/** Small display helpers for the library UI (real values only). */

/** "12:34" / "1:02:03" clock for durations and resume positions. */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "26 Nov 2026" from an ISO timestamp, in local time. */
export function formatDateLine(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/**
 * Resume ratio (0..1) for a history entry's progress bar, or null when
 * there is nothing truthful to show (no recorded position, or the
 * recording's duration is unknown).
 */
export function resumeRatio(positionSeconds: number, durationSeconds: number | null): number | null {
  if (!durationSeconds || durationSeconds <= 0 || positionSeconds <= 0) return null;
  return Math.min(1, positionSeconds / durationSeconds);
}
