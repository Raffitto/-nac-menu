-- NAC Menu OS: visibility-native get_bi_dashboard + business day (03:00 Asia/Riyadh)
-- Safe to re-run. No table drops. Run in Supabase SQL Editor after analytics_dashboard_setup.sql

-- ---------------------------------------------------------------------------
-- Business day helpers (operational day ≠ calendar midnight)
-- ---------------------------------------------------------------------------
create or replace function public.nac_business_day_key(ts timestamptz default now())
returns date
language sql
stable
as $$
  select case
    when (ts at time zone 'Asia/Riyadh')::time < time '03:00:00'
    then ((ts at time zone 'Asia/Riyadh')::date - interval '1 day')::date
    else (ts at time zone 'Asia/Riyadh')::date
  end;
$$;

create or replace function public.nac_business_day_start(ts timestamptz default now())
returns timestamptz
language sql
stable
as $$
  select (public.nac_business_day_key(ts)::timestamp + time '03:00:00') at time zone 'Asia/Riyadh';
$$;

create or replace function public.nac_business_day_end(ts timestamptz default now())
returns timestamptz
language sql
stable
as $$
  select public.nac_business_day_start(ts) + interval '1 day' - interval '1 second';
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
    when p_hours = 720 then public.nac_business_day_start(ts - interval '29 days')
    else ts - make_interval(hours => greatest(p_hours, 1))
  end;
$$;

-- ---------------------------------------------------------------------------
-- Visibility stats view
-- ---------------------------------------------------------------------------
create or replace view public.menu_item_visibility_stats as
select
  item_name_en as name,
  count(*) filter (where event_type = 'item_impression') as impressions,
  count(*) filter (where event_type = 'item_open') as modal_opens,
  count(distinct session_id) filter (where event_type = 'item_impression') as impression_sessions,
  coalesce(sum((metadata->>'visible_duration_ms')::numeric) filter (where event_type = 'item_impression_end'), 0)::bigint as visible_duration_ms
from public.menu_events
where coalesce(trim(item_name_en), '') <> ''
group by item_name_en;

grant select on public.menu_item_visibility_stats to authenticated;

-- ---------------------------------------------------------------------------
-- get_bi_dashboard — impressions native + business day filtering
-- ---------------------------------------------------------------------------
create or replace function public.get_bi_dashboard(
  p_branch text default null,
  p_hours int default 0
)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  with filtered as (
    select *
    from public.menu_events
    where (p_branch is null or branch_id = p_branch)
      and (
        coalesce(p_hours, 0) = 0
        or (
          created_at >= public.nac_filter_since(p_hours)
          and created_at <= now()
        )
      )
  ),
  session_stats as (
    select
      session_id,
      count(*)::int as total,
      count(*) filter (where event_type = 'item_open')::int as item_opens,
      count(*) filter (where event_type = 'item_impression')::int as impressions,
      count(*) filter (where event_type = 'add_on_click')::int as addon_clicks,
      count(*) filter (where event_type in ('search_used', 'search_submit'))::int as searches,
      max((metadata->>'duration_seconds')::numeric) filter (where event_type = 'time_spent') as duration
    from filtered
    where coalesce(trim(session_id), '') <> ''
    group by session_id
  ),
  session_quality as (
    select
      case
        when total <= 2 and item_opens = 0 then 'bounce'
        when total <= 4 and item_opens <= 1 then 'casual'
        when total >= 12 or (item_opens >= 5 and addon_clicks >= 2) then 'power'
        when total >= 8 or (item_opens >= 3 and (addon_clicks > 0 or searches > 0)) then 'deep'
        else 'engaged'
      end as quality
    from session_stats
  ),
  session_lang as (
    select distinct on (session_id)
      session_id,
      coalesce(nullif(trim(language), ''), 'unknown') as dominant_lang
    from filtered
    where coalesce(trim(session_id), '') <> ''
      and coalesce(nullif(trim(language), ''), '') <> ''
    order by session_id, created_at asc
  ),
  biz_today as (
    select
      public.nac_business_day_start() as day_start,
      public.nac_business_day_end() as day_end,
      public.nac_business_day_key() as day_key
  )
  select jsonb_build_object(
    'total_events', (select count(*)::bigint from filtered),
    'total_sessions', (
      select count(distinct session_id)::bigint
      from filtered
      where coalesce(trim(session_id), '') <> ''
    ),
    'business_day', jsonb_build_object(
      'key', (select day_key::text from biz_today),
      'start', (select day_start from biz_today),
      'end', (select day_end from biz_today),
      'timezone', 'Asia/Riyadh',
      'note', 'Operational day 03:00 – 02:59'
    ),
    'by_language', coalesce(
      (
        select jsonb_object_agg(language_key, cnt)
        from (
          select coalesce(nullif(trim(language), ''), 'unknown') as language_key, count(*)::bigint as cnt
          from filtered
          group by 1
        ) s
      ),
      '{}'::jsonb
    ),
    'by_language_sessions', coalesce(
      (
        select jsonb_object_agg(language_key, cnt)
        from (
          select dominant_lang as language_key, count(*)::bigint as cnt
          from session_lang
          where dominant_lang in ('en', 'ar')
          group by 1
        ) sl
      ),
      '{}'::jsonb
    ),
    'by_event_type', coalesce(
      (
        select jsonb_object_agg(event_type, cnt)
        from (
          select event_type, count(*)::bigint as cnt
          from filtered
          group by 1
        ) t
      ),
      '{}'::jsonb
    ),
    'top_items', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'name', m.name,
            'impressions', m.impressions,
            'opens', m.opens,
            'impression_sessions', m.impression_sessions,
            'visible_duration_ms', m.visible_duration_ms,
            'deep_interest_rate', m.deep_interest_rate,
            'avg_visible_duration_ms', m.avg_visible_duration_ms
          )
          order by greatest(m.impressions, m.opens) desc nulls last
        )
        from (
          select
            coalesce(i.name, o.name) as name,
            coalesce(i.impressions, 0) as impressions,
            coalesce(o.opens, 0) as opens,
            coalesce(i.impression_sessions, 0) as impression_sessions,
            coalesce(d.visible_duration_ms, 0) as visible_duration_ms,
            case
              when coalesce(i.impressions, 0) > 0
              then round((coalesce(o.opens, 0)::numeric / i.impressions) * 100, 1)
              else null
            end as deep_interest_rate,
            case
              when coalesce(i.impression_sessions, 0) > 0
              then round(coalesce(d.visible_duration_ms, 0)::numeric / i.impression_sessions)
              else 0
            end as avg_visible_duration_ms
          from (
            select item_name_en as name,
              count(*)::bigint as impressions,
              count(distinct session_id)::bigint as impression_sessions
            from filtered
            where event_type = 'item_impression'
              and coalesce(trim(item_name_en), '') <> ''
            group by item_name_en
          ) i
          full outer join (
            select item_name_en as name, count(*)::bigint as opens
            from filtered
            where event_type = 'item_open'
              and coalesce(trim(item_name_en), '') <> ''
            group by item_name_en
          ) o on i.name = o.name
          left join (
            select item_name_en as name,
              coalesce(sum((metadata->>'visible_duration_ms')::numeric), 0)::bigint as visible_duration_ms
            from filtered
            where event_type = 'item_impression_end'
              and coalesce(trim(item_name_en), '') <> ''
            group by item_name_en
          ) d on coalesce(i.name, o.name) = d.name
          order by greatest(coalesce(i.impressions, 0), coalesce(o.opens, 0)) desc
          limit 40
        ) m
        where coalesce(m.opens, 0) > 0
      ),
      '[]'::jsonb
    ),
    'top_categories', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object('id', v.id, 'opens', v.opens, 'impressions', v.impressions)
          order by greatest(v.impressions, v.opens) desc nulls last
        )
        from (
          select
            category_id as id,
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
      ),
      '[]'::jsonb
    ),
    'by_hour', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'hour', w.hour_bucket,
            'count', w.c,
            'business_day_key', w.biz_key
          )
          order by w.hour_bucket
        )
        from (
          select
            date_trunc('hour', created_at) as hour_bucket,
            public.nac_business_day_key(created_at) as biz_key,
            count(*)::bigint as c
          from filtered
          where created_at >= public.nac_filter_since(case when coalesce(p_hours, 0) in (0, 24) then 24 else p_hours end)
          group by 1, 2
          order by 1
        ) w
      ),
      '[]'::jsonb
    ),
    'by_hour_qr', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'hour', w.hour_bucket,
            'count', w.c,
            'business_day_key', w.biz_key
          )
          order by w.hour_bucket
        )
        from (
          select
            date_trunc('hour', created_at) as hour_bucket,
            public.nac_business_day_key(created_at) as biz_key,
            count(*)::bigint as c
          from filtered
          where event_type = 'qr_session_start'
            and created_at >= public.nac_filter_since(case when coalesce(p_hours, 0) in (0, 24) then 24 else p_hours end)
          group by 1, 2
          order by 1
        ) w
      ),
      '[]'::jsonb
    ),
    'today_unique_sessions', (
      select count(distinct session_id)::bigint
      from filtered, biz_today b
      where created_at >= b.day_start
        and created_at <= b.day_end
        and coalesce(trim(session_id), '') <> ''
    ),
    'today_qr_sessions', (
      select count(*)::bigint
      from filtered, biz_today b
      where event_type = 'qr_session_start'
        and created_at >= b.day_start
        and created_at <= b.day_end
    ),
    'avg_time_spent', coalesce(
      (
        select round(avg((metadata->>'duration_seconds')::numeric))::bigint
        from filtered
        where event_type = 'time_spent'
          and metadata->>'duration_seconds' is not null
          and (metadata->>'duration_seconds')::numeric > 0
      ),
      0
    ),
    'avg_items_per_session', coalesce(
      (
        select round(avg(item_cnt)::numeric, 1)
        from (
          select session_id, count(*)::numeric as item_cnt
          from filtered
          where event_type = 'item_open'
            and coalesce(trim(session_id), '') <> ''
          group by session_id
        ) x
      ),
      0
    ),
    'bounce_sessions', (
      select count(*)::bigint
      from (
        select session_id
        from filtered
        where coalesce(trim(session_id), '') <> ''
        group by session_id
        having count(*) <= 2
          and count(*) filter (
            where event_type in ('item_open','category_open','search_used','search_submit','add_on_click','item_impression')
          ) = 0
      ) b
    ),
    'deep_sessions', (
      select count(*)::bigint
      from (
        select session_id
        from filtered
        where coalesce(trim(session_id), '') <> ''
        group by session_id
        having count(*) >= 8
      ) d
    ),
    'top_searches', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object('query', sq.q, 'count', sq.cnt)
          order by sq.cnt desc nulls last
        )
        from (
          select lower(trim(search_query)) as q, count(*)::bigint as cnt
          from filtered
          where event_type in ('search_used', 'search_submit')
            and coalesce(trim(search_query), '') <> ''
          group by 1
          order by cnt desc
          limit 10
        ) sq
      ),
      '[]'::jsonb
    ),
    'returning_sessions', (
      select count(*)::bigint
      from filtered
      where event_type = 'qr_session_start'
        and metadata->>'returning' = 'true'
    ),
    'modal_engagement_events', (
      select count(*)::bigint
      from filtered
      where event_type in ('modal_drag_close', 'item_navigation')
    ),
    'top_addon_pairs', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object('item', ap.item, 'addon', ap.addon, 'clicks', ap.clicks)
          order by ap.clicks desc nulls last
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
      ),
      '[]'::jsonb
    ),
    'funnel', jsonb_build_object(
      'qr_scans', (select count(distinct session_id)::bigint from filtered where event_type = 'qr_session_start'),
      'category_opens', (select count(distinct session_id)::bigint from filtered where event_type = 'category_open'),
      'item_impressions', (select count(distinct session_id)::bigint from filtered where event_type = 'item_impression'),
      'item_opens', (select count(distinct session_id)::bigint from filtered where event_type = 'item_open'),
      'addon_clicks', (select count(distinct session_id)::bigint from filtered where event_type = 'add_on_click'),
      'time_spent', (select count(distinct session_id)::bigint from filtered where event_type = 'time_spent'),
      'exits', (select count(distinct session_id)::bigint from filtered where event_type = 'menu_exit')
    ),
    'dead_zones', coalesce(
      (
        select jsonb_agg(row_to_json(dz)::jsonb order by dz.engagement_ratio asc nulls last)
        from (
          select
            category_id,
            count(*) filter (where event_type = 'category_open')::bigint as opens,
            count(*) filter (where event_type = 'item_open')::bigint as item_opens,
            count(*) filter (where event_type = 'item_impression')::bigint as impressions,
            count(*) filter (where event_type = 'menu_exit')::bigint as exits,
            round(
              (count(*) filter (where event_type = 'item_open')::numeric
               / nullif(count(*) filter (where event_type = 'category_open'), 0)) * 100,
              1
            ) as engagement_ratio
          from filtered
          where category_id is not null
          group by category_id
          having count(*) filter (where event_type = 'category_open') >= 3
          order by engagement_ratio asc nulls last
          limit 10
        ) dz
      ),
      '[]'::jsonb
    ),
    'lost_searches', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object('query', ls.q, 'sessions', ls.sess_count)
          order by ls.sess_count desc nulls last
        )
        from (
          select
            lower(trim(search_query)) as q,
            count(distinct session_id)::bigint as sess_count
          from filtered
          where event_type in ('search_used', 'search_submit')
            and coalesce(trim(search_query), '') <> ''
            and not exists (
              select 1 from filtered f2
              where f2.session_id = filtered.session_id
                and f2.event_type in ('item_open', 'item_impression')
            )
          group by 1
          order by sess_count desc
          limit 10
        ) ls
      ),
      '[]'::jsonb
    ),
    'session_quality', jsonb_build_object(
      'bounce', (select count(*)::bigint from session_quality where quality = 'bounce'),
      'casual', (select count(*)::bigint from session_quality where quality = 'casual'),
      'engaged', (select count(*)::bigint from session_quality where quality = 'engaged'),
      'deep', (select count(*)::bigint from session_quality where quality = 'deep'),
      'power', (select count(*)::bigint from session_quality where quality = 'power')
    ),
    'lang_behavior', jsonb_build_object(
      'en', jsonb_build_object(
        'sessions', (select count(*)::bigint from session_lang where dominant_lang = 'en'),
        'avg_events', coalesce((select round(avg(total)::numeric, 1) from session_stats where session_id in (select session_id from session_lang where dominant_lang = 'en')), 0),
        'avg_duration', coalesce((select round(avg(duration))::bigint from session_stats where session_id in (select session_id from session_lang where dominant_lang = 'en') and duration is not null), 0)
      ),
      'ar', jsonb_build_object(
        'sessions', (select count(*)::bigint from session_lang where dominant_lang = 'ar'),
        'avg_events', coalesce((select round(avg(total)::numeric, 1) from session_stats where session_id in (select session_id from session_lang where dominant_lang = 'ar')), 0),
        'avg_duration', coalesce((select round(avg(duration))::bigint from session_stats where session_id in (select session_id from session_lang where dominant_lang = 'ar') and duration is not null), 0)
      )
    ),
    'strongest_hour', (
      select extract(hour from (created_at at time zone 'Asia/Riyadh'))::int
      from filtered
      where created_at >= public.nac_business_day_start()
      group by 1
      order by count(*) desc
      limit 1
    ),
    'top_converting_category', coalesce(
      (
        select jsonb_build_object(
          'id', tc.category_id,
          'ratio', round((tc.io::numeric / tc.co) * 100, 1),
          'item_opens', tc.io,
          'cat_opens', tc.co
        )
        from (
          select
            category_id,
            count(*) filter (where event_type = 'item_open')::bigint as io,
            count(*) filter (where event_type = 'category_open')::bigint as co
          from filtered
          where category_id is not null
          group by category_id
          having count(*) filter (where event_type = 'category_open') >= 5
          order by (count(*) filter (where event_type = 'item_open')::numeric
                    / count(*) filter (where event_type = 'category_open')) desc
          limit 1
        ) tc
      ),
      '{}'::jsonb
    ),
    'placement_stats', coalesce(
      (
        select jsonb_agg(row_to_json(p)::jsonb)
        from (
          select
            coalesce(metadata->>'approximate_position', 'unknown') as position,
            count(*)::bigint as impressions
          from filtered
          where event_type = 'item_impression'
          group by 1
          order by impressions desc
        ) p
      ),
      '[]'::jsonb
    )
  );
$$;

revoke all on function public.get_bi_dashboard(text, int) from public;
grant execute on function public.get_bi_dashboard(text, int) to authenticated;
