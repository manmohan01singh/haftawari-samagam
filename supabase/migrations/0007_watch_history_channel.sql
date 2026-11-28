-- 0007: watch_history.channel_title — the REAL channel that published
-- a recording, captured at watch time (audit fix, 28 Nov 2026: the
-- Library history rows previously displayed the official channel's
-- handle for EVERY recording, whatever channel it came from).
-- Nullable + no backfill: rows written before this migration simply
-- have no channel line in the UI, never a wrong one.
alter table public.watch_history
  add column if not exists channel_title text;
