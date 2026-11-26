import React from 'react';
import { StubScreen } from '../../../components/common/StubScreen';

/** Phase 1 admin stub — access is enforced server-side by RLS (admin role). */
export function AdminChatModerationScreen() {
  return <StubScreen title="Admin — Chat moderation" message="Reported and removed chat messages will appear here." showHeader={false} />;
}
