import type { SamagamSession, SessionStatus } from '../../types/database';

export type { SamagamSession, SessionStatus };

/**
 * Truthful UI labels for a synchronized Samagam session.
 *
 * A session plays a PRERECORDED, authorized recording together at a
 * scheduled time. It is therefore labelled UPCOMING / NOW PLAYING /
 * COMPLETED — never "LIVE", which would falsely claim a newly originated
 * live broadcast. (A red badge is used for NOW PLAYING; the word stays
 * truthful.)
 */
export const SESSION_LABELS: Record<Exclude<SessionStatus, 'cancelled'>, string> = {
  upcoming: 'UPCOMING',
  now_playing: 'NOW PLAYING',
  completed: 'COMPLETED',
};

/** Position of every participant, derived from the server clock. */
export interface SessionPlaybackPosition {
  sessionId: string;
  /** Seconds from the scheduled start; 0 before start, clamped at duration. */
  offsetSeconds: number;
  /** Total recording length in seconds, when known. */
  durationSeconds: number | null;
  status: SessionStatus;
}
