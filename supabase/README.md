# Supabase — configuration notes

- **Plan:** Free tier only. No paid features are used by this project.
- **Project:** not created yet. The user creates it (guided steps in
  `docs/ARCHITECTURE.md` §8); no account is created on their behalf.
- **Schema:** apply `migrations/0001_init.sql` via the Dashboard SQL
  editor, or with the Supabase CLI:

  ```bash
  npx supabase link --project-ref <your-project-ref>
  npx supabase db push
  ```

- **Realtime:** the migration adds `sessions`, `chat_messages` and
  `session_participants` to the `supabase_realtime` publication.
  Presence channels need no publication entry.
- **Keys:** the app uses only the **anon public** key
  (`EXPO_PUBLIC_SUPABASE_ANON_KEY`). The **service-role** key must
  never be placed in `.env`, the app, or this repository — all admin
  power is granted through Row Level Security role checks.
- **First admin:** after the owner signs up in the app, run in the
  SQL editor:

  ```sql
  update public.profiles set role = 'admin'
  where id = '<owner auth user id>';
  ```

  (Find the id under Dashboard → Authentication → Users.)
- **Local dev (optional):** `npx supabase start` runs a local stack
  in Docker and applies the same migrations.
