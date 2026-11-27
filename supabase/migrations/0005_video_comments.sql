-- Haftawari Samagam — 0005_video_comments.sql
-- Comments + likes for RECORDED videos (the Watch page), Phase 13.
--
-- Why this exists: until now the Watch page had NO comments anywhere
-- (only the description box) and its Like button was an honest stub —
-- a tap answered "not available, nothing was recorded" because no
-- backend existed. Session chat (chat_messages, 0001) is scoped to
-- synchronized sessions and joined participants; recorded videos
-- opened from Home / Search / Channel / Up Next needed their own.
--
-- Keying decision: both tables are keyed by youtube_video_id (text),
-- the ONE identifier every watch resolves to. The catalogue row id
-- (videos.id) exists only for the seeded subset — most watches are
-- API-only videos with no row at all, and keying by row id would
-- repeat the exact hole the round-3 history audit fixed (features
-- silently dead for API-only videos). video_id is still stored when
-- a catalogue row exists (nullable FK, cascade on row delete) so
-- catalogue joins stay possible.
--
-- APPLY BY HAND, like 0001–0004: paste this file into the Supabase
-- Dashboard SQL editor for project umbdfrjxcxootvshxveg and Run.
-- It is delivered as a file only; nothing here runs automatically.
-- The app degrades gracefully BEFORE this migration is applied: the
-- comments row and sheet show a clear "Comments are not available
-- yet" state and the Like button keeps answering honestly that
-- nothing was recorded (the services detect the missing-table error).
--
-- Truthfulness rules encoded here:
--  * Comments and likes are REAL member rows only — nothing is
--    seeded, and counts are always computed from the tables.
--  * A comment count never includes removed comments.
--
-- NOTE on session titles (Phase 13 item 3): NO schema change is
-- needed — sessions.title has existed since 0001 and the admin
-- create form already writes it. What was missing was an EDIT path
-- for existing sessions; that is app code (adminService
-- updateSessionTitle + AdminSessionsScreen), not SQL.

-- ── Video comments ───────────────────────────────────────────────────
create table public.video_comments (
  id uuid primary key default gen_random_uuid(),
  youtube_video_id text not null,
  video_id uuid references public.videos (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 1000),
  is_removed boolean not null default false,
  created_at timestamptz not null default now()
);
create index video_comments_video_idx
  on public.video_comments (youtube_video_id, created_at desc);

-- ── Video likes ──────────────────────────────────────────────────────
-- One row per (video, member): the row's existence IS the like, so
-- the real count is count(*) and unliking is a delete. No counter
-- column exists to drift or be edited.
create table public.video_likes (
  youtube_video_id text not null,
  video_id uuid references public.videos (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (youtube_video_id, user_id)
);
create index video_likes_video_idx on public.video_likes (youtube_video_id);

-- ═════════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY — enabled on both tables.
-- ═════════════════════════════════════════════════════════════════════
alter table public.video_comments enable row level security;
alter table public.video_likes enable row level security;

-- comments: readable by ANYONE (signed-out visitors included — the
-- Watch page is public) except removed ones; the author and admins
-- can still read a removed row (moderation / own-history honesty).
-- Insert: a signed-in member only as themselves. Delete: the author
-- (hard delete of their own comment) or an admin. Update: admins
-- only (moderation removal via is_removed).
create policy video_comments_select on public.video_comments
  for select using (not is_removed or user_id = auth.uid() or public.is_admin());
create policy video_comments_insert_own on public.video_comments
  for insert with check (user_id = auth.uid());
create policy video_comments_delete_own_or_admin on public.video_comments
  for delete using (user_id = auth.uid() or public.is_admin());
create policy video_comments_admin_update on public.video_comments
  for update using (public.is_admin()) with check (public.is_admin());

-- likes: readable by anyone (the count is public, like the meta
-- line's YouTube count); a member can only create/delete THEIR OWN
-- like row.
create policy video_likes_select_public on public.video_likes
  for select using (true);
create policy video_likes_insert_own on public.video_likes
  for insert with check (user_id = auth.uid());
create policy video_likes_delete_own on public.video_likes
  for delete using (user_id = auth.uid());

-- ── Comment author names ─────────────────────────────────────────────
-- profiles RLS (0001) lets a member read only their OWN profile, so
-- comment readers cannot resolve other authors' display names from
-- the client. This function closes exactly that gap and nothing
-- more, following the 0002 session_participant_names pattern:
--
--  * It returns names ONLY for users who authored a non-removed
--    comment on the given video — the set of people whose names the
--    public comment list legitimately displays.
--  * It exposes only (user_id, display_name) — no emails, no roles,
--    no avatars, no other profile fields.
--  * Comments are public-read, so the function is callable by anon
--    too; the in-body filter above is the boundary.
create or replace function public.video_comment_authors(p_youtube_video_id text)
returns table (user_id uuid, display_name text)
language sql
stable
security definer
set search_path = public
as $$
  select distinct vc.user_id, p.display_name
  from public.video_comments vc
  join public.profiles p on p.id = vc.user_id
  where vc.youtube_video_id = p_youtube_video_id
    and not vc.is_removed;
$$;

revoke execute on function public.video_comment_authors(text) from public;
grant execute on function public.video_comment_authors(text) to anon;
grant execute on function public.video_comment_authors(text) to authenticated;
