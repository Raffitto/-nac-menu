-- Bound the intraday rollup to created_at so the existing index can range-scan
-- today and yesterday in Asia/Riyadh. The advisory lock stays. Semantics stay
-- calendar-day distinct session counts for those two dates.

create or replace function public.refresh_menu_events_daily_rollup_intraday()
returns bigint
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_from date;
  v_to date;
  v_rows bigint;
begin
  if not pg_try_advisory_xact_lock(88442201) then
    return 0;
  end if;

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
    count(distinct m.session_id) filter (where coalesce(trim(m.session_id), '') <> '')::bigint
  from public.menu_events m
  where m.created_at >= (v_from::timestamp at time zone 'Asia/Riyadh')
    and m.created_at < ((v_to + 1)::timestamp at time zone 'Asia/Riyadh')
  group by 1, 2, 3, 4, 5, 6, 7;

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$function$;
