/**
 * Display formatting helpers. Every value formatted here comes from a
 * real backend/API response — these helpers never invent numbers.
 */

/** Parse an ISO-8601 duration ("PT3H35S") to seconds; null if unparsable. */
export function parseIso8601Duration(iso: string): number | null {
  const match = /^P(?:\d+Y)?(?:\d+M)?(?:\d+D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(iso);
  if (!match) return null;
  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2] ?? 0);
  const seconds = Math.floor(Number(match[3] ?? 0));
  return hours * 3600 + minutes * 60 + seconds;
}

/**
 * Count formatting in the Indian numbering style used by the reference
 * UI (e.g. 465000 → "4.65 lakh", 7256 → "7.2K"). Values below 1000 are
 * shown as-is.
 */
export function formatCount(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '0';
  if (value < 1000) return String(Math.floor(value));
  if (value < 100000) {
    // K range renders at ONE decimal in the reference UI ("7.2K
    // videos" for 7,256 — ref-3), truncated like YouTube, not
    // rounded ("7.26K" / "7.3K" both miss the reference).
    const k = Math.floor((value / 1000) * 10) / 10;
    return `${Number.isInteger(k) ? String(k) : k.toFixed(1)}K`;
  }
  if (value < 10000000) {
    const lakh = value / 100000;
    return `${trimNum(lakh)} lakh`;
  }
  const crore = value / 10000000;
  return `${trimNum(crore)} crore`;
}

function trimNum(n: number): string {
  const rounded = Math.round(n * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded).replace(/0$/, '');
}

/** "3 days ago" style relative time from an ISO timestamp. */
export function timeAgo(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const seconds = Math.max(0, Math.floor((now.getTime() - then) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} mo ago`;
  const years = Math.floor(months / 12);
  return `${years} yr ago`;
}
