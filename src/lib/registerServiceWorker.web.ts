/**
 * Web-only service worker registration (docs/PWA.md): registers the
 * offline-shell worker from public/sw.js after first paint, production
 * builds only. The worker never caches Supabase/YouTube traffic.
 */
export function registerServiceWorker(): void {
  if (process.env.NODE_ENV !== 'production') return;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  const register = () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
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
