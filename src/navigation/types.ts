import type { NavigatorScreenParams } from '@react-navigation/native';

/** Main bottom-tab routes (mobile app pattern from the audit). */
export type MainTabParamList = {
  Home: undefined;
  Shorts: undefined;
  Subscriptions: undefined;
  Library: undefined;
};

/** Admin stack routes (reachable only by admin-role users; RLS enforces data access). */
export type AdminStackParamList = {
  AdminOverview: undefined;
  AdminVideos: undefined;
  AdminSessions: undefined;
  AdminCategories: undefined;
  AdminMembers: undefined;
  AdminChatModeration: undefined;
  AdminAuditLogs: undefined;
};

export type RootStackParamList = {
  MainTabs: NavigatorScreenParams<MainTabParamList>;
  Watch: { videoId: string; sessionId?: string };
  Search: undefined;
  SearchResults: { query: string };
  Channel: { channelId: string };
  Playlist: { playlistId: string };
  History: undefined;
  Settings: undefined;
  Account: undefined;
  Admin: NavigatorScreenParams<AdminStackParamList>;
};
