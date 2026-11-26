import React from 'react';
import { StubScreen } from '../../../components/common/StubScreen';

/** Phase 1 admin stub — access is enforced server-side by RLS (admin role). */
export function AdminMembersScreen() {
  return <StubScreen title="Admin — Members" message="Registered members will appear here." showHeader={false} />;
}
