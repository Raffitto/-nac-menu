-- Canonical Google review counts from Drive workbook "2026 review tracking".
-- Not QR scans / review_events.

create table if not exists public.google_review_tracking_entries (
  id uuid primary key default gen_random_uuid(),
  branch_id text not null check (branch_id in ('khobar', 'riyadh', 'jeddah')),
  review_date date not null,
  staff_name text not null,
  source_staff_name text,
  review_count numeric not null default 0,
  source_file_id uuid references public.ask_nac_files (id) on delete set null,
  source_drive_file_id text,
  source_sheet text,
  ingested_at timestamptz not null default now(),
  unique (branch_id, review_date, staff_name)
);

create index if not exists idx_google_review_tracking_branch_date
  on public.google_review_tracking_entries (branch_id, review_date);

create index if not exists idx_google_review_tracking_staff
  on public.google_review_tracking_entries (branch_id, staff_name);

comment on table public.google_review_tracking_entries is
  'Staff/day Google review counts ingested only from the Google Drive 2026 review tracking workbook.';

alter table public.google_review_tracking_entries enable row level security;

drop policy if exists google_review_tracking_select on public.google_review_tracking_entries;
create policy google_review_tracking_select on public.google_review_tracking_entries
  for select to authenticated
  using (
    case
      when public.ask_nac_vault_role() = 'branch_admin'
        then public.ask_nac_vault_branch_admin_scope_allowed(branch_id, false)
      else public.ask_nac_vault_can_read_scope(branch_id, false, 'reception', 'internal')
    end
  );

grant select on public.google_review_tracking_entries to authenticated;

insert into public.ask_nac_report_type_templates (
  code, label, default_department, default_data_layer, default_sensitivity, parser_version, active
)
values (
  'google_review_tracking',
  'Google Review Tracking',
  'reception',
  'operational',
  'internal',
  'google_review_tracking_workbook',
  true
)
on conflict (code) do update
set label = excluded.label,
    parser_version = excluded.parser_version,
    active = true;

insert into public.ask_nac_drive_discovery_rules (
  folder_path_pattern,
  file_name_pattern,
  detected_report_type,
  action,
  confidence,
  reason,
  created_by,
  active
)
select
  'review tracking',
  'review.?tracking',
  'google_review_tracking',
  'ingest',
  0.99,
  'Operational 2026 review tracking workbook — not QR review events.',
  'system',
  true
where not exists (
  select 1
  from public.ask_nac_drive_discovery_rules
  where folder_path_pattern = 'review tracking'
    and detected_report_type = 'google_review_tracking'
);
