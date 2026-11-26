import React from 'react';
import { StubScreen } from '../../../components/common/StubScreen';

/** Phase 1 admin stub — access is enforced server-side by RLS (admin role). */
export function AdminSessionsScreen() {
  return <StubScreen title="Admin — Sessions" message="Schedule synchronized Samagam sessions here. No sessions are scheduled yet." showHeader={false} />;
}
