import type { NavigatorScreenParams } from '@react-navigation/native';

/**
 * Main bottom-tab routes. There is NO Shorts route: the user decided
 * (26 Nov 2026) the app has no Shorts anywhere — this overrides the
 * Master Prompt §7 and the reference screenshots.
 */
export type MainTabParamList = {
  Home: undefined;
  Subscriptions: undefined;
  Library: undefined;
};

/** Admin stack routes (reachable only by admin-role users; RLS enforces data access). */
export type AdminStackParamList = {
  AdminOverview: undefined;
  AdminVideos: undefined;
  AdminChannels: undefined;
  AdminSessions: undefined;
  AdminCategories: undefined;
  AdminMembers: undefined;
  AdminChatModeration: undefined;
  AdminAuditLogs: undefined;
};

export type RootStackParamList = {
  MainTabs: NavigatorScreenParams<MainTabParamList>;
  /** videoRowId = Supabase `videos` row id; youtubeVideoId = a YouTube id (API-sourced items). */
  Watch: { videoRowId?: string; youtubeVideoId?: string; sessionId?: string };
  Search: undefined;
  SearchResults: { query: string };
  /** Defaults to the official channel when no id is passed. */
  Channel: { channelId?: string; tab?: 'videos' | 'live' };
  Playlist: { playlistId: string };
  /** Saved videos screen (library stream). */
  Saved: undefined;
  /** All playlists list screen (library stream). */
  Playlists: undefined;
  /** Samagam sessions list (sessions stream). */
  Sessions: undefined;
  /** Synchronized Samagam watch screen (sessions stream). */
  SessionWatch: { sessionId: string };
  History: undefined;
  Settings: undefined;
  Account: undefined;
  SignIn: undefined;
  SignUp: undefined;
  /** Set-new-password gate shown after a password-recovery email link. */
  SetNewPassword: undefined;
  Admin: NavigatorScreenParams<AdminStackParamList>;
};
