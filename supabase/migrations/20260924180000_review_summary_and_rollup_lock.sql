-- Review summary was calling nac_reviews_branch_allowed() once per row (17s, 359k buffers on MTD).
-- Evaluate the allowed-branch set once. Same authorization. One scan of the filtered rows.
-- Staff rows include branch_id so the client does not re-query every branch.

create or replace function public.get_review_events_summary(
  p_branch text default null,
  p_hours int default 24
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_since timestamptz;
  v_allowed text[];
  v_result jsonb;
begin
  v_since := public.nac_filter_since(p_hours);
  v_allowed := public.nac_reviews_allowed_branches();

  with filtered as (
    select e.event_type, e.branch_id, e.employee_name, e.employee_role, e.created_at,
      e.review_session_id, e.session_id
    from public.review_events e
    where (coalesce(p_hours, 0) = 0 or e.created_at >= v_since)
      and (p_branch is null or e.branch_id = lower(trim(p_branch)))
      and public.nac_normalize_branch_id(e.branch_id) = any(v_allowed)
  ),
  by_type as (select event_type, count(*)::int as c from filtered group by 1),
  staff as (
    select
      public.nac_normalize_branch_id(branch_id) as branch_id,
      coalesce(nullif(trim(employee_name), ''), '') as name,
      max(employee_role) as role,
      count(*) filter (where event_type = 'qr_scan') as scans,
      count(*) filter (where event_type in ('review_generate', 'review_regenerate')) as generated,
      count(*) filter (where event_type in ('review_google_click', 'google_redirect')) as google
    from filtered
    where coalesce(trim(employee_name), '') <> ''
    group by 1, 2
  ),
  daily as (
    select (created_at at time zone 'Asia/Riyadh')::date as day_key,
      count(*) filter (where event_type = 'qr_scan')::int as scans
    from filtered group by 1
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
        'branch_id', branch_id,
        'name', name, 'role', role, 'scans', scans, 'generated', generated, 'google', google,
        'conversion_pct', case when scans > 0 then round(100.0 * google / scans) else 0 end
      ) order by scans desc, google desc) from staff
    ), '[]'::jsonb),
    'daily_trend', coalesce((
      select jsonb_agg(jsonb_build_object('date', day_key::text, 'scans', scans) order by day_key)
      from daily
    ), '[]'::jsonb),
    'by_branch', coalesce((
      select jsonb_agg(jsonb_build_object(
        'branch_id', branch_id, 'qr_scans', qr_scans, 'reviews_generated', reviews_generated,
        'google_redirects', google_redirects, 'review_page_opens', review_page_opens,
        'conversion_pct', case when qr_scans > 0 then round(100.0 * google_redirects / qr_scans) else 0 end
      ) order by branch_id) from branches
    ), '[]'::jsonb)
  ) into v_result;

  return coalesce(v_result, '{}'::jsonb);
end;
$$;

-- Skip a second intraday rollup if the previous run is still in a transaction.
create or replace function public.refresh_menu_events_daily_rollup_intraday()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
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
  where (m.created_at at time zone 'Asia/Riyadh')::date >= v_from
    and (m.created_at at time zone 'Asia/Riyadh')::date <= v_to
  group by 1, 2, 3, 4, 5, 6, 7;

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;
