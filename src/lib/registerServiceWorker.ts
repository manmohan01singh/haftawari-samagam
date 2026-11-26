/**
 * Native platforms have no service worker — the Android app follows the
 * same offline rule as the PWA (shell + honest empty states) through
 * React Native itself. These no-ops are the native counterparts of
 * registerServiceWorker.web.ts (Metro picks the .web variant on web).
 */
export const SW_UPDATE_EVENT = 'haftawari:sw-update';
export const INSTALL_AVAILABLE_EVENT = 'haftawari:install-available';

export function registerServiceWorker(): void {
  // Intentionally empty on native.
}

export function applyPwaUpdate(): void {
  // No service worker on native; updates ship via the app build.
}

export function hasPwaInstallPrompt(): boolean {
  return false;
}

export async function promptPwaInstall(): Promise<boolean> {
  return false;
}
