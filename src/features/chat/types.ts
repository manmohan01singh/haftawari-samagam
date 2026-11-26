import type { ChatMessage } from '../../types/database';

export type { ChatMessage };

/** Client-side draft before it is sent (no id / timestamp yet). */
export interface ChatMessageDraft {
  sessionId: string;
  body: string;
}

/** Moderation actions an admin may take on a message (server-enforced). */
export type ChatModerationAction = 'remove' | 'restore';

/**
 * A chat author as the UI is allowed to know them.
 *
 * `displayName` is the member's REAL profile display name when it could
 * be resolved — from the caller's own profile, from an admin-visible
 * profiles read, or from a name map the host screen supplies (e.g. the
 * session's Realtime Presence roster, where members broadcast their own
 * name). It is `null` when the name is not knowable: the `profiles` RLS
 * policy lets a member read only their own row, so other members' names
 * are not fetchable from the database by design. The UI falls back to a
 * neutral label in that case — it never invents a name or handle.
 */
export interface ChatAuthor {
  userId: string;
  displayName: string | null;
}

/** A chat message together with its (possibly unresolved) author. */
export interface ChatMessageWithAuthor extends ChatMessage {
  author: ChatAuthor;
}
