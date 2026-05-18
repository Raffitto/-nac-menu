-- Fix review_events inserts from anonymous review QR (run in Supabase SQL editor)
-- Safe to re-run.

-- Required columns for staff review tracking
alter table public.review_events
  add column if not exists employee_name text;

alter table public.review_events
  add column if not exists employee_role text;

alter table public.review_events
  add column if not exists store_name text;

-- Allow all event types used by ReviewPortal
alter table public.review_events drop constraint if exists review_events_event_type_check;

alter table public.review_events add constraint review_events_event_type_check check (
  event_type in (
    'qr_scan',
    'review_page_open',
    'review_open',
    'review_generate',
    'review_regenerate',
    'review_copy',
    'copy_review',
    'review_google_click',
    'google_redirect',
    'review_language_change'
  )
);

-- RLS: anon guests on review QR must INSERT; dashboard auth must SELECT
alter table public.review_events enable row level security;

drop policy if exists "anon_insert_review_events" on public.review_events;
drop policy if exists review_events_anon_insert on public.review_events;

create policy "anon_insert_review_events"
  on public.review_events
  for insert
  to anon, authenticated
  with check (true);

drop policy if exists "authenticated_select_review_events" on public.review_events;
drop policy if exists review_events_auth_select on public.review_events;

create policy "authenticated_select_review_events"
  on public.review_events
  for select
  to authenticated
  using (true);

grant insert on table public.review_events to anon, authenticated;
grant select on table public.review_events to authenticated;

-- Optional: allow service role full access (default in Supabase)
grant all on table public.review_events to service_role;
