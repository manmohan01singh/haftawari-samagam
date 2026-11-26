/**
 * Web-only PWA plumbing (docs/PWA.md):
 *  - Registers the service worker from public/sw.js (production only,
 *    relative URL so the GitHub Pages base path works).
 *  - Actively checks for updates on load, on tab focus and when the tab
 *    becomes visible again — the old registration never checked, so a
 *    cache-first worker could serve a stale bundle forever.
 *  - When a new worker is waiting, dispatches `haftawari:sw-update` on
 *    window; PwaBanners shows "New version available — Tap to update".
 *    Tapping calls applyPwaUpdate(), which posts SKIP_WAITING and
 *    reloads exactly once when the new worker takes control.
 *  - Captures `beforeinstallprompt` and dispatches
 *    `haftawari:install-available`; promptPwaInstall() replays it.
 *    The event only exists when the browser itself offers install —
 *    nothing here fakes an install prompt.
 */

export const SW_UPDATE_EVENT = 'haftawari:sw-update';
export const INSTALL_AVAILABLE_EVENT = 'haftawari:install-available';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let waitingWorker: ServiceWorker | null = null;
let deferredInstall: BeforeInstallPromptEvent | null = null;
let reloading = false;
let listenersBound = false;

function announceUpdate(worker: ServiceWorker): void {
  waitingWorker = worker;
  window.dispatchEvent(new CustomEvent(SW_UPDATE_EVENT));
}

function bindGlobalListeners(): void {
  if (listenersBound) return;
  listenersBound = true;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return; // reload exactly once — no reload loops
    reloading = true;
    window.location.reload();
  });

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstall = event as BeforeInstallPromptEvent;
    window.dispatchEvent(new CustomEvent(INSTALL_AVAILABLE_EVENT));
  });
  window.addEventListener('appinstalled', () => {
    deferredInstall = null;
  });
}

function watchRegistration(registration: ServiceWorkerRegistration): void {
  if (registration.waiting && navigator.serviceWorker.controller) {
    announceUpdate(registration.waiting);
  }
  registration.addEventListener('updatefound', () => {
    const installing = registration.installing;
    if (!installing) return;
    installing.addEventListener('statechange', () => {
      if (installing.state === 'installed' && navigator.serviceWorker.controller) {
        announceUpdate(installing);
      }
    });
  });
  const check = () => {
    registration.update().catch(() => undefined);
  };
  window.addEventListener('focus', check);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check();
  });
}

/** Called from the update banner: activate the waiting worker now. */
export function applyPwaUpdate(): void {
  if (waitingWorker) {
    waitingWorker.postMessage({ type: 'SKIP_WAITING' });
  } else {
    window.location.reload();
  }
}

/** True once the browser has offered a real install prompt. */
export function hasPwaInstallPrompt(): boolean {
  return deferredInstall !== null;
}

/** Replay the browser's own install prompt. Resolves false if none. */
export async function promptPwaInstall(): Promise<boolean> {
  if (!deferredInstall) return false;
  const promptEvent = deferredInstall;
  deferredInstall = null;
  await promptEvent.prompt();
  const choice = await promptEvent.userChoice;
  return choice.outcome === 'accepted';
}

export function registerServiceWorker(): void {
  if (process.env.NODE_ENV !== 'production') return;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  bindGlobalListeners();
  const register = () => {
    const swUrl = new URL('sw.js', document.baseURI);
    navigator.serviceWorker
      .register(swUrl)
      .then((registration) => {
        watchRegistration(registration);
        return registration.update();
      })
      .catch(() => {
        // Registration failure must never break the app.
      });
  };
  if (typeof window !== 'undefined' && document.readyState !== 'complete') {
    window.addEventListener('load', register, { once: true });
  } else {
    register();
  }
}
