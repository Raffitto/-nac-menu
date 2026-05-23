-- =============================================================================
-- menu_events INSERT restore — fixes guest tracking after security hardening
-- Safe to re-run. Run in Supabase SQL Editor if public menu stops sending events.
--
-- Root cause (typical):
--   PostgREST INSERT uses RETURNING by default; anon had INSERT but not SELECT.
--   Frontend fix: returning:'minimal' + dedicated anon client (see supabaseMenuTrack.js).
--   This SQL restores table/sequence grants and RLS insert policies.
-- =============================================================================

-- Schema usage (required for PostgREST)
grant usage on schema public to anon, authenticated;

-- -----------------------------------------------------------------------------
-- RLS + policies (idempotent)
-- -----------------------------------------------------------------------------
alter table if exists public.menu_events enable row level security;

drop policy if exists "anon_insert_menu_events" on public.menu_events;
drop policy if exists "authenticated_select_menu_events" on public.menu_events;
drop policy if exists "menu_events_insert_anon_authenticated" on public.menu_events;

create policy "menu_events_insert_anon_authenticated"
  on public.menu_events
  for insert
  to anon, authenticated
  with check (true);

create policy "authenticated_select_menu_events"
  on public.menu_events
  for select
  to authenticated
  using (true);

-- -----------------------------------------------------------------------------
-- Table privileges — anon INSERT only; authenticated SELECT + INSERT
-- -----------------------------------------------------------------------------
revoke all on table public.menu_events from anon;
grant insert on table public.menu_events to anon;

revoke select, update, delete on table public.menu_events from anon;

grant select, insert on table public.menu_events to authenticated;

-- Serial / identity id column: REVOKE ALL removes sequence access (common break)
do $seq$
declare
  r record;
begin
  for r in
    select sequencename
    from pg_sequences
    where schemaname = 'public'
      and sequencename like 'menu\_events%'
  loop
    execute format('grant usage, select on sequence public.%I to anon', r.sequename);
    execute format('grant usage, select on sequence public.%I to authenticated', r.sequename);
  end loop;
end;
$seq$;

comment on table public.menu_events is
  'Guest menu analytics. Anon: INSERT only (use returning=minimal in client). Authenticated: SELECT for dashboard.';

-- -----------------------------------------------------------------------------
-- Verify (SQL Editor)
-- -----------------------------------------------------------------------------
-- SET ROLE anon;
-- INSERT INTO menu_events (event_type, branch_id, session_id)
--   VALUES ('page_view', 'khobar', gen_random_uuid()::text);
-- ROLLBACK;
-- RESET ROLE;
