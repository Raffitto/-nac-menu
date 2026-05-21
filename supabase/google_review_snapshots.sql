-- Google review/rating snapshot history (daily per branch)
-- Run in Supabase SQL Editor. Safe to re-run.

create table if not exists public.google_review_snapshots (
  id uuid primary key default gen_random_uuid(),
  branch_id text not null,
  branch_name text not null,
  rating numeric,
  review_count integer not null,
  captured_at timestamptz not null default now(),
  snapshot_date date not null default current_date,
  created_at timestamptz not null default now(),
  unique (branch_id, snapshot_date)
);

alter table public.google_review_snapshots enable row level security;

drop policy if exists "anon_select_google_review_snapshots" on public.google_review_snapshots;
drop policy if exists "auth_full_google_review_snapshots" on public.google_review_snapshots;

create policy "anon_select_google_review_snapshots"
  on public.google_review_snapshots
  for select
  to anon
  using (true);

create policy "auth_full_google_review_snapshots"
  on public.google_review_snapshots
  for all
  to authenticated
  using (true)
  with check (true);

create index if not exists idx_google_review_snapshots_branch_date
  on public.google_review_snapshots (branch_id, snapshot_date desc);

grant select on public.google_review_snapshots to anon, authenticated;
grant insert, update, delete on public.google_review_snapshots to authenticated;

comment on table public.google_review_snapshots is
  'Daily Google Maps rating and review count per branch (Places API snapshots, not QR redirects).';
