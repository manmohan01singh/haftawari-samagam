/**
 * Native platforms have no service worker — the Android app follows the
 * same offline rule as the PWA (shell + honest empty states) through
 * React Native itself. This no-op is the native counterpart of
 * registerServiceWorker.web.ts (Metro picks the .web variant on web).
 */
export function registerServiceWorker(): void {
  // Intentionally empty on native.
}
