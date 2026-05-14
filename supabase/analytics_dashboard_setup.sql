-- NAC menu analytics dashboard: RLS + RPC
-- Run once in Supabase SQL Editor after your original menu_events table + anon insert policy exist.

-- ---------------------------------------------------------------------------
-- 1) Allow authenticated users to read menu_events (dashboard only)
-- ---------------------------------------------------------------------------
grant select on public.menu_events to authenticated;

drop policy if exists "authenticated_select_menu_events" on public.menu_events;
create policy "authenticated_select_menu_events"
  on public.menu_events
  for select
  to authenticated
  using (true);

-- ---------------------------------------------------------------------------
-- 2) Allow inserts as authenticated too (optional: staff stays signed in while testing the guest menu)
-- ---------------------------------------------------------------------------
drop policy if exists "anon_insert_menu_events" on public.menu_events;
drop policy if exists "menu_events_insert_anon_authenticated" on public.menu_events;

create policy "menu_events_insert_anon_authenticated"
  on public.menu_events
  for insert
  to anon, authenticated
  with check (true);

-- ---------------------------------------------------------------------------
-- 3) Server-side aggregates for the dashboard (one round trip; SECURITY DEFINER)
-- ---------------------------------------------------------------------------
create or replace function public.get_dashboard_aggregates()
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select jsonb_build_object(
    'total_events', (select count(*)::bigint from public.menu_events),
    'total_sessions', (
      select count(distinct session_id)::bigint
      from public.menu_events
      where coalesce(trim(session_id), '') <> ''
    ),
    'by_language', coalesce(
      (
        select jsonb_object_agg(language_key, cnt)
        from (
          select coalesce(nullif(trim(language), ''), 'unknown') as language_key, count(*)::bigint as cnt
          from public.menu_events
          group by 1
        ) s
      ),
      '{}'::jsonb
    ),
    'by_event_type', coalesce(
      (
        select jsonb_object_agg(event_type, cnt)
        from (
          select event_type, count(*)::bigint as cnt
          from public.menu_events
          group by 1
        ) t
      ),
      '{}'::jsonb
    ),
    'top_items', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object('name', u.name, 'opens', u.opens)
          ORDER BY u.opens DESC NULLS LAST
        )
        from (
          select item_name_en as name, count(*)::bigint as opens
          from public.menu_events
          where event_type = 'item_open'
            and coalesce(trim(item_name_en), '') <> ''
          group by item_name_en
          order by opens desc
          limit 12
        ) u
      ),
      '[]'::jsonb
    ),
    'top_categories', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object('id', v.id, 'opens', v.opens)
          ORDER BY v.opens DESC NULLS LAST
        )
        from (
          select category_id as id, count(*)::bigint as opens
          from public.menu_events
          where event_type = 'category_open'
            and category_id is not null
          group by category_id
          order by opens desc
          limit 10
        ) v
      ),
      '[]'::jsonb
    ),
    'by_hour', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object('hour', w.hour_bucket, 'count', w.c)
          ORDER BY w.hour_bucket
        )
        from (
          select date_trunc('hour', created_at) as hour_bucket, count(*)::bigint as c
          from public.menu_events
          where created_at > now() - interval '24 hours'
          group by 1
          order by 1
        ) w
      ),
      '[]'::jsonb
    )
  );
$$;

revoke all on function public.get_dashboard_aggregates() from public;
grant execute on function public.get_dashboard_aggregates() to authenticated;
