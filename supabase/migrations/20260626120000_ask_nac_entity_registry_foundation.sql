-- Entity Registry v0 — durable business-object layer for NAC Brain.
-- Additive foundation only. Documents remain evidence; entities become memory.

-- ── 1. Core entity registry ─────────────────────────────────────────────────

create table if not exists public.ask_nac_entities (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in (
    'document', 'branch', 'procedure', 'policy', 'standard', 'checklist'
  )),
  canonical_key text not null,
  display_name text not null,
  slug text,
  scope text not null default 'brand',
  branch_id text check (branch_id is null or branch_id in ('khobar', 'riyadh', 'jeddah')),
  brand_wide boolean not null default false,
  department text,
  sensitivity_level text not null default 'internal'
    check (sensitivity_level in ('public', 'internal', 'management', 'finance', 'hr_restricted')),
  authority_level text check (authority_level is null or authority_level in (
    'corporate_manual', 'signed_policy', 'job_description', 'branch_sop',
    'uploaded_report', 'manager_memory', 'operator_memory', 'inferred'
  )),
  status text not null default 'active'
    check (status in ('active', 'archived', 'superseded')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_ask_nac_entities_canonical_key
  on public.ask_nac_entities (canonical_key);

create index if not exists idx_ask_nac_entities_type_branch_active
  on public.ask_nac_entities (entity_type, branch_id)
  where status = 'active';

create index if not exists idx_ask_nac_entities_scope_type
  on public.ask_nac_entities (scope, entity_type)
  where status = 'active';

comment on table public.ask_nac_entities is
  'NAC Brain entity registry v0. Canonical keys: document:{file_id}, branch:{branch_id}, {type}:{scope}:{slug}.';

comment on column public.ask_nac_entities.canonical_key is
  'Stable identity key. document:{file_id}, branch:{branch_id}, procedure|policy|standard|checklist:{scope}:{slug}.';

comment on column public.ask_nac_entities.scope is
  'brand | khobar | riyadh | jeddah — logical scope for procedure/policy/standard/checklist entities.';

-- ── 2. Entity provenance ──────────────────────────────────────────────────────

create table if not exists public.ask_nac_entity_provenance (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.ask_nac_entities (id) on delete cascade,
  source_file_id uuid references public.ask_nac_files (id) on delete set null,
  file_version_id uuid references public.ask_nac_file_versions (id) on delete set null,
  compiler_job_id uuid references public.ask_nac_ingestion_jobs (id) on delete set null,
  extraction_method text not null,
  confidence numeric,
  created_by text,
  created_at timestamptz not null default now()
);

create index if not exists idx_ask_nac_entity_provenance_entity
  on public.ask_nac_entity_provenance (entity_id, created_at desc);

create index if not exists idx_ask_nac_entity_provenance_source_file
  on public.ask_nac_entity_provenance (source_file_id)
  where source_file_id is not null;

comment on table public.ask_nac_entity_provenance is
  'Traceability from entities back to vault files, versions, and compiler jobs.';

-- ── 3. Entity relationships (foundation only — no graph traversal yet) ───────

create table if not exists public.ask_nac_entity_relationships (
  id uuid primary key default gen_random_uuid(),
  source_entity_id uuid not null references public.ask_nac_entities (id) on delete cascade,
  target_entity_id uuid not null references public.ask_nac_entities (id) on delete cascade,
  relationship_type text not null check (relationship_type in (
    'applies_to_branch', 'evidenced_by', 'supersedes', 'related_to'
  )),
  confidence numeric,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (source_entity_id, target_entity_id, relationship_type)
);

create index if not exists idx_ask_nac_entity_relationships_source
  on public.ask_nac_entity_relationships (source_entity_id, relationship_type);

create index if not exists idx_ask_nac_entity_relationships_target
  on public.ask_nac_entity_relationships (target_entity_id, relationship_type);

comment on table public.ask_nac_entity_relationships is
  'Entity-to-entity links for future reasoning. v0 stores foundation rows only.';

-- ── 4. Seed canonical branch entities ─────────────────────────────────────────

insert into public.ask_nac_entities (
  entity_type, canonical_key, display_name, scope, branch_id, brand_wide,
  department, sensitivity_level, authority_level, metadata
)
select
  'branch',
  'branch:' || v.branch_id,
  v.display_name,
  v.branch_id,
  v.branch_id,
  false,
  'operations',
  'internal',
  'corporate_manual',
  jsonb_build_object('seeded', true, 'registry_version', 'entity-registry-v0')
from (values
  ('khobar', 'Khobar'),
  ('riyadh', 'Riyadh'),
  ('jeddah', 'Jeddah')
) as v(branch_id, display_name)
on conflict (canonical_key) do update set
  display_name = excluded.display_name,
  updated_at = now();

-- ── 5. RLS ────────────────────────────────────────────────────────────────────

alter table public.ask_nac_entities enable row level security;
alter table public.ask_nac_entity_provenance enable row level security;
alter table public.ask_nac_entity_relationships enable row level security;

-- Branch entities: branch access only (no cross-branch leakage).
drop policy if exists ask_nac_entities_select on public.ask_nac_entities;
create policy ask_nac_entities_select on public.ask_nac_entities
  for select to authenticated
  using (
    (
      entity_type = 'branch'
      and branch_id is not null
      and public.ask_nac_vault_branch_allowed(branch_id)
    )
    or (
      entity_type <> 'branch'
      and public.ask_nac_vault_can_read_scope(
        branch_id,
        brand_wide,
        coalesce(department, 'operations'),
        sensitivity_level
      )
    )
  );

drop policy if exists ask_nac_entities_insert on public.ask_nac_entities;
create policy ask_nac_entities_insert on public.ask_nac_entities
  for insert to authenticated
  with check (
    entity_type in ('document', 'branch')
    and (
      (
        entity_type = 'branch'
        and branch_id is not null
        and public.ask_nac_vault_branch_allowed(branch_id)
      )
      or (
        entity_type = 'document'
        and public.ask_nac_vault_can_read_scope(
          branch_id,
          brand_wide,
          coalesce(department, 'operations'),
          sensitivity_level
        )
      )
    )
  );

drop policy if exists ask_nac_entity_provenance_select on public.ask_nac_entity_provenance;
create policy ask_nac_entity_provenance_select on public.ask_nac_entity_provenance
  for select to authenticated
  using (
    exists (
      select 1 from public.ask_nac_entities e
      where e.id = entity_id
      and (
        (
          e.entity_type = 'branch'
          and e.branch_id is not null
          and public.ask_nac_vault_branch_allowed(e.branch_id)
        )
        or (
          e.entity_type <> 'branch'
          and public.ask_nac_vault_can_read_scope(
            e.branch_id,
            e.brand_wide,
            coalesce(e.department, 'operations'),
            e.sensitivity_level
          )
        )
      )
    )
    and (
      source_file_id is null
      or public.ask_nac_vault_can_read_file(source_file_id)
    )
  );

drop policy if exists ask_nac_entity_provenance_insert on public.ask_nac_entity_provenance;
create policy ask_nac_entity_provenance_insert on public.ask_nac_entity_provenance
  for insert to authenticated
  with check (
    exists (
      select 1 from public.ask_nac_entities e
      where e.id = entity_id
      and e.entity_type in ('document', 'branch')
      and (
        (
          e.entity_type = 'branch'
          and e.branch_id is not null
          and public.ask_nac_vault_branch_allowed(e.branch_id)
        )
        or (
          e.entity_type = 'document'
          and public.ask_nac_vault_can_read_scope(
            e.branch_id,
            e.brand_wide,
            coalesce(e.department, 'operations'),
            e.sensitivity_level
          )
        )
      )
    )
    and (
      source_file_id is null
      or public.ask_nac_vault_can_read_file(source_file_id)
    )
  );

drop policy if exists ask_nac_entity_relationships_select on public.ask_nac_entity_relationships;
create policy ask_nac_entity_relationships_select on public.ask_nac_entity_relationships
  for select to authenticated
  using (
    exists (
      select 1 from public.ask_nac_entities s where s.id = source_entity_id
      and (
        (s.entity_type = 'branch' and s.branch_id is not null and public.ask_nac_vault_branch_allowed(s.branch_id))
        or (s.entity_type <> 'branch' and public.ask_nac_vault_can_read_scope(
          s.branch_id, s.brand_wide, coalesce(s.department, 'operations'), s.sensitivity_level
        ))
      )
    )
    and exists (
      select 1 from public.ask_nac_entities t where t.id = target_entity_id
      and (
        (t.entity_type = 'branch' and t.branch_id is not null and public.ask_nac_vault_branch_allowed(t.branch_id))
        or (t.entity_type <> 'branch' and public.ask_nac_vault_can_read_scope(
          t.branch_id, t.brand_wide, coalesce(t.department, 'operations'), t.sensitivity_level
        ))
      )
    )
  );

drop policy if exists ask_nac_entity_relationships_insert on public.ask_nac_entity_relationships;
create policy ask_nac_entity_relationships_insert on public.ask_nac_entity_relationships
  for insert to authenticated
  with check (
    relationship_type in ('applies_to_branch', 'evidenced_by', 'related_to')
    and exists (
      select 1 from public.ask_nac_entities s where s.id = source_entity_id
      and s.entity_type in ('document', 'branch')
    )
    and exists (
      select 1 from public.ask_nac_entities t where t.id = target_entity_id
      and t.entity_type in ('document', 'branch')
    )
  );

grant select, insert on public.ask_nac_entities to authenticated;
grant select, insert on public.ask_nac_entity_provenance to authenticated;
grant select, insert on public.ask_nac_entity_relationships to authenticated;
