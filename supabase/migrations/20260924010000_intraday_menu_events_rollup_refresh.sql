-- Intraday rollup refresh — keep Today / 7D / MTD useful without scanning menu_events on every UI load.
-- Safe to re-run. Does not raise statement_timeout. Does not delete raw menu_events.
-- Staff JWTs cannot execute refresh (service_role / postgres cron only).

-- Fast path: rebuild only the current + previous Riyadh calendar days (business day spans 03:00).
create or replace function public.refresh_menu_events_daily_rollup_intraday()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from date;
  v_to date;
  v_rows bigint;
begin
  -- Cover business-day wrap: Riyadh calendar today and yesterday.
  v_to := (current_timestamp at time zone 'Asia/Riyadh')::date;
  v_from := v_to - 1;

  delete from public.menu_events_daily_rollup
  where day_key >= v_from
    and day_key <= v_to;

  insert into public.menu_events_daily_rollup (
    day_key, branch_id, language, event_type, role_key, shift_bucket, is_weekend,
    event_count, session_ids
  )
  select
    (m.created_at at time zone 'Asia/Riyadh')::date,
    coalesce(nullif(trim(m.branch_id), ''), 'unknown'),
    coalesce(nullif(trim(m.language), ''), 'unknown'),
    coalesce(m.event_type, 'unknown'),
    public.nac_resolved_role(m.employee_role, m.metadata),
    public.nac_shift_bucket(m.created_at),
    public.nac_is_weekend_riyadh(m.created_at),
    count(*)::bigint,
    -- Distinct sessions per day/branch/event slice — not raw event rows.
    count(distinct m.session_id) filter (where coalesce(trim(m.session_id), '') <> '')::bigint
  from public.menu_events m
  where (m.created_at at time zone 'Asia/Riyadh')::date >= v_from
    and (m.created_at at time zone 'Asia/Riyadh')::date <= v_to
  group by 1, 2, 3, 4, 5, 6, 7;

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

revoke all on function public.refresh_menu_events_daily_rollup_intraday() from public;
revoke all on function public.refresh_menu_events_daily_rollup_intraday() from anon;
revoke all on function public.refresh_menu_events_daily_rollup_intraday() from authenticated;
grant execute on function public.refresh_menu_events_daily_rollup_intraday() to service_role;

comment on function public.refresh_menu_events_daily_rollup_intraday() is
  'Rebuild menu_events_daily_rollup for Riyadh today+yesterday only. service_role / pg_cron. Preserves distinct session_ids semantics.';

-- Supporting index for intraday refresh predicate (created_at range).
create index if not exists idx_menu_events_created_at
  on public.menu_events (created_at desc);

-- Schedule every 15 minutes (UTC). Nightly 45-day job remains in rollup_refresh_cron.sql.
do $cron$
declare
  r record;
  v_job_id bigint;
begin
  if to_regprocedure('cron.schedule(text,text,text)') is null then
    raise notice 'pg_cron unavailable — skip intraday schedule; function still installed';
    return;
  end if;

  for r in
    select jobid from cron.job where jobname = 'nac_refresh_menu_events_daily_rollup_intraday'
  loop
    perform cron.unschedule(r.jobid);
  end loop;

  select cron.schedule(
    'nac_refresh_menu_events_daily_rollup_intraday',
    '*/15 * * * *',
    $job$select public.refresh_menu_events_daily_rollup_intraday();$job$
  )
  into v_job_id;

  raise notice 'Scheduled nac_refresh_menu_events_daily_rollup_intraday (job_id=%)', v_job_id;
exception
  when others then
    raise notice 'Could not schedule intraday rollup cron: %', SQLERRM;
end;
$cron$;

-- Clarify that interactive BI (including Today) reads the rollup fabric.
comment on function public.get_bi_dashboard_from_rollup(text, int) is
  'Fast BI from menu_events_daily_rollup. Used for Today/7D/MTD interactive loads. session_ids = distinct sessions. Refresh via refresh_menu_events_daily_rollup_intraday / nightly 45d job.';
