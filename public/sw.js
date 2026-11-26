/* Haftawari Samagam — service worker (see docs/PWA.md).
 *
 * Strategy:
 *  - App shell (HTML, JS/CSS bundles, icons, manifest): cache-first with a
 *    versioned cache; old caches deleted on activate.
 *  - Supabase + YouTube traffic: NETWORK-ONLY. Session state, chat,
 *    presence and metadata are never served from cache — stale data
 *    (e.g. a cached "NOW PLAYING" state) would be misleading.
 *  - No video is ever cached: playback is the official YouTube embed,
 *    online only.
 */
const CACHE_VERSION = 'haftawari-shell-v1';
const SHELL_ASSETS = ['/', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png', '/favicon.ico'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function isNetworkOnly(url) {
  return (
    url.hostname.endsWith('.supabase.co') ||
    url.hostname === 'www.googleapis.com' ||
    url.hostname.endsWith('.youtube.com') ||
    url.hostname.endsWith('.googleusercontent.com') ||
    url.hostname.endsWith('.ggpht.com') ||
    url.hostname.endsWith('.ytimg.com')
  );
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (isNetworkOnly(url)) {
    // Network-only: never intercept with cached data. Let the browser
    // perform the request exactly as if no worker existed.
    return;
  }

  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        // Cache successful same-origin shell/bundle responses for
        // offline shell loads; navigations fall back to the shell.
        if (response.ok && (request.mode === 'navigate' || url.pathname.startsWith('/_expo/'))) {
          const copy = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
        }
        return response;
      }).catch(() => {
        if (request.mode === 'navigate') {
          return caches.match('/', { ignoreSearch: true });
        }
        throw new Error('offline and not cached');
      });
    }),
  );
});
