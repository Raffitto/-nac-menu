-- Ensure staff columns exist on review_events (safe to re-run)
alter table public.review_events
  add column if not exists employee_name text;

alter table public.review_events
  add column if not exists employee_role text;

alter table public.review_events
  add column if not exists store_name text;

-- Allow QR + alias event types used by review portal
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
