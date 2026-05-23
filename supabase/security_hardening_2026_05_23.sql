-- =============================================================================
-- NAC Hospitality OS — Security hardening (2026-05-23)
-- Safe to re-run. Apply in Supabase SQL Editor after analytics / rollup migrations.
--
-- Goals:
--   • Guest menu + review QR keep anon INSERT on event tables.
--   • Anon cannot read or mutate operational analytics rows.
--   • Dashboard staff use authenticated JWT + SECURITY DEFINER RPCs only.
--   • Rollup table is not directly readable; refresh is service_role only.
--
-- Does NOT change: public menu CMS SELECT, review_portal_staff anon read, Foodics RLS.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) menu_events — RLS on, anon INSERT-only, authenticated read for dashboard
-- -----------------------------------------------------------------------------
alter table if exists public.menu_events enable row level security;

-- Drop legacy policy names so re-run is idempotent
drop policy if exists "anon_insert_menu_events" on public.menu_events;
drop policy if exists "authenticated_select_menu_events" on public.menu_events;
drop policy if exists "menu_events_insert_anon_authenticated" on public.menu_events;

-- Anon + staff may insert tracking rows (public menu + signed-in menu testing)
create policy "menu_events_insert_anon_authenticated"
  on public.menu_events
  for insert
  to anon, authenticated
  with check (true);

-- Dashboard / client fallback may read rows only when authenticated
create policy "authenticated_select_menu_events"
  on public.menu_events
  for select
  to authenticated
  using (true);

-- Defense in depth: strip table privileges from anon, then grant only INSERT
revoke all on table public.menu_events from anon;
grant insert on table public.menu_events to anon;

revoke select, update, delete on table public.menu_events from anon;

grant select, insert on table public.menu_events to authenticated;

comment on table public.menu_events is
  'Guest menu analytics. RLS: anon INSERT only; SELECT authenticated; aggregates via SECURITY DEFINER RPCs.';

-- -----------------------------------------------------------------------------
-- 2) review_events — RLS on, anon INSERT-only (review QR), authenticated SELECT
-- -----------------------------------------------------------------------------
alter table if exists public.review_events enable row level security;

drop policy if exists "anon_insert_review_events" on public.review_events;
drop policy if exists review_events_anon_insert on public.review_events;
drop policy if exists "authenticated_select_review_events" on public.review_events;
drop policy if exists review_events_auth_select on public.review_events;

create policy "anon_insert_review_events"
  on public.review_events
  for insert
  to anon, authenticated
  with check (true);

create policy "authenticated_select_review_events"
  on public.review_events
  for select
  to authenticated
  using (true);

revoke all on table public.review_events from anon;
grant insert on table public.review_events to anon;

revoke select, update, delete on table public.review_events from anon;

grant select, insert on table public.review_events to authenticated;

comment on table public.review_events is
  'Review QR funnel events. RLS: anon INSERT only; SELECT authenticated; intel via RPCs.';

-- -----------------------------------------------------------------------------
-- 3) menu_events_daily_rollup — no direct anon/authenticated access
--     SECURITY DEFINER RPCs (owner bypasses RLS) read aggregates internally.
-- -----------------------------------------------------------------------------
alter table if exists public.menu_events_daily_rollup enable row level security;

-- No policies: direct PostgREST access denied for anon + authenticated
revoke all on table public.menu_events_daily_rollup from anon;
revoke all on table public.menu_events_daily_rollup from authenticated;

comment on table public.menu_events_daily_rollup is
  'Pre-aggregated menu metrics. No direct API access; use get_*_from_rollup RPCs or service_role refresh.';

-- -----------------------------------------------------------------------------
-- 4) Dashboard / reporting RPCs — authenticated only, not PUBLIC/anon
-- -----------------------------------------------------------------------------
-- BI & overview
revoke all on function public.get_dashboard_aggregates() from public;
revoke all on function public.get_dashboard_aggregates() from anon;
grant execute on function public.get_dashboard_aggregates() to authenticated;

revoke all on function public.get_bi_dashboard(text, int) from public;
revoke all on function public.get_bi_dashboard(text, int) from anon;
grant execute on function public.get_bi_dashboard(text, int) to authenticated;

revoke all on function public.get_bi_dashboard_from_rollup(text, int) from public;
revoke all on function public.get_bi_dashboard_from_rollup(text, int) from anon;
grant execute on function public.get_bi_dashboard_from_rollup(text, int) to authenticated;

revoke all on function public.get_live_activity() from public;
revoke all on function public.get_live_activity() from anon;
grant execute on function public.get_live_activity() to authenticated;

-- Session analytics
revoke all on function public.get_session_analytics(
  text, int, text, text, text, text, text, int, boolean
) from public;
revoke all on function public.get_session_analytics(
  text, int, text, text, text, text, text, int, boolean
) from anon;
grant execute on function public.get_session_analytics(
  text, int, text, text, text, text, text, int, boolean
) to authenticated;

revoke all on function public.get_session_analytics_feed(text, int, int) from public;
revoke all on function public.get_session_analytics_feed(text, int, int) from anon;
grant execute on function public.get_session_analytics_feed(text, int, int) to authenticated;

revoke all on function public.get_session_analytics_from_rollup(
  text, int, text, text, text, text, text
) from public;
revoke all on function public.get_session_analytics_from_rollup(
  text, int, text, text, text, text, text
) from anon;
grant execute on function public.get_session_analytics_from_rollup(
  text, int, text, text, text, text, text
) to authenticated;

-- Review & unified intelligence
revoke all on function public.get_review_events_summary(text, int) from public;
revoke all on function public.get_review_events_summary(text, int) from anon;
grant execute on function public.get_review_events_summary(text, int) to authenticated;

revoke all on function public.get_review_intelligence(text, int) from public;
revoke all on function public.get_review_intelligence(text, int) from anon;
grant execute on function public.get_review_intelligence(text, int) to authenticated;

revoke all on function public.get_unified_business_day_summary(text, date) from public;
revoke all on function public.get_unified_business_day_summary(text, date) from anon;
grant execute on function public.get_unified_business_day_summary(text, date) to authenticated;

revoke all on function public.generate_daily_branch_snapshot(text, date) from public;
revoke all on function public.generate_daily_branch_snapshot(text, date) from anon;
grant execute on function public.generate_daily_branch_snapshot(text, date) to authenticated;

-- Branch comparison
revoke all on function public.get_branch_comparison(int) from public;
revoke all on function public.get_branch_comparison(int) from anon;
grant execute on function public.get_branch_comparison(int) to authenticated;

revoke all on function public.get_branch_comparison_from_rollup(int) from public;
revoke all on function public.get_branch_comparison_from_rollup(int) from anon;
grant execute on function public.get_branch_comparison_from_rollup(int) to authenticated;

-- -----------------------------------------------------------------------------
-- 5) Rollup refresh — service_role only (cron / Edge Function), not staff JWT
-- -----------------------------------------------------------------------------
revoke all on function public.refresh_menu_events_daily_rollup(int) from public;
revoke all on function public.refresh_menu_events_daily_rollup(int) from anon;
revoke all on function public.refresh_menu_events_daily_rollup(int) from authenticated;

grant execute on function public.refresh_menu_events_daily_rollup(int) to service_role;

comment on function public.refresh_menu_events_daily_rollup(int) is
  'Rebuild menu_events_daily_rollup. Execute with service_role only (scheduled job).';

-- =============================================================================
-- Post-apply verification checklist (run in SQL Editor)
-- =============================================================================
-- [ ] SET ROLE anon; SELECT count(*) FROM menu_events;        -- expect permission denied
-- [ ] SET ROLE anon; SELECT count(*) FROM review_events;      -- expect permission denied
-- [ ] SET ROLE anon; INSERT INTO menu_events (event_type, branch_id, session_id)
--       VALUES ('page_view', 'khobar', gen_random_uuid()::text);  -- expect OK (then rollback)
-- [ ] SET ROLE anon; INSERT INTO review_events (event_type, branch_id)
--       VALUES ('qr_scan', 'khobar');                           -- expect OK (then rollback)
-- [ ] RESET ROLE;  -- sign in as staff → RPC get_bi_dashboard(null, 24) returns jsonb
-- [ ] service_role: SELECT refresh_menu_events_daily_rollup(7);  -- expect bigint row count
-- [ ] authenticated: SELECT refresh_menu_events_daily_rollup(7); -- expect permission denied
