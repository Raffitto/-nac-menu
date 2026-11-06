CREATE OR REPLACE FUNCTION public.get_review_events_summary(p_branch text DEFAULT NULL::text, p_hours integer DEFAULT 24)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      and e.created_at <= now()
      and (p_branch is null or e.branch_id = lower(trim(p_branch)))
      and public.nac_reviews_normalize_branch_id(e.branch_id) = any(v_allowed)
      and coalesce(e.metadata->>'self_test', 'false') <> 'true'
  ),
  identified as (
    select *, coalesce('review:' || nullif(trim(review_session_id), ''),
      'menu:' || nullif(trim(session_id), '')) as visit_id,
      lower(coalesce(nullif(trim(employee_name), ''), '')) as employee_key
    from filtered
  ),
  visit_starts as (
    select branch_id, employee_key, visit_id, min(created_at) as started_at
    from identified where event_type = 'qr_scan' and visit_id is not null and created_at is not null
    group by 1,2,3
  ),
  visits as (
    select s.*, exists(select 1 from identified e
      where e.branch_id = s.branch_id and e.employee_key = s.employee_key
        and e.visit_id = s.visit_id and e.created_at >= s.started_at
        and e.event_type in ('google_redirect','review_google_click')) as converted
    from visit_starts s
  ),
  metrics as (
    select f.branch_id, f.employee_key,
      (select count(*) from visits v where v.branch_id=f.branch_id and v.employee_key=f.employee_key) as qr_visits,
      (select count(*) from visits v where v.branch_id=f.branch_id and v.employee_key=f.employee_key and v.converted) as converted_visits,
      count(*) filter(where f.event_type='qr_scan' and (f.visit_id is null or f.created_at is null)) as unidentifiable_scans,
      count(*) filter(where f.event_type in ('google_redirect','review_google_click') and not exists(
        select 1 from visits v where v.branch_id=f.branch_id and v.employee_key=f.employee_key
        and v.visit_id=f.visit_id and f.created_at>=v.started_at)) as unmatched_redirects
    from identified f group by f.branch_id,f.employee_key
  ),
  by_type as (select event_type, count(*)::int as c from filtered group by 1),
  staff as (
    select
      public.nac_reviews_normalize_branch_id(branch_id) as branch_id,
      max(coalesce(nullif(trim(employee_name), ''), '')) as name,
      max(employee_role) as role,
      count(*) filter (where event_type = 'qr_scan') as scans,
      count(*) filter (where event_type in ('review_generate', 'review_regenerate')) as generated,
      count(*) filter (where event_type in ('review_google_click', 'google_redirect')) as google
    from filtered
    where coalesce(trim(employee_name), '') <> ''
    group by 1, lower(trim(employee_name))
  ),
  daily as (
    select (started_at at time zone 'Asia/Riyadh')::date as day_key,
      count(*)::int as scans
    from visit_starts group by 1
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
  , raw_summary as (select jsonb_build_object(
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
  ) as raw_result)
  select r.raw_result || jsonb_build_object(
    'metric_version', 'qr-visits-v1',
    'raw_qr_scans', r.raw_result->'qr_scans',
    'raw_google_redirects', r.raw_result->'google_redirects',
    'qr_visits', coalesce((select sum(qr_visits) from metrics),0),
    'converted_visits', coalesce((select sum(converted_visits) from metrics),0),
    'unidentifiable_scans', coalesce((select sum(unidentifiable_scans) from metrics),0),
    'unmatched_redirects', coalesce((select sum(unmatched_redirects) from metrics),0),
    'conversion_pct', case when (select sum(unidentifiable_scans) from metrics)>0 then null
      when (select sum(qr_visits) from metrics)>0 then
        round(100.0*(select sum(converted_visits) from metrics)/(select sum(qr_visits) from metrics))
      else null end,
    'staff', coalesce((select jsonb_agg(s || jsonb_build_object(
      'raw_scans',s->'scans','raw_google',s->'google',
      'qr_visits',m.qr_visits,'converted_visits',m.converted_visits,
      'unidentifiable_scans',m.unidentifiable_scans,'unmatched_redirects',m.unmatched_redirects,
      'conversion_pct',case when m.unidentifiable_scans>0 or m.qr_visits=0 then null
        else round(100.0*m.converted_visits/m.qr_visits) end))
      from jsonb_array_elements(r.raw_result->'staff') s join metrics m
      on m.branch_id=s->>'branch_id' and m.employee_key=lower(trim(s->>'name'))), '[]'::jsonb),
    'by_branch', coalesce((select jsonb_agg(jsonb_build_object(
      'branch_id',b.branch_id,'qr_visits',coalesce(m.qr_visits,0),
      'converted_visits',coalesce(m.converted_visits,0),
      'unidentifiable_scans',coalesce(m.unidentifiable_scans,0),
      'unmatched_redirects',coalesce(m.unmatched_redirects,0),
      'raw_qr_scans',coalesce((select (x->>'qr_scans')::bigint from jsonb_array_elements(r.raw_result->'by_branch') x where x->>'branch_id'=b.branch_id),0),
      'raw_google_redirects',coalesce((select (x->>'google_redirects')::bigint from jsonb_array_elements(r.raw_result->'by_branch') x where x->>'branch_id'=b.branch_id),0),
      'reviews_generated',coalesce((select (x->>'reviews_generated')::bigint from jsonb_array_elements(r.raw_result->'by_branch') x where x->>'branch_id'=b.branch_id),0),
      'conversion_pct',case when coalesce(m.unidentifiable_scans,0)>0 or coalesce(m.qr_visits,0)=0 then null else round(100.0*m.converted_visits/m.qr_visits) end))
      from (select unnest(v_allowed) as branch_id) b
      left join (select branch_id,sum(qr_visits) qr_visits,sum(converted_visits) converted_visits,
        sum(unidentifiable_scans) unidentifiable_scans,sum(unmatched_redirects) unmatched_redirects
        from metrics group by branch_id) m using(branch_id)
      where p_branch is null or b.branch_id=lower(trim(p_branch))), '[]'::jsonb)
  ) into v_result from raw_summary r;


  return coalesce(v_result, '{}'::jsonb);
end;
$function$
;
