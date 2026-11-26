import type { ChatMessage } from '../../types/database';

export type { ChatMessage };

/** Client-side draft before it is sent (no id / timestamp yet). */
export interface ChatMessageDraft {
  sessionId: string;
  body: string;
}

/** Moderation actions an admin may take on a message (server-enforced). */
export type ChatModerationAction = 'remove' | 'restore';
