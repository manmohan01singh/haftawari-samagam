/* Haftawari Samagam — service worker (see docs/PWA.md).
 *
 * Strategy (v3 — fixes the stale-PWA bug):
 *  - Navigations / HTML: NETWORK-FIRST. A new deploy's index.html (which
 *    points at the new hashed bundle) is always fetched fresh when
 *    online; the cached shell is only an offline fallback. The previous
 *    cache-first worker served the OLD index.html — and therefore the
 *    old bundle — indefinitely.
 *  - JS/CSS bundles and shell assets (icons, manifest): STALE-WHILE-
 *    REVALIDATE. Fast from cache, refreshed in the background, so a
 *    bundle change lands on the next load at the latest.
 *  - Supabase + YouTube traffic: NETWORK-ONLY, never intercepted.
 *  - No video is ever cached: playback is the official YouTube embed.
 *
 * Updates: install does NOT skipWaiting on its own. The app detects a
 * waiting worker, shows a "New version available" banner, and only on
 * the user's tap posts { type: 'SKIP_WAITING' } here.
 */
const CACHE_VERSION = 'haftawari-shell-v3';
/* The web build is served under a base path (experiments.baseUrl, e.g.
 * GitHub Pages /haftawari-samagam/). Shell paths stay relative to this
 * worker's own URL — root-absolute paths would 404 under a subpath. */
const PRECACHE_ASSETS = ['./manifest.webmanifest', './icon-192.png', './icon-512.png', './favicon.ico'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(PRECACHE_ASSETS)),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
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

  if (isNetworkOnly(url)) return;
  if (url.origin !== self.location.origin) return;

  // Navigations: network-first, cached shell only as offline fallback.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put('./', copy));
          }
          return response;
        })
        .catch(() => caches.match('./', { ignoreSearch: true })),
    );
    return;
  }

  // Everything else same-origin (bundles, icons, manifest): stale-while-revalidate.
  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => {
          if (cached) return cached;
          throw new Error('offline and not cached');
        });
      return cached || network;
    }),
  );
});
