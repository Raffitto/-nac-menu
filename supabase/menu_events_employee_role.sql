-- Session Analytics: staff role on menu_events (safe to re-run)
-- Run in Supabase SQL Editor before relying on role filters in the dashboard.

alter table public.menu_events
  add column if not exists employee_role text;

comment on column public.menu_events.employee_role is
  'Staff role at time of event (waiter, receptionist, rm). Used by Session Analytics filters.';

-- Backfill: metadata first, then default waiter for historical rows
update public.menu_events
set employee_role = coalesce(
  nullif(trim(employee_role), ''),
  nullif(trim(metadata->>'employee_role'), ''),
  nullif(trim(metadata->>'role'), ''),
  'waiter'
)
where employee_role is null;

create index if not exists idx_menu_events_employee_role
  on public.menu_events (employee_role)
  where employee_role is not null;

analyze public.menu_events;
