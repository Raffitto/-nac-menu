-- Operational Dashboard integrity — calendar month filter + rollup funnel session semantics
-- Safe to re-run in Supabase SQL Editor.

create or replace function public.nac_calendar_month_start(ts timestamptz default now())
returns timestamptz
language sql
stable
as $$
  select (
    date_trunc('month', ts at time zone 'Asia/Riyadh') at time zone 'Asia/Riyadh'
  );
$$;

create or replace function public.nac_filter_since(p_hours int, ts timestamptz default now())
returns timestamptz
language sql
stable
as $$
  select case
    when coalesce(p_hours, 0) = 0 then null::timestamptz
    when p_hours = 24 then public.nac_business_day_start(ts)
    when p_hours = 168 then public.nac_business_day_start(ts - interval '6 days')
    when p_hours in (999, 720) then public.nac_calendar_month_start(ts)
    else ts - make_interval(hours => greatest(p_hours, 1))
  end;
$$;

comment on function public.nac_filter_since(int, timestamptz) is
  'Range lower bound: 24=today business day, 168=7D, 999/720=calendar month-to-date (Asia/Riyadh).';

-- Rollup BI: funnel stages use sum(session_ids) per event type (approx distinct sessions per day slice), monotonic.
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
