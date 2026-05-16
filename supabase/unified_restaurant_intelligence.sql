-- NAC Unified Restaurant Intelligence Platform
-- Review events, session attribution, daily snapshots, staff config, unified BI RPCs
-- Safe to re-run. Requires: menu_events, nac_business_day_* helpers, foodics tables (optional)

-- ---------------------------------------------------------------------------
-- review_events
-- ---------------------------------------------------------------------------
create table if not exists public.review_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check (
    event_type in (
      'review_page_open',
      'review_generate',
      'review_copy',
      'review_google_click',
      'review_regenerate',
      'review_language_change'
    )
  ),
  branch_id text not null default 'khobar',
  employee_name text,
  employee_role text,
  review_session_id text not null,
  session_id text,
  language text,
  generated_text_length int,
  device_type text,
  user_agent text,
  source_url text,
  business_day_key date not null default (public.nac_business_day_key()),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_review_events_branch_day
  on public.review_events (branch_id, business_day_key desc);
create index if not exists idx_review_events_type_created
  on public.review_events (event_type, created_at desc);
create index if not exists idx_review_events_review_session
  on public.review_events (review_session_id);
create index if not exists idx_review_events_menu_session
  on public.review_events (session_id) where session_id is not null;
create index if not exists idx_review_events_created
  on public.review_events (created_at desc);

-- One page_open per review session (client should still dedupe)
create unique index if not exists uq_review_page_open_session
  on public.review_events (review_session_id)
  where event_type = 'review_page_open';

alter table public.review_events enable row level security;

drop policy if exists review_events_anon_insert on public.review_events;
create policy review_events_anon_insert on public.review_events
  for insert to anon, authenticated with check (true);

drop policy if exists review_events_auth_select on public.review_events;
create policy review_events_auth_select on public.review_events
  for select to authenticated using (true);

grant insert on public.review_events to anon, authenticated;
grant select on public.review_events to authenticated;

-- ---------------------------------------------------------------------------
-- review_session_links — lightweight menu ↔ review attribution
-- ---------------------------------------------------------------------------
create table if not exists public.review_session_links (
  id uuid primary key default gen_random_uuid(),
  branch_id text not null default 'khobar',
  menu_session_id text not null,
  review_session_id text not null,
  employee_name text,
  employee_role text,
  attribution_confidence text not null default 'low'
    check (attribution_confidence in ('low', 'medium', 'high')),
  linked_session_id text generated always as (menu_session_id) stored,
  linked_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  unique (menu_session_id, review_session_id)
);

create index if not exists idx_review_links_branch on public.review_session_links (branch_id, linked_at desc);
create index if not exists idx_review_links_menu on public.review_session_links (menu_session_id);
create index if not exists idx_review_links_review on public.review_session_links (review_session_id);

alter table public.review_session_links enable row level security;

drop policy if exists review_links_anon_insert on public.review_session_links;
create policy review_links_anon_insert on public.review_session_links
  for insert to anon, authenticated with check (true);

drop policy if exists review_links_auth_select on public.review_session_links;
create policy review_links_auth_select on public.review_session_links
  for select to authenticated using (true);

grant insert on public.review_session_links to anon, authenticated;
grant select on public.review_session_links to authenticated;

-- ---------------------------------------------------------------------------
-- review_portal_staff — centralized staff / QR config
-- ---------------------------------------------------------------------------
create table if not exists public.review_portal_staff (
  id uuid primary key default gen_random_uuid(),
  branch_id text not null,
  employee_name text not null,
  role text not null default 'waiter',
  active boolean not null default true,
  url_slug text not null,
  qr_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (branch_id, url_slug)
);

create index if not exists idx_review_staff_branch_active
  on public.review_portal_staff (branch_id, active);

alter table public.review_portal_staff enable row level security;

drop policy if exists review_staff_anon_read on public.review_portal_staff;
create policy review_staff_anon_read on public.review_portal_staff
  for select to anon, authenticated using (active = true);

drop policy if exists review_staff_auth_all on public.review_portal_staff;
create policy review_staff_auth_all on public.review_portal_staff
  for all to authenticated using (true) with check (true);

grant select on public.review_portal_staff to anon, authenticated;
grant all on public.review_portal_staff to authenticated;

-- Seed Khobar staff (idempotent)
insert into public.review_portal_staff (branch_id, employee_name, role, url_slug, qr_metadata)
values
  ('khobar', 'Default', 'reception', 'default', '{"label":"NAC Khobar"}'::jsonb)
on conflict (branch_id, url_slug) do nothing;

-- ---------------------------------------------------------------------------
-- daily_branch_snapshots
-- ---------------------------------------------------------------------------
create table if not exists public.daily_branch_snapshots (
  id uuid primary key default gen_random_uuid(),
  branch_id text not null,
  business_day_key date not null,
  snapshot jsonb not null default '{}'::jsonb,
  snapshot_created_at timestamptz not null default now(),
  unique (branch_id, business_day_key)
);

create index if not exists idx_daily_snapshots_branch_day
  on public.daily_branch_snapshots (branch_id, business_day_key desc);

alter table public.daily_branch_snapshots enable row level security;

drop policy if exists daily_snapshots_auth on public.daily_branch_snapshots;
create policy daily_snapshots_auth on public.daily_branch_snapshots
  for all to authenticated using (true) with check (true);

grant select, insert, update on public.daily_branch_snapshots to authenticated;

-- ---------------------------------------------------------------------------
-- get_review_intelligence
-- ---------------------------------------------------------------------------
create or replace function public.get_review_intelligence(
  p_branch text default null,
  p_hours int default 24
)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  with filtered as (
    select *
    from public.review_events e
    where (p_branch is null or e.branch_id = lower(trim(p_branch)))
      and (
        coalesce(p_hours, 0) = 0
        or e.created_at >= public.nac_filter_since(p_hours)
      )
  ),
  by_type as (
    select event_type, count(*)::int as c from filtered group by event_type
  ),
  employees as (
    select
      coalesce(employee_name, 'Unknown') as name,
      coalesce(employee_role, '') as role,
      count(*) filter (where event_type = 'review_page_open') as opens,
      count(*) filter (where event_type = 'review_generate') as generated,
      count(*) filter (where event_type = 'review_google_click') as google_clicks,
      avg(generated_text_length) filter (where event_type in ('review_generate', 'review_regenerate')) as avg_length
    from filtered
    where coalesce(trim(employee_name), '') <> ''
    group by 1, 2
  )
  select jsonb_build_object(
    'total_events', (select count(*)::int from filtered),
    'by_event_type', coalesce((select jsonb_object_agg(event_type, c) from by_type), '{}'::jsonb),
    'review_sessions', (select count(distinct review_session_id)::int from filtered),
    'google_clicks', coalesce((select c from by_type where event_type = 'review_google_click'), 0),
    'reviews_generated', coalesce((select c from by_type where event_type = 'review_generate'), 0),
    'conversion_pct', case
      when coalesce((select c from by_type where event_type = 'review_generate'), 0) > 0
      then round(
        100.0 * coalesce((select c from by_type where event_type = 'review_google_click'), 0)
        / greatest((select c from by_type where event_type = 'review_generate'), 1)
      )
      else 0
    end,
    'top_employees', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', name, 'role', role, 'opens', opens, 'generated', generated,
        'google_clicks', google_clicks, 'avg_length', round(avg_length::numeric, 0),
        'conversion_pct', case when generated > 0 then round(100.0 * google_clicks / generated) else 0 end
      ) order by generated desc nulls last)
      from employees limit 15
    ), '[]'::jsonb),
    'business_day_key', public.nac_business_day_key()::text
  );
$$;

grant execute on function public.get_review_intelligence(text, int) to authenticated;

-- ---------------------------------------------------------------------------
-- generate_daily_branch_snapshot
-- ---------------------------------------------------------------------------
create or replace function public.generate_daily_branch_snapshot(
  p_branch text,
  p_business_day_key date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_branch text := lower(trim(coalesce(p_branch, 'khobar')));
  v_day date := coalesce(p_business_day_key, public.nac_business_day_key());
  v_start timestamptz;
  v_end timestamptz;
  v_snap jsonb;
begin
  v_start := (v_day::timestamp + time '03:00:00') at time zone 'Asia/Riyadh';
  v_end := v_start + interval '1 day' - interval '1 second';

  with menu_f as (
    select * from public.menu_events m
    where m.branch_id = v_branch
      and m.created_at >= v_start and m.created_at <= v_end
  ),
  review_f as (
    select * from public.review_events r
    where r.branch_id = v_branch
      and r.business_day_key = v_day
  ),
  foodics_f as (
    select coalesce(sum(quantity_sold), 0)::numeric as qty,
           coalesce(sum(net_sales), 0)::numeric as revenue
    from public.foodics_sales_items f
    where f.branch_id = v_branch
      and f.period_start <= v_end::date
      and f.period_end >= v_day
  ),
  menu_agg as (
    select
      count(distinct session_id) filter (where event_type = 'qr_session_start') as qr_scans,
      count(distinct session_id) as menu_sessions,
      count(*) filter (where event_type = 'item_impression') as impressions,
      count(*) filter (where event_type = 'item_open') as item_opens,
      count(*) filter (where event_type = 'image_expand') as image_expands,
      count(*) filter (where event_type = 'search') as searches,
      count(*) filter (where event_type = 'add_on_click') as addon_opens
    from menu_f
  ),
  review_agg as (
    select
      count(*) filter (where event_type = 'review_generate') as reviews_generated,
      count(*) filter (where event_type = 'review_google_click') as google_clicks
    from review_f
  ),
  top_viewed as (
    select item_name_en as name, count(*)::int as c
    from menu_f where event_type = 'item_impression' and coalesce(trim(item_name_en), '') <> ''
    group by 1 order by c desc limit 10
  ),
  top_sold as (
    select matched_menu_item_name as name, sum(quantity_sold)::int as c
    from public.foodics_sales_items f
    where f.branch_id = v_branch and f.period_start <= v_end::date and f.period_end >= v_day
      and coalesce(trim(matched_menu_item_name), '') <> ''
    group by 1 order by c desc nulls last limit 10
  )
  select jsonb_build_object(
    'branch_id', v_branch,
    'business_day_key', v_day::text,
    'period_start', v_start,
    'period_end', v_end,
    'menu_sessions', coalesce((select menu_sessions from menu_agg), 0),
    'qr_scans', coalesce((select qr_scans from menu_agg), 0),
    'impressions', coalesce((select impressions from menu_agg), 0),
    'item_opens', coalesce((select item_opens from menu_agg), 0),
    'image_expands', coalesce((select image_expands from menu_agg), 0),
    'searches', coalesce((select searches from menu_agg), 0),
    'addon_opens', coalesce((select addon_opens from menu_agg), 0),
    'foodics_revenue', coalesce((select revenue from foodics_f), 0),
    'quantity_sold', coalesce((select qty from foodics_f), 0),
    'reviews_generated', coalesce((select reviews_generated from review_agg), 0),
    'google_review_clicks', coalesce((select google_clicks from review_agg), 0),
    'review_conversion_pct', case
      when coalesce((select reviews_generated from review_agg), 0) > 0
      then round(100.0 * coalesce((select google_clicks from review_agg), 0)
        / (select reviews_generated from review_agg))
      else 0 end,
    'top_viewed_items', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'count', c)) from top_viewed), '[]'::jsonb),
    'top_sold_items', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'count', c)) from top_sold), '[]'::jsonb)
  ) into v_snap;

  insert into public.daily_branch_snapshots (branch_id, business_day_key, snapshot)
  values (v_branch, v_day, v_snap)
  on conflict (branch_id, business_day_key)
  do update set snapshot = excluded.snapshot, snapshot_created_at = now();

  return v_snap;
end;
$$;

grant execute on function public.generate_daily_branch_snapshot(text, date) to authenticated;

-- ---------------------------------------------------------------------------
-- get_unified_business_day_summary
-- ---------------------------------------------------------------------------
create or replace function public.get_unified_business_day_summary(
  p_branch text default null,
  p_business_day_key date default null
)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  with params as (
    select
      lower(trim(coalesce(p_branch, 'khobar'))) as branch,
      coalesce(p_business_day_key, public.nac_business_day_key()) as day_key
  ),
  bounds as (
    select
      p.branch,
      p.day_key,
      (p.day_key::timestamp + time '03:00:00') at time zone 'Asia/Riyadh' as v_start,
      ((p.day_key::timestamp + time '03:00:00') at time zone 'Asia/Riyadh') + interval '1 day' - interval '1 second' as v_end
    from params p
  ),
  menu_f as (
    select m.*
    from public.menu_events m, bounds b
    where m.branch_id = b.branch
      and m.created_at between b.v_start and b.v_end
  ),
  review_f as (
    select r.*
    from public.review_events r, bounds b
    where r.branch_id = b.branch and r.business_day_key = b.day_key
  ),
  menu_stats as (
    select
      count(distinct session_id) filter (where event_type = 'qr_session_start') as scans,
      count(distinct session_id) as sessions,
      count(*) filter (where event_type = 'item_impression') as impressions,
      count(*) filter (where event_type = 'item_open') as opens,
      count(*) filter (where event_type = 'image_expand') as image_expands
    from menu_f
  ),
  review_stats as (
    select
      count(*) filter (where event_type = 'review_generate') as reviews,
      count(*) filter (where event_type = 'review_google_click') as google_clicks
    from review_f
  ),
  sales_stats as (
    select
      coalesce(sum(f.quantity_sold), 0)::numeric as orders_qty,
      coalesce(sum(f.net_sales), 0)::numeric as sales
    from public.foodics_sales_items f, bounds b
    where f.branch_id = b.branch
      and f.period_start <= b.v_end::date
      and f.period_end >= b.day_key
  ),
  emp_review as (
    select employee_name as name, count(*) filter (where event_type = 'review_generate') as gen
    from review_f
    where coalesce(trim(employee_name), '') <> ''
    group by 1 order by 2 desc limit 5
  )
  select jsonb_build_object(
    'branch_id', (select branch from bounds),
    'business_day_key', (select day_key::text from bounds),
    'scans', coalesce((select scans from menu_stats), 0),
    'sessions', coalesce((select sessions from menu_stats), 0),
    'impressions', coalesce((select impressions from menu_stats), 0),
    'opens', coalesce((select opens from menu_stats), 0),
    'image_expands', coalesce((select image_expands from menu_stats), 0),
    'orders_qty', coalesce((select orders_qty from sales_stats), 0),
    'sales', coalesce((select sales from sales_stats), 0),
    'reviews', coalesce((select reviews from review_stats), 0),
    'google_clicks', coalesce((select google_clicks from review_stats), 0),
    'review_conversion_pct', case
      when coalesce((select reviews from review_stats), 0) > 0
      then round(100.0 * coalesce((select google_clicks from review_stats), 0) / (select reviews from review_stats))
      else 0 end,
    'employee_leaders', coalesce((
      select jsonb_agg(jsonb_build_object('name', name, 'reviews_generated', gen)) from emp_review
    ), '[]'::jsonb),
    'snapshot', (
      select s.snapshot from public.daily_branch_snapshots s, bounds b
      where s.branch_id = b.branch and s.business_day_key = b.day_key
    )
  );
$$;

grant execute on function public.get_unified_business_day_summary(text, date) to authenticated;

-- ---------------------------------------------------------------------------
-- get_branch_comparison — cross-branch intelligence
-- ---------------------------------------------------------------------------
create or replace function public.get_branch_comparison(
  p_hours int default 24
)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  with branches as (
    select unnest(array['khobar', 'riyadh', 'jeddah']) as branch_id
  ),
  menu_agg as (
    select
      m.branch_id,
      count(distinct m.session_id) as sessions,
      count(*) filter (where m.event_type = 'item_impression') as impressions,
      count(*) filter (where m.event_type = 'item_open') as opens,
      count(*) filter (where m.event_type = 'image_expand') as image_expands
    from public.menu_events m
    where coalesce(p_hours, 0) = 0 or m.created_at >= public.nac_filter_since(p_hours)
    group by m.branch_id
  ),
  review_agg as (
    select
      r.branch_id,
      count(*) filter (where r.event_type = 'review_generate') as reviews,
      count(*) filter (where r.event_type = 'review_google_click') as google_clicks
    from public.review_events r
    where coalesce(p_hours, 0) = 0 or r.created_at >= public.nac_filter_since(p_hours)
    group by r.branch_id
  ),
  sales_agg as (
    select f.branch_id, coalesce(sum(f.net_sales), 0)::numeric as sales
    from public.foodics_sales_items f
    where coalesce(p_hours, 0) = 0
      or f.created_at >= public.nac_filter_since(p_hours)
    group by f.branch_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'branch_id', b.branch_id,
    'sessions', coalesce(ma.sessions, 0),
    'impressions', coalesce(ma.impressions, 0),
    'opens', coalesce(ma.opens, 0),
    'image_expands', coalesce(ma.image_expands, 0),
    'visual_conversion_pct', case when coalesce(ma.impressions, 0) > 0
      then round(100.0 * coalesce(ma.image_expands, 0) / ma.impressions) else 0 end,
    'browse_to_open_pct', case when coalesce(ma.impressions, 0) > 0
      then round(100.0 * coalesce(ma.opens, 0) / ma.impressions) else 0 end,
    'reviews', coalesce(ra.reviews, 0),
    'google_clicks', coalesce(ra.google_clicks, 0),
    'review_conversion_pct', case when coalesce(ra.reviews, 0) > 0
      then round(100.0 * coalesce(ra.google_clicks, 0) / ra.reviews) else 0 end,
    'sales', coalesce(sa.sales, 0)
  ) order by b.branch_id), '[]'::jsonb)
  from branches b
  left join menu_agg ma on ma.branch_id = b.branch_id
  left join review_agg ra on ra.branch_id = b.branch_id
  left join sales_agg sa on sa.branch_id = b.branch_id;
$$;

grant execute on function public.get_branch_comparison(int) to authenticated;
