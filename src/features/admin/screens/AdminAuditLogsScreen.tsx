import React from 'react';
import { StubScreen } from '../../../components/common/StubScreen';

/** Phase 1 admin stub — access is enforced server-side by RLS (admin role). */
export function AdminAuditLogsScreen() {
  return <StubScreen title="Admin — Audit logs" message="Admin actions recorded in the audit log will appear here." showHeader={false} />;
}
