-- =============================================================================
-- NAC — Scheduled menu_events_daily_rollup refresh (pg_cron)
-- Safe to re-run. Requires: security_hardening_2026_05_23.sql (service_role-only execute)
--           session_analytics_rollup.sql (table + refresh function)
--
-- Dashboard staff JWT cannot call refresh_menu_events_daily_rollup.
-- This job runs as the database cron runner (postgres), not via the frontend.
-- Never put SUPABASE_SERVICE_ROLE_KEY in React / Netlify public env.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Enable pg_cron (Supabase: Database → Extensions → pg_cron, or run once here)
-- -----------------------------------------------------------------------------
create extension if not exists pg_cron with schema extensions;

-- -----------------------------------------------------------------------------
-- 2) Nightly refresh — 03:15 Asia/Riyadh (after NAC business-day anchor at 03:00)
--    Supabase cron uses UTC: 03:15 Riyadh (UTC+3) = 00:15 UTC → minute 15, hour 0
-- -----------------------------------------------------------------------------
do $cron$
declare
  r record;
  v_job_id bigint;
begin
  -- Idempotent: remove prior job(s) with same name
  for r in
    select jobid from cron.job where jobname = 'nac_refresh_menu_events_daily_rollup'
  loop
    perform cron.unschedule(r.jobid);
  end loop;

  select cron.schedule(
    'nac_refresh_menu_events_daily_rollup',
    '15 0 * * *',
    $job$select public.refresh_menu_events_daily_rollup(45);$job$
  )
  into v_job_id;

  raise notice 'Scheduled nac_refresh_menu_events_daily_rollup (job_id=%)', v_job_id;
end;
$cron$;

comment on extension pg_cron is
  'Schedules refresh_menu_events_daily_rollup(45) nightly at 03:15 Asia/Riyadh for 7D/Month BI RPCs.';

-- -----------------------------------------------------------------------------
-- 3) Verify schedule (read-only)
-- -----------------------------------------------------------------------------
-- select jobid, jobname, schedule, command, active
-- from cron.job
-- where jobname = 'nac_refresh_menu_events_daily_rollup';

-- -----------------------------------------------------------------------------
-- 4) Manual one-time refresh (operators only — NOT staff dashboard JWT)
--    • Supabase SQL Editor (runs as postgres) — OK for emergencies
--    • Or backend script / Edge Function with service_role — OK
--    • Never from browser / REACT_APP_* keys
-- -----------------------------------------------------------------------------
-- select public.refresh_menu_events_daily_rollup(45);

-- -----------------------------------------------------------------------------
-- 5) Unschedule (if needed)
-- -----------------------------------------------------------------------------
-- select cron.unschedule(jobid) from cron.job
-- where jobname = 'nac_refresh_menu_events_daily_rollup';
