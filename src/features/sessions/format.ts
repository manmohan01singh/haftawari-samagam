/**
 * Display formatting for session times. All inputs are real schedule
 * values from the sessions table — nothing here invents data.
 */

const dateTimeFmt = new Intl.DateTimeFormat('en-IN', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
});

const timeFmt = new Intl.DateTimeFormat('en-IN', {
  hour: 'numeric',
  minute: '2-digit',
});

/** "Wed, 4 Dec, 5:00 pm" */
export function formatSessionDateTime(iso: string): string {
  return dateTimeFmt.format(new Date(iso));
}

/** "5:00 pm" */
export function formatSessionTime(iso: string): string {
  return timeFmt.format(new Date(iso));
}

/** Human countdown to a future instant: "in 2 h 14 min", "in 3 days". */
export function formatCountdown(targetIso: string, nowMs: number): string {
  const diffMs = Date.parse(targetIso) - nowMs;
  if (diffMs <= 0) return 'starting now';
  const totalMinutes = Math.floor(diffMs / 60_000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `in ${days} day${days === 1 ? '' : 's'}${hours > 0 ? ` ${hours} h` : ''}`;
  if (hours > 0) return `in ${hours} h ${minutes} min`;
  if (minutes > 0) return `in ${minutes} min`;
  return 'in less than a minute';
}

/** Elapsed label for a playing session: "Started 42 min ago". */
export function formatStartedAgo(startIso: string, nowMs: number): string {
  const diffMs = nowMs - Date.parse(startIso);
  if (diffMs < 60_000) return 'Started just now';
  const totalMinutes = Math.floor(diffMs / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `Started ${hours} h ${minutes} min ago`;
  return `Started ${minutes} min ago`;
}
