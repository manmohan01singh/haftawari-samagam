# Haftawari Samagam

A YouTube-inspired video app for Haftawari and Amritvela kirtan
samagams: an archive of authorized recordings, scheduled synchronized
Samagam sessions (labelled truthfully as **UPCOMING / NOW PLAYING /
COMPLETED**), real member chat and presence, and an admin dashboard.

One Expo + React Native + TypeScript codebase serves both the Android
app and the installable PWA, backed by a single Supabase project.

> Phase 1 (current): scaffolding and architecture only. Screens are
> honest empty-state stubs; no mock or fabricated data exists anywhere
> in this project. See `docs/ARCHITECTURE.md` for the full Phase 1
> report, including what is implemented vs stub.

## Setup

```bash
npm install

# Configure environment (free accounts — guided in docs/ARCHITECTURE.md §8)
cp .env.example .env
#   EXPO_PUBLIC_SUPABASE_URL=...
#   EXPO_PUBLIC_SUPABASE_ANON_KEY=...
#   EXPO_PUBLIC_YOUTUBE_API_KEY=...

# Apply the database schema to your Supabase project
#   (Dashboard SQL editor, or: npx supabase link && npx supabase db push)
#   File: supabase/migrations/0001_init.sql

npm run web       # PWA / web
npm run android   # Android (Expo Go / dev build)
npx tsc --noEmit  # typecheck
```

Without `.env`, the app still runs and shows a clearly-signalled
"not configured" empty state — it never invents data.

## Rules this project follows

- Playback is only via the official YouTube embedded player; metadata
  only via YouTube Data API v3. Streams are never downloaded or
  scraped; ads, attribution and player controls are never hidden.
- A prerecorded recording in a synchronized session is never labelled
  or presented as a newly originated live broadcast.
- Participant counts and chat are real (Supabase Realtime Presence /
  Postgres) — never fabricated.
- No paid services without the owner's explicit approval.
- This project is independent of the Darbar Hall Reverb app.
