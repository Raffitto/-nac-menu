-- Canonical branch_id normalization for review/menu intelligence RPCs.
-- Run in Supabase SQL Editor after intelligence_query_optimization.sql.

create or replace function public.nac_normalize_branch_id(p text)
returns text
language sql
immutable
as $$
  select case
    when p is null or trim(p) = '' then null
    when lower(trim(p)) in ('khobar', 'riyadh', 'jeddah') then lower(trim(p))
    when lower(trim(p)) ~ '(khobar|alkhobar|الخبر)' then 'khobar'
    when lower(trim(p)) ~ '(riyadh|رياض)' then 'riyadh'
    when lower(trim(p)) ~ '(jeddah|jedda|جدة|jiddah)' then 'jeddah'
    when lower(regexp_replace(trim(p), '^nac[-_\s]*', '', 'i')) in ('khobar', 'riyadh', 'jeddah')
      then lower(regexp_replace(trim(p), '^nac[-_\s]*', '', 'i'))
    else null
  end;
$$;

-- Re-apply get_review_events_summary with normalized branch_id + staff per branch
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
    select e.event_type,
      public.nac_normalize_branch_id(e.branch_id) as branch_id,
      e.employee_name,
      e.employee_role,
      e.created_at,
      e.review_session_id,
      e.session_id
    from public.review_events e, bounds b
    where (coalesce(p_hours, 0) = 0 or e.created_at >= b.since_ts)
      and (
        p_branch is null
        or public.nac_normalize_branch_id(e.branch_id) = public.nac_normalize_branch_id(p_branch)
      )
  ),
  by_type as (select event_type, count(*)::int as c from filtered group by 1),
  staff as (
    select
      coalesce(nullif(trim(employee_name), ''), '') as name,
      branch_id,
      max(employee_role) as role,
      count(*) filter (where event_type = 'qr_scan') as scans,
      count(*) filter (where event_type in ('review_generate', 'review_regenerate')) as generated,
      count(*) filter (where event_type in ('review_google_click', 'google_redirect')) as google
    from filtered
    where coalesce(trim(employee_name), '') <> ''
      and branch_id is not null
    group by 1, 2
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
    where branch_id is not null
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
        'name', name,
        'branch_id', branch_id,
        'role', role,
        'scans', scans,
        'generated', generated,
        'google', google,
        'conversion_pct', case when scans > 0 then round(100.0 * google / scans) else 0 end
      ) order by branch_id, scans desc, google desc)
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

grant execute on function public.nac_normalize_branch_id(text) to authenticated;
grant execute on function public.get_review_events_summary(text, int) to authenticated;
