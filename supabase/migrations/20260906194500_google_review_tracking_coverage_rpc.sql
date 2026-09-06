-- Reports readiness only needs distinct review dates, not staff rows.
-- RLS on google_review_tracking_entries re-evaluates vault helpers per row and
-- made the Aug 1–31 coverage select take ~3s. Security definer + one scope check.

create or replace function public.get_google_review_tracking_coverage(
  p_branch_id text,
  p_start_date date,
  p_end_date date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_branch text;
  v_allowed boolean;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  v_branch := lower(trim(coalesce(p_branch_id, '')));
  if v_branch = '' or p_start_date is null or p_end_date is null then
    return jsonb_build_object(
      'coverage_start', null,
      'coverage_end', null,
      'distinct_date_count', 0,
      'dates', '[]'::jsonb,
      'missing_dates', '[]'::jsonb
    );
  end if;

  if public.ask_nac_vault_role() = 'branch_admin' then
    v_allowed := public.ask_nac_vault_branch_admin_scope_allowed(v_branch, false);
  else
    v_allowed := public.ask_nac_vault_can_read_scope(v_branch, false, 'reception', 'internal');
  end if;

  if not coalesce(v_allowed, false) then
    raise exception 'branch access denied';
  end if;

  return (
    with covered as (
      select distinct e.review_date
      from public.google_review_tracking_entries e
      where e.branch_id = v_branch
        and e.review_date >= p_start_date
        and e.review_date <= p_end_date
        and e.review_count > 0
    ),
    expected as (
      select generate_series(p_start_date, p_end_date, interval '1 day')::date as review_date
    )
    select jsonb_build_object(
      'coverage_start', (select min(review_date) from covered),
      'coverage_end', (select max(review_date) from covered),
      'distinct_date_count', (select count(*) from covered),
      'dates', coalesce(
        (select jsonb_agg(review_date order by review_date) from covered),
        '[]'::jsonb
      ),
      'missing_dates', coalesce(
        (
          select jsonb_agg(expected.review_date order by expected.review_date)
          from expected
          where not exists (
            select 1 from covered where covered.review_date = expected.review_date
          )
        ),
        '[]'::jsonb
      )
    )
  );
end;
$$;

comment on function public.get_google_review_tracking_coverage(text, date, date) is
  'Reports readiness: distinct Drive review-tracking dates for a branch/range. Not staff rows.';

revoke all on function public.get_google_review_tracking_coverage(text, date, date) from public;
grant execute on function public.get_google_review_tracking_coverage(text, date, date) to authenticated;
