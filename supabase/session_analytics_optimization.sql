-- Session Analytics: RPC-first aggregates + indexes (safe to re-run)
-- Run in Supabase SQL Editor after menu_events_employee_role.sql

-- ---------------------------------------------------------------------------
-- Helpers: shift / weekend / role (Asia/Riyadh)
-- ---------------------------------------------------------------------------
create or replace function public.nac_shift_bucket(ts timestamptz)
returns text
language sql
stable
as $$
  select case
    when h >= 5 and h < 12 then 'am'
    when h >= 12 and h < 17 then 'pm'
    else 'late'
  end
  from (
    select extract(hour from ts at time zone 'Asia/Riyadh')::int as h
  ) x;
$$;

create or replace function public.nac_is_weekend_riyadh(ts timestamptz)
returns boolean
language sql
stable
as $$
  select extract(dow from ts at time zone 'Asia/Riyadh')::int in (5, 6);
$$;

create or replace function public.nac_resolved_role(p_role text, p_meta jsonb)
returns text
language sql
immutable
as $$
  select lower(coalesce(
    nullif(trim(p_role), ''),
    nullif(trim(p_meta->>'employee_role'), ''),
    nullif(trim(p_meta->>'role'), ''),
    'waiter'
  ));
$$;

create or replace function public.nac_role_matches(p_filter text, p_role text, p_meta jsonb)
returns boolean
language sql
stable
as $$
  select
    coalesce(p_filter, 'all') = 'all'
    or public.nac_resolved_role(p_role, p_meta) = lower(trim(p_filter))
    or (
      lower(trim(p_filter)) = 'receptionist'
      and public.nac_resolved_role(p_role, p_meta) like '%recept%'
    )
    or (
      lower(trim(p_filter)) = 'waiter'
      and public.nac_resolved_role(p_role, p_meta) like '%wait%'
    )
    or (
      lower(trim(p_filter)) in ('rm', 'manager')
      and (
        public.nac_resolved_role(p_role, p_meta) like '%manager%'
        or public.nac_resolved_role(p_role, p_meta) = 'rm'
      )
    );
$$;

-- ---------------------------------------------------------------------------
-- Indexes (created_at, branch, language, event_type, role, session)
-- ---------------------------------------------------------------------------
create index if not exists idx_menu_events_created_at_desc
  on public.menu_events (created_at desc);

create index if not exists idx_menu_events_branch_created
  on public.menu_events (branch_id, created_at desc);

create index if not exists idx_menu_events_event_created
  on public.menu_events (event_type, created_at desc);

create index if not exists idx_menu_events_branch_event_created
  on public.menu_events (branch_id, event_type, created_at desc)
  where branch_id is not null;

create index if not exists idx_menu_events_session_id
  on public.menu_events (session_id)
  where coalesce(trim(session_id), '') <> '';

create index if not exists idx_menu_events_language_created
  on public.menu_events (language, created_at desc)
  where language is not null;

create index if not exists idx_menu_events_employee_role_created
  on public.menu_events (employee_role, created_at desc)
  where employee_role is not null;

create index if not exists idx_menu_events_branch_lang_created
  on public.menu_events (branch_id, language, created_at desc);

analyze public.menu_events;

-- ---------------------------------------------------------------------------
-- get_session_analytics — filtered aggregates in SQL (no client row scans)
-- ---------------------------------------------------------------------------
create or replace function public.get_session_analytics(
  p_branch text default null,
  p_hours int default 24,
  p_language text default 'all',
  p_event_type text default 'all',
  p_shift text default 'all',
  p_day_type text default 'all',
  p_role text default 'all',
  p_feed_limit int default 45,
  p_light boolean default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_light boolean;
  v_feed_lim int;
begin
  v_light := coalesce(
    p_light,
    coalesce(p_hours, 0) in (999, 720),
    coalesce(p_hours, 0) >= 168 and p_branch is null
  );
  v_feed_lim := least(greatest(coalesce(p_feed_limit, 45), 1), 50);

  return (
    with filtered as (
      select
        m.id,
        m.session_id,
        m.language,
        m.event_type,
        m.category_id,
        m.section_id,
        m.item_name_en,
        m.item_name_ar,
        m.search_query,
        m.add_on_name,
        m.created_at,
        m.metadata,
        m.branch_id,
        m.employee_role
      from public.menu_events m
      where (p_branch is null or m.branch_id = lower(trim(p_branch)))
        and (
          coalesce(p_hours, 0) = 0
          or (
            m.created_at >= public.nac_filter_since(p_hours)
            and m.created_at <= now()
          )
        )
        and (
          coalesce(p_language, 'all') = 'all'
          or coalesce(nullif(trim(m.language), ''), 'unknown') = lower(trim(p_language))
        )
        and (
          coalesce(p_event_type, 'all') = 'all'
          or m.event_type = p_event_type
        )
        and (
          coalesce(p_shift, 'all') = 'all'
          or public.nac_shift_bucket(m.created_at) = lower(trim(p_shift))
        )
        and (
          coalesce(p_day_type, 'all') = 'all'
          or (
            lower(trim(p_day_type)) = 'weekend'
            and public.nac_is_weekend_riyadh(m.created_at)
          )
          or (
            lower(trim(p_day_type)) = 'weekday'
            and not public.nac_is_weekend_riyadh(m.created_at)
          )
        )
        and public.nac_role_matches(p_role, m.employee_role, m.metadata)
    ),
    session_stats as (
      select
        session_id,
        count(*)::int as total,
        count(*) filter (where event_type = 'item_open')::int as item_opens,
        count(*) filter (where event_type = 'item_impression')::int as impressions,
        count(*) filter (where event_type = 'add_on_click')::int as addon_clicks,
        max((metadata->>'duration_seconds')::numeric) filter (where event_type = 'time_spent') as duration
      from filtered
      where coalesce(trim(session_id), '') <> ''
      group by session_id
    ),
    session_quality as (
      select case
        when total <= 2 and item_opens = 0 then 'bounce'
        when total <= 4 and item_opens <= 1 then 'casual'
        when total >= 12 or (item_opens >= 5 and addon_clicks >= 2) then 'power'
        when total >= 8 or (item_opens >= 3 and (addon_clicks > 0)) then 'deep'
        else 'engaged'
      end as quality
      from session_stats
    ),
    biz_today as (
      select
        public.nac_business_day_start() as day_start,
        public.nac_business_day_end() as day_end,
        public.nac_business_day_key() as day_key
    )
    select jsonb_build_object(
      'partial_mode', v_light,
      'aggregation_note', case
        when v_light then 'Large range — daily aggregates and simplified metrics for speed'
        else 'Full SQL aggregation'
      end,
      'total_events', (select count(*)::bigint from filtered),
      'total_sessions', (
        select count(distinct session_id)::bigint
        from filtered
        where event_type = 'qr_session_start'
          and coalesce(trim(session_id), '') <> ''
      ),
      'by_language', coalesce((
        select jsonb_object_agg(language_key, cnt)
        from (
          select coalesce(nullif(trim(language), ''), 'unknown') as language_key,
            count(*)::bigint as cnt
          from filtered
          group by 1
        ) s
      ), '{}'::jsonb),
      'by_event_type', coalesce((
        select jsonb_object_agg(event_type, cnt)
        from (
          select event_type, count(*)::bigint as cnt from filtered group by 1
        ) t
      ), '{}'::jsonb),
      'by_role', coalesce((
        select jsonb_object_agg(role_key, cnt)
        from (
          select public.nac_resolved_role(employee_role, metadata) as role_key,
            count(*)::bigint as cnt
          from filtered
          group by 1
        ) r
      ), '{}'::jsonb),
      'by_branch', coalesce((
        select jsonb_object_agg(branch_key, cnt)
        from (
          select coalesce(nullif(trim(branch_id), ''), 'unknown') as branch_key,
            count(*)::bigint as cnt
          from filtered
          group by 1
        ) b
      ), '{}'::jsonb),
      'by_hour', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'hour', w.bucket,
            'count', w.c,
            'granularity', case when v_light then 'day' else 'hour' end
          )
          order by w.bucket
        )
        from (
          select
            case
              when v_light then date_trunc('day', created_at)
              else date_trunc('hour', created_at)
            end as bucket,
            count(*)::bigint as c
          from filtered
          group by 1
          order by 1
        ) w
      ), '[]'::jsonb),
      'top_items', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'name', t.name,
            'opens', t.opens,
            'impressions', t.impressions
          )
          order by greatest(t.opens, t.impressions) desc nulls last
        )
        from (
          select
            coalesce(nullif(trim(item_name_en), ''), 'Unknown') as name,
            count(*) filter (where event_type = 'item_open')::bigint as opens,
            count(*) filter (where event_type = 'item_impression')::bigint as impressions
          from filtered
          where coalesce(trim(item_name_en), '') <> ''
          group by 1
          order by greatest(
            count(*) filter (where event_type = 'item_open'),
            count(*) filter (where event_type = 'item_impression')
          ) desc
          limit case when v_light then 20 else 40 end
        ) t
      ), '[]'::jsonb),
      'top_categories', coalesce((
        select jsonb_agg(
          jsonb_build_object('id', v.id, 'opens', v.opens, 'impressions', v.impressions)
          order by greatest(v.impressions, v.opens) desc nulls last
        )
        from (
          select category_id as id,
            count(*) filter (where event_type = 'category_open')::bigint as opens,
            count(*) filter (where event_type = 'item_impression')::bigint as impressions
          from filtered
          where category_id is not null
          group by category_id
          order by greatest(
            count(*) filter (where event_type = 'item_impression'),
            count(*) filter (where event_type = 'category_open')
          ) desc
          limit 10
        ) v
      ), '[]'::jsonb),
      'top_searches', coalesce((
        select jsonb_agg(jsonb_build_object('query', sq.q, 'count', sq.cnt) order by sq.cnt desc)
        from (
          select lower(trim(search_query)) as q, count(*)::bigint as cnt
          from filtered
          where event_type in ('search_used', 'search_submit')
            and coalesce(trim(search_query), '') <> ''
          group by 1
          order by cnt desc
          limit 10
        ) sq
      ), '[]'::jsonb),
      'top_addon_pairs', coalesce((
        select jsonb_agg(
          jsonb_build_object('item', ap.item, 'addon', ap.addon, 'clicks', ap.clicks)
          order by ap.clicks desc
        )
        from (
          select
            coalesce(nullif(trim(item_name_en), ''), 'Unknown item') as item,
            coalesce(nullif(trim(add_on_name), ''), 'Unknown add-on') as addon,
            count(*)::bigint as clicks
          from filtered
          where event_type = 'add_on_click'
          group by 1, 2
          order by clicks desc
          limit 12
        ) ap
      ), '[]'::jsonb),
      'bounce_sessions', (
        select count(*)::bigint from session_quality where quality = 'bounce'
      ),
      'deep_sessions', (
        select count(*)::bigint from session_quality where quality in ('deep', 'power')
      ),
      'avg_time_spent', coalesce((
        select round(avg((metadata->>'duration_seconds')::numeric))::bigint
        from filtered
        where event_type = 'time_spent'
          and (metadata->>'duration_seconds')::numeric > 0
      ), 0),
      'avg_items_per_session', coalesce((
        select round(avg(item_cnt)::numeric, 1)
        from (
          select count(*)::numeric as item_cnt
          from filtered
          where event_type = 'item_open'
            and coalesce(trim(session_id), '') <> ''
          group by session_id
        ) x
      ), 0),
      'returning_sessions', (
        select count(*)::bigint
        from filtered
        where event_type = 'qr_session_start'
          and metadata->>'returning' = 'true'
      ),
      'today_qr_sessions', (
        select count(*)::bigint
        from filtered, biz_today b
        where event_type = 'qr_session_start'
          and created_at >= b.day_start
          and created_at <= b.day_end
      ),
      'funnel', jsonb_build_object(
        'qr_scans', (select count(distinct session_id)::bigint from filtered where event_type = 'qr_session_start'),
        'category_opens', (select count(distinct session_id)::bigint from filtered where event_type = 'category_open'),
        'item_impressions', (select count(distinct session_id)::bigint from filtered where event_type = 'item_impression'),
        'item_opens', (select count(distinct session_id)::bigint from filtered where event_type = 'item_open'),
        'addon_clicks', (select count(distinct session_id)::bigint from filtered where event_type = 'add_on_click')
      ),
      'session_quality', jsonb_build_object(
        'bounce', (select count(*)::bigint from session_quality where quality = 'bounce'),
        'casual', (select count(*)::bigint from session_quality where quality = 'casual'),
        'engaged', (select count(*)::bigint from session_quality where quality = 'engaged'),
        'deep', (select count(*)::bigint from session_quality where quality = 'deep'),
        'power', (select count(*)::bigint from session_quality where quality = 'power')
      ),
      'drinks_vs_food_pct', coalesce((
        select round(
          100.0 * count(*) filter (where event_type = 'item_open' and category_id = 'drinks')
          / nullif(count(*) filter (where event_type = 'item_open' and category_id is not null), 0)
        )::int
        from filtered
      ), 0),
      'recent_feed', coalesce((
        select jsonb_agg(row_to_json(f)::jsonb order by f.created_at desc)
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
            coalesce(
              nullif(trim(employee_role), ''),
              metadata->>'employee_role',
              metadata->>'role'
            ) as employee_role
          from filtered
          order by created_at desc
          limit v_feed_lim
        ) f
      ), '[]'::jsonb),
      'business_day', jsonb_build_object(
        'key', (select day_key::text from biz_today),
        'timezone', 'Asia/Riyadh'
      )
    )
  );
end;
$$;

revoke all on function public.get_session_analytics(text, int, text, text, text, text, text, int, boolean) from public;
grant execute on function public.get_session_analytics(text, int, text, text, text, text, text, int, boolean) to authenticated;
