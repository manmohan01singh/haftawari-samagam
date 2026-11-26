/**
 * Web-only service worker registration (docs/PWA.md): registers the
 * offline-shell worker from public/sw.js after first paint, production
 * builds only. The worker never caches Supabase/YouTube traffic.
 */
export function registerServiceWorker(): void {
  if (process.env.NODE_ENV !== 'production') return;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  const register = () => {
    // Relative to the document: the web build is served under a base
    // path (experiments.baseUrl, e.g. GitHub Pages /haftawari-samagam/),
    // so a root-absolute '/sw.js' would 404. The default scope (the
    // worker's directory) then matches the app root under that base.
    const swUrl = new URL('sw.js', document.baseURI);
    navigator.serviceWorker.register(swUrl).catch(() => {
      // Registration failure must never break the app; the PWA simply
      // runs without an offline shell.
    });
  };
  if (typeof window !== 'undefined' && document.readyState !== 'complete') {
    window.addEventListener('load', register, { once: true });
  } else {
    register();
  }
}
