-- Haftawari Samagam — 0008_video_live_chat.sql
-- Live chat for YouTube LIVE broadcasts opened on the Watch page
-- (Chat 2 fault 42, 28 Nov 2026).
--
-- Why this exists: session chat (chat_messages, 0001) is scoped to
-- the app's own Samagam Sessions. A YouTube channel's live broadcast
-- opened in the app had NO sangat chat at all — only the comments
-- section — while the real YouTube live page carries a live chat.
-- This table gives every live broadcast its own chat, keyed by the
-- YouTube video id (the one identifier every watch resolves to).
--
-- APPLY BY HAND, like 0001–0007: paste this file into the Supabase
-- Dashboard SQL editor for project umbdfrjxcxootvshxveg and Run.
-- The app degrades gracefully BEFORE it is applied: the Watch page
-- detects the missing table and simply does not render the chat
-- card — no error, no fake chat.
--
-- Rules encoded here:
--  * Messages are REAL member rows only; nothing is seeded.
--  * Reading is public (guests can follow the chat); posting needs
--    a signed-in account and the row's user_id must be the poster.
--  * Body is plain text, 1–500 chars, enforced by a CHECK.
--  * No edits; a member may delete their own message; admins may
--    delete any message (moderation).

create table if not exists public.video_chat_messages (
  id uuid primary key default gen_random_uuid(),
  youtube_video_id text not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now()
);

create index if not exists video_chat_messages_video_created_idx
  on public.video_chat_messages (youtube_video_id, created_at);

alter table public.video_chat_messages enable row level security;

drop policy if exists "video chat readable by everyone" on public.video_chat_messages;
create policy "video chat readable by everyone"
  on public.video_chat_messages for select
  using (true);

drop policy if exists "members post their own chat" on public.video_chat_messages;
create policy "members post their own chat"
  on public.video_chat_messages for insert
  with check (auth.uid() = user_id);

drop policy if exists "members delete their own chat" on public.video_chat_messages;
create policy "members delete their own chat"
  on public.video_chat_messages for delete
  using (auth.uid() = user_id);

-- Realtime: the Watch page subscribes to inserts for the open
-- broadcast (postgres_changes). Guarded so re-running is safe.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'video_chat_messages'
  ) then
    alter publication supabase_realtime add table public.video_chat_messages;
  end if;
end $$;
