import React, { type ReactNode } from 'react';
import { View } from 'react-native';
import { EmptyState } from '../../../components/common/EmptyState';
import type { Profile } from '../../../types/database';
import { useAdminGate } from '../useAdminGate';
import { AdminButton, LoadingView } from './AdminUi';

export interface AdminContext {
  userId: string;
  profile: Profile;
}

/**
 * Wraps every admin screen. Renders the screen's content (via render
 * prop, with the verified admin identity) only for admins; everyone
 * else gets a clear, honest state:
 *  - backend not configured yet
 *  - signed out → sign-in required
 *  - signed in as a member → not authorized (and how admin is granted)
 * Enforcement is Row Level Security — this gate is presentation only.
 */
export function AdminGate({ children }: { children: (ctx: AdminContext) => ReactNode }) {
  const { gate, refresh } = useAdminGate();

  switch (gate.status) {
    case 'admin':
      return <>{children({ userId: gate.userId, profile: gate.profile })}</>;
    case 'loading':
      return <LoadingView label="Checking admin access…" />;
    case 'unconfigured':
      return (
        <EmptyState
          title="Backend not configured"
          message="Supabase is not connected yet, so the admin dashboard has no data to show. Set the Supabase env vars (see .env.example) and restart the app."
        />
      );
    case 'signed-out':
      return (
        <View style={{ flex: 1 }}>
          <EmptyState
            title="Sign-in required"
            message="The admin dashboard is only available to signed-in admin accounts. Sign in from the Account area, then return here."
          />
        </View>
      );
    case 'not-admin':
      return (
        <View style={{ flex: 1 }}>
          <EmptyState
            title="Not authorized"
            message="This account is a member account, not an admin. Admin access is granted only by the project owner, who promotes a profile in the Supabase dashboard SQL editor — it cannot be granted from inside the app."
          />
        </View>
      );
    case 'error':
      return (
        <View style={{ flex: 1 }}>
          <EmptyState title="Could not verify admin access" message={gate.message} />
          <View style={{ padding: 16, alignItems: 'center' }}>
            <AdminButton title="Retry" onPress={refresh} />
          </View>
        </View>
      );
  }
}
