/* YouTube Gurbani — service worker (see docs/PWA.md).
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
 * Updates (v4 — the tap-to-update trap): install now calls
 * skipWaiting() ITSELF and activate claims clients, so a new deploy
 * takes over on the next launch without any user action. v3 waited
 * for a banner tap ({ type: 'SKIP_WAITING' } from the app); a user
 * who ignored the banner — or whose OLD bundle had no banner at
 * all — stayed on the stale build indefinitely, which is exactly
 * the owner's "I can't see any changed" report of 27 Nov 2026.
 * The app still reloads exactly once on controllerchange
 * (registerServiceWorker.web), so the takeover is one clean reload,
 * never a loop. The SKIP_WAITING message handler is kept for older
 * app bundles that still send it.
 */
const CACHE_VERSION = 'haftawari-shell-v28';
/* The web build is served under a base path (experiments.baseUrl, e.g.
 * GitHub Pages /haftawari-samagam/). Shell paths stay relative to this
 * worker's own URL — root-absolute paths would 404 under a subpath. */
const PRECACHE_ASSETS = ['./manifest.webmanifest', './icon-192.png', './icon-512.png', './favicon.ico'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(PRECACHE_ASSETS))
      // Auto-activate: never park in "waiting" behind a banner tap.
      .then(() => self.skipWaiting()),
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
