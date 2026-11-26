# PWA plan — Haftawari Samagam

## What exists in Phase 1

- `app.json → web`: name/short name, description, theme/background
  colours, `display: "standalone"`, Metro bundler.
- `public/manifest.webmanifest`: install manifest. The referenced
  `/icon-192.png` and `/icon-512.png` still need to be exported from
  `assets/icon.png` and placed in `public/` (Phase 2 task) — until
  then the manifest is present but installability is incomplete.
  This is stated plainly rather than shipping placeholder icons.

## Service worker — registration plan (Phase 2)

Expo's web output does not register a service worker for this
template by default. The plan, to implement in Phase 2:

1. Author a small `public/sw.js` (Workbox is optional, not required)
   with a **cache-first app shell** strategy: the HTML shell, JS/CSS
   bundles and icons are precached at install with a versioned cache
   name; old caches are deleted on activate.
2. **Network-first (or network-only) for all Supabase and YouTube
   traffic.** Session state, chat, presence and metadata are never
   served from cache — showing stale "NOW PLAYING" state or cached
   chat would be misleading.
3. **Offline behaviour:** when offline, the shell loads and every
   data screen shows its honest empty/offline state. No content is
   pre-fabricated for offline use, and no video is ever cached
   (playback is the official YouTube embed, online only).
4. Register the worker from the web entry only (`Platform.OS ===
   'web'` guard / a web-only module), after first paint, and only in
   production builds.
5. Push notifications: **not implemented** in Phase 1. Web Push would
   require a VAPID key pair and a sender (e.g. a Supabase Edge
   Function) — to be designed in a later phase, free-tier only, and
   only with the user's approval.

## Android

The Android app is the same codebase via EAS Build; it does not use
the PWA service worker. Offline behaviour on Android follows the same
rule: shell + honest empty states, no fabricated offline content.
