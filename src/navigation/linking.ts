import { Platform } from 'react-native';
import {
  getPathFromState as navGetPathFromState,
  getStateFromPath as navGetStateFromPath,
  type LinkingOptions,
} from '@react-navigation/native';
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
 *
 * Deployment-base fix (UX Fix 2, taps stream, 27 Nov): React
 * Navigation generates paths WITHOUT the deployment base — navigating
 * rewrote the address bar to …github.io/sessions instead of
 * …github.io/haftawari-samagam/sessions (verified on the live site:
 * even the landing URL lost its prefix on load). In-session history
 * still worked, but any refresh, shared link or reopened URL at those
 * root paths hit GitHub Pages' 404, because the site only exists
 * under the base. The wrappers below capture the base the app was
 * actually loaded under ('' when served from a root, e.g. Expo dev)
 * and re-apply it to every generated path, and strip it when parsing.
 * Verified with a 9/9 browser-history test (URLs keep the base,
 * Back/Forward stay inside the app).
 */
const DEPLOY_BASE = '/haftawari-samagam';

function webPrefixes(): string[] {
  // window is only read on web, inside this function.
  const origin = window.location.origin;
  return [`${origin}${DEPLOY_BASE}`, origin];
}

/** The base path the app was loaded under, or '' when served from a root. */
function deployedBase(): string {
  return window.location.pathname.startsWith(DEPLOY_BASE) ? DEPLOY_BASE : '';
}

function createWebLinking(): LinkingOptions<RootStackParamList> {
  const base = deployedBase();
  return {
    prefixes: webPrefixes(),
    ...(base
      ? {
          getStateFromPath: (
            path: string,
            config: Parameters<typeof navGetStateFromPath>[1],
          ) =>
            navGetStateFromPath(
              path.startsWith(base) ? path.slice(base.length) || '/' : path,
              config,
            ),
          getPathFromState: (
            state: Parameters<typeof navGetPathFromState>[0],
            config: Parameters<typeof navGetPathFromState>[1],
          ) => {
            const path = navGetPathFromState(state, config);
            return base + (path.startsWith('/') ? path : `/${path}`);
          },
        }
      : {}),
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
            AdminChannels: 'channels',
            AdminSessions: 'sessions',
            AdminCategories: 'categories',
            AdminMembers: 'members',
            AdminChatModeration: 'chat-moderation',
            AdminAuditLogs: 'audit-logs',
          },
        },
      },
    },
  };
}

export const appLinking: LinkingOptions<RootStackParamList> | undefined =
  Platform.OS === 'web' ? createWebLinking() : undefined;
