-- ── 0004: profile avatar ─────────────────────────────────────────────
-- Adds profiles.avatar_url so a member's real profile photo — today
-- that means the Google avatar that arrives in auth user metadata on
-- Google sign-in (user_metadata.avatar_url / picture) — can live on
-- the profile row and be rendered wherever the app shows the member.
--
-- APPLY BY HAND, like 0001/0002: paste this file into the Supabase
-- dashboard SQL Editor for project umbdfrjxcxootvshxveg and run it.
-- It is delivered as a file only; nothing here runs automatically.
--
-- The app degrades gracefully BEFORE this migration is applied:
-- the profile sync in the app catches the missing-column error,
-- logs it, and continues the sign-in unaffected, and the UI falls
-- back to the avatar carried in the auth user's metadata (merged
-- into the exposed profile by AuthContext). Once this has run, the
-- sync persists avatar_url here and new Google users are seeded
-- with their photo by the trigger below from their first sign-in.

alter table public.profiles
  add column if not exists avatar_url text;

-- Seed the avatar (and the fuller Google name fields) at profile
-- creation. Google identities carry the photo as `avatar_url` (and
-- `picture` on some flows) and the name as `full_name` / `name`;
-- email sign-ups pass `display_name` explicitly. Coalesce keeps the
-- existing email behaviour identical while giving brand-new Google
-- users their DP from birth.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'display_name',
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      null
    ),
    coalesce(
      new.raw_user_meta_data ->> 'avatar_url',
      new.raw_user_meta_data ->> 'picture',
      null
    )
  );
  return new;
end;
$$;

-- No new RLS policy is needed: profiles_update_own (0001) already
-- lets a member update their own row, and the profiles_guard_role
-- trigger already prevents non-admins from changing `role` through
-- such an update. The app's sync only ever writes display_name and
-- avatar_url on the caller's own row.
