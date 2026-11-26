import React from 'react';
import { StubScreen } from '../../../components/common/StubScreen';

/** Phase 1 admin stub — access is enforced server-side by RLS (admin role). */
export function AdminVideosScreen() {
  return <StubScreen title="Admin — Videos" message="Add and manage archive recordings here. No recordings have been added yet." showHeader={false} />;
}
