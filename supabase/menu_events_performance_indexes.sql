-- menu_events query performance (Session Analytics feed, filters, RPC CTEs)
-- Run in Supabase SQL Editor on production

create index if not exists idx_menu_events_created_at_desc
  on public.menu_events (created_at desc);

create index if not exists idx_menu_events_branch_created
  on public.menu_events (branch_id, created_at desc);

create index if not exists idx_menu_events_event_created
  on public.menu_events (event_type, created_at desc);

create index if not exists idx_menu_events_branch_event_created
  on public.menu_events (branch_id, event_type, created_at desc)
  where branch_id is not null;

create index if not exists idx_menu_events_session_id
  on public.menu_events (session_id)
  where coalesce(trim(session_id), '') <> '';

analyze public.menu_events;
