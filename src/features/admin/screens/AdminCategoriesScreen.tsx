import React from 'react';
import { StubScreen } from '../../../components/common/StubScreen';

/** Phase 1 admin stub — access is enforced server-side by RLS (admin role). */
export function AdminCategoriesScreen() {
  return <StubScreen title="Admin — Categories" message="Manage categories such as Haftawari, Amritvela and Evening Kirtan here." showHeader={false} />;
}
