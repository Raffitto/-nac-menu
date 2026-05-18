-- Calendar month-to-date filter (Asia/Riyadh) — use p_hours = 999 for "This Month"

create or replace function public.nac_calendar_month_start(ts timestamptz default now())
returns timestamptz
language sql
stable
as $$
  select (
    date_trunc('month', ts at time zone 'Asia/Riyadh') at time zone 'Asia/Riyadh'
  );
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
    when p_hours = 999 then public.nac_calendar_month_start(ts)
    when p_hours = 720 then public.nac_calendar_month_start(ts)
    else ts - make_interval(hours => greatest(p_hours, 1))
  end;
$$;
