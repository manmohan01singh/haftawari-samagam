import React from 'react';
import { StubScreen } from '../../../components/common/StubScreen';

/** Phase 1 admin stub — access is enforced server-side by RLS (admin role). */
export function AdminOverviewScreen() {
  return <StubScreen title="Admin — Overview" message="Real totals (members, published recordings, upcoming sessions) will appear here once Supabase is connected." showHeader={false} />;
}
