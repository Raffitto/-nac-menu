-- Google Drive first-class ingestion for Company Knowledge.
-- Keeps metadata sync working while allowing registered folders to opt into
-- server-side download, extraction, chunking, and indexing.

alter table public.ask_nac_drive_sync_folders
  add column if not exists label text;

alter table public.ask_nac_drive_sync_folders
  add column if not exists branch_id text check (branch_id is null or branch_id in ('khobar', 'riyadh', 'jeddah'));

alter table public.ask_nac_drive_sync_folders
  add column if not exists department text;

alter table public.ask_nac_drive_sync_folders
  add column if not exists report_type text;

alter table public.ask_nac_drive_sync_folders
  add column if not exists sensitivity text check (
    sensitivity is null or sensitivity in ('public', 'internal', 'management', 'finance', 'hr_restricted')
  );

alter table public.ask_nac_drive_sync_folders
  add column if not exists auto_ingest boolean not null default false;

alter table public.ask_nac_drive_sync_folders
  add column if not exists last_ingest_at timestamptz;

update public.ask_nac_drive_sync_folders
set
  label = coalesce(label, folder_name, drive_folder_id),
  branch_id = coalesce(branch_id, default_branch_id),
  department = coalesce(department, default_department, 'operations'),
  report_type = coalesce(report_type, 'other'),
  sensitivity = coalesce(sensitivity, 'internal')
where label is null
   or branch_id is null
   or department is null
   or report_type is null
   or sensitivity is null;

alter table public.ask_nac_files
  add column if not exists source_external_version text;

alter table public.ask_nac_files
  add column if not exists source_external_checksum text;

alter table public.ask_nac_files
  add column if not exists searchable boolean not null default false;

update public.ask_nac_files
set searchable = coalesce(chunk_count, 0) > 0 or search_status = 'searchable'
where searchable is false;

alter table public.ask_nac_drive_sync_runs
  drop constraint if exists ask_nac_drive_sync_runs_status_check;

alter table public.ask_nac_drive_sync_runs
  add constraint ask_nac_drive_sync_runs_status_check
  check (status in ('queued', 'running', 'completed', 'failed', 'partial', 'processing'));

alter table public.ask_nac_drive_sync_runs
  add column if not exists discovered_count int not null default 0;

alter table public.ask_nac_drive_sync_runs
  add column if not exists new_count int not null default 0;

alter table public.ask_nac_drive_sync_runs
  add column if not exists changed_count int not null default 0;

alter table public.ask_nac_drive_sync_runs
  add column if not exists skipped_count int not null default 0;

alter table public.ask_nac_drive_sync_runs
  add column if not exists downloaded_count int not null default 0;

alter table public.ask_nac_drive_sync_runs
  add column if not exists extracted_count int not null default 0;

alter table public.ask_nac_drive_sync_runs
  add column if not exists parsed_count int not null default 0;

alter table public.ask_nac_drive_sync_runs
  add column if not exists indexed_count int not null default 0;

alter table public.ask_nac_drive_sync_runs
  add column if not exists failed_count int not null default 0;

alter table public.ask_nac_drive_sync_runs
  add column if not exists current_file text;

update public.ask_nac_drive_sync_runs
set
  discovered_count = greatest(discovered_count, files_discovered),
  new_count = greatest(new_count, files_new),
  changed_count = greatest(changed_count, files_changed),
  skipped_count = greatest(skipped_count, files_skipped),
  failed_count = greatest(failed_count, files_failed)
where files_discovered > 0
   or files_new > 0
   or files_changed > 0
   or files_skipped > 0
   or files_failed > 0;

create table if not exists public.ask_nac_drive_sync_run_files (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.ask_nac_drive_sync_runs (id) on delete cascade,
  folder_id uuid not null references public.ask_nac_drive_sync_folders (id) on delete cascade,
  drive_file_id text not null,
  file_name text not null,
  mime_type text,
  modified_time timestamptz,
  source_version text,
  checksum text,
  file_id uuid references public.ask_nac_files (id) on delete set null,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'completed', 'failed', 'skipped', 'unsupported')),
  action text check (action is null or action in ('metadata_only', 'new', 'changed', 'skipped', 'retry')),
  error text,
  stats jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists idx_ask_nac_drive_run_files_run
  on public.ask_nac_drive_sync_run_files (run_id, status);

create index if not exists idx_ask_nac_drive_run_files_drive_id
  on public.ask_nac_drive_sync_run_files (drive_file_id, created_at desc);

alter table public.ask_nac_drive_sync_run_files enable row level security;

drop policy if exists ask_nac_drive_run_files_select on public.ask_nac_drive_sync_run_files;
create policy ask_nac_drive_run_files_select on public.ask_nac_drive_sync_run_files
  for select to authenticated
  using (
    exists (
      select 1
      from public.ask_nac_drive_sync_folders f
      where f.id = folder_id
        and public.ask_nac_drive_connection_owned(f.connection_id)
    )
  );

grant select on public.ask_nac_drive_sync_run_files to authenticated;

