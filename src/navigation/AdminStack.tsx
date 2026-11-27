import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import {
  AdminAuditLogsScreen,
  AdminCategoriesScreen,
  AdminChannelsScreen,
  AdminChatModerationScreen,
  AdminHostedScreen,
  AdminMembersScreen,
  AdminOverviewScreen,
  AdminSessionsScreen,
  AdminVideosScreen,
} from '../features/admin/screens';
import type { AdminStackParamList } from './types';

const Stack = createNativeStackNavigator<AdminStackParamList>();

/**
 * Admin dashboard stack. Navigation-level gating (showing this stack
 * only to admins) is a UX convenience — the real enforcement is Row
 * Level Security on every admin-writable table.
 */
export function AdminStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="AdminOverview" component={AdminOverviewScreen} options={{ title: 'Admin' }} />
      <Stack.Screen name="AdminVideos" component={AdminVideosScreen} options={{ title: 'Videos' }} />
      <Stack.Screen name="AdminHosted" component={AdminHostedScreen} options={{ title: 'Hosted videos' }} />
      <Stack.Screen name="AdminChannels" component={AdminChannelsScreen} options={{ title: 'Channels' }} />
      <Stack.Screen name="AdminSessions" component={AdminSessionsScreen} options={{ title: 'Sessions' }} />
      <Stack.Screen name="AdminCategories" component={AdminCategoriesScreen} options={{ title: 'Categories' }} />
      <Stack.Screen name="AdminMembers" component={AdminMembersScreen} options={{ title: 'Members' }} />
      <Stack.Screen name="AdminChatModeration" component={AdminChatModerationScreen} options={{ title: 'Chat moderation' }} />
      <Stack.Screen name="AdminAuditLogs" component={AdminAuditLogsScreen} options={{ title: 'Audit logs' }} />
    </Stack.Navigator>
  );
}
