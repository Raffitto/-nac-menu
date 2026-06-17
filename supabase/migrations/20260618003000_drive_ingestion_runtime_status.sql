-- Runtime status hardening for Google Drive ingestion.
-- Adds explicit phases and failure fields so production runs cannot sit at
-- silent zero counters.

alter table public.ask_nac_drive_sync_runs
  drop constraint if exists ask_nac_drive_sync_runs_status_check;

alter table public.ask_nac_drive_sync_runs
  add constraint ask_nac_drive_sync_runs_status_check
  check (status in ('queued', 'running', 'completed', 'completed_empty', 'failed', 'partial', 'processing'));

alter table public.ask_nac_drive_sync_runs
  add column if not exists runtime_stage text;

alter table public.ask_nac_drive_sync_runs
  add column if not exists error_code text;

alter table public.ask_nac_drive_sync_runs
  add column if not exists error_message text;

alter table public.ask_nac_drive_sync_runs
  add column if not exists selected_folders_count int not null default 0;

alter table public.ask_nac_drive_sync_runs
  add column if not exists selected_drive_folder_ids text[] not null default '{}';

alter table public.ask_nac_drive_sync_runs
  add column if not exists current_folder_path text;

alter table public.ask_nac_drive_sync_runs
  add column if not exists current_file_path text;

alter table public.ask_nac_drive_sync_runs
  add column if not exists completed_at timestamptz;

alter table public.ask_nac_drive_sync_runs
  add column if not exists updated_at timestamptz not null default now();

