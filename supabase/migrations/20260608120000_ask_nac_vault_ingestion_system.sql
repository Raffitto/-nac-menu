-- Phase 4.5 — Data Vault bulk ingestion, Drive sync, operational timeline

-- ── File registry extensions ────────────────────────────────────────────────

alter table public.ask_nac_files
  add column if not exists ingestion_source text not null default 'manual_upload'
    check (ingestion_source in ('manual_upload', 'bulk_import', 'drive_sync'));

alter table public.ask_nac_files
  add column if not exists external_source_id text;

alter table public.ask_nac_files
  add column if not exists external_source_modified_at timestamptz;

alter table public.ask_nac_files
  add column if not exists bulk_batch_id uuid;

create index if not exists idx_ask_nac_files_content_hash
  on public.ask_nac_files (content_hash)
  where content_hash is not null and status = 'active';

create unique index if not exists idx_ask_nac_files_external_source
  on public.ask_nac_files (external_source_id, uploader_email)
  where external_source_id is not null and status = 'active';

create index if not exists idx_ask_nac_files_bulk_batch
  on public.ask_nac_files (bulk_batch_id)
  where bulk_batch_id is not null;

-- ── Bulk import batches ─────────────────────────────────────────────────────

create table if not exists public.ask_nac_bulk_import_batches (
  id uuid primary key default gen_random_uuid(),
  label text,
  total_files int not null default 0,
  processed_files int not null default 0,
  succeeded_files int not null default 0,
  failed_files int not null default 0,
  skipped_files int not null default 0,
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'completed', 'failed', 'cancelled')),
  default_branch_id text check (default_branch_id is null or default_branch_id in ('khobar', 'riyadh', 'jeddah')),
  default_department text,
  created_by text,
  uploader_email text not null,
  started_at timestamptz,
  finished_at timestamptz,
  stats jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_ask_nac_bulk_batches_email
  on public.ask_nac_bulk_import_batches (uploader_email, created_at desc);

create table if not exists public.ask_nac_bulk_import_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.ask_nac_bulk_import_batches (id) on delete cascade,
  relative_path text,
  original_filename text not null,
  file_id uuid references public.ask_nac_files (id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'completed', 'failed', 'skipped', 'duplicate')),
  skip_reason text,
  error text,
  content_hash text,
  stats jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists idx_ask_nac_bulk_items_batch
  on public.ask_nac_bulk_import_items (batch_id, status);

alter table public.ask_nac_files
  add constraint ask_nac_files_bulk_batch_fk
  foreign key (bulk_batch_id) references public.ask_nac_bulk_import_batches (id) on delete set null;

-- ── Google Drive sync ───────────────────────────────────────────────────────

create table if not exists public.ask_nac_drive_connections (
  id uuid primary key default gen_random_uuid(),
  user_email text not null unique,
  google_account_email text,
  refresh_token text not null,
  access_token text,
  token_expires_at timestamptz,
  scopes text[] not null default '{}',
  status text not null default 'active'
    check (status in ('active', 'revoked', 'error')),
  last_error text,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ask_nac_drive_sync_folders (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.ask_nac_drive_connections (id) on delete cascade,
  drive_folder_id text not null,
  folder_name text,
  default_branch_id text check (default_branch_id is null or default_branch_id in ('khobar', 'riyadh', 'jeddah')),
  default_department text,
  schedule text not null default 'manual'
    check (schedule in ('manual', 'daily')),
  last_sync_at timestamptz,
  last_sync_status text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique (connection_id, drive_folder_id)
);

create table if not exists public.ask_nac_drive_sync_runs (
  id uuid primary key default gen_random_uuid(),
  folder_id uuid not null references public.ask_nac_drive_sync_folders (id) on delete cascade,
  bulk_batch_id uuid references public.ask_nac_bulk_import_batches (id) on delete set null,
  trigger_type text not null default 'manual'
    check (trigger_type in ('manual', 'scheduled')),
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'completed', 'failed')),
  files_discovered int not null default 0,
  files_new int not null default 0,
  files_changed int not null default 0,
  files_skipped int not null default 0,
  files_failed int not null default 0,
  error text,
  started_at timestamptz,
  finished_at timestamptz,
  stats jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_ask_nac_drive_runs_folder
  on public.ask_nac_drive_sync_runs (folder_id, created_at desc);

-- ── Operational timeline ────────────────────────────────────────────────────

create table if not exists public.ask_nac_operational_timeline_events (
  id uuid primary key default gen_random_uuid(),
  branch_id text not null check (branch_id in ('khobar', 'riyadh', 'jeddah')),
  event_date date not null,
  event_type text not null check (
    event_type in (
      'sales',
      'complaint',
      'audit',
      'review',
      'staffing',
      'promotion',
      'incident',
      'operational_issue',
      'reservation',
      'cash_up',
      'weekly_summary',
      'pnl',
      'action_item'
    )
  ),
  title text not null,
  summary text,
  severity text check (severity is null or severity in ('info', 'warning', 'critical')),
  source_file_id uuid references public.ask_nac_files (id) on delete set null,
  source_fact_id uuid references public.ask_nac_structured_facts (id) on delete set null,
  metric_key text,
  metric_value numeric,
  dimensions jsonb not null default '{}'::jsonb,
  confidence numeric,
  created_at timestamptz not null default now()
);

create index if not exists idx_ask_nac_timeline_branch_date
  on public.ask_nac_operational_timeline_events (branch_id, event_date desc);

create index if not exists idx_ask_nac_timeline_type
  on public.ask_nac_operational_timeline_events (branch_id, event_type, event_date desc);

create unique index if not exists idx_ask_nac_timeline_dedup
  on public.ask_nac_operational_timeline_events (branch_id, event_date, event_type, source_file_id, metric_key)
  where source_file_id is not null and metric_key is not null;

-- ── Knowledge graph link types (Phase 4.5) ──────────────────────────────────

alter table public.ask_nac_document_links
  drop constraint if exists ask_nac_document_links_link_type_check;

alter table public.ask_nac_document_links
  add constraint ask_nac_document_links_link_type_check check (
    link_type in (
      'same_branch_period',
      'operational_chain',
      'shared_issue',
      'sales_to_reception',
      'reception_to_logbook',
      'logbook_to_audit',
      'cash_up_to_logbook',
      'logbook_to_reviews',
      'reviews_to_google_snapshot',
      'weekly_to_daily',
      'foodics_to_cash_up'
    )
  );

-- ── RLS ─────────────────────────────────────────────────────────────────────

alter table public.ask_nac_bulk_import_batches enable row level security;
alter table public.ask_nac_bulk_import_items enable row level security;
alter table public.ask_nac_drive_connections enable row level security;
alter table public.ask_nac_drive_sync_folders enable row level security;
alter table public.ask_nac_drive_sync_runs enable row level security;
alter table public.ask_nac_operational_timeline_events enable row level security;

drop policy if exists ask_nac_bulk_batches_select on public.ask_nac_bulk_import_batches;
create policy ask_nac_bulk_batches_select on public.ask_nac_bulk_import_batches
  for select to authenticated
  using (lower(uploader_email) = public.ask_nac_vault_auth_email() or public.ask_nac_vault_role() in ('ceo', 'super_admin'));

drop policy if exists ask_nac_bulk_batches_insert on public.ask_nac_bulk_import_batches;
create policy ask_nac_bulk_batches_insert on public.ask_nac_bulk_import_batches
  for insert to authenticated
  with check (
    public.ask_nac_vault_can_upload()
    and lower(uploader_email) = public.ask_nac_vault_auth_email()
  );

drop policy if exists ask_nac_bulk_batches_update on public.ask_nac_bulk_import_batches;
create policy ask_nac_bulk_batches_update on public.ask_nac_bulk_import_batches
  for update to authenticated
  using (lower(uploader_email) = public.ask_nac_vault_auth_email())
  with check (lower(uploader_email) = public.ask_nac_vault_auth_email());

drop policy if exists ask_nac_bulk_items_select on public.ask_nac_bulk_import_items;
create policy ask_nac_bulk_items_select on public.ask_nac_bulk_import_items
  for select to authenticated
  using (
    exists (
      select 1 from public.ask_nac_bulk_import_batches b
      where b.id = batch_id
        and (lower(b.uploader_email) = public.ask_nac_vault_auth_email() or public.ask_nac_vault_role() in ('ceo', 'super_admin'))
    )
  );

drop policy if exists ask_nac_bulk_items_insert on public.ask_nac_bulk_import_items;
create policy ask_nac_bulk_items_insert on public.ask_nac_bulk_import_items
  for insert to authenticated
  with check (
    public.ask_nac_vault_can_upload()
    and exists (
      select 1 from public.ask_nac_bulk_import_batches b
      where b.id = batch_id
        and lower(b.uploader_email) = public.ask_nac_vault_auth_email()
    )
  );

drop policy if exists ask_nac_bulk_items_update on public.ask_nac_bulk_import_items;
create policy ask_nac_bulk_items_update on public.ask_nac_bulk_import_items
  for update to authenticated
  using (
    exists (
      select 1 from public.ask_nac_bulk_import_batches b
      where b.id = batch_id
        and lower(b.uploader_email) = public.ask_nac_vault_auth_email()
    )
  );

-- OAuth tokens: revoke table-wide access, then grant safe columns only.
revoke all on public.ask_nac_drive_connections from authenticated;
revoke all on public.ask_nac_drive_connections from anon;
revoke all on public.ask_nac_drive_connections from public;

drop policy if exists ask_nac_drive_connections_select on public.ask_nac_drive_connections;

create or replace function public.ask_nac_drive_connection_owned(p_connection_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.ask_nac_drive_connections c
    where c.id = p_connection_id
      and lower(c.user_email) = public.ask_nac_vault_auth_email()
  );
$$;

grant execute on function public.ask_nac_drive_connection_owned(uuid) to authenticated;

grant select (
  id,
  user_email,
  google_account_email,
  status,
  connected_at,
  updated_at,
  last_error,
  token_expires_at,
  scopes
) on public.ask_nac_drive_connections to authenticated;

create policy ask_nac_drive_connections_select on public.ask_nac_drive_connections
  for select to authenticated
  using (lower(user_email) = public.ask_nac_vault_auth_email());

drop policy if exists ask_nac_drive_folders_select on public.ask_nac_drive_sync_folders;
create policy ask_nac_drive_folders_select on public.ask_nac_drive_sync_folders
  for select to authenticated
  using (public.ask_nac_drive_connection_owned(connection_id));

drop policy if exists ask_nac_drive_folders_insert on public.ask_nac_drive_sync_folders;
create policy ask_nac_drive_folders_insert on public.ask_nac_drive_sync_folders
  for insert to authenticated
  with check (public.ask_nac_drive_connection_owned(connection_id));

drop policy if exists ask_nac_drive_folders_update on public.ask_nac_drive_sync_folders;
create policy ask_nac_drive_folders_update on public.ask_nac_drive_sync_folders
  for update to authenticated
  using (public.ask_nac_drive_connection_owned(connection_id))
  with check (public.ask_nac_drive_connection_owned(connection_id));

drop policy if exists ask_nac_drive_runs_select on public.ask_nac_drive_sync_runs;
create policy ask_nac_drive_runs_select on public.ask_nac_drive_sync_runs
  for select to authenticated
  using (
    exists (
      select 1
      from public.ask_nac_drive_sync_folders f
      where f.id = folder_id
        and public.ask_nac_drive_connection_owned(f.connection_id)
    )
  );

drop policy if exists ask_nac_timeline_select on public.ask_nac_operational_timeline_events;
create policy ask_nac_timeline_select on public.ask_nac_operational_timeline_events
  for select to authenticated
  using (
    public.ask_nac_vault_can_read_scope(branch_id, false, 'operations', 'internal')
  );

drop policy if exists ask_nac_timeline_insert on public.ask_nac_operational_timeline_events;
create policy ask_nac_timeline_insert on public.ask_nac_operational_timeline_events
  for insert to authenticated
  with check (
    public.ask_nac_vault_can_upload()
    and public.ask_nac_vault_can_read_scope(branch_id, false, 'operations', 'internal')
  );

grant select, insert, update on public.ask_nac_bulk_import_batches to authenticated;
grant select, insert, update on public.ask_nac_bulk_import_items to authenticated;
grant select, insert, update on public.ask_nac_drive_sync_folders to authenticated;
grant select on public.ask_nac_drive_sync_runs to authenticated;
grant select, insert on public.ask_nac_operational_timeline_events to authenticated;

-- Parser templates for new report types
insert into public.ask_nac_report_type_templates (code, label, default_department, default_data_layer, default_sensitivity, parser_version, active)
values
  ('weekly_sales_overview', 'Weekly Sales Overview', 'sales', 'operational', 'internal', 'vault-prototype-v3', true),
  ('pnl', 'P&L', 'sales', 'operational', 'finance', 'vault-prototype-v3', true)
on conflict (code) do update set
  parser_version = excluded.parser_version,
  active = excluded.active;
