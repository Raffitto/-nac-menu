-- Fast Session Analytics for This Month / All branches — daily rollup (safe to re-run)

create table if not exists public.menu_events_daily_rollup (
  day_key date not null,
  branch_id text not null default 'unknown',
  language text not null default 'unknown',
  event_type text not null default 'unknown',
  role_key text not null default 'waiter',
  shift_bucket text not null default 'late',
  is_weekend boolean not null default false,
  event_count bigint not null default 0,
  session_ids bigint not null default 0,
  primary key (day_key, branch_id, language, event_type, role_key, shift_bucket, is_weekend)
);

create index if not exists idx_menu_events_daily_rollup_day
  on public.menu_events_daily_rollup (day_key desc);

create index if not exists idx_menu_events_daily_rollup_branch_day
  on public.menu_events_daily_rollup (branch_id, day_key desc);

-- Refresh last N days from menu_events (run after large imports or nightly)
create or replace function public.refresh_menu_events_daily_rollup(p_days int default 45)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
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
$$;

grant execute on function public.refresh_menu_events_daily_rollup(int) to authenticated;

-- Lightweight feed — bounded index scan only
create or replace function public.get_session_analytics_feed(
  p_branch text default null,
  p_hours int default 24,
  p_limit int default 45
)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(jsonb_agg(row_to_json(f)::jsonb order by f.created_at desc), '[]'::jsonb)
  from (
    select
      id,
      created_at,
      event_type,
      language,
      category_id,
      item_name_en,
      item_name_ar,
      search_query,
      add_on_name,
      branch_id,
      metadata,
      coalesce(nullif(trim(employee_role), ''), metadata->>'employee_role', metadata->>'role') as employee_role
    from public.menu_events m
    where (p_branch is null or m.branch_id = lower(trim(p_branch)))
      and (
        coalesce(p_hours, 0) = 0
        or (m.created_at >= public.nac_filter_since(p_hours) and m.created_at <= now())
      )
    order by m.created_at desc
    limit least(greatest(coalesce(p_limit, 45), 1), 50)
  ) f;
$$;

grant execute on function public.get_session_analytics_feed(text, int, int) to authenticated;

-- Summary from rollup for month / long ranges (no raw menu_events scan)
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
  )
  select jsonb_build_object(
    'partial_mode', true,
    'aggregation_note', 'Month/long range — daily rollup (fast path). Refresh rollup if stale.',
    'total_events', coalesce((select sum(event_count) from filtered), 0),
    'total_sessions', coalesce((select sum(session_ids) from filtered), 0),
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
