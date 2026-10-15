-- Rollback for 20261015160000_menu_event_detail_rollup.sql.
-- Not applied automatically. Restores the previous rollup readers and refresh
-- functions, then drops the detail table. Does not delete menu_events.

create or replace function public.get_bi_dashboard_from_rollup(
  p_branch text default null,
  p_hours int default 999
)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  with bounds as (
    select public.nac_filter_since(p_hours) as since_ts
  ),
  filtered as (
    select r.*
    from public.menu_events_daily_rollup r, bounds b
    where r.day_key >= (b.since_ts at time zone 'Asia/Riyadh')::date
      and (p_branch is null or r.branch_id = lower(trim(p_branch)))
  ),
  biz_today as (
    select
      public.nac_business_day_start() as day_start,
      public.nac_business_day_end() as day_end,
      public.nac_business_day_key() as day_key
  ),
  funnel_raw as (
    select
      coalesce(sum(r.session_ids) filter (where r.event_type = 'qr_session_start'), 0)::bigint as qr_scans,
      coalesce(sum(r.session_ids) filter (where r.event_type in ('category_open', 'menu_tab_open', 'section_open')), 0)::bigint as category_opens,
      coalesce(sum(r.session_ids) filter (where r.event_type = 'item_open'), 0)::bigint as item_opens,
      coalesce(sum(r.session_ids) filter (where r.event_type = 'add_on_click'), 0)::bigint as addon_clicks,
      coalesce(sum(r.session_ids) filter (where r.event_type = 'item_impression'), 0)::bigint as item_impressions,
      coalesce(sum(r.session_ids) filter (where r.event_type = 'time_spent'), 0)::bigint as time_spent,
      coalesce(sum(r.session_ids) filter (where r.event_type = 'menu_exit'), 0)::bigint as exits
    from filtered r
  ),
  funnel_bounded as (
    select
      qr_scans,
      least(category_opens, qr_scans) as category_opens,
      least(item_opens, least(category_opens, qr_scans)) as item_opens,
      least(addon_clicks, qr_scans) as addon_clicks,
      item_impressions,
      time_spent,
      exits
    from funnel_raw
  )
  select jsonb_build_object(
    'partial_mode', true,
    'aggregation_note', '7D/Month — daily rollup (session-scoped funnel). Run refresh_menu_events_daily_rollup(45) if stale.',
    'total_events', coalesce((select sum(event_count)::bigint from filtered), 0),
    'total_sessions', coalesce((
      select sum(session_ids)::bigint from filtered where event_type = 'qr_session_start'
    ), 0),
    'business_day', jsonb_build_object(
      'key', (select day_key::text from biz_today),
      'start', (select day_start from biz_today),
      'end', (select day_end from biz_today),
      'timezone', 'Asia/Riyadh',
      'note', 'Operational day 03:00 – 02:59'
    ),
    'by_language', coalesce((
      select jsonb_object_agg(language, cnt) from (
        select language as language, sum(event_count)::bigint as cnt from filtered group by 1
      ) s
    ), '{}'::jsonb),
    'by_event_type', coalesce((
      select jsonb_object_agg(event_type, cnt) from (
        select event_type, sum(event_count)::bigint as cnt from filtered group by 1
      ) t
    ), '{}'::jsonb),
    'by_hour', coalesce((
      select jsonb_agg(
        jsonb_build_object('hour', day_key, 'count', c, 'business_day_key', day_key, 'granularity', 'day')
        order by day_key
      )
      from (
        select day_key, sum(event_count)::bigint as c from filtered group by 1
      ) d
    ), '[]'::jsonb),
    'top_items', '[]'::jsonb,
    'top_categories', '[]'::jsonb,
    'top_searches', '[]'::jsonb,
    'top_addon_pairs', '[]'::jsonb,
    'dead_zones', '[]'::jsonb,
    'lost_searches', '[]'::jsonb,
    'session_quality', '{}'::jsonb,
    'lang_behavior', '{}'::jsonb,
    'bounce_sessions', 0,
    'deep_sessions', 0,
    'avg_time_spent', 0,
    'avg_items_per_session', 0,
    'returning_sessions', 0,
    'today_unique_sessions', 0,
    'today_qr_sessions', coalesce((
      select sum(event_count)::bigint from filtered f, biz_today b
      where f.event_type = 'qr_session_start' and f.day_key = b.day_key
    ), 0),
    'funnel', (
      select jsonb_build_object(
        'qr_scans', qr_scans,
        'category_opens', category_opens,
        'item_opens', item_opens,
        'item_impressions', item_impressions,
        'addon_clicks', addon_clicks,
        'time_spent', time_spent,
        'exits', exits
      )
      from funnel_bounded
    ),
    'strongest_hour', null,
    'top_converting_category', '{}'::jsonb,
    'placement_stats', '[]'::jsonb,
    'modal_engagement_events', 0,
    'drinks_vs_food_pct', 0
  );
$$;

grant execute on function public.get_bi_dashboard_from_rollup(text, int) to authenticated;

create or replace function public.get_session_analytics_from_rollup(
  p_branch text default null,
  p_hours int default 999,
  p_language text default 'all',
  p_event_type text default 'all',
  p_shift text default 'all',
  p_day_type text default 'all',
  p_role text default 'all'
)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  with bounds as (
    select public.nac_filter_since(p_hours) as since_ts
  ),
  filtered as (
    select r.*
    from public.menu_events_daily_rollup r, bounds b
    where r.day_key >= (b.since_ts at time zone 'Asia/Riyadh')::date
      and (p_branch is null or r.branch_id = lower(trim(p_branch)))
      and (coalesce(p_language, 'all') = 'all' or r.language = lower(trim(p_language)))
      and (coalesce(p_event_type, 'all') = 'all' or r.event_type = p_event_type)
      and (coalesce(p_shift, 'all') = 'all' or r.shift_bucket = lower(trim(p_shift)))
      and (
        coalesce(p_day_type, 'all') = 'all'
        or (lower(trim(p_day_type)) = 'weekend' and r.is_weekend)
        or (lower(trim(p_day_type)) = 'weekday' and not r.is_weekend)
      )
      and (
        coalesce(p_role, 'all') = 'all'
        or r.role_key = lower(trim(p_role))
        or (lower(trim(p_role)) = 'waiter' and r.role_key like '%wait%')
        or (lower(trim(p_role)) = 'receptionist' and r.role_key like '%recept%')
      )
  ),
  menu_sessions as (
    select coalesce(sum(session_ids), 0)::bigint as n
    from filtered
    where event_type = 'qr_session_start'
  ),
  funnel_raw as (
    select
      coalesce(sum(r.session_ids) filter (where r.event_type = 'qr_session_start'), 0)::bigint as qr_scans,
      coalesce(sum(r.session_ids) filter (where r.event_type in ('category_open', 'menu_tab_open', 'section_open')), 0)::bigint as category_opens,
      coalesce(sum(r.session_ids) filter (where r.event_type = 'item_open'), 0)::bigint as item_opens
    from filtered r
  ),
  funnel_bounded as (
    select
      qr_scans,
      least(category_opens, qr_scans) as category_opens,
      least(item_opens, least(category_opens, qr_scans)) as item_opens
    from funnel_raw
  )
  select jsonb_build_object(
    'partial_mode', true,
    'aggregation_note', 'Month/long range — daily rollup. Session count = menu QR entry sessions.',
    'total_events', coalesce((select sum(event_count) from filtered), 0),
    'total_sessions', (select n from menu_sessions),
    'by_language', coalesce((
      select jsonb_object_agg(language, cnt) from (
        select language, sum(event_count)::bigint as cnt from filtered group by 1
      ) s
    ), '{}'::jsonb),
    'by_event_type', coalesce((
      select jsonb_object_agg(event_type, cnt) from (
        select event_type, sum(event_count)::bigint as cnt from filtered group by 1
      ) t
    ), '{}'::jsonb),
    'by_role', coalesce((
      select jsonb_object_agg(role_key, cnt) from (
        select role_key, sum(event_count)::bigint as cnt from filtered group by 1
      ) r
    ), '{}'::jsonb),
    'by_branch', coalesce((
      select jsonb_object_agg(branch_id, cnt) from (
        select branch_id, sum(event_count)::bigint as cnt from filtered group by 1
      ) b
    ), '{}'::jsonb),
    'by_hour', coalesce((
      select jsonb_agg(
        jsonb_build_object('hour', day_key, 'count', c, 'granularity', 'day')
        order by day_key
      )
      from (
        select day_key, sum(event_count)::bigint as c from filtered group by 1
      ) d
    ), '[]'::jsonb),
    'top_items', '[]'::jsonb,
    'top_categories', '[]'::jsonb,
    'top_searches', '[]'::jsonb,
    'top_addon_pairs', '[]'::jsonb,
    'bounce_sessions', 0,
    'deep_sessions', 0,
    'avg_time_spent', 0,
    'avg_items_per_session', 0,
    'returning_sessions', 0,
    'today_qr_sessions', 0,
    'funnel', (
      select jsonb_build_object(
        'qr_scans', qr_scans,
        'category_opens', category_opens,
        'item_opens', item_opens
      )
      from funnel_bounded
    ),
    'session_quality', '{}'::jsonb,
    'drinks_vs_food_pct', 0,
    'recent_feed', '[]'::jsonb
  );
$$;

grant execute on function public.get_session_analytics_from_rollup(text, int, text, text, text, text, text) to authenticated;

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

create or replace function public.refresh_menu_events_daily_rollup(p_days integer default 45)
returns bigint
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_since date;
  v_rows bigint;
begin
  v_since := (current_date at time zone 'Asia/Riyadh')::date - greatest(coalesce(p_days, 45), 1);

  delete from public.menu_events_daily_rollup
  where day_key >= v_since;

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
  where (m.created_at at time zone 'Asia/Riyadh')::date >= v_since
  group by 1, 2, 3, 4, 5, 6, 7;

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$function$;


drop function if exists public.menu_event_detail_summary(text, date, text);
drop function if exists public.refresh_menu_events_detail_daily(date, date);
drop table if exists public.menu_events_detail_daily;
