import type { SessionStatus } from '../../types/database';

/**
 * Session state machine (pure functions — unit-testable, no I/O).
 *
 *   upcoming ──(start time reached)──▶ now_playing ──(end reached)──▶ completed
 *      │                                  │
 *      └──────────(admin cancels)─────────┴──▶ cancelled
 *
 * Status is SERVER-AUTHORITATIVE: the stored status is changed by the
 * admin / a scheduled job, and clients additionally derive the effective
 * status from the server clock so every device agrees. Clients never
 * invent a transition locally.
 */

const TRANSITIONS: Record<SessionStatus, SessionStatus[]> = {
  upcoming: ['now_playing', 'cancelled'],
  now_playing: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

export function canTransition(from: SessionStatus, to: SessionStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: SessionStatus, to: SessionStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid session transition: ${from} -> ${to}`);
  }
}

/**
 * Effective status from the server clock. `nowMs` MUST come from a
 * server-synced clock (see sessionService.getServerNow) so all
 * participants derive the same status.
 */
export function deriveStatus(args: {
  storedStatus: SessionStatus;
  scheduledStartAt: string;
  scheduledEndAt: string | null;
  durationSeconds: number | null;
  nowMs: number;
}): SessionStatus {
  const { storedStatus, scheduledStartAt, scheduledEndAt, durationSeconds, nowMs } = args;
  if (storedStatus === 'cancelled' || storedStatus === 'completed') return storedStatus;
  const startMs = Date.parse(scheduledStartAt);
  if (nowMs < startMs) return 'upcoming';
  // Effective end: the scheduled window end AND the recording's own end
  // both bound the session. A recording shorter than its scheduled
  // window is FINISHED at its own end (the synced offset clamps there —
  // deriveOffsetSeconds), so the session honestly flips to COMPLETED
  // then instead of claiming NOW PLAYING over a player stuck at the
  // end of the video until the window closes.
  const windowEndMs = scheduledEndAt ? Date.parse(scheduledEndAt) : null;
  const recordingEndMs = durationSeconds != null ? startMs + durationSeconds * 1000 : null;
  // Hard cap (deep-research session-completion model, 27 Nov 2026):
  // when NEITHER a window end nor a recording duration is known
  // (legacy rows, unprobed hosted files), the session must still end
  // — a NOW PLAYING that never finishes is worse than a generous
  // bound. 4h exceeds every real samagam in the catalogue (~3h max);
  // admin flows now always set a duration or a window end, so the
  // cap is only a backstop for legacy data.
  const HARD_CAP_MS = 4 * 60 * 60 * 1000;
  const endMs =
    windowEndMs != null && recordingEndMs != null
      ? Math.min(windowEndMs, recordingEndMs)
      : (windowEndMs ?? recordingEndMs ?? startMs + HARD_CAP_MS);
  if (nowMs >= endMs) return 'completed';
  return 'now_playing';
}

/** Playback offset (seconds) every participant should be at, right now. */
export function deriveOffsetSeconds(args: {
  scheduledStartAt: string;
  durationSeconds: number | null;
  nowMs: number;
}): number {
  const startMs = Date.parse(args.scheduledStartAt);
  const raw = Math.floor((args.nowMs - startMs) / 1000);
  const atLeastZero = Math.max(0, raw);
  return args.durationSeconds != null
    ? Math.min(atLeastZero, args.durationSeconds)
    : atLeastZero;
}
