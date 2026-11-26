/** One participant as reported by Supabase Realtime Presence. */
export interface PresenceMember {
  userId: string;
  displayName: string | null;
  /** ISO timestamp of when this presence entry was tracked. */
  onlineAt: string;
}

/**
 * A REAL participant count: the number of presence entries currently
 * tracked on the session's presence channel. It is never estimated,
 * padded or fabricated.
 */
export interface PresenceSnapshot {
  sessionId: string;
  participantCount: number;
  members: PresenceMember[];
}
