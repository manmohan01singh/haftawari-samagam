import { Platform } from 'react-native';
import {
  findFocusedRoute,
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
 *
 * Deployment-base fix, part 2 (night work, 27 Nov): the 9/9 test only
 * covered IN-APP navigation. A FRESH DEEP ENTRY (typing or opening
 * …/haftawari-samagam/admin) still lost the base — the bar ended at
 * github.io/admin, twice verified in the cloud browser. Root cause,
 * proven in the installed @react-navigation source: getStateFromPath
 * stamps the focused route with `route.path` = the path it was parsed
 * from, and useLinking's getPathForRoute reuses that stamped path
 * VERBATIM for the address bar on mount, bypassing getPathFromState.
 * Because this wrapper strips the base before parsing, the stamped
 * path was base-less. So getStateFromPath now re-attaches the base to
 * the stamped path after parsing (only when the incoming URL actually
 * carried the base); the re-parse check inside getPathForRoute strips
 * it again, still matches, and the bar keeps the full subpath URL.
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
          ) => {
            const stripped = path.startsWith(base) ? path.slice(base.length) || '/' : path;
            const state = navGetStateFromPath(stripped, config);
            // Part 2 (see header): the parser stamps the focused
            // route with `route.path` = the path it was parsed from,
            // and the address bar is rewritten from that stamp on
            // mount — bypassing getPathFromState. Re-attach the base
            // to the stamp when the incoming URL carried it, so a
            // deep entry keeps the full subpath URL.
            if (state && stripped !== path) {
              const focused = findFocusedRoute(state);
              if (focused?.path) focused.path = `${base}${focused.path}`;
            }
            return state;
          },
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
            Shorts: 'shorts',
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
        Help: 'help',
        Account: 'account',
        // Gated screens need paths too: without one, a guest deep
        // entry (e.g. /account/edit-profile) matches no route and
        // React Navigation silently falls back to Home — the same
        // silent bounce the admin gate fix (night work, 27 Nov)
        // removed for /admin. EditProfile renders its own signed-out
        // gate; SetNewPassword renders its reset-link-only note.
        EditProfile: 'account/edit-profile',
        SetNewPassword: 'set-new-password',
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

// ── Shareable app links (Phase 13) ───────────────────────────────────
/**
 * Canonical deployed PWA origin+base, used on native where there is
 * no window: a shared link must land in THIS app, and the PWA is the
 * app's public home (the APK has no custom scheme configured — see
 * the linking note above). On web the CURRENT origin + the base the
 * app was actually loaded under wins, so links shared from a dev
 * server or a future custom domain stay on that origin.
 */
const APP_WEB_BASE_URL = 'https://manmohan01singh.github.io/haftawari-samagam';

export function appUrlForPath(path: string): string {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    return `${window.location.origin}${deployedBase()}${path}`;
  }
  return `${APP_WEB_BASE_URL}${path}`;
}

/** Deep link that opens THIS app on a Samagam session (SessionWatch). */
export function sessionShareUrl(sessionId: string): string {
  return appUrlForPath(`/session/${encodeURIComponent(sessionId)}`);
}

/**
 * Deep link that opens THIS app on a recording (Watch). Mirrors the
 * linking config: Watch is the plain `watch` path and its params
 * travel as query params, exactly as React Navigation parses them.
 */
export function watchShareUrl(params: {
  videoRowId?: string | null;
  youtubeVideoId?: string | null;
  sessionId?: string | null;
}): string {
  const query = new URLSearchParams();
  if (params.videoRowId) query.set('videoRowId', params.videoRowId);
  if (params.youtubeVideoId) query.set('youtubeVideoId', params.youtubeVideoId);
  if (params.sessionId) query.set('sessionId', params.sessionId);
  const qs = query.toString();
  return appUrlForPath(qs ? `/watch?${qs}` : '/watch');
}

/** Deep link that opens THIS app on a channel page. */
export function channelShareUrl(channelId: string): string {
  return appUrlForPath(`/channel?channelId=${encodeURIComponent(channelId)}`);
}
