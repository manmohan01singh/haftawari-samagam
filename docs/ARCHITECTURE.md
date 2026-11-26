# Haftawari Samagam — Architecture (Phase 1 Report)

_Status: Phase 1 — scaffolding & architecture. No feature is claimed
functional beyond what is marked "Implemented" below. No mock or
fabricated data exists anywhere in the project._

## 1. Stack

| Layer | Choice | Notes |
|---|---|---|
| App | React Native 0.88 + Expo SDK 58, TypeScript (strict) | One codebase for Android + web |
| Navigation | React Navigation 7 (native-stack + bottom-tabs) | Per the approved Master Prompt architecture in `src/navigation/` |
| Backend | Supabase (Free tier) | Postgres + Auth + Realtime; created by the user in a later step — **not yet created** |
| Video metadata | YouTube Data API v3 (Free quota) | Read-only metadata; key not yet created |
| Playback | Official YouTube embedded player (Phase 2) | Never downloads/scrapes streams; ads, attribution and player controls are never hidden |
| Branding | `src/config/branding.ts` | Single rename point; working name "Haftawari Samagam" |

> Note: the create-expo-app template ships an `AGENTS.md` recommending
> Expo Router. Phase 1 follows the user-approved architecture (React
> Navigation, `src/navigation/`, `src/screens/`) from the Master
> Prompt instead; the template file is left untouched and this
> divergence is recorded here deliberately.

## 2. Folder map

```
App.tsx / index.ts            entry (NavigationContainer + RootNavigator)
app.json                      Expo + PWA web config (name, theme, display)
public/manifest.webmanifest   PWA manifest (icons exported in Phase 2)
src/
  config/branding.ts          ALL branding in one file
  theme/tokens.ts             audited design tokens, light + dark
  types/database.ts           row types mirroring the SQL schema
  lib/supabase.ts             client from env vars + not-configured guard
  lib/youtube.ts              Data API v3 skeleton (validate + metadata)
  navigation/                 types, RootNavigator, MainTabs, AdminStack
  components/
    layout/                   Header (56px), Sidebar (240/72), BottomNav, ChipsRow
    video/                    VideoCard (16:9, radius 12, duration badge)
    common/                   EmptyState, StubScreen
  screens/                    home, watch, search (+results), channel,
                              shorts, subscriptions, library, history,
                              playlist, settings, account  (stubs)
  features/
    sessions/                 synchronized Samagam engine (see §4)
    chat/                     session chat service (real messages only)
    presence/                 Realtime Presence (real counts only)
    admin/screens/            overview, videos, sessions, categories,
                              members, chat moderation, audit logs (stubs)
supabase/migrations/0001_init.sql   schema + RLS (see §3)
docs/ARCHITECTURE.md          this file
docs/PWA.md                   PWA / service-worker plan
```

## 3. Data model & RLS summary

Tables: `profiles` (role `member|admin`), `categories`, `videos`
(`youtube_video_id` unique, `publish_state`, `is_featured`),
`playlists`, `playlist_items`, `sessions`, `session_participants`,
`chat_messages`, `watch_history`, `saved_videos`, `audit_logs`.

Row Level Security is **enabled on every table**:

- Public (incl. signed-out): read published videos, categories,
  playlists marked public, and session schedule rows.
- Members: manage only their own profile (role change blocked by a
  trigger unless already admin), history, saves and participant rows;
  read/insert chat only in sessions they have joined.
- Admins (`public.is_admin()` role check, SECURITY DEFINER to avoid
  policy recursion): full management of videos, categories, sessions;
  chat moderation updates; audit-log read. `is_session_participant()`
  is likewise a definer function to keep participant/chat policies
  recursion-free.
- Audit logs: insert-as-self or admin; admin-read only; no update/delete
  policy exists, so the log is append-only from the app.

The app ships only the anon key. There is **no service-role key** in
the client — admin power exists solely through these policies.

## 4. Synchronized Samagam engine

State machine (pure, in `src/features/sessions/stateMachine.ts`):

```
upcoming ──▶ now_playing ──▶ completed
   │             │
   └──────▶ cancelled ◀──────┘
```

- Labels are exactly **UPCOMING / NOW PLAYING / COMPLETED**. The word
  "LIVE" is never a session status: a session plays a prerecorded,
  authorized recording, and presenting it as a newly originated live
  broadcast would be false. NOW PLAYING may use the red badge styling.
- One `sessions` row is the source of truth (video ref, scheduled
  start/end, stored status). Status is server-authoritative; clients
  also derive the effective status and playback offset from the
  scheduled start + a server-synced clock, so late joining and
  reconnection are just "recompute the offset" — no per-second stream.
- Sync with the official embedded player is best-effort (seek to the
  derived offset on join and on drift), within what the official
  player permits.

Realtime channels (Supabase Realtime, Free tier):

| Channel | Type | Purpose |
|---|---|---|
| `session:<id>` | postgres_changes on `sessions` | stored-status changes |
| `chat:<id>` | postgres_changes on `chat_messages` | new chat messages |
| `session-presence:<id>` | Presence | real participant count + roster |

Presence entries expire automatically on disconnect; the count shown
is exactly the number of tracked entries — never estimated.

## 5. Admin permission model

Auth (Supabase Auth) → `profiles.role`. New users are always `member`
(profile auto-created by trigger). Promotion to `admin` is done once,
manually, by the project owner in the Supabase dashboard SQL editor
(`update profiles set role='admin' where id = '<owner auth id>';`),
after which the trigger + RLS prevent any non-admin role change.
Admin UI lives in `src/features/admin/` behind the Admin stack;
hiding UI is convenience only — RLS is the enforcement.

## 6. PWA + Android build path

- **PWA:** Expo web (Metro bundler). `app.json → web` carries name,
  theme and `display: standalone`; `public/manifest.webmanifest` is
  the install manifest (192/512 icons to be exported from
  `assets/icon.png` in Phase 2). Service worker: offline **app shell
  only** — see `docs/PWA.md`. No content is cached as "offline data",
  and nothing fabricated is shown offline.
- **Android:** EAS Build (`eas build --platform android`) once the
  user creates a free Expo account, or `npx expo run:android` with a
  local Android SDK. Package id: `com.haftawarisamagam.app`.
  This project is fully separate from the Darbar Hall Reverb Java app
  (`~/workspace/gurudwara-reverb`) — different codebase, package and
  signing; nothing is shared or touched.

## 7. Implemented vs stub (Phase 1 honesty table)

| Area | State |
|---|---|
| Expo + TS project, deps installed | **Implemented** (`npm install` + `expo install` succeeded) |
| Folder architecture, navigation wiring | **Implemented** (navigators render stub screens) |
| Theme tokens (light/dark, audited geometry) | **Implemented** |
| Branding config | **Implemented** |
| Supabase client + not-configured guard | **Implemented** (no project exists yet, so the app currently runs unconfigured) |
| YouTube Data API client (parse/validate/metadata) | **Implemented as a client skeleton** — untested against a real key (none exists yet) |
| Session state machine (pure functions) | **Implemented** |
| Session/chat/presence services | **Interfaces wired to real Supabase queries** — untested until a Supabase project exists |
| SQL schema + RLS migration | **Written, not yet applied** (no Supabase project yet) |
| All screens incl. admin | **Stubs** with honest empty states |
| Video playback, search behaviour, auth UI, push | **Not implemented** (later phases) |

## 9. Phase 2 — core screens on the live backend (26 Nov 2026)

Backend is live: Supabase project (Mumbai) with migration 0001 applied
(11 tables, RLS verified — an anonymous INSERT into `videos` with the
publishable key is rejected, Postgres 42501 / HTTP 401, exactly as the
admin-only write policy intends) and a YouTube Data API v3 key
restricted to that API. `.env` carries the three public values locally
(gitignored, never committed).

Built in Phase 2 (status per area in §10):

- **Auth** — `src/features/auth/AuthContext.tsx` (session + profile +
  isAdmin from `profiles.role`), SignIn/SignUp screens. Sign-up passes
  the display name as user metadata for the auto-profile trigger. The
  project's auth settings require email confirmation
  (`mailer_autoconfirm=false`, read live from `/auth/v1/settings`), so
  sign-up honestly shows a "check your email" state when no session is
  returned. Admin routes are registered only when `isAdmin`; RLS is
  the enforcement.
- **Home feed** — published `videos` rows only, paginated 25/page,
  category chips from the real `categories` table, `FeedCard` per
  reference §1 (full-bleed thumbnail, title full-width, avatar row,
  engagement row with the actions that have a real backend: Save via
  `saved_videos`, Share via the system sheet).
- **Watch** — official YouTube embed only (`react-native-webview`
  iframe embed on native, iframe on web; branding/controls untouched),
  mounted lazily after the navigation transition; white sheet with
  20px rounded top corners overlapping the player (reference §5);
  real metadata from Supabase/API incl. statistics; Up Next from the
  published catalogue; `watch_history` recorded for signed-in users
  (position stays 0 — the embed does not expose it, and the UI never
  claims otherwise).
- **Search** — pill search bar (reference §3); results = published
  archive matches (Supabase) + official-channel matches (Data API
  search), de-duplicated; a channel result block with real counts and
  a "Latest videos" carousel leads when the query matches the channel
  (name, handle, or initials such as "bgsj").
- **Channel** — official channel resolved via `channels?forHandle`
  (UC id `UCu7xpk9fOQRs4AvYEOakBfg`); banner/avatar/counts/description
  from the API; uploads paginated via the uploads playlist; **Videos /
  Live tabs only — no Shorts tab**.
- **Subscriptions** — reference §2 layout for the one channel this app
  follows: avatar rail (red dot only when the API reports the channel
  genuinely live), "Most relevant", 78%-width carousel.
- **Library ("You") + Account + History** — reference §4 layout over
  real `watch_history` / `saved_videos` data; honest sign-in states.
- **PWA** — icons generated from `assets/icon.png`; `public/index.html`
  links the manifest; `public/sw.js` (offline shell only, network-only
  for Supabase/YouTube) registered in production web builds. Verified
  in `dist/` after `expo export --platform web`.
- **NO SHORTS (user decision, 26 Nov 2026)** — overrides Master Prompt
  §7 and the reference: Shorts screen/route deleted, bottom-nav slot 2
  is Subscriptions, sidebar item removed, no channel Shorts tab, no
  Shorts shelves. The circled + slot is retained (reference geometry);
  having no user uploads, it opens the official channel.
- **First-content seed: BLOCKED BY DESIGN, not worked around.** The
  one verified real samagam ("Kal Taaran Gur Nanak Aaya (30/11/20)",
  YouTube id `G0enZ06AnF0`, 3:00:35) cannot be inserted with the
  publishable key — RLS admin-only write rejects it (see above). The
  legitimate path is provided as `supabase/admin-seed-verified-samagam.sql`
  for the project owner to run once in the dashboard SQL Editor. Until
  then the home feed honestly shows its empty state.

### Performance (hard requirement — "app seamless and smooth")

Implemented: FlatList everywhere with stable `keyExtractor`s,
`removeClippedSubviews`, tuned `initialNumToRender`/`windowSize`;
incremental pagination (Supabase range pages, YouTube page tokens);
memoized cards (`React.memo`) with stable `useCallback` renderers;
list thumbnails are 480×360 `hqdefault` derivatives (full-res only on
hero/watch surfaces); `expo-image` with memory-disk caching and short
transitions; geometry-matched skeleton cards so loading never shifts
layout; the player embed mounts only on the Watch screen and only
after the transition settles (thumbnail + spinner before that); all
data work is async (no JS-thread blocking); native-stack + bottom-tab
navigators keep transitions native. NOT IMPLEMENTED: `getItemLayout`
(feed/shelf cards have variable-height text, so fixed offsets would
be wrong), image blurhash placeholders, and any on-device profiling
(no device build was run in this phase).

## 10. Phase 2 honesty table

| Area | State |
|---|---|
| Auth (sign-up/in/out, profile, admin route guard) | **Implemented** (email confirmation required by project settings) |
| Home feed (real published rows, pagination, categories) | **Implemented** — empty until the owner runs the admin seed or publishes via the future admin UI |
| Watch (official embed, sheet, Up Next, history) | **Implemented** |
| Search (archive + channel, channel block) | **Implemented** |
| Channel (Videos/Live tabs, uploads pagination) | **Implemented** |
| Subscriptions / Library / Account / History | **Implemented** |
| PWA (icons, manifest link, service worker) | **Implemented + verified in dist** |
| Like / Dislike / per-video comments | **Not implemented** — no backend in the schema; not shown as dead buttons |
| Cast / notification bell in the top bar | **Not implemented** — no casting/notifications exist; omitted rather than faked |
| "Subscribed" pill state | **Not implemented** — no subscriptions table; channel rows offer View Channel instead |
| Session playback + live chat (chat card/sheet) | **Phase 3** — geometry catalogued from screenshots 05–07, not built here |
| Admin dashboard build-out | **Phase 3** (stub screens + route guard in place) |
| Shorts | **Removed by user decision** — will not be built |

## 8. Next steps requiring the user (guided, free, no paid services)

1. **Supabase (free):** create an account at supabase.com → New project
   (Free plan) → copy Project URL + anon public key into `.env` →
   run `supabase/migrations/0001_init.sql` in the SQL editor (or
   `supabase link` + `supabase db push`) → promote the owner's profile
   to admin (SQL in §5).
2. **Google Cloud (free):** create a project → enable "YouTube Data
   API v3" → create an API key → put it in `.env` as
   `EXPO_PUBLIC_YOUTUBE_API_KEY`.
3. Then Phase 2 can begin: auth, home feed from real published videos,
   watch page with the official embedded player.

No paid service is used or required for any of the above.
