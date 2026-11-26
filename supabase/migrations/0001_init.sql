-- Haftawari Samagam — 0001_init.sql
-- Initial schema + Row Level Security.
-- Apply with:  supabase db push        (Supabase CLI, linked project)
--         or:  paste into the Supabase Dashboard SQL editor.
-- Free tier only. No paid features are used.
--
-- Truthfulness rules encoded here:
--  * sessions.status is an enum of upcoming / now_playing / completed /
--    cancelled. There is deliberately NO 'live' status: a session plays a
--    prerecorded, authorized recording and must never be represented as a
--    newly originated live broadcast.
--  * Participant counts come from session_participants / Realtime
--    Presence — never from a stored, editable counter.

create extension if not exists pgcrypto;

-- ── Enums ────────────────────────────────────────────────────────────
create type public.user_role as enum ('member', 'admin');
create type public.publish_state as enum ('draft', 'published', 'unpublished');
create type public.session_status as enum ('upcoming', 'now_playing', 'completed', 'cancelled');
create type public.participant_state as enum ('joined', 'left');

-- ── Profiles (1:1 with auth.users) ───────────────────────────────────
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  role public.user_role not null default 'member',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Create a profile automatically for every new auth user (always member;
-- promotion to admin is a deliberate, audited act — see docs).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', null));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Role check used by RLS policies. SECURITY DEFINER so policies can read
-- the caller's role without recursive policy evaluation on profiles.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- ── Categories ───────────────────────────────────────────────────────
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

-- ── Videos (archive recordings; playback via official YouTube embed) ─
create table public.videos (
  id uuid primary key default gen_random_uuid(),
  youtube_video_id text not null unique,
  title text not null,
  description text,
  category_id uuid references public.categories (id) on delete set null,
  thumbnail_url text,
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  publish_state public.publish_state not null default 'draft',
  is_featured boolean not null default false,
  published_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index videos_category_idx on public.videos (category_id);
create index videos_publish_state_idx on public.videos (publish_state);

-- ── Playlists ────────────────────────────────────────────────────────
create table public.playlists (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  is_public boolean not null default true,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.playlist_items (
  playlist_id uuid not null references public.playlists (id) on delete cascade,
  video_id uuid not null references public.videos (id) on delete cascade,
  position integer not null,
  added_at timestamptz not null default now(),
  primary key (playlist_id, video_id),
  unique (playlist_id, position)
);

-- ── Synchronized Samagam sessions ────────────────────────────────────
create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.videos (id) on delete cascade,
  title text,
  scheduled_start_at timestamptz not null,
  scheduled_end_at timestamptz,
  status public.session_status not null default 'upcoming',
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (scheduled_end_at is null or scheduled_end_at > scheduled_start_at)
);
create index sessions_start_idx on public.sessions (scheduled_start_at);
create index sessions_status_idx on public.sessions (status);

create table public.session_participants (
  session_id uuid not null references public.sessions (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  state public.participant_state not null default 'joined',
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (session_id, user_id)
);

-- ── Session chat (real member messages only; nothing is seeded) ──────
create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 1000),
  is_removed boolean not null default false,
  created_at timestamptz not null default now()
);
create index chat_messages_session_idx on public.chat_messages (session_id, created_at);

-- ── Personal library ─────────────────────────────────────────────────
create table public.watch_history (
  user_id uuid not null references public.profiles (id) on delete cascade,
  video_id uuid not null references public.videos (id) on delete cascade,
  last_position_seconds integer not null default 0 check (last_position_seconds >= 0),
  watched_at timestamptz not null default now(),
  primary key (user_id, video_id)
);

create table public.saved_videos (
  user_id uuid not null references public.profiles (id) on delete cascade,
  video_id uuid not null references public.videos (id) on delete cascade,
  saved_at timestamptz not null default now(),
  primary key (user_id, video_id)
);

-- ── Audit log (admin actions; append-only from the app) ──────────────
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null,
  entity_type text,
  entity_id uuid,
  details jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_created_idx on public.audit_logs (created_at desc);

-- Participant check used by RLS policies on session_participants and
-- chat_messages. SECURITY DEFINER so the policy does not recursively
-- evaluate session_participants policies on itself. Defined here, after
-- the table exists, because SQL-language function bodies are validated
-- at creation time.
create or replace function public.is_session_participant(p_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.session_participants
    where session_id = p_session_id and user_id = auth.uid()
  );
$$;

-- ═════════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY — enabled on EVERY table.
-- ═════════════════════════════════════════════════════════════════════
alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.videos enable row level security;
alter table public.playlists enable row level security;
alter table public.playlist_items enable row level security;
alter table public.sessions enable row level security;
alter table public.session_participants enable row level security;
alter table public.chat_messages enable row level security;
alter table public.watch_history enable row level security;
alter table public.saved_videos enable row level security;
alter table public.audit_logs enable row level security;

-- profiles: own row readable/updatable by its owner; admins read all.
-- Role self-promotion is blocked: the update policy forbids changing
-- `role` unless the caller is already an admin (checked via trigger).
create policy profiles_select_own_or_admin on public.profiles
  for select using (id = auth.uid() or public.is_admin());
create policy profiles_update_own on public.profiles
  for update using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

create or replace function public.prevent_role_self_promotion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role and not public.is_admin() then
    raise exception 'Only an admin can change a profile role.';
  end if;
  return new;
end;
$$;

create trigger profiles_guard_role
  before update on public.profiles
  for each row execute function public.prevent_role_self_promotion();

-- categories: public read; admin write.
create policy categories_select_public on public.categories
  for select using (true);
create policy categories_admin_write on public.categories
  for all using (public.is_admin()) with check (public.is_admin());

-- videos: public read of PUBLISHED only; admins see and manage all.
create policy videos_select_published_or_admin on public.videos
  for select using (publish_state = 'published' or public.is_admin());
create policy videos_admin_write on public.videos
  for all using (public.is_admin()) with check (public.is_admin());

-- playlists: public playlists readable by anyone; private ones only by
-- their creator / admins. Writes: creator or admin.
create policy playlists_select on public.playlists
  for select using (is_public or created_by = auth.uid() or public.is_admin());
create policy playlists_write_own_or_admin on public.playlists
  for all using (created_by = auth.uid() or public.is_admin())
  with check (created_by = auth.uid() or public.is_admin());

create policy playlist_items_select on public.playlist_items
  for select using (
    exists (
      select 1 from public.playlists p
      where p.id = playlist_id
        and (p.is_public or p.created_by = auth.uid() or public.is_admin())
    )
  );
create policy playlist_items_write on public.playlist_items
  for all using (
    exists (
      select 1 from public.playlists p
      where p.id = playlist_id
        and (p.created_by = auth.uid() or public.is_admin())
    )
  )
  with check (
    exists (
      select 1 from public.playlists p
      where p.id = playlist_id
        and (p.created_by = auth.uid() or public.is_admin())
    )
  );

-- sessions: readable by anyone (they describe public scheduled events);
-- only admins create / change / cancel them.
create policy sessions_select_public on public.sessions
  for select using (true);
create policy sessions_admin_write on public.sessions
  for all using (public.is_admin()) with check (public.is_admin());

-- session_participants: a user manages only their own row; participants
-- of a session and admins can read the roster (for the REAL count).
create policy participants_select on public.session_participants
  for select using (
    user_id = auth.uid()
    or public.is_admin()
    or public.is_session_participant(session_id)
  );
create policy participants_insert_own on public.session_participants
  for insert with check (user_id = auth.uid());
create policy participants_update_own on public.session_participants
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy participants_delete_own on public.session_participants
  for delete using (user_id = auth.uid());

-- chat: authenticated members of the session can read non-removed
-- messages (admins also see removed ones, for moderation); an
-- authenticated user can insert only as themselves and only into a
-- session they have joined; admins can update (moderation removal).
create policy chat_select on public.chat_messages
  for select using (
    public.is_admin()
    or (not is_removed and public.is_session_participant(session_id))
  );
create policy chat_insert_own_joined on public.chat_messages
  for insert with check (
    user_id = auth.uid() and public.is_session_participant(session_id)
  );
create policy chat_admin_update on public.chat_messages
  for update using (public.is_admin()) with check (public.is_admin());

-- watch history & saved videos: strictly the owner's own rows.
create policy watch_history_own on public.watch_history
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy saved_videos_own on public.saved_videos
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- audit logs: admins read; authenticated users may insert entries about
-- their own actions (the admin UI writes these); nobody updates/deletes.
create policy audit_logs_select_admin on public.audit_logs
  for select using (public.is_admin());
create policy audit_logs_insert_actor on public.audit_logs
  for insert with check (actor_id = auth.uid() or public.is_admin());

-- ── Realtime ─────────────────────────────────────────────────────────
-- Publish the tables the app subscribes to (sessions status, chat,
-- participants). Presence uses Realtime Presence channels and needs no
-- publication entry. Run once; safe to re-run in the SQL editor if the
-- publication already contains a table it will error — remove that line.
alter publication supabase_realtime add table public.sessions;
alter publication supabase_realtime add table public.chat_messages;
alter publication supabase_realtime add table public.session_participants;
