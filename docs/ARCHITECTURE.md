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
