-- Haftawari Samagam — 0006_hosted_videos.sql
-- Dual-source videos: YouTube (official embed, unchanged) + HOSTED
-- (original files from the rights holder, stored in Cloudflare R2,
-- played with a native player from short-lived signed URLs).
--
-- Apply with:  paste into the Supabase Dashboard SQL editor and Run
--         or:  supabase db push        (Supabase CLI, linked project)
-- Free tier only. No paid features are used.
--
-- SOURCE RULE (absolute, structural — not a UI convention):
--   * Hosted files are ORIGINALS supplied by the rights holder only.
--     Nothing in this schema or the app ever downloads, scrapes or
--     extracts a YouTube stream.
--   * A hosted video CANNOT reach publish_state='published' unless a
--     row exists in public.content_authorizations for it. That gate
--     is enforced by a BEFORE INSERT/UPDATE trigger on videos
--     (videos_hosted_publish_gate), so no client — app, dashboard or
--     raw API — can publish an unauthorized hosted recording.
--   * Playback URLs are never stored. The r2-playback Edge Function
--     mints short-lived (<= 15 min) signed GET URLs for signed-in
--     members only, after re-checking source/publish/asset status
--     AND the existence of an authorization row.

-- ── videos: source + nullable youtube id ─────────────────────────────
alter table public.videos
  add column if not exists source text not null default 'youtube'
    check (source in ('youtube', 'hosted'));

-- Hosted rows have no YouTube id. The column stays UNIQUE: in Postgres
-- a unique index treats NULLs as distinct, so any number of hosted
-- rows (NULL id) coexist while real YouTube ids stay unique.
alter table public.videos
  alter column youtube_video_id drop not null;

-- A YouTube-source row must carry its id; a hosted row carries none
-- (its media lives in hosted_assets). Enforced for every write.
alter table public.videos
  drop constraint if exists videos_source_id_check;
alter table public.videos
  add constraint videos_source_id_check check (
    (source = 'youtube' and youtube_video_id is not null)
    or (source = 'hosted')
  );

create index if not exists videos_source_idx on public.videos (source);

-- ── hosted_assets: one R2 object set per hosted video ──────────────
-- r2_object_key is the ORIGINAL upload key; hls_master_key is the
-- transcoded HLS master playlist key. Keys are storage identifiers,
-- never URLs — a key alone grants no access (bucket is private;
-- playback goes through signed URLs minted by the Edge Function).
create table if not exists public.hosted_assets (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null unique references public.videos (id) on delete cascade,
  r2_object_key text not null unique,
  hls_master_key text,
  original_filename text,
  content_type text,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  status text not null default 'uploaded'
    check (status in ('uploaded', 'processing', 'ready', 'failed')),
  -- Rotation window: an asset may be published from publish_at and is
  -- a rotation candidate after expires_at (see hosted_rotation_candidates).
  publish_at timestamptz,
  expires_at timestamptz,
  -- Set when this asset was created as the replacement for an older
  -- asset of (normally) another video row/version chain.
  replacement_of uuid references public.hosted_assets (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_at is null or publish_at is null or expires_at > publish_at)
);
create index if not exists hosted_assets_status_idx on public.hosted_assets (status);
create index if not exists hosted_assets_expires_idx on public.hosted_assets (expires_at);

-- ── content_authorizations: the publish gate's evidence ────────────
-- One row per permission grant. Admin-only table: members have NO
-- access at all (RLS below grants nothing to non-admins).
create table if not exists public.content_authorizations (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.videos (id) on delete cascade,
  rights_holder text not null,
  permission_note text not null,
  permission_reference text,
  permission_date date not null,
  recorded_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists content_authorizations_video_idx
  on public.content_authorizations (video_id);

-- ── Publish gate (structural) ────────────────────────────────────────
create or replace function public.enforce_hosted_publish_gate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.source = 'hosted' and new.publish_state = 'published' then
    if not exists (
      select 1 from public.content_authorizations ca
      where ca.video_id = new.id
    ) then
      raise exception
        'Hosted video % cannot be published: no content authorization is recorded for it. Record the rights holder''s permission in content_authorizations first.',
        new.id;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists videos_hosted_publish_gate on public.videos;
create trigger videos_hosted_publish_gate
  before insert or update of source, publish_state on public.videos
  for each row execute function public.enforce_hosted_publish_gate();

-- ── Row Level Security ───────────────────────────────────────────────
alter table public.hosted_assets enable row level security;
alter table public.content_authorizations enable row level security;

-- hosted_assets: a signed-in member may read the asset row ONLY when
-- its video is a published hosted video (playback metadata). Object
-- keys are not URLs and grant no access by themselves. Admins manage.
drop policy if exists hosted_assets_select_published on public.hosted_assets;
create policy hosted_assets_select_published on public.hosted_assets
  for select using (
    public.is_admin()
    or exists (
      select 1 from public.videos v
      where v.id = video_id
        and v.source = 'hosted'
        and v.publish_state = 'published'
    )
  );
drop policy if exists hosted_assets_admin_write on public.hosted_assets;
create policy hosted_assets_admin_write on public.hosted_assets
  for all using (public.is_admin()) with check (public.is_admin());

-- content_authorizations: ADMIN ONLY. No member policy exists, so
-- non-admins can neither read nor write a single row.
drop policy if exists content_authorizations_admin_all on public.content_authorizations;
create policy content_authorizations_admin_all on public.content_authorizations
  for all using (public.is_admin()) with check (public.is_admin());

-- ── Rotation candidates ──────────────────────────────────────────────
-- Identifies EXPIRED assets that are SAFE to rotate out. It deletes
-- nothing: the r2-rotate Edge Function performs the swap + R2 DELETE
-- + audit entry, and re-checks safety at action time.
-- An asset is a candidate when ALL of these hold:
--   * its expires_at is in the past;
--   * a replacement asset exists (some other asset's replacement_of
--     points at it) and that replacement's status is 'ready';
--   * its video is NOT referenced by any session whose status is
--     'upcoming' or 'now_playing' (a scheduled/live Samagam must
--     never lose its recording mid-flight).
create or replace function public.hosted_rotation_candidates()
returns table (
  asset_id uuid,
  video_id uuid,
  r2_object_key text,
  hls_master_key text,
  expires_at timestamptz,
  replacement_asset_id uuid,
  replacement_video_id uuid
)
language sql
stable
security definer
set search_path = public
as $$
  select
    a.id,
    a.video_id,
    a.r2_object_key,
    a.hls_master_key,
    a.expires_at,
    r.id,
    r.video_id
  from public.hosted_assets a
  join public.hosted_assets r on r.replacement_of = a.id and r.status = 'ready'
  where a.expires_at is not null
    and a.expires_at < now()
    and not exists (
      select 1 from public.sessions s
      where s.video_id = a.video_id
        and s.status in ('upcoming', 'now_playing')
    );
$$;

-- ═════════════════════════════════════════════════════════════════════
-- pg_cron rotation schedule (OPTIONAL, commented out on purpose):
-- pg_cron ships with Supabase but must be enabled per project, and
-- the actual deletion MUST go through the r2-rotate Edge Function
-- (it owns the R2 credentials and writes the audit entries) — SQL
-- alone can never delete the R2 objects. To schedule it:
--
--   1. Dashboard → Database → Extensions → enable pg_cron.
--   2. Store the function URL + cron secret in Vault, then:
--
-- create extension if not exists pg_cron;
-- select cron.schedule(
--   'hosted-video-rotation',
--   '17 3 * * *',  -- daily at 03:17 UTC
--   $$
--   select net.http_post(
--     url := (select decrypted_secret from vault.decrypted_secrets
--             where name = 'r2_rotate_url'),
--     headers := jsonb_build_object(
--       'Content-Type', 'application/json',
--       'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets
--                         where name = 'r2_rotate_secret')),
--     body := '{}'::jsonb
--   );
--   $$
-- );
--
-- Until that is set up, an admin (or any external cron) can invoke
-- r2-rotate manually; hosted_rotation_candidates() above is safe to
-- call at any time for a dry-run listing.
-- ═════════════════════════════════════════════════════════════════════
