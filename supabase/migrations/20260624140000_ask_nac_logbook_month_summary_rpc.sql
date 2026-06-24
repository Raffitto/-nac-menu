-- Monthly logbook executive summary: facts + coverage in one security-definer round trip.

create or replace function public.get_vault_logbook_month_summary_facts(
  p_branch_id text,
  p_start_date date,
  p_end_date date,
  p_metric_keys text[] default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_metric_keys text[];
  v_facts jsonb;
  v_coverage jsonb;
  v_summary jsonb;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  if p_branch_id is null then
    raise exception 'branch_id required';
  end if;

  if not public.ask_nac_vault_branch_allowed(p_branch_id) then
    raise exception 'branch access denied';
  end if;

  if p_start_date is null or p_end_date is null then
    return jsonb_build_object(
      'facts', '[]'::jsonb,
      'coverage', '[]'::jsonb,
      'coverageSummary', jsonb_build_object(
        'distinctDays', 0,
        'readyDays', 0,
        'partialDays', 0,
        'fileCount', 0
      )
    );
  end if;

  v_metric_keys := coalesce(p_metric_keys, array[
    'complaints',
    'operational_issues',
    'operational_highlights',
    'dinner_notes',
    'training_notes',
    'staff_performance_notes',
    'reservations',
    'covers',
    'walkins',
    'no_shows',
    'cancellations',
    'google_review_5',
    'google_review_4',
    'google_review_3',
    'google_review_2',
    'google_review_1'
  ]::text[]);

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'fileId', f.file_id,
        'periodStart', f.period_start,
        'periodEnd', f.period_end,
        'metricKey', f.metric_key,
        'metricValue', f.metric_value,
        'dimensions', coalesce(f.dimensions, '{}'::jsonb),
        'confidence', f.confidence
      )
      order by f.period_start, f.metric_key
    ),
    '[]'::jsonb
  )
  into v_facts
  from public.ask_nac_structured_facts f
  where f.report_type = 'daily_logbook'
    and f.archived_at is null
    and f.branch_id = p_branch_id
    and f.period_start <= p_end_date
    and f.period_end >= p_start_date
    and f.metric_key = any (v_metric_keys)
    and public.ask_nac_vault_can_read_scope(
      f.branch_id,
      f.brand_wide,
      f.department,
      f.sensitivity_level
    );

  with coverage_rows as (
    select
      c.period_start,
      c.period_end,
      c.readiness_status,
      c.source_file_id,
      c.fact_count,
      coalesce(sf.title, sf.original_filename) as file_title
    from public.ask_nac_data_coverage c
    left join public.ask_nac_files sf on sf.id = c.source_file_id
    where c.report_type = 'daily_logbook'
      and c.branch_id = p_branch_id
      and c.period_start <= p_end_date
      and c.period_end >= p_start_date
  ),
  coverage_json as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'periodStart', cr.period_start,
          'periodEnd', cr.period_end,
          'readinessStatus', cr.readiness_status,
          'sourceFileId', cr.source_file_id,
          'fileTitle', cr.file_title,
          'factCount', cr.fact_count
        )
        order by cr.period_start
      ),
      '[]'::jsonb
    ) as coverage
    from coverage_rows cr
  ),
  coverage_stats as (
    select
      count(*)::int as file_count,
      count(*) filter (where readiness_status = 'ready')::int as ready_days,
      count(*) filter (where readiness_status = 'partial')::int as partial_days,
      count(distinct period_start)::int as distinct_days
    from coverage_rows
  )
  select
    cj.coverage,
    jsonb_build_object(
      'distinctDays', cs.distinct_days,
      'readyDays', cs.ready_days,
      'partialDays', cs.partial_days,
      'fileCount', cs.file_count
    )
  into v_coverage, v_summary
  from coverage_json cj
  cross join coverage_stats cs;

  return jsonb_build_object(
    'facts', coalesce(v_facts, '[]'::jsonb),
    'coverage', coalesce(v_coverage, '[]'::jsonb),
    'coverageSummary', coalesce(v_summary, jsonb_build_object(
      'distinctDays', 0,
      'readyDays', 0,
      'partialDays', 0,
      'fileCount', 0
    ))
  );
end;
$$;

comment on function public.get_vault_logbook_month_summary_facts(text, date, date, text[]) is
  'Returns daily_logbook structured facts and coverage rows for monthly executive summaries. Security definer with vault scope checks.';

revoke all on function public.get_vault_logbook_month_summary_facts(text, date, date, text[]) from public;
grant execute on function public.get_vault_logbook_month_summary_facts(text, date, date, text[]) to authenticated;
