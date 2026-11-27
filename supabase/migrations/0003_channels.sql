-- Haftawari Samagam — 0003_channels.sql
-- Multi-channel panel: the admin chooses WHICH YouTube channels appear
-- in the app. Each active channel's uploads + genuinely-live broadcasts
-- (as reported by the YouTube Data API) surface in Subscriptions and
-- Search. Until this migration is applied the app keeps its previous
-- single-channel behaviour via a code-level fallback (see
-- src/features/channels/channelsService.ts).
--
-- Apply with:  paste into the Supabase Dashboard SQL editor and Run
--         or:  supabase db push        (Supabase CLI, linked project)
-- Free tier only. No paid features are used.
--
-- Truthfulness rules encoded here:
--  * A row in this table is an admin's deliberate choice — the app
--    never invents channels, and a channel only appears in the app
--    while is_active is true.
--  * Nothing here stores a "live" flag: live state always comes from
--    the YouTube Data API at read time, never from this table.

-- ── Channels ─────────────────────────────────────────────────────────
create table public.channels (
  id uuid primary key default gen_random_uuid(),
  -- The channel's UC… id on YouTube (24 chars: "UC" + 22).
  youtube_channel_id text not null unique
    check (youtube_channel_id ~ '^UC[A-Za-z0-9_-]{22}$'),
  -- The channel's @handle as returned by the API (may be null for
  -- legacy channels without one).
  handle text,
  -- Title/avatar are a snapshot of the API's values at add/refresh
  -- time, so lists can render without spending API quota. The admin
  -- screen's Refresh action re-reads them from the API.
  title text not null,
  avatar_url text,
  -- Extra name forms people actually type (e.g. 'amritvela'), used
  -- ONLY for search matching — never displayed. Admin-editable later;
  -- seeded sensibly for the first channel.
  aliases text[] not null default '{}',
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index channels_active_order_idx on public.channels (is_active, sort_order);

-- ═════════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY
-- ═════════════════════════════════════════════════════════════════════
alter table public.channels enable row level security;

-- Everyone (including signed-out visitors) can read ACTIVE channels —
-- the Subscriptions rail and Search need them before sign-in. Admins
-- can read all rows (including deactivated ones) so the panel can
-- manage them. Writes are admin-only, enforced by public.is_admin()
-- exactly like videos/categories in 0001_init.sql.
create policy channels_select_active_or_admin on public.channels
  for select using (is_active or public.is_admin());
create policy channels_admin_write on public.channels
  for all using (public.is_admin()) with check (public.is_admin());

-- ── Seed: the existing official channel ──────────────────────────────
-- Values verified live against the YouTube Data API v3 on 2026-11-26
-- (channels.list?forHandle=@bhaigursharansinghjiofficial): title and
-- handle are the API's own values; the avatar is the API's s800
-- thumbnail URL from the same response. ON CONFLICT keeps this
-- migration safely re-runnable.
insert into public.channels (youtube_channel_id, handle, title, avatar_url, aliases, is_active, sort_order)
values (
  'UCu7xpk9fOQRs4AvYEOakBfg',
  '@bhaigursharansinghjiofficial',
  'BHAI GURSHARAN SINGH JI (OFFICIAL CHANNEL)',
  'https://yt3.ggpht.com/aa4URDxgf29D7bnSdRkNL48jRC5TXnKzF1ATzEJDzUTK4xwA_2AWle4BuyUwGVvGdZ5abubvU9A=s800-c-k-c0x00ffffff-no-rj',
  array[
    'bhai gursharan singh ji',
    'bhai gursharan singh',
    'gursharan singh ji',
    'gursharan singh',
    'bgsj',
    'bhai sahib',
    'ludhiana wale',
    'bhai gursharan singh ji ludhiana wale'
  ],
  true,
  0
)
on conflict (youtube_channel_id) do nothing;
