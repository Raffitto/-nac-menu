-- Align rollup session analytics total_sessions with menu QR entry (qr_session_start).

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
    'funnel', '{}'::jsonb,
    'session_quality', '{}'::jsonb,
    'drinks_vs_food_pct', 0,
    'recent_feed', '[]'::jsonb
  );
$$;

grant execute on function public.get_session_analytics_from_rollup(text, int, text, text, text, text, text) to authenticated;
