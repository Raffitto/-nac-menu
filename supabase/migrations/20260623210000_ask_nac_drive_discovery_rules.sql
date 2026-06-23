-- Smart Drive Discovery with approval gate — rules, candidates, discovery roots, report types.

alter table public.ask_nac_drive_sync_folders
  add column if not exists is_discovery_root boolean not null default false;

comment on column public.ask_nac_drive_sync_folders.is_discovery_root is
  'When true, folder is a top-level Daily/Weekly root; subfolders are classified via discovery rules.';

create table if not exists public.ask_nac_drive_discovery_rules (
  id uuid primary key default gen_random_uuid(),
  folder_path_pattern text not null,
  file_name_pattern text,
  detected_report_type text not null,
  action text not null check (action in ('ingest', 'ignore', 'ask')),
  branch_id text check (branch_id is null or branch_id in ('khobar', 'riyadh', 'jeddah')),
  confidence numeric not null default 0.5,
  reason text,
  created_by text not null default 'system',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  active boolean not null default true
);

create index if not exists idx_ask_nac_drive_discovery_rules_active
  on public.ask_nac_drive_discovery_rules (active, branch_id);

create index if not exists idx_ask_nac_drive_discovery_rules_pattern
  on public.ask_nac_drive_discovery_rules (folder_path_pattern);

comment on table public.ask_nac_drive_discovery_rules is
  'Permanent Drive folder/file classification decisions for smart discovery ingestion.';

create table if not exists public.ask_nac_drive_discovery_candidates (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid references public.ask_nac_drive_connections (id) on delete cascade,
  discovery_root_folder_id uuid references public.ask_nac_drive_sync_folders (id) on delete cascade,
  folder_path text not null,
  detected_report_type text not null,
  recommended_action text not null check (recommended_action in ('ingest', 'ignore', 'ask', 'unknown_needs_review')),
  confidence numeric not null default 0.5,
  reason text,
  sample_filenames text[] not null default '{}',
  file_count int not null default 0,
  branch_id text check (branch_id is null or branch_id in ('khobar', 'riyadh', 'jeddah')),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'ignored', 'deferred')),
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (discovery_root_folder_id, folder_path)
);

create unique index if not exists idx_ask_nac_drive_discovery_rules_pattern_branch
  on public.ask_nac_drive_discovery_rules (folder_path_pattern, coalesce(branch_id, ''));

create index if not exists idx_ask_nac_drive_discovery_candidates_status
  on public.ask_nac_drive_discovery_candidates (status, branch_id);

alter table public.ask_nac_drive_discovery_rules enable row level security;
alter table public.ask_nac_drive_discovery_candidates enable row level security;

drop policy if exists ask_nac_drive_discovery_rules_select on public.ask_nac_drive_discovery_rules;
create policy ask_nac_drive_discovery_rules_select on public.ask_nac_drive_discovery_rules
  for select to authenticated using (true);

drop policy if exists ask_nac_drive_discovery_rules_write on public.ask_nac_drive_discovery_rules;
create policy ask_nac_drive_discovery_rules_write on public.ask_nac_drive_discovery_rules
  for all to authenticated using (true) with check (true);

drop policy if exists ask_nac_drive_discovery_candidates_select on public.ask_nac_drive_discovery_candidates;
create policy ask_nac_drive_discovery_candidates_select on public.ask_nac_drive_discovery_candidates
  for select to authenticated using (true);

drop policy if exists ask_nac_drive_discovery_candidates_write on public.ask_nac_drive_discovery_candidates;
create policy ask_nac_drive_discovery_candidates_write on public.ask_nac_drive_discovery_candidates
  for all to authenticated using (true) with check (true);

grant select, insert, update, delete on public.ask_nac_drive_discovery_rules to authenticated;
grant select, insert, update, delete on public.ask_nac_drive_discovery_candidates to authenticated;

insert into public.ask_nac_report_type_templates (code, label, default_department, default_data_layer, default_sensitivity, parser_version, active)
values
  ('daily_briefing', 'Daily Briefing', 'operations', 'operational', 'management', 'vault-prototype-v3', true),
  ('breakage_report', 'Breakage Report', 'operations', 'operational', 'management', 'vault-prototype-v3', true),
  ('discount_void_comp', 'Discount / Void / Comp', 'operations', 'operational', 'management', 'vault-prototype-v3', true),
  ('guest_feedback', 'Guest Feedback', 'operations', 'operational', 'internal', 'vault-prototype-v3', true)
on conflict (code) do update set
  label = excluded.label,
  default_department = excluded.default_department,
  default_sensitivity = excluded.default_sensitivity,
  parser_version = excluded.parser_version,
  active = excluded.active;

-- Seed known Daily/Weekly folder decisions (system defaults; user rules override via created_at/recency).
insert into public.ask_nac_drive_discovery_rules
  (folder_path_pattern, detected_report_type, action, confidence, reason, created_by, active)
values
  ('Cash Up', 'cash_up', 'ingest', 0.98, 'Daily cash-up operational reports.', 'system', true),
  ('Logbook', 'daily_logbook', 'ingest', 0.98, 'Daily logbook operational reports.', 'system', true),
  ('Daily Reception', 'daily_reception', 'ingest', 0.96, 'Daily reception counts and covers.', 'system', true),
  ('Daily Briefing', 'daily_briefing', 'ingest', 0.96, 'Daily briefing workbook (MOD, reservations, staffing).', 'system', true),
  ('CCM and Foodics', 'ccm_reconciliation', 'ingest', 0.96, 'CCM / Foodics reconciliation folder.', 'system', true),
  ('Breakage', 'breakage_report', 'ingest', 0.95, 'Breakage / asset-loss reporting.', 'system', true),
  ('Discount and comp', 'discount_void_comp', 'ingest', 0.95, 'Discount/comp operational reports (CEO format).', 'system', true),
  ('Voids discounts', 'discount_void_comp', 'ingest', 0.95, 'Same category as Discount and comp — renamed folder.', 'system', true),
  ('Voids and discounts', 'discount_void_comp', 'ingest', 0.95, 'Same category as Discount and comp — renamed folder.', 'system', true),
  ('Guest Feedback', 'guest_feedback', 'ask', 0.72, 'Uncertain: operational feedback vs complaints vs Google reviews.', 'system', true),
  ('Daily Napkins Count', 'ignore', 'ignore', 0.99, 'Explicitly excluded from ingestion.', 'system', true),
  ('Monthly Cash Safe', 'ignore', 'ignore', 0.99, 'Explicitly excluded from ingestion.', 'system', true),
  ('Weekly Dashboards', 'weekly_dashboard', 'ingest', 0.97, 'Executive weekly management dashboards.', 'system', true),
  ('Executive Reports/Weekly Dashboards', 'weekly_dashboard', 'ingest', 0.97, 'Executive Reports weekly dashboards path.', 'system', true);
