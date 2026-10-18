-- Guest-menu detail rollup. Dashboard reads this table. It does not scan menu_events.
-- Refresh is limited to a created_at range so the created_at index can serve it.
-- Do not run a backfill from the dashboard. After this migration is authorized:
--   select public.refresh_menu_events_detail_daily(
--     (current_timestamp at time zone 'Asia/Riyadh')::date - 45,
--     (current_timestamp at time zone 'Asia/Riyadh')::date
--   );
-- Historical add_on_open rows are the duplicate half of a click. They are omitted
-- only when the real add_on_click exists in the same session within 3 seconds.
-- A shadow with no pair is kept. Nothing in menu_events is deleted.

create table if not exists public.menu_events_detail_daily (
  day_key date not null,
  branch_id text not null,
  kind text not null,
  language text not null default '',
  key1 text not null default '',
  key2 text not null default '',
  event_count bigint not null default 0,
  session_count bigint not null default 0,
  metric_sum bigint not null default 0,
  primary key (day_key, branch_id, kind, language, key1, key2)
);

create index if not exists idx_menu_events_detail_daily_day_branch
  on public.menu_events_detail_daily (day_key desc, branch_id, kind);

alter table public.menu_events_detail_daily enable row level security;
revoke all on table public.menu_events_detail_daily from public;
revoke all on table public.menu_events_detail_daily from anon;
revoke all on table public.menu_events_detail_daily from authenticated;

comment on table public.menu_events_detail_daily is
  'Daily guest-menu rankings. Read by rollup RPCs. Refreshed only for a bounded created_at range.';

create or replace function public.refresh_menu_events_detail_daily(
  p_from date,
  p_to date
)
returns bigint
language plpgsql
security definer
set search_path = public
as $detail$
declare
  v_rows bigint := 0;
begin
  if p_from is null or p_to is null or p_to < p_from then
    return 0;
  end if;

  -- Same lock as the cron refresh. A second request in this transaction succeeds.
  -- A concurrent cron uses try-lock and returns 0 instead of failing.
  -- A cancelled call rolls back, so the previous detail rows stay and the range can be rerun.
  perform pg_advisory_xact_lock(88442201);

  delete from public.menu_events_detail_daily
  where day_key >= p_from
    and day_key <= p_to;

  create temporary table _menu_detail_window on commit drop as
  select
    (m.created_at at time zone 'Asia/Riyadh')::date as day_key,
    coalesce(nullif(lower(btrim(m.branch_id)), ''), 'unknown') as branch_id,
    case
      when lower(btrim(coalesce(m.language, ''))) in ('en', 'ar') then lower(btrim(m.language))
      else 'unknown'
    end as language,
    m.event_type,
    nullif(btrim(m.item_name_en), '') as item_name,
    nullif(btrim(m.category_id), '') as category_id,
    nullif(btrim(m.add_on_name), '') as add_on_name,
    nullif(lower(btrim(m.search_query)), '') as search_query,
    nullif(btrim(m.session_id), '') as session_id,
    m.created_at,
    coalesce(m.metadata->>'source', '') as source,
    case
      when m.event_type = 'time_spent'
        and coalesce(m.metadata->>'duration_seconds', '') ~ '^[0-9]+(\.[0-9]+)?$'
        and (m.metadata->>'duration_seconds')::numeric > 0
      then least((m.metadata->>'duration_seconds')::numeric, 1200)::bigint
      else 0
    end as duration_sec
  from public.menu_events m
  where m.created_at >= (p_from::timestamp at time zone 'Asia/Riyadh')
    and m.created_at < ((p_to + 1)::timestamp at time zone 'Asia/Riyadh');

  insert into public.menu_events_detail_daily (
    day_key, branch_id, kind, language, key1, key2, event_count, session_count, metric_sum
  )
  select day_key, branch_id, 'item', language, item_name, '',
    count(*)::bigint,
    count(distinct session_id)::bigint,
    0
  from _menu_detail_window
  where event_type = 'item_open'
    and item_name is not null
  group by 1, 2, 4, 5;

  insert into public.menu_events_detail_daily (
    day_key, branch_id, kind, language, key1, key2, event_count, session_count, metric_sum
  )
  select day_key, branch_id, 'category', language, category_id, '',
    count(*)::bigint,
    count(distinct session_id)::bigint,
    0
  from _menu_detail_window
  where event_type = 'category_open'
    and category_id is not null
  group by 1, 2, 4, 5;

  insert into public.menu_events_detail_daily (
    day_key, branch_id, kind, language, key1, key2, event_count, session_count, metric_sum
  )
  select day_key, branch_id, 'search', language, left(search_query, 80), '',
    count(*)::bigint,
    count(distinct session_id)::bigint,
    0
  from _menu_detail_window
  where event_type in ('search_used', 'search_submit')
    and search_query is not null
  group by 1, 2, 4, 5;

  insert into public.menu_events_detail_daily (
    day_key, branch_id, kind, language, key1, key2, event_count, session_count, metric_sum
  )
  select day_key, branch_id, 'duration', language, '', '',
    count(*)::bigint,
    count(distinct session_id)::bigint,
    sum(duration_sec)::bigint
  from _menu_detail_window
  where event_type = 'time_spent'
    and duration_sec > 0
  group by 1, 2, 4;

  insert into public.menu_events_detail_daily (
    day_key, branch_id, kind, language, key1, key2, event_count, session_count, metric_sum
  )
  select day_key, branch_id, 'addon', language, item_name, add_on_name,
    count(*)::bigint,
    count(distinct session_id)::bigint,
    0
  from _menu_detail_window w
  where event_type = 'add_on_click'
    and item_name is not null
    and add_on_name is not null
    and (
      source <> 'add_on_open'
      or not exists (
        select 1
        from _menu_detail_window pair
        where pair.event_type = 'add_on_click'
          and pair.source <> 'add_on_open'
          and pair.session_id is not distinct from w.session_id
          and pair.branch_id = w.branch_id
          and pair.item_name = w.item_name
          and pair.add_on_name = w.add_on_name
          and pair.created_at between w.created_at - interval '3 seconds'
            and w.created_at + interval '3 seconds'
      )
    )
  group by 1, 2, 4, 5, 6;

  insert into public.menu_events_detail_daily (
    day_key, branch_id, kind, language, key1, key2, event_count, session_count, metric_sum
  )
  select day_key, branch_id, 'language', lang, lang, '',
    0,
    count(*)::bigint,
    0
  from (
    select distinct on (day_key, branch_id, session_id)
      day_key,
      branch_id,
      session_id,
      language as lang
    from _menu_detail_window
    where session_id is not null
    order by day_key, branch_id, session_id, created_at
  ) first_language
  group by 1, 2, 4;

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$detail$;

comment on function public.refresh_menu_events_detail_daily(date, date) is
  'Rebuild menu_events_detail_daily for an inclusive Riyadh date range. Uses idx_menu_events_created_at_desc. service_role / cron only.';

revoke all on function public.refresh_menu_events_detail_daily(date, date) from public;
revoke all on function public.refresh_menu_events_detail_daily(date, date) from anon;
revoke all on function public.refresh_menu_events_detail_daily(date, date) from authenticated;
grant execute on function public.refresh_menu_events_detail_daily(date, date) to service_role;

create or replace function public.menu_event_branch_visible(
  p_requested text,
  p_row_branch text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $branch$
  select auth.uid() is not null
    and case
      when public.ask_nac_vault_has_all_branches() then
        p_requested is null
        or btrim(p_requested) = ''
        or lower(btrim(p_row_branch)) = lower(btrim(p_requested))
      else
        btrim(coalesce(p_requested, '')) <> ''
        and lower(btrim(p_row_branch)) = lower(btrim(p_requested))
        and public.ask_nac_vault_branch_allowed(p_requested)
    end;
$branch$;

revoke all on function public.menu_event_branch_visible(text, text) from public;
revoke all on function public.menu_event_branch_visible(text, text) from anon;
revoke all on function public.menu_event_branch_visible(text, text) from authenticated;

create or replace function public.menu_event_detail_summary(
  p_branch text,
  p_since date,
  p_language text default 'all'
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $detail$
  with scoped as (
    select *
    from public.menu_events_detail_daily d
    where (p_since is null or d.day_key >= p_since)
      and public.menu_event_branch_visible(p_branch, d.branch_id)
      and (
        coalesce(p_language, 'all') = 'all'
        or d.language = lower(btrim(p_language))
        or (d.kind = 'language' and d.key1 = lower(btrim(p_language)))
      )
  )
  select jsonb_build_object(
    'top_items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', t.key1,
        'opens', t.event_count,
        'impressions', 0
      ) order by t.event_count desc, t.key1)
      from (
        select key1, sum(event_count)::bigint as event_count
        from scoped
        where kind = 'item' and key1 <> ''
        group by key1
        order by sum(event_count) desc, key1
        limit 20
      ) t
    ), '[]'::jsonb),
    'top_categories', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.key1,
        'opens', t.event_count,
        'impressions', 0
      ) order by t.event_count desc, t.key1)
      from (
        select key1, sum(event_count)::bigint as event_count
        from scoped
        where kind = 'category' and key1 <> ''
        group by key1
        order by sum(event_count) desc, key1
        limit 12
      ) t
    ), '[]'::jsonb),
    'top_searches', coalesce((
      select jsonb_agg(jsonb_build_object('query', t.key1, 'count', t.event_count) order by t.event_count desc, t.key1)
      from (
        select key1, sum(event_count)::bigint as event_count
        from scoped
        where kind = 'search' and key1 <> ''
        group by key1
        order by sum(event_count) desc, key1
        limit 10
      ) t
    ), '[]'::jsonb),
    'top_addon_pairs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'item', t.key1,
        'addon', t.key2,
        'clicks', t.event_count
      ) order by t.event_count desc, t.key1, t.key2)
      from (
        select key1, key2, sum(event_count)::bigint as event_count
        from scoped
        where kind = 'addon' and key1 <> '' and key2 <> ''
        group by key1, key2
        order by sum(event_count) desc, key1, key2
        limit 12
      ) t
    ), '[]'::jsonb),
    'avg_time_spent', coalesce((
      select case
        when sum(event_count) > 0 then round(sum(metric_sum)::numeric / sum(event_count))::bigint
        else 0
      end
      from scoped
      where kind = 'duration'
    ), 0),
    'duration_samples', coalesce((
      select sum(event_count)::bigint from scoped where kind = 'duration'
    ), 0),
    'duration_note', 'Average of recorded positive durations only. Zero and missing durations are excluded.',
    'lang_behavior', jsonb_build_object(
      'en', jsonb_build_object(
        'sessions', coalesce((select sum(session_count)::bigint from scoped where kind = 'language' and key1 = 'en'), 0),
        'avg_events', 0,
        'avg_duration', 0
      ),
      'ar', jsonb_build_object(
        'sessions', coalesce((select sum(session_count)::bigint from scoped where kind = 'language' and key1 = 'ar'), 0),
        'avg_events', 0,
        'avg_duration', 0
      ),
      'unknown', jsonb_build_object(
        'sessions', coalesce((select sum(session_count)::bigint from scoped where kind = 'language' and key1 = 'unknown'), 0),
        'avg_events', 0,
        'avg_duration', 0
      )
    )
  );
$detail$;

revoke all on function public.menu_event_detail_summary(text, date, text) from public;
revoke all on function public.menu_event_detail_summary(text, date, text) from anon;
grant execute on function public.menu_event_detail_summary(text, date, text) to authenticated;

-- Existing event totals stay on menu_events_daily_rollup. Rankings come from the detail table.
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
  detail as (
    select public.menu_event_detail_summary(
      p_branch,
      (select (since_ts at time zone 'Asia/Riyadh')::date from bounds),
      'all'
    ) as payload
  ),
  filtered as (
    select r.*
    from public.menu_events_daily_rollup r, bounds b
    where r.day_key >= (b.since_ts at time zone 'Asia/Riyadh')::date
      and public.menu_event_branch_visible(p_branch, r.branch_id)
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
    'aggregation_note', '7D/Month — daily rollup (session-scoped funnel). Item rankings come from menu_events_detail_daily. Run refresh_menu_events_daily_rollup(45) if stale.',
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
    'top_items', coalesce((select payload->'top_items' from detail), '[]'::jsonb),
    'top_categories', coalesce((select payload->'top_categories' from detail), '[]'::jsonb),
    'top_searches', coalesce((select payload->'top_searches' from detail), '[]'::jsonb),
    'top_addon_pairs', coalesce((select payload->'top_addon_pairs' from detail), '[]'::jsonb),
    'dead_zones', '[]'::jsonb,
    'lost_searches', '[]'::jsonb,
    'session_quality', '{}'::jsonb,
    'lang_behavior', coalesce((select payload->'lang_behavior' from detail), '{}'::jsonb),
    'bounce_sessions', 0,
    'deep_sessions', 0,
    'avg_time_spent', coalesce((select (payload->>'avg_time_spent')::bigint from detail), 0),
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
  detail as (
    select case
      when coalesce(p_shift, 'all') <> 'all'
        or coalesce(p_role, 'all') <> 'all'
        or coalesce(p_day_type, 'all') <> 'all'
        or coalesce(p_event_type, 'all') <> 'all'
      then jsonb_build_object(
        'top_items', '[]'::jsonb,
        'top_categories', '[]'::jsonb,
        'top_searches', '[]'::jsonb,
        'top_addon_pairs', '[]'::jsonb,
        'avg_time_spent', 0,
        'lang_behavior', '{}'::jsonb
      )
      else public.menu_event_detail_summary(
        p_branch,
        (select (since_ts at time zone 'Asia/Riyadh')::date from bounds),
        coalesce(p_language, 'all')
      )
    end as payload
  ),
  filtered as (
    select r.*
    from public.menu_events_daily_rollup r, bounds b
    where r.day_key >= (b.since_ts at time zone 'Asia/Riyadh')::date
      and public.menu_event_branch_visible(p_branch, r.branch_id)
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
    'aggregation_note', 'Month/long range — daily rollup. Session count = menu QR entry sessions. Rankings come from menu_events_detail_daily.',
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
    'top_items', coalesce((select payload->'top_items' from detail), '[]'::jsonb),
    'top_categories', coalesce((select payload->'top_categories' from detail), '[]'::jsonb),
    'top_searches', coalesce((select payload->'top_searches' from detail), '[]'::jsonb),
    'top_addon_pairs', coalesce((select payload->'top_addon_pairs' from detail), '[]'::jsonb),
    'bounce_sessions', 0,
    'deep_sessions', 0,
    'avg_time_spent', coalesce((select (payload->>'avg_time_spent')::bigint from detail), 0),
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
    'lang_behavior', coalesce((select payload->'lang_behavior' from detail), '{}'::jsonb),
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

  perform public.refresh_menu_events_detail_daily(v_from, v_to);

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
  v_from date;
  v_to date;
  v_rows bigint;
begin
  if not pg_try_advisory_xact_lock(88442201) then
    return 0;
  end if;

  v_to := (current_timestamp at time zone 'Asia/Riyadh')::date;
  v_from := v_to - greatest(coalesce(p_days, 45), 1);

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

  perform public.refresh_menu_events_detail_daily(v_from, v_to);

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$function$;

revoke all on function public.refresh_menu_events_daily_rollup(integer) from public;
revoke all on function public.refresh_menu_events_daily_rollup(integer) from anon;
revoke all on function public.refresh_menu_events_daily_rollup(integer) from authenticated;
grant execute on function public.refresh_menu_events_daily_rollup(integer) to service_role;

revoke all on function public.refresh_menu_events_daily_rollup_intraday() from public;
revoke all on function public.refresh_menu_events_daily_rollup_intraday() from anon;
revoke all on function public.refresh_menu_events_daily_rollup_intraday() from authenticated;
grant execute on function public.refresh_menu_events_daily_rollup_intraday() to service_role;
