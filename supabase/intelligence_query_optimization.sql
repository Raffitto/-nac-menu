-- Intelligence query optimization — run in Supabase SQL Editor
-- Fixes statement timeouts on 7D / This Month (p_hours 168 / 999)

-- ---------------------------------------------------------------------------
-- review_events indexes
-- ---------------------------------------------------------------------------
create index if not exists idx_review_events_created_at_desc
  on public.review_events (created_at desc);

create index if not exists idx_review_events_branch_created
  on public.review_events (branch_id, created_at desc);

create index if not exists idx_review_events_event_created
  on public.review_events (event_type, created_at desc);

create index if not exists idx_review_events_branch_event_created
  on public.review_events (branch_id, event_type, created_at desc);

create index if not exists idx_review_events_employee_created
  on public.review_events (employee_name, created_at desc)
  where coalesce(trim(employee_name), '') <> '';

-- ---------------------------------------------------------------------------
-- Fast BI dashboard from daily rollup (7D / month — no full menu_events scan)
-- ---------------------------------------------------------------------------
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

-- Client calls get_bi_dashboard_from_rollup when p_hours >= 168 (keeps existing get_bi_dashboard for Today).

-- ---------------------------------------------------------------------------
-- Branch comparison — rollup for long ranges
-- ---------------------------------------------------------------------------
create or replace function public.get_branch_comparison_from_rollup(p_hours int default 999)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  with bounds as (select public.nac_filter_since(p_hours) as since_ts),
  branches as (select unnest(array['khobar', 'riyadh', 'jeddah']) as branch_id),
  menu_agg as (
    select r.branch_id, sum(r.session_ids)::bigint as sessions,
      sum(r.event_count) filter (where r.event_type = 'item_impression')::bigint as impressions,
      sum(r.event_count) filter (where r.event_type = 'item_open')::bigint as opens
    from public.menu_events_daily_rollup r, bounds b
    where r.day_key >= (b.since_ts at time zone 'Asia/Riyadh')::date
    group by r.branch_id
  ),
  review_agg as (
    select e.branch_id,
      count(*) filter (where e.event_type in ('review_generate', 'review_regenerate'))::bigint as reviews,
      count(*) filter (where e.event_type in ('review_google_click', 'google_redirect'))::bigint as google_clicks,
      count(*) filter (where e.event_type = 'qr_scan')::bigint as qr_scans
    from public.review_events e, bounds b
    where e.created_at >= b.since_ts
    group by e.branch_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'branch_id', b.branch_id,
    'sessions', coalesce(ma.sessions, 0),
    'impressions', coalesce(ma.impressions, 0),
    'opens', coalesce(ma.opens, 0),
    'qr_scans', coalesce(ra.qr_scans, 0),
    'reviews_generated', coalesce(ra.reviews, 0),
    'google_redirects', coalesce(ra.google_clicks, 0),
    'conversion_pct', case when coalesce(ra.qr_scans, 0) > 0
      then round(100.0 * coalesce(ra.google_clicks, 0) / ra.qr_scans) else 0 end,
    'visual_conversion_pct', case when coalesce(ma.impressions, 0) > 0
      then round(100.0 * coalesce(ma.opens, 0) / ma.impressions) else 0 end,
    'reviews', coalesce(ra.reviews, 0),
    'sales', 0
  ) order by b.branch_id), '[]'::jsonb)
  from branches b
  left join menu_agg ma on ma.branch_id = b.branch_id
  left join review_agg ra on ra.branch_id = b.branch_id;
$$;

grant execute on function public.get_branch_comparison_from_rollup(int) to authenticated;

-- ---------------------------------------------------------------------------
-- Review events — server-side summary (no 5k row client fetch)
-- ---------------------------------------------------------------------------
create or replace function public.get_review_events_summary(
  p_branch text default null,
  p_hours int default 24
)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  with bounds as (select public.nac_filter_since(p_hours) as since_ts),
  filtered as (
    select e.event_type, e.branch_id, e.employee_name, e.employee_role, e.created_at,
      e.review_session_id, e.session_id
    from public.review_events e, bounds b
    where (coalesce(p_hours, 0) = 0 or e.created_at >= b.since_ts)
      and (p_branch is null or e.branch_id = lower(trim(p_branch)))
  ),
  by_type as (select event_type, count(*)::int as c from filtered group by 1),
  staff as (
    select
      coalesce(nullif(trim(employee_name), ''), '') as name,
      max(employee_role) as role,
      count(*) filter (where event_type = 'qr_scan') as scans,
      count(*) filter (where event_type in ('review_generate', 'review_regenerate')) as generated,
      count(*) filter (where event_type in ('review_google_click', 'google_redirect')) as google
    from filtered
    where coalesce(trim(employee_name), '') <> ''
    group by 1
  ),
  daily as (
    select (created_at at time zone 'Asia/Riyadh')::date as day_key,
      count(*) filter (where event_type = 'qr_scan')::int as scans
    from filtered
    group by 1
  ),
  branches as (
    select branch_id,
      count(*) filter (where event_type = 'qr_scan')::int as qr_scans,
      count(*) filter (where event_type in ('review_generate', 'review_regenerate'))::int as reviews_generated,
      count(*) filter (where event_type in ('review_google_click', 'google_redirect'))::int as google_redirects,
      count(*) filter (where event_type in ('review_page_open', 'review_open'))::int as review_page_opens
    from filtered
    where coalesce(trim(branch_id), '') <> ''
    group by 1
  )
  select jsonb_build_object(
    'qr_scans', coalesce((select sum(c) from by_type where event_type = 'qr_scan'), 0),
    'reviews_generated', coalesce((select sum(c) from by_type where event_type in ('review_generate', 'review_regenerate')), 0),
    'google_redirects', coalesce((select sum(c) from by_type where event_type in ('review_google_click', 'google_redirect')), 0),
    'review_page_opens', coalesce((select sum(c) from by_type where event_type in ('review_page_open', 'review_open')), 0),
    'conversion_pct', case
      when coalesce((select sum(c) from by_type where event_type = 'qr_scan'), 0) > 0
      then round(100.0 * coalesce((select sum(c) from by_type where event_type in ('review_google_click', 'google_redirect')), 0)
        / greatest((select sum(c) from by_type where event_type = 'qr_scan'), 1))
      else 0 end,
    'unique_visitors', coalesce((
      select count(distinct coalesce(nullif(trim(review_session_id), ''), nullif(trim(session_id), '')))::int
      from filtered
      where coalesce(nullif(trim(review_session_id), ''), nullif(trim(session_id), '')) is not null
    ), 0),
    'staff', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', name, 'role', role, 'scans', scans, 'generated', generated, 'google', google,
        'conversion_pct', case when scans > 0 then round(100.0 * google / scans) else 0 end
      ) order by scans desc, google desc)
      from staff
    ), '[]'::jsonb),
    'daily_trend', coalesce((
      select jsonb_agg(jsonb_build_object('date', day_key::text, 'scans', scans) order by day_key)
      from daily
    ), '[]'::jsonb),
    'by_branch', coalesce((
      select jsonb_agg(jsonb_build_object(
        'branch_id', branch_id,
        'qr_scans', qr_scans,
        'reviews_generated', reviews_generated,
        'google_redirects', google_redirects,
        'review_page_opens', review_page_opens,
        'conversion_pct', case when qr_scans > 0 then round(100.0 * google_redirects / qr_scans) else 0 end
      ) order by branch_id)
      from branches
    ), '[]'::jsonb)
  );
$$;

grant execute on function public.get_review_events_summary(text, int) to authenticated;

analyze public.menu_events;
analyze public.review_events;
analyze public.menu_events_daily_rollup;
