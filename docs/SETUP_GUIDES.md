# Account Setup Guides — Haftawari Samagam

Prepared 2026-11-26. Both services are FREE for this project. No paid service is to be accepted at any step without the project owner's explicit approval.

## A. Supabase (Free)

Status: owner signed in (GitHub) on 2026-11-26, but project creation is BLOCKED by the Free-plan limit: the account already has 2 active Free projects (limit is 2, counted across all organizations). A decision from the owner is pending: pause one existing project (reversible, data kept), or use a second account.

Once a slot is free:
1. Dashboard → New project → Name: `haftawari-samagam`
2. Database password: set by the OWNER on screen; store it safely; never share it in chat.
3. Region: Mumbai if offered, otherwise Singapore.
4. Plan: Free. Decline any paid upgrade prompt.
5. Wait for provisioning to finish.
6. Project Settings → API → copy **Project URL** and **anon public key** into the app `.env`:
   - `EXPO_PUBLIC_SUPABASE_URL=`
   - `EXPO_PUBLIC_SUPABASE_ANON_KEY=`
   Never copy the `service_role` secret key into the app or chat.
7. SQL Editor → run `supabase/migrations/0001_init.sql` → verify tables + RLS.
8. Promote the owner's profile to admin (SQL in `supabase/README.md`).

## B. Google Cloud — YouTube Data API v3 (Free)

1. Go to console.cloud.google.com and sign in with the owner's Google account.
2. Create a new project (e.g. `haftawari-samagam`) — no billing needs to be enabled for the YouTube Data API v3 free quota.
3. APIs & Services → Library → search "YouTube Data API v3" → Enable.
4. APIs & Services → Credentials → Create credentials → API key.
5. Restrict the key: Application restrictions = None for server-side metadata fetch testing (tighten later); API restrictions = YouTube Data API v3 only.
6. Copy the key into `.env` as `EXPO_PUBLIC_YOUTUBE_API_KEY=` — note: keys in a client app are visible; the API restriction (YouTube Data API v3 only) is what protects it. For production, metadata fetch should move behind a Supabase Edge Function so the key stays server-side (Phase 2 decision).
7. Free quota: 10,000 units/day by default — enough for admin-side metadata validation (a videos.list call costs 1 unit).

## Order of operations
Supabase first (backend + auth + RLS test), then the YouTube key (admin Add-Video validation), then Phase 2 build work begins.
