import { Platform } from 'react-native';
import type { LinkingOptions } from '@react-navigation/native';
import type { RootStackParamList } from './types';

/**
 * Web URL linking for the PWA (UX fix, navlib stream).
 *
 * Before this, the app ran with NO linking config: every screen shared
 * the one page URL, so the browser Back/Forward buttons could not move
 * inside the app (Back left the site or did nothing), a refresh always
 * dumped the user back on Home, and no screen could be shared or
 * reopened by URL. With this config each screen has its own URL under
 * the app's base path (app.json experiments.baseUrl =
 * "/haftawari-samagam"), browser history mirrors the navigation stack,
 * and refresh / deep entry restore the screen the URL names.
 *
 * Native keeps its existing behaviour (no linking): the app has no
 * custom scheme configured, and in-app navigation there is unchanged.
 *
 * Route paths are deliberately plain words; ids travel as path params
 * (playlist/session) or query params (watch/channel/search), which
 * React Navigation maps onto the existing route params unchanged.
 */
function webPrefixes(): string[] {
  // window is only read on web, inside this function.
  const origin = window.location.origin;
  const base = '/haftawari-samagam';
  return [`${origin}${base}`, origin];
}

export const appLinking: LinkingOptions<RootStackParamList> | undefined =
  Platform.OS === 'web'
    ? {
        prefixes: webPrefixes(),
        config: {
          screens: {
            MainTabs: {
              screens: {
                Home: '',
                Subscriptions: 'subscriptions',
                Library: 'you',
              },
            },
            Watch: 'watch',
            Search: 'search',
            SearchResults: 'results',
            Channel: 'channel',
            Playlist: 'playlist/:playlistId',
            Saved: 'saved',
            Playlists: 'playlists',
            Sessions: 'sessions',
            SessionWatch: 'session/:sessionId',
            History: 'history',
            Settings: 'settings',
            Account: 'account',
            SignIn: 'sign-in',
            SignUp: 'sign-up',
            Admin: {
              path: 'admin',
              screens: {
                AdminOverview: '',
                AdminVideos: 'videos',
                AdminSessions: 'sessions',
                AdminCategories: 'categories',
                AdminMembers: 'members',
                AdminChatModeration: 'chat-moderation',
                AdminAuditLogs: 'audit-logs',
              },
            },
          },
        },
      }
    : undefined;
