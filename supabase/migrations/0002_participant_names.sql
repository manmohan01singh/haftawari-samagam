-- Haftawari Samagam — 0002_participant_names.sql
-- Display names of a session's participants, for chat author labels.
--
-- Why this exists: profiles RLS (0001) lets a member read only their
-- OWN profile row, so a chat participant cannot resolve the display
-- names of the other authors in the session from the client. This
-- function closes exactly that gap and nothing more:
--
--  * It returns names ONLY for users who are participants of the
--    given session (a row exists in session_participants).
--  * It returns rows ONLY when the CALLER is themselves a participant
--    of that session or an admin — the same boundary RLS already puts
--    on reading the session's chat. Everyone else gets an empty set.
--  * It exposes only (user_id, display_name) — no emails, no roles,
--    no other profile fields.
--
-- Apply with:  supabase db push        (Supabase CLI, linked project)
--         or:  paste into the Supabase Dashboard SQL editor.
-- Free tier only. No paid features are used.

create or replace function public.session_participant_names(p_session_id uuid)
returns table (user_id uuid, display_name text)
language sql
stable
security definer
set search_path = public
as $$
  select sp.user_id, p.display_name
  from public.session_participants sp
  join public.profiles p on p.id = sp.user_id
  where sp.session_id = p_session_id
    and (
      public.is_admin()
      or public.is_session_participant(p_session_id)
    );
$$;

-- Lock the function down: only signed-in users may call it (and the
-- in-body gate above still applies to every call).
revoke execute on function public.session_participant_names(uuid) from public;
revoke execute on function public.session_participant_names(uuid) from anon;
grant execute on function public.session_participant_names(uuid) to authenticated;
