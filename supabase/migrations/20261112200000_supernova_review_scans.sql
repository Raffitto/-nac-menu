-- One general Supernova review QR. This table is deliberately separate from NAC review_events.
create table public.supernova_review_scans (
  id bigint generated always as identity primary key,
  scanned_at timestamptz not null default now(),
  visitor_id uuid not null
);

create index supernova_review_scans_scanned_at_idx
  on public.supernova_review_scans (scanned_at desc);

alter table public.supernova_review_scans enable row level security;
revoke all on public.supernova_review_scans from public, anon, authenticated;
grant insert (visitor_id) on public.supernova_review_scans to anon;
grant select on public.supernova_review_scans to authenticated;

create policy supernova_scans_insert on public.supernova_review_scans
  for insert to anon with check (visitor_id is not null);

create policy supernova_scans_read on public.supernova_review_scans
  for select to authenticated using ((select auth.uid()) is not null);

create or replace function public.get_supernova_scan_summary(p_days integer default 30)
returns jsonb
language sql stable security invoker
set search_path = ''
as $$
  with bounds as (
    select (now() at time zone 'Asia/Riyadh')::date as today,
           least(greatest(coalesce(p_days, 30), 1), 365) as history_days
  ),
  counts as (
    select count(*)::integer as total_scans,
           count(*) filter (where (s.scanned_at at time zone 'Asia/Riyadh')::date = b.today)::integer as today_scans,
           count(*) filter (where (s.scanned_at at time zone 'Asia/Riyadh')::date >= b.today - 6)::integer as last_7_days,
           count(*) filter (where (s.scanned_at at time zone 'Asia/Riyadh')::date >= b.today - 29)::integer as last_30_days,
           count(distinct s.visitor_id)::integer as approximate_unique_scans
    from public.supernova_review_scans s cross join bounds b
  ),
  history as (
    select d.day::date as day, count(s.id)::integer as scans
    from bounds b
    cross join lateral generate_series(b.today - (b.history_days - 1), b.today, interval '1 day') d(day)
    left join public.supernova_review_scans s
      on s.scanned_at >= d.day at time zone 'Asia/Riyadh'
     and s.scanned_at < (d.day + interval '1 day') at time zone 'Asia/Riyadh'
    group by d.day
  )
  select jsonb_build_object(
    'total_scans', c.total_scans,
    'today_scans', c.today_scans,
    'last_7_days', c.last_7_days,
    'last_30_days', c.last_30_days,
    'approximate_unique_scans', c.approximate_unique_scans,
    'repeat_scans', c.total_scans - c.approximate_unique_scans,
    'daily_history', (select coalesce(jsonb_agg(jsonb_build_object('date', h.day, 'scans', h.scans) order by h.day), '[]'::jsonb) from history h)
  )
  from counts c;
$$;

revoke all on function public.get_supernova_scan_summary(integer) from public, anon;
grant execute on function public.get_supernova_scan_summary(integer) to authenticated;
