-- =============================================================================
-- Ask NAC Data Vault + Brand Brain — P0 foundation (schema, RLS, seeds)
-- Safe to re-run (idempotent drops where noted).
-- Does NOT migrate Foodics. Does NOT change foodics_* tables.
--
-- Manual Supabase steps (see bottom comments):
--   • Enable pgvector extension if Brand Brain embeddings are desired later
--   • Verify storage bucket ask-nac-vault-originals after migration
-- =============================================================================

-- ── 0. Optional pgvector (Brand Brain embeddings later) ─────────────────────

do $$
begin
  create extension if not exists vector with schema extensions;
exception
  when others then
    raise notice 'pgvector extension not enabled — embedding column will be added later';
end $$;

-- ── 1. Enums via check constraints (extensible text codes) ───────────────────

-- ── 2. Role definitions ─────────────────────────────────────────────────────

create table if not exists public.ask_nac_roles (
  code text primary key,
  label text not null,
  priority int not null default 100,
  default_sensitivity_ceiling text not null default 'internal'
    check (default_sensitivity_ceiling in ('public', 'internal', 'management', 'finance', 'hr_restricted')),
  cross_branch boolean not null default false,
  can_upload boolean not null default false,
  capabilities jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.ask_nac_roles is
  'Canonical Ask NAC vault roles (server-side). Maps from menu_staff_scope / client RBAC where applicable.';

-- ── 3. Sensitivity policies (role × level) ───────────────────────────────────

create table if not exists public.ask_nac_sensitivity_policies (
  role_code text not null references public.ask_nac_roles (code) on delete cascade,
  sensitivity_level text not null
    check (sensitivity_level in ('public', 'internal', 'management', 'finance', 'hr_restricted')),
  allow_read boolean not null default false,
  allow_aggregate boolean not null default false,
  redact_fields text[] not null default '{}',
  primary key (role_code, sensitivity_level)
);

comment on table public.ask_nac_sensitivity_policies is
  'Per-role sensitivity access matrix for vault artifacts.';

-- ── 4. Staff + branch / department access ───────────────────────────────────

create table if not exists public.ask_nac_staff (
  email text primary key,
  vault_role text not null references public.ask_nac_roles (code),
  primary_branch_id text check (primary_branch_id is null or primary_branch_id in ('khobar', 'riyadh', 'jeddah')),
  menu_role_legacy text,
  updated_at timestamptz not null default now()
);

comment on table public.ask_nac_staff is
  'Maps Supabase Auth email → vault role. Seeded from menu_staff_scope; extend for ops_manager multi-branch.';

create table if not exists public.ask_nac_user_branch_access (
  email text not null,
  branch_id text not null check (branch_id in ('khobar', 'riyadh', 'jeddah')),
  access_level text not null default 'read' check (access_level in ('read', 'write', 'admin')),
  primary key (email, branch_id)
);

comment on table public.ask_nac_user_branch_access is
  'Explicit branch grants (ops_manager, cost_controller). NULL-all-branches roles skip this table.';

create table if not exists public.ask_nac_user_department_access (
  email text not null,
  department text not null,
  access_level text not null default 'read' check (access_level in ('read', 'write', 'admin')),
  max_sensitivity text not null default 'internal'
    check (max_sensitivity in ('public', 'internal', 'management', 'finance', 'hr_restricted')),
  primary key (email, department)
);

comment on table public.ask_nac_user_department_access is
  'Optional per-user department overrides. When absent, role defaults apply.';

create index if not exists idx_ask_nac_staff_role on public.ask_nac_staff (vault_role);
create index if not exists idx_ask_nac_branch_access_email on public.ask_nac_user_branch_access (email);
create index if not exists idx_ask_nac_dept_access_email on public.ask_nac_user_department_access (email);

-- ── 5. Report type templates (registry metadata) ────────────────────────────

create table if not exists public.ask_nac_report_type_templates (
  code text primary key,
  label text not null,
  default_department text,
  default_data_layer text not null default 'operational'
    check (default_data_layer in ('operational', 'brand_brain', 'mixed', 'unknown')),
  default_sensitivity text not null default 'internal'
    check (default_sensitivity in ('public', 'internal', 'management', 'finance', 'hr_restricted')),
  parser_version text,
  expected_columns jsonb not null default '[]'::jsonb,
  fact_keys jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ── 6. File registry ────────────────────────────────────────────────────────

create table if not exists public.ask_nac_files (
  id uuid primary key default gen_random_uuid(),
  title text,
  original_filename text not null,
  storage_bucket text not null default 'ask-nac-vault-originals',
  storage_path text,
  branch_scope_type text not null default 'single_branch'
    check (branch_scope_type in ('single_branch', 'multi_branch', 'brand_wide')),
  primary_branch_id text check (primary_branch_id is null or primary_branch_id in ('khobar', 'riyadh', 'jeddah')),
  brand_wide boolean not null default false,
  department text not null,
  report_type text not null,
  data_layer text not null default 'unknown'
    check (data_layer in ('operational', 'brand_brain', 'mixed', 'unknown')),
  period_start date,
  period_end date,
  period_label text,
  sensitivity_level text not null default 'internal'
    check (sensitivity_level in ('public', 'internal', 'management', 'finance', 'hr_restricted')),
  status text not null default 'active'
    check (status in ('active', 'archived', 'quarantined')),
  uploaded_by text,
  uploader_email text,
  classification_confidence numeric,
  parser_version text,
  content_hash text,
  legacy_foodics_batch_id uuid,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.ask_nac_files is
  'Logical vault document registry. Metadata only in P0/P1 — parsing pipeline not wired yet.';
comment on column public.ask_nac_files.legacy_foodics_batch_id is
  'Reserved for future Foodics migration — do not populate in P0/P1.';

create index if not exists idx_ask_nac_files_branch on public.ask_nac_files (primary_branch_id);
create index if not exists idx_ask_nac_files_department on public.ask_nac_files (department);
create index if not exists idx_ask_nac_files_report_type on public.ask_nac_files (report_type);
create index if not exists idx_ask_nac_files_period on public.ask_nac_files (period_start, period_end);
create index if not exists idx_ask_nac_files_sensitivity on public.ask_nac_files (sensitivity_level);
create index if not exists idx_ask_nac_files_created on public.ask_nac_files (created_at desc);
create index if not exists idx_ask_nac_files_status on public.ask_nac_files (status);

create table if not exists public.ask_nac_file_versions (
  id uuid primary key default gen_random_uuid(),
  file_id uuid not null references public.ask_nac_files (id) on delete cascade,
  version_no int not null default 1,
  storage_path text not null,
  size_bytes bigint,
  mime_type text,
  content_hash text,
  ingestion_job_id uuid,
  supersedes_version_id uuid references public.ask_nac_file_versions (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (file_id, version_no)
);

create index if not exists idx_ask_nac_file_versions_file on public.ask_nac_file_versions (file_id);

create table if not exists public.ask_nac_file_permissions (
  id uuid primary key default gen_random_uuid(),
  file_id uuid not null references public.ask_nac_files (id) on delete cascade,
  grant_type text not null check (grant_type in ('role', 'user', 'branch_role')),
  role_code text references public.ask_nac_roles (code) on delete cascade,
  user_email text,
  branch_id text check (branch_id is null or branch_id in ('khobar', 'riyadh', 'jeddah')),
  department text,
  min_sensitivity text check (min_sensitivity is null or min_sensitivity in ('public', 'internal', 'management', 'finance', 'hr_restricted')),
  can_read boolean not null default true,
  can_export boolean not null default false,
  can_reindex boolean not null default false,
  can_delete boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_ask_nac_file_permissions_file on public.ask_nac_file_permissions (file_id);

create table if not exists public.ask_nac_file_tags (
  file_id uuid not null references public.ask_nac_files (id) on delete cascade,
  tag text not null,
  primary key (file_id, tag)
);

-- ── 7. Ingestion jobs ───────────────────────────────────────────────────────

create table if not exists public.ask_nac_ingestion_jobs (
  id uuid primary key default gen_random_uuid(),
  file_id uuid not null references public.ask_nac_files (id) on delete cascade,
  file_version_id uuid references public.ask_nac_file_versions (id) on delete set null,
  status text not null default 'registered'
    check (status in ('registered', 'queued', 'processing', 'completed', 'failed', 'skipped')),
  stage text not null default 'registry_only',
  error text,
  stats jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_ask_nac_ingestion_jobs_file on public.ask_nac_ingestion_jobs (file_id);
create index if not exists idx_ask_nac_ingestion_jobs_status on public.ask_nac_ingestion_jobs (status);

-- ── 8. Data coverage ────────────────────────────────────────────────────────

create table if not exists public.ask_nac_data_coverage (
  id uuid primary key default gen_random_uuid(),
  branch_id text check (branch_id is null or branch_id in ('khobar', 'riyadh', 'jeddah')),
  brand_wide boolean not null default false,
  department text not null,
  report_type text not null,
  period_start date,
  period_end date,
  source_file_id uuid references public.ask_nac_files (id) on delete set null,
  fact_count int not null default 0,
  last_ingested_at timestamptz,
  readiness_status text not null default 'registered'
    check (readiness_status in ('registered', 'partial', 'ready', 'stale')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_ask_nac_coverage_branch_report_period
  on public.ask_nac_data_coverage (branch_id, report_type, period_start desc, period_end desc);
create index if not exists idx_ask_nac_coverage_department on public.ask_nac_data_coverage (department);
create index if not exists idx_ask_nac_coverage_sensitivity_ready
  on public.ask_nac_data_coverage (readiness_status, report_type);
create index if not exists idx_ask_nac_coverage_source_file on public.ask_nac_data_coverage (source_file_id);

-- ── 9. Structured facts + rollups ───────────────────────────────────────────

create table if not exists public.ask_nac_structured_facts (
  id uuid primary key default gen_random_uuid(),
  file_id uuid references public.ask_nac_files (id) on delete set null,
  file_version_id uuid references public.ask_nac_file_versions (id) on delete set null,
  branch_id text check (branch_id is null or branch_id in ('khobar', 'riyadh', 'jeddah')),
  brand_wide boolean not null default false,
  department text not null,
  report_type text not null,
  sensitivity_level text not null default 'internal'
    check (sensitivity_level in ('public', 'internal', 'management', 'finance', 'hr_restricted')),
  metric_key text not null,
  metric_value numeric,
  metric_unit text,
  dimensions jsonb not null default '{}'::jsonb,
  period_start date,
  period_end date,
  grain text not null default 'line'
    check (grain in ('line', 'daily', 'monthly', 'snapshot')),
  source_row_ref text,
  confidence numeric,
  created_by text,
  archived_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_ask_nac_facts_branch_report_period
  on public.ask_nac_structured_facts (branch_id, report_type, period_start, period_end);
create index if not exists idx_ask_nac_facts_department on public.ask_nac_structured_facts (department);
create index if not exists idx_ask_nac_facts_sensitivity on public.ask_nac_structured_facts (sensitivity_level);
create index if not exists idx_ask_nac_facts_source_file on public.ask_nac_structured_facts (file_id);
create index if not exists idx_ask_nac_facts_metric on public.ask_nac_structured_facts (metric_key, report_type);

create table if not exists public.ask_nac_daily_facts (
  id uuid primary key default gen_random_uuid(),
  file_id uuid references public.ask_nac_files (id) on delete set null,
  branch_id text check (branch_id is null or branch_id in ('khobar', 'riyadh', 'jeddah')),
  brand_wide boolean not null default false,
  department text not null,
  report_type text not null,
  sensitivity_level text not null default 'internal'
    check (sensitivity_level in ('public', 'internal', 'management', 'finance', 'hr_restricted')),
  metric_key text not null,
  sum_value numeric,
  count_value bigint not null default 0,
  dimensions jsonb not null default '{}'::jsonb,
  period_start date not null,
  period_end date not null,
  source_file_id uuid references public.ask_nac_files (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_ask_nac_daily_branch_report_period
  on public.ask_nac_daily_facts (branch_id, report_type, period_start, period_end);
create index if not exists idx_ask_nac_daily_department on public.ask_nac_daily_facts (department);
create index if not exists idx_ask_nac_daily_sensitivity on public.ask_nac_daily_facts (sensitivity_level);
create index if not exists idx_ask_nac_daily_source_file on public.ask_nac_daily_facts (source_file_id);

create table if not exists public.ask_nac_monthly_facts (
  id uuid primary key default gen_random_uuid(),
  file_id uuid references public.ask_nac_files (id) on delete set null,
  branch_id text check (branch_id is null or branch_id in ('khobar', 'riyadh', 'jeddah')),
  brand_wide boolean not null default false,
  department text not null,
  report_type text not null,
  sensitivity_level text not null default 'internal'
    check (sensitivity_level in ('public', 'internal', 'management', 'finance', 'hr_restricted')),
  metric_key text not null,
  sum_value numeric,
  count_value bigint not null default 0,
  dimensions jsonb not null default '{}'::jsonb,
  period_start date not null,
  period_end date not null,
  source_file_id uuid references public.ask_nac_files (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_ask_nac_monthly_branch_report_period
  on public.ask_nac_monthly_facts (branch_id, report_type, period_start, period_end);
create index if not exists idx_ask_nac_monthly_department on public.ask_nac_monthly_facts (department);
create index if not exists idx_ask_nac_monthly_sensitivity on public.ask_nac_monthly_facts (sensitivity_level);
create index if not exists idx_ask_nac_monthly_source_file on public.ask_nac_monthly_facts (source_file_id);

-- ── 10. Document intelligence (Brand Brain) ─────────────────────────────────

create table if not exists public.ask_nac_brand_brain_topics (
  code text primary key,
  label text not null,
  parent_code text references public.ask_nac_brand_brain_topics (code) on delete set null,
  default_department text,
  keywords text[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.ask_nac_document_summaries (
  id uuid primary key default gen_random_uuid(),
  file_id uuid not null references public.ask_nac_files (id) on delete cascade,
  section_key text,
  summary text not null,
  branch_id text check (branch_id is null or branch_id in ('khobar', 'riyadh', 'jeddah')),
  brand_wide boolean not null default false,
  department text,
  sensitivity_level text not null default 'internal'
    check (sensitivity_level in ('public', 'internal', 'management', 'finance', 'hr_restricted')),
  topic_codes text[] not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists idx_ask_nac_summaries_file on public.ask_nac_document_summaries (file_id);
create index if not exists idx_ask_nac_summaries_branch_dept on public.ask_nac_document_summaries (branch_id, department);

create table if not exists public.ask_nac_document_chunks (
  id uuid primary key default gen_random_uuid(),
  file_id uuid not null references public.ask_nac_files (id) on delete cascade,
  chunk_index int not null,
  content text not null,
  token_count int,
  branch_id text check (branch_id is null or branch_id in ('khobar', 'riyadh', 'jeddah')),
  brand_wide boolean not null default false,
  department text,
  sensitivity_level text not null default 'internal'
    check (sensitivity_level in ('public', 'internal', 'management', 'finance', 'hr_restricted')),
  topic_codes text[] not null default '{}',
  source_page int,
  heading_path text,
  embedding_placeholder text,
  created_at timestamptz not null default now(),
  unique (file_id, chunk_index)
);

comment on column public.ask_nac_document_chunks.embedding_placeholder is
  'Placeholder until pgvector embedding column is added. Run ask_nac_vault_upgrade_embeddings() when vector ext is enabled.';

create index if not exists idx_ask_nac_chunks_file on public.ask_nac_document_chunks (file_id);
create index if not exists idx_ask_nac_chunks_branch_dept on public.ask_nac_document_chunks (branch_id, department);
create index if not exists idx_ask_nac_chunks_sensitivity on public.ask_nac_document_chunks (sensitivity_level);

-- Add pgvector embedding column when extension exists
do $$
begin
  if exists (select 1 from pg_extension where extname = 'vector') then
    execute $sql$
      alter table public.ask_nac_document_chunks
        add column if not exists embedding extensions.vector(1536)
    $sql$;
    comment on column public.ask_nac_document_chunks.embedding is
      'Brand Brain semantic index (1536-d). Filter by branch/department/sensitivity before vector search.';
  end if;
exception
  when others then
    raise notice 'ask_nac_document_chunks.embedding skipped: %', sqlerrm;
end $$;

create table if not exists public.ask_nac_file_field_mappings (
  id uuid primary key default gen_random_uuid(),
  report_type text not null,
  source_column text not null,
  target_field text not null,
  transform text,
  confidence numeric,
  file_id uuid references public.ask_nac_files (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_ask_nac_field_mappings_report on public.ask_nac_file_field_mappings (report_type);

-- ── 11. Audit ───────────────────────────────────────────────────────────────

create table if not exists public.ask_nac_query_log (
  id uuid primary key default gen_random_uuid(),
  user_email text,
  question text,
  intent text,
  sources_used text[] not null default '{}',
  branches_requested text[] not null default '{}',
  branches_served text[] not null default '{}',
  denied_scopes jsonb not null default '[]'::jsonb,
  facts_retrieved int not null default 0,
  chunks_retrieved int not null default 0,
  latency_ms int,
  created_at timestamptz not null default now()
);

create index if not exists idx_ask_nac_query_log_user on public.ask_nac_query_log (user_email, created_at desc);

create table if not exists public.ask_nac_file_access_log (
  id uuid primary key default gen_random_uuid(),
  file_id uuid references public.ask_nac_files (id) on delete set null,
  user_email text,
  action text not null check (action in ('read', 'download', 'export', 'reindex', 'delete', 'upload')),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_ask_nac_file_access_log_file on public.ask_nac_file_access_log (file_id, created_at desc);
create index if not exists idx_ask_nac_file_access_log_user on public.ask_nac_file_access_log (user_email, created_at desc);

-- ── 12. RLS helper functions ────────────────────────────────────────────────

create or replace function public.ask_nac_vault_auth_email()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select lower(trim(coalesce(auth.jwt() ->> 'email', '')));
$$;

create or replace function public.ask_nac_vault_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select s.vault_role from public.ask_nac_staff s where lower(s.email) = public.ask_nac_vault_auth_email()),
    'staff'
  );
$$;

create or replace function public.ask_nac_vault_sensitivity_rank(p_level text)
returns int
language sql
immutable
as $$
  select case lower(trim(coalesce(p_level, '')))
    when 'public' then 1
    when 'internal' then 2
    when 'management' then 3
    when 'finance' then 4
    when 'hr_restricted' then 5
    else 0
  end;
$$;

create or replace function public.ask_nac_vault_sensitivity_ceiling()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(r.default_sensitivity_ceiling, 'public')
  from public.ask_nac_roles r
  where r.code = public.ask_nac_vault_role();
$$;

create or replace function public.ask_nac_vault_can_read_sensitivity(p_level text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.ask_nac_vault_sensitivity_rank(p_level)
      <= public.ask_nac_vault_sensitivity_rank(public.ask_nac_vault_sensitivity_ceiling())
     and coalesce(
       (select sp.allow_read
        from public.ask_nac_sensitivity_policies sp
        where sp.role_code = public.ask_nac_vault_role()
          and sp.sensitivity_level = lower(trim(p_level))),
       false
     );
$$;

create or replace function public.ask_nac_vault_has_all_branches()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select r.cross_branch from public.ask_nac_roles r where r.code = public.ask_nac_vault_role()),
    false
  );
$$;

create or replace function public.ask_nac_vault_branch_allowed(p_branch text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.ask_nac_vault_has_all_branches() then true
    when p_branch is null and public.ask_nac_vault_role() in ('ceo', 'super_admin') then true
    when lower(trim(coalesce(p_branch, ''))) = 'brand'
      and public.ask_nac_vault_role() in ('ceo', 'super_admin', 'marketing') then true
    when public.nac_normalize_branch_id(p_branch) is null then false
    when exists (
      select 1
      from public.ask_nac_user_branch_access ba
      where lower(ba.email) = public.ask_nac_vault_auth_email()
        and ba.branch_id = public.nac_normalize_branch_id(p_branch)
    ) then true
    when public.nac_normalize_branch_id(p_branch) = (
      select s.primary_branch_id from public.ask_nac_staff s
      where lower(s.email) = public.ask_nac_vault_auth_email()
    ) then true
    else false
  end;
$$;

create or replace function public.ask_nac_vault_role_default_departments(p_role text)
returns text[]
language sql
immutable
as $$
  select case lower(trim(p_role))
    when 'ceo' then array['admin','operations','sales','reception','cost_control','purchasing','inventory','hr','marketing','design','foh','kitchen','brand']
    when 'super_admin' then array['admin','operations','sales','reception','cost_control','purchasing','inventory','hr','marketing','design','foh','kitchen','brand']
    when 'ops_manager' then array['operations','sales','reception','inventory','foh','kitchen','admin']
    when 'branch_manager' then array['operations','sales','reception','foh','kitchen','admin']
    when 'reception_manager' then array['reception','sales']
    when 'cost_controller' then array['cost_control','purchasing','inventory','ffe']
    when 'marketing' then array['marketing','design','brand']
    when 'hr' then array['hr']
    when 'staff' then array['brand','operations']
    else array['brand']
  end;
$$;

create or replace function public.ask_nac_vault_department_allowed(p_department text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_department is null then false
    when exists (
      select 1 from public.ask_nac_user_department_access da
      where lower(da.email) = public.ask_nac_vault_auth_email()
        and da.department = lower(trim(p_department))
    ) then true
    when lower(trim(p_department)) = any (
      public.ask_nac_vault_role_default_departments(public.ask_nac_vault_role())
    ) then true
    else false
  end;
$$;

create or replace function public.ask_nac_vault_can_read_scope(
  p_branch_id text,
  p_brand_wide boolean,
  p_department text,
  p_sensitivity text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.ask_nac_vault_can_read_sensitivity(p_sensitivity)
     and public.ask_nac_vault_department_allowed(p_department)
     and (
       coalesce(p_brand_wide, false) = true
       or public.ask_nac_vault_branch_allowed(p_branch_id)
     );
$$;

create or replace function public.ask_nac_vault_can_upload()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select r.can_upload from public.ask_nac_roles r where r.code = public.ask_nac_vault_role()),
    false
  );
$$;

create or replace function public.ask_nac_vault_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.ask_nac_vault_role() in ('ceo', 'super_admin');
$$;

create or replace function public.ask_nac_vault_can_read_file(p_file_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.ask_nac_files f
    where f.id = p_file_id
      and f.status = 'active'
      and public.ask_nac_vault_can_read_scope(
        f.primary_branch_id,
        f.brand_wide,
        f.department,
        f.sensitivity_level
      )
  );
$$;

grant execute on function public.ask_nac_vault_auth_email() to authenticated;
grant execute on function public.ask_nac_vault_role() to authenticated;
grant execute on function public.ask_nac_vault_sensitivity_rank(text) to authenticated;
grant execute on function public.ask_nac_vault_sensitivity_ceiling() to authenticated;
grant execute on function public.ask_nac_vault_can_read_sensitivity(text) to authenticated;
grant execute on function public.ask_nac_vault_has_all_branches() to authenticated;
grant execute on function public.ask_nac_vault_branch_allowed(text) to authenticated;
grant execute on function public.ask_nac_vault_department_allowed(text) to authenticated;
grant execute on function public.ask_nac_vault_can_read_scope(text, boolean, text, text) to authenticated;
grant execute on function public.ask_nac_vault_can_upload() to authenticated;
grant execute on function public.ask_nac_vault_is_admin() to authenticated;
grant execute on function public.ask_nac_vault_can_read_file(uuid) to authenticated;

-- ── 13. Enable RLS ──────────────────────────────────────────────────────────

alter table public.ask_nac_roles enable row level security;
alter table public.ask_nac_sensitivity_policies enable row level security;
alter table public.ask_nac_staff enable row level security;
alter table public.ask_nac_user_branch_access enable row level security;
alter table public.ask_nac_user_department_access enable row level security;
alter table public.ask_nac_report_type_templates enable row level security;
alter table public.ask_nac_files enable row level security;
alter table public.ask_nac_file_versions enable row level security;
alter table public.ask_nac_file_permissions enable row level security;
alter table public.ask_nac_file_tags enable row level security;
alter table public.ask_nac_ingestion_jobs enable row level security;
alter table public.ask_nac_data_coverage enable row level security;
alter table public.ask_nac_structured_facts enable row level security;
alter table public.ask_nac_daily_facts enable row level security;
alter table public.ask_nac_monthly_facts enable row level security;
alter table public.ask_nac_brand_brain_topics enable row level security;
alter table public.ask_nac_document_summaries enable row level security;
alter table public.ask_nac_document_chunks enable row level security;
alter table public.ask_nac_file_field_mappings enable row level security;
alter table public.ask_nac_query_log enable row level security;
alter table public.ask_nac_file_access_log enable row level security;

-- Reference tables: read for authenticated
drop policy if exists ask_nac_roles_read on public.ask_nac_roles;
create policy ask_nac_roles_read on public.ask_nac_roles for select to authenticated using (true);

drop policy if exists ask_nac_sensitivity_read on public.ask_nac_sensitivity_policies;
create policy ask_nac_sensitivity_read on public.ask_nac_sensitivity_policies for select to authenticated using (true);

drop policy if exists ask_nac_templates_read on public.ask_nac_report_type_templates;
create policy ask_nac_templates_read on public.ask_nac_report_type_templates for select to authenticated using (true);

drop policy if exists ask_nac_topics_read on public.ask_nac_brand_brain_topics;
create policy ask_nac_topics_read on public.ask_nac_brand_brain_topics for select to authenticated using (true);

-- Staff scope: own row or admin
drop policy if exists ask_nac_staff_read on public.ask_nac_staff;
create policy ask_nac_staff_read on public.ask_nac_staff
  for select to authenticated
  using (lower(email) = public.ask_nac_vault_auth_email() or public.ask_nac_vault_is_admin());

drop policy if exists ask_nac_branch_access_read on public.ask_nac_user_branch_access;
create policy ask_nac_branch_access_read on public.ask_nac_user_branch_access
  for select to authenticated
  using (lower(email) = public.ask_nac_vault_auth_email() or public.ask_nac_vault_is_admin());

drop policy if exists ask_nac_dept_access_read on public.ask_nac_user_department_access;
create policy ask_nac_dept_access_read on public.ask_nac_user_department_access
  for select to authenticated
  using (lower(email) = public.ask_nac_vault_auth_email() or public.ask_nac_vault_is_admin());

-- Files
drop policy if exists ask_nac_files_select on public.ask_nac_files;
create policy ask_nac_files_select on public.ask_nac_files
  for select to authenticated
  using (public.ask_nac_vault_can_read_file(id));

drop policy if exists ask_nac_files_insert on public.ask_nac_files;
create policy ask_nac_files_insert on public.ask_nac_files
  for insert to authenticated
  with check (
    public.ask_nac_vault_can_upload()
    and public.ask_nac_vault_can_read_scope(
      primary_branch_id,
      brand_wide,
      department,
      sensitivity_level
    )
    and lower(coalesce(uploader_email, '')) = public.ask_nac_vault_auth_email()
  );

drop policy if exists ask_nac_files_update on public.ask_nac_files;
create policy ask_nac_files_update on public.ask_nac_files
  for update to authenticated
  using (public.ask_nac_vault_can_read_file(id) and public.ask_nac_vault_can_upload())
  with check (public.ask_nac_vault_can_read_scope(primary_branch_id, brand_wide, department, sensitivity_level));

-- File versions (inherit file access)
drop policy if exists ask_nac_file_versions_select on public.ask_nac_file_versions;
create policy ask_nac_file_versions_select on public.ask_nac_file_versions
  for select to authenticated
  using (public.ask_nac_vault_can_read_file(file_id));

drop policy if exists ask_nac_file_versions_insert on public.ask_nac_file_versions;
create policy ask_nac_file_versions_insert on public.ask_nac_file_versions
  for insert to authenticated
  with check (
    public.ask_nac_vault_can_upload()
    and public.ask_nac_vault_can_read_file(file_id)
  );

-- Permissions / tags: readable if file readable; write admin only
drop policy if exists ask_nac_file_permissions_select on public.ask_nac_file_permissions;
create policy ask_nac_file_permissions_select on public.ask_nac_file_permissions
  for select to authenticated
  using (public.ask_nac_vault_can_read_file(file_id));

drop policy if exists ask_nac_file_tags_select on public.ask_nac_file_tags;
create policy ask_nac_file_tags_select on public.ask_nac_file_tags
  for select to authenticated
  using (public.ask_nac_vault_can_read_file(file_id));

-- Ingestion jobs
drop policy if exists ask_nac_ingestion_select on public.ask_nac_ingestion_jobs;
create policy ask_nac_ingestion_select on public.ask_nac_ingestion_jobs
  for select to authenticated
  using (public.ask_nac_vault_can_read_file(file_id));

drop policy if exists ask_nac_ingestion_insert on public.ask_nac_ingestion_jobs;
create policy ask_nac_ingestion_insert on public.ask_nac_ingestion_jobs
  for insert to authenticated
  with check (public.ask_nac_vault_can_upload() and public.ask_nac_vault_can_read_file(file_id));

-- Coverage + facts + chunks + summaries: scope-based read
drop policy if exists ask_nac_coverage_insert on public.ask_nac_data_coverage;
create policy ask_nac_coverage_insert on public.ask_nac_data_coverage
  for insert to authenticated
  with check (
    public.ask_nac_vault_can_upload()
    and source_file_id is not null
    and public.ask_nac_vault_can_read_file(source_file_id)
  );

drop policy if exists ask_nac_coverage_select on public.ask_nac_data_coverage;
create policy ask_nac_coverage_select on public.ask_nac_data_coverage
  for select to authenticated
  using (public.ask_nac_vault_can_read_scope(branch_id, brand_wide, department, 'internal'));

drop policy if exists ask_nac_facts_select on public.ask_nac_structured_facts;
create policy ask_nac_facts_select on public.ask_nac_structured_facts
  for select to authenticated
  using (public.ask_nac_vault_can_read_scope(branch_id, brand_wide, department, sensitivity_level));

drop policy if exists ask_nac_daily_select on public.ask_nac_daily_facts;
create policy ask_nac_daily_select on public.ask_nac_daily_facts
  for select to authenticated
  using (public.ask_nac_vault_can_read_scope(branch_id, brand_wide, department, sensitivity_level));

drop policy if exists ask_nac_monthly_select on public.ask_nac_monthly_facts;
create policy ask_nac_monthly_select on public.ask_nac_monthly_facts
  for select to authenticated
  using (public.ask_nac_vault_can_read_scope(branch_id, brand_wide, department, sensitivity_level));

drop policy if exists ask_nac_summaries_select on public.ask_nac_document_summaries;
create policy ask_nac_summaries_select on public.ask_nac_document_summaries
  for select to authenticated
  using (public.ask_nac_vault_can_read_scope(branch_id, brand_wide, department, sensitivity_level));

drop policy if exists ask_nac_chunks_select on public.ask_nac_document_chunks;
create policy ask_nac_chunks_select on public.ask_nac_document_chunks
  for select to authenticated
  using (public.ask_nac_vault_can_read_scope(branch_id, brand_wide, department, sensitivity_level));

drop policy if exists ask_nac_field_mappings_select on public.ask_nac_file_field_mappings;
create policy ask_nac_field_mappings_select on public.ask_nac_file_field_mappings
  for select to authenticated
  using (public.ask_nac_vault_is_admin());

-- Audit
drop policy if exists ask_nac_query_log_insert on public.ask_nac_query_log;
create policy ask_nac_query_log_insert on public.ask_nac_query_log
  for insert to authenticated
  with check (lower(coalesce(user_email, '')) = public.ask_nac_vault_auth_email());

drop policy if exists ask_nac_query_log_select on public.ask_nac_query_log;
create policy ask_nac_query_log_select on public.ask_nac_query_log
  for select to authenticated
  using (lower(coalesce(user_email, '')) = public.ask_nac_vault_auth_email() or public.ask_nac_vault_is_admin());

drop policy if exists ask_nac_file_access_log_insert on public.ask_nac_file_access_log;
create policy ask_nac_file_access_log_insert on public.ask_nac_file_access_log
  for insert to authenticated
  with check (lower(coalesce(user_email, '')) = public.ask_nac_vault_auth_email());

drop policy if exists ask_nac_file_access_log_select on public.ask_nac_file_access_log;
create policy ask_nac_file_access_log_select on public.ask_nac_file_access_log
  for select to authenticated
  using (lower(coalesce(user_email, '')) = public.ask_nac_vault_auth_email() or public.ask_nac_vault_is_admin());

-- Grants
grant select on public.ask_nac_roles to authenticated;
grant select on public.ask_nac_sensitivity_policies to authenticated;
grant select on public.ask_nac_staff to authenticated;
grant select on public.ask_nac_user_branch_access to authenticated;
grant select on public.ask_nac_user_department_access to authenticated;
grant select on public.ask_nac_report_type_templates to authenticated;
grant select, insert, update on public.ask_nac_files to authenticated;
grant select, insert on public.ask_nac_file_versions to authenticated;
grant select on public.ask_nac_file_permissions to authenticated;
grant select on public.ask_nac_file_tags to authenticated;
grant select, insert on public.ask_nac_ingestion_jobs to authenticated;
grant select, insert on public.ask_nac_data_coverage to authenticated;
grant select on public.ask_nac_structured_facts to authenticated;
grant select on public.ask_nac_daily_facts to authenticated;
grant select on public.ask_nac_monthly_facts to authenticated;
grant select on public.ask_nac_brand_brain_topics to authenticated;
grant select on public.ask_nac_document_summaries to authenticated;
grant select on public.ask_nac_document_chunks to authenticated;
grant select on public.ask_nac_file_field_mappings to authenticated;
grant select, insert on public.ask_nac_query_log to authenticated;
grant select, insert on public.ask_nac_file_access_log to authenticated;

-- ── 14. Seed roles ──────────────────────────────────────────────────────────

insert into public.ask_nac_roles (code, label, priority, default_sensitivity_ceiling, cross_branch, can_upload, capabilities) values
  ('super_admin', 'Super Admin', 10, 'hr_restricted', true, true, '{"all_branches":true}'::jsonb),
  ('ceo', 'CEO', 20, 'hr_restricted', true, true, '{"all_branches":true}'::jsonb),
  ('ops_manager', 'Operations Manager', 30, 'finance', true, true, '{"assigned_branches":true}'::jsonb),
  ('branch_manager', 'Branch Manager', 40, 'management', false, true, '{"single_branch":true}'::jsonb),
  ('reception_manager', 'Reception Manager', 50, 'internal', false, true, '{"single_branch":true}'::jsonb),
  ('cost_controller', 'Cost Controller', 50, 'finance', false, true, '{"cost_departments":true}'::jsonb),
  ('marketing', 'Marketing', 60, 'internal', false, true, '{"marketing_departments":true}'::jsonb),
  ('hr', 'Human Resources', 50, 'hr_restricted', false, true, '{"hr_only":true}'::jsonb),
  ('staff', 'Staff', 90, 'public', false, false, '{"limited":true}'::jsonb)
on conflict (code) do update set
  label = excluded.label,
  priority = excluded.priority,
  default_sensitivity_ceiling = excluded.default_sensitivity_ceiling,
  cross_branch = excluded.cross_branch,
  can_upload = excluded.can_upload,
  capabilities = excluded.capabilities;

-- Sensitivity matrix seeds
insert into public.ask_nac_sensitivity_policies (role_code, sensitivity_level, allow_read, allow_aggregate) values
  ('super_admin', 'public', true, true),
  ('super_admin', 'internal', true, true),
  ('super_admin', 'management', true, true),
  ('super_admin', 'finance', true, true),
  ('super_admin', 'hr_restricted', true, true),
  ('ceo', 'public', true, true),
  ('ceo', 'internal', true, true),
  ('ceo', 'management', true, true),
  ('ceo', 'finance', true, true),
  ('ceo', 'hr_restricted', true, false),
  ('ops_manager', 'public', true, true),
  ('ops_manager', 'internal', true, true),
  ('ops_manager', 'management', true, true),
  ('ops_manager', 'finance', true, true),
  ('ops_manager', 'hr_restricted', false, false),
  ('branch_manager', 'public', true, true),
  ('branch_manager', 'internal', true, true),
  ('branch_manager', 'management', true, true),
  ('branch_manager', 'finance', false, false),
  ('branch_manager', 'hr_restricted', false, false),
  ('reception_manager', 'public', true, true),
  ('reception_manager', 'internal', true, true),
  ('reception_manager', 'management', false, false),
  ('reception_manager', 'finance', false, false),
  ('reception_manager', 'hr_restricted', false, false),
  ('cost_controller', 'public', true, true),
  ('cost_controller', 'internal', true, true),
  ('cost_controller', 'management', true, true),
  ('cost_controller', 'finance', true, true),
  ('cost_controller', 'hr_restricted', false, false),
  ('marketing', 'public', true, true),
  ('marketing', 'internal', true, true),
  ('marketing', 'management', false, false),
  ('marketing', 'finance', false, false),
  ('marketing', 'hr_restricted', false, false),
  ('hr', 'public', true, true),
  ('hr', 'internal', true, true),
  ('hr', 'management', true, false),
  ('hr', 'finance', false, false),
  ('hr', 'hr_restricted', true, false),
  ('staff', 'public', true, true),
  ('staff', 'internal', false, false),
  ('staff', 'management', false, false),
  ('staff', 'finance', false, false),
  ('staff', 'hr_restricted', false, false)
on conflict (role_code, sensitivity_level) do update set
  allow_read = excluded.allow_read,
  allow_aggregate = excluded.allow_aggregate;

-- Map existing menu_staff_scope users → vault roles (reuse emails, do not duplicate menu table)
insert into public.ask_nac_staff (email, vault_role, primary_branch_id, menu_role_legacy) values
  ('raffi@nac.com', 'super_admin', null, 'developer'),
  ('raffiazarian@gmail.com', 'super_admin', null, 'developer'),
  ('raffi@nac-khobar.com', 'super_admin', null, 'developer'),
  ('ahmad@nac.com', 'ceo', null, 'ceo'),
  ('ahmad@nac-khobar.com', 'ceo', null, 'ceo'),
  ('fady@nac.com', 'branch_manager', 'khobar', 'branch_gm'),
  ('fady@nac-khobar.com', 'branch_manager', 'khobar', 'branch_gm'),
  ('armel@nac.com', 'branch_manager', 'riyadh', 'branch_gm'),
  ('armel@nac-riyadh.com', 'branch_manager', 'riyadh', 'branch_gm'),
  ('usama@nac.com', 'branch_manager', 'jeddah', 'branch_gm'),
  ('usama@nac-jeddah.com', 'branch_manager', 'jeddah', 'branch_gm')
on conflict (email) do update set
  vault_role = excluded.vault_role,
  primary_branch_id = excluded.primary_branch_id,
  menu_role_legacy = excluded.menu_role_legacy,
  updated_at = now();

-- Report type templates (first types — parsers not wired)
insert into public.ask_nac_report_type_templates (code, label, default_department, default_data_layer, default_sensitivity, parser_version) values
  ('cash_up', 'Cash Up', 'admin', 'operational', 'management', null),
  ('reception_daily_report', 'Reception Daily Report', 'reception', 'operational', 'internal', null),
  ('daily_logbook', 'Daily Logbook', 'operations', 'operational', 'internal', null),
  ('brand_brain_sop', 'Brand Brain SOP', 'brand', 'brand_brain', 'internal', null)
on conflict (code) do update set
  label = excluded.label,
  default_department = excluded.default_department,
  default_data_layer = excluded.default_data_layer,
  default_sensitivity = excluded.default_sensitivity;

-- Brand Brain topic seeds (minimal taxonomy)
insert into public.ask_nac_brand_brain_topics (code, label, parent_code, default_department, keywords) values
  ('brand', 'Brand Standards', null, 'brand', array['brand','standards']),
  ('brand.service', 'Service Standards', 'brand', 'foh', array['service','sop']),
  ('brand.service.complaints', 'Complaint Handling', 'brand.service', 'reception', array['complaint','waiting']),
  ('brand.reception', 'Reception', 'brand', 'reception', array['reservation','covers']),
  ('brand.hr', 'HR Policies', 'brand', 'hr', array['hr','policy'])
on conflict (code) do update set
  label = excluded.label,
  parent_code = excluded.parent_code,
  default_department = excluded.default_department,
  keywords = excluded.keywords;

-- ── 15. Storage bucket (private vault originals) ───────────────────────────

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'ask-nac-vault-originals',
  'ask-nac-vault-originals',
  false,
  104857600,
  null
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit;

-- Storage RLS: path prefix = branch_id / department / file_id / filename
drop policy if exists ask_nac_vault_storage_select on storage.objects;
create policy ask_nac_vault_storage_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'ask-nac-vault-originals'
    and public.ask_nac_vault_branch_allowed(split_part(name, '/', 1))
  );

drop policy if exists ask_nac_vault_storage_insert on storage.objects;
create policy ask_nac_vault_storage_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'ask-nac-vault-originals'
    and public.ask_nac_vault_can_upload()
    and public.ask_nac_vault_branch_allowed(split_part(name, '/', 1))
  );

drop policy if exists ask_nac_vault_storage_update on storage.objects;
create policy ask_nac_vault_storage_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'ask-nac-vault-originals'
    and public.ask_nac_vault_can_upload()
    and public.ask_nac_vault_branch_allowed(split_part(name, '/', 1))
  )
  with check (bucket_id = 'ask-nac-vault-originals');

-- ── 16. Comments / manual steps ─────────────────────────────────────────────

comment on schema public is
  'Ask NAC vault P0 applied. Manual: supabase db push; enable pgvector in Dashboard if embedding column missing; verify storage bucket policies.';

-- MANUAL SUPABASE STEPS:
-- 1. Run: supabase db push  (or paste this file in SQL Editor)
-- 2. Dashboard → Database → Extensions → enable "vector" for Brand Brain embeddings
-- 3. Dashboard → Storage → confirm bucket ask-nac-vault-originals (private, 100MB limit)
-- 4. Add ops_manager / hr / marketing staff to ask_nac_staff + ask_nac_user_branch_access as needed
-- 5. Foodics tables unchanged — migration to vault is a future phase
