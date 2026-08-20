-- Foodics Bridge Phase 2B — production normalized observations + aliases + RLS
-- Scope: Khobar-first, branch-extensible. LEGACY / EXTERNAL EVIDENCE only.
-- Does NOT alter Menu Manager, Inventory/Food Bible costing, or Cashup/Logbook.

-- ---------------------------------------------------------------------------
-- A) RAW SOURCE ARCHIVE
-- ---------------------------------------------------------------------------
create table if not exists public.foodics_export_sources (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'foodics',
  foodics_account text,
  branch_id text not null check (branch_id in ('khobar', 'riyadh', 'jeddah')),
  report_type text not null check (report_type in ('sales_by_creator', 'menu_engineering')),
  date_from date not null,
  date_to date not null,
  exported_at timestamptz not null,
  filename text not null,
  checksum_sha256 text not null,
  file_size bigint,
  source_file_path text,
  archive_storage_path text,
  parser_version text,
  grain text not null check (grain in ('day', 'period')),
  ingestion_status text not null default 'registered',
  observation_count integer,
  parse_error text,
  created_at timestamptz not null default now(),
  unique (checksum_sha256, branch_id, report_type, date_from, date_to)
);

create index if not exists idx_foodics_export_sources_checksum
  on public.foodics_export_sources (checksum_sha256);

create index if not exists idx_foodics_export_sources_branch_report
  on public.foodics_export_sources (branch_id, report_type, date_from, date_to);

-- ---------------------------------------------------------------------------
-- Alias / future canonical entity mapping (no auto-merge)
-- ---------------------------------------------------------------------------
create table if not exists public.foodics_entity_aliases (
  id uuid primary key default gen_random_uuid(),
  branch_id text not null check (branch_id in ('khobar', 'riyadh', 'jeddah')),
  entity_type text not null check (entity_type in ('creator', 'product')),
  raw_label text not null,
  normalized_label text not null,
  canonical_entity_id uuid null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  status text not null default 'unresolved'
    check (status in ('unresolved', 'mapped', 'ignored')),
  source text not null default 'foodics',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (branch_id, entity_type, raw_label)
);

create index if not exists idx_foodics_entity_aliases_normalized
  on public.foodics_entity_aliases (branch_id, entity_type, normalized_label);

create index if not exists idx_foodics_entity_aliases_canonical
  on public.foodics_entity_aliases (canonical_entity_id)
  where canonical_entity_id is not null;

-- ---------------------------------------------------------------------------
-- B) NORMALIZED CURRENT OBSERVATIONS
-- ---------------------------------------------------------------------------
create table if not exists public.foodics_normalized_observations (
  id uuid primary key default gen_random_uuid(),
  business_key text not null,
  business_key_hash text not null,
  branch_id text not null check (branch_id in ('khobar', 'riyadh', 'jeddah')),
  report_type text not null check (report_type in ('sales_by_creator', 'menu_engineering')),
  grain text not null check (grain in ('day', 'period')),
  business_date date,
  period_start date not null,
  period_end date not null,
  entity_type text not null check (entity_type in ('creator', 'product')),
  raw_entity_label text not null,
  normalized_entity_label text not null,
  canonical_entity_id uuid null,
  metrics jsonb not null default '{}'::jsonb,
  metrics_fingerprint text not null,
  semantics text not null default 'LEGACY_EXTERNAL_EVIDENCE',
  cost_semantics text,
  is_current boolean not null default true,
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  first_source_id uuid references public.foodics_export_sources (id),
  last_source_id uuid references public.foodics_export_sources (id),
  active_source_id uuid not null references public.foodics_export_sources (id),
  active_exported_at timestamptz not null,
  previous_metrics jsonb,
  source_row_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_key),
  constraint foodics_obs_day_requires_business_date check (
    (grain = 'day' and business_date is not null and period_start = period_end and business_date = period_start)
    or (grain = 'period')
  )
);

create index if not exists idx_foodics_obs_daily
  on public.foodics_normalized_observations (branch_id, report_type, business_date)
  where grain = 'day' and is_current;

create index if not exists idx_foodics_obs_entity
  on public.foodics_normalized_observations (branch_id, report_type, normalized_entity_label);

create index if not exists idx_foodics_obs_canonical
  on public.foodics_normalized_observations (canonical_entity_id)
  where canonical_entity_id is not null;

-- ---------------------------------------------------------------------------
-- History / provenance
-- ---------------------------------------------------------------------------
create table if not exists public.foodics_observation_history (
  id uuid primary key default gen_random_uuid(),
  business_key text not null,
  business_key_hash text not null,
  branch_id text not null,
  report_type text not null,
  grain text not null,
  business_date date,
  period_start date,
  period_end date,
  entity_type text not null,
  raw_entity_label text,
  normalized_entity_label text not null,
  canonical_entity_id uuid null,
  metrics jsonb not null,
  metrics_fingerprint text not null,
  semantics text,
  cost_semantics text,
  active_source_id uuid references public.foodics_export_sources (id),
  active_exported_at timestamptz,
  superseded_by_source_id uuid references public.foodics_export_sources (id),
  note text,
  recorded_at timestamptz not null default now()
);

create index if not exists idx_foodics_obs_history_key
  on public.foodics_observation_history (business_key, recorded_at desc);

-- ---------------------------------------------------------------------------
-- Sync / backfill checkpoints
-- ---------------------------------------------------------------------------
create table if not exists public.foodics_sync_state (
  branch_id text not null check (branch_id in ('khobar', 'riyadh', 'jeddah')),
  report_type text not null check (report_type in ('sales_by_creator', 'menu_engineering')),
  last_success_date date,
  overlap_days integer not null default 3,
  backfill_cursor_date date,
  backfill_target_end date,
  updated_at timestamptz not null default now(),
  primary key (branch_id, report_type)
);

-- ---------------------------------------------------------------------------
-- Atomic ingest of one export (service_role / security definer)
-- ---------------------------------------------------------------------------
create or replace function public.foodics_bridge_ingest_export(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source_id uuid;
  v_existing_source public.foodics_export_sources%rowtype;
  v_obs jsonb;
  v_alias jsonb;
  v_existing public.foodics_normalized_observations%rowtype;
  v_inserted int := 0;
  v_updated int := 0;
  v_noop int := 0;
  v_stale int := 0;
  v_history int := 0;
  v_aliases int := 0;
  v_incoming_exported timestamptz;
  v_incoming_ingested timestamptz;
  v_fp text;
  v_branch text;
  v_report text;
  v_date_from date;
  v_date_to date;
  v_checksum text;
begin
  if auth.role() not in ('service_role', 'postgres') then
    raise exception 'foodics_bridge_ingest_export requires service_role';
  end if;

  v_branch := p->'source'->>'branch_id';
  v_report := p->'source'->>'report_type';
  v_date_from := (p->'source'->>'date_from')::date;
  v_date_to := (p->'source'->>'date_to')::date;
  v_checksum := p->'source'->>'checksum_sha256';

  select * into v_existing_source
  from public.foodics_export_sources s
  where s.checksum_sha256 = v_checksum
    and s.branch_id = v_branch
    and s.report_type = v_report
    and s.date_from = v_date_from
    and s.date_to = v_date_to
    and s.ingestion_status = 'ingested'
  limit 1;

  if found then
    return jsonb_build_object(
      'ok', true,
      'skipped', true,
      'reason', 'identical_file_hash',
      'source_id', v_existing_source.id,
      'inserted', 0,
      'updated', 0,
      'noop', 0,
      'stale', 0,
      'history', 0,
      'aliases', 0
    );
  end if;

  insert into public.foodics_export_sources (
    source, foodics_account, branch_id, report_type, date_from, date_to,
    exported_at, filename, checksum_sha256, file_size, source_file_path,
    archive_storage_path, parser_version, grain, ingestion_status, observation_count
  ) values (
    coalesce(p->'source'->>'source', 'foodics'),
    p->'source'->>'foodics_account',
    v_branch,
    v_report,
    v_date_from,
    v_date_to,
    (p->'source'->>'exported_at')::timestamptz,
    p->'source'->>'filename',
    v_checksum,
    nullif(p->'source'->>'file_size', '')::bigint,
    p->'source'->>'source_file_path',
    p->'source'->>'archive_storage_path',
    p->'source'->>'parser_version',
    p->'source'->>'grain',
    'ingesting',
    coalesce(jsonb_array_length(p->'observations'), 0)
  )
  on conflict (checksum_sha256, branch_id, report_type, date_from, date_to)
  do update set
    exported_at = excluded.exported_at,
    filename = excluded.filename,
    parser_version = excluded.parser_version,
    ingestion_status = 'ingesting'
  returning id into v_source_id;

  v_incoming_exported := (p->'source'->>'exported_at')::timestamptz;
  v_incoming_ingested := coalesce((p->'source'->>'ingested_at')::timestamptz, now());

  for v_alias in select * from jsonb_array_elements(coalesce(p->'aliases', '[]'::jsonb))
  loop
    insert into public.foodics_entity_aliases (
      branch_id, entity_type, raw_label, normalized_label, canonical_entity_id,
      first_seen_at, last_seen_at, status, source, metadata
    ) values (
      v_branch,
      v_alias->>'entity_type',
      v_alias->>'raw_label',
      v_alias->>'normalized_label',
      nullif(v_alias->>'canonical_entity_id', '')::uuid,
      v_incoming_ingested,
      v_incoming_ingested,
      coalesce(v_alias->>'status', 'unresolved'),
      'foodics',
      coalesce(v_alias->'metadata', '{}'::jsonb)
    )
    on conflict (branch_id, entity_type, raw_label) do update set
      last_seen_at = greatest(public.foodics_entity_aliases.last_seen_at, excluded.last_seen_at),
      normalized_label = excluded.normalized_label
    where public.foodics_entity_aliases.status = 'unresolved';
    v_aliases := v_aliases + 1;
  end loop;

  for v_obs in select * from jsonb_array_elements(coalesce(p->'observations', '[]'::jsonb))
  loop
    v_fp := v_obs->>'metrics_fingerprint';

    select * into v_existing
    from public.foodics_normalized_observations o
    where o.business_key = v_obs->>'business_key'
    limit 1;

    if not found then
      insert into public.foodics_normalized_observations (
        business_key, business_key_hash, branch_id, report_type, grain,
        business_date, period_start, period_end,
        entity_type, raw_entity_label, normalized_entity_label, canonical_entity_id,
        metrics, metrics_fingerprint, semantics, cost_semantics, is_current,
        first_seen_at, last_seen_at, first_source_id, last_source_id,
        active_source_id, active_exported_at, source_row_ref
      ) values (
        v_obs->>'business_key',
        v_obs->>'business_key_hash',
        v_branch,
        v_report,
        v_obs->>'grain',
        nullif(v_obs->>'business_date', '')::date,
        (v_obs->>'period_start')::date,
        (v_obs->>'period_end')::date,
        v_obs->>'entity_type',
        v_obs->>'raw_entity_label',
        v_obs->>'normalized_entity_label',
        nullif(v_obs->>'canonical_entity_id', '')::uuid,
        coalesce(v_obs->'metrics', '{}'::jsonb),
        v_fp,
        coalesce(v_obs->>'semantics', 'LEGACY_EXTERNAL_EVIDENCE'),
        v_obs->>'cost_semantics',
        true,
        v_incoming_ingested,
        v_incoming_ingested,
        v_source_id,
        v_source_id,
        v_source_id,
        v_incoming_exported,
        v_obs->>'source_row_ref'
      );
      v_inserted := v_inserted + 1;
      continue;
    end if;

    if v_existing.metrics_fingerprint = v_fp then
      update public.foodics_normalized_observations
      set last_seen_at = v_incoming_ingested,
          last_source_id = v_source_id,
          updated_at = now()
      where id = v_existing.id;
      v_noop := v_noop + 1;
      continue;
    end if;

    -- Older export must not overwrite newer current
    if v_incoming_exported < v_existing.active_exported_at then
      insert into public.foodics_observation_history (
        business_key, business_key_hash, branch_id, report_type, grain,
        business_date, period_start, period_end, entity_type,
        raw_entity_label, normalized_entity_label, canonical_entity_id,
        metrics, metrics_fingerprint, semantics, cost_semantics,
        active_source_id, active_exported_at, superseded_by_source_id, note
      ) values (
        v_obs->>'business_key',
        v_obs->>'business_key_hash',
        v_branch,
        v_report,
        v_obs->>'grain',
        nullif(v_obs->>'business_date', '')::date,
        (v_obs->>'period_start')::date,
        (v_obs->>'period_end')::date,
        v_obs->>'entity_type',
        v_obs->>'raw_entity_label',
        v_obs->>'normalized_entity_label',
        nullif(v_obs->>'canonical_entity_id', '')::uuid,
        coalesce(v_obs->'metrics', '{}'::jsonb),
        v_fp,
        coalesce(v_obs->>'semantics', 'LEGACY_EXTERNAL_EVIDENCE'),
        v_obs->>'cost_semantics',
        v_source_id,
        v_incoming_exported,
        v_existing.active_source_id,
        'older_export_ignored_for_current'
      );
      v_stale := v_stale + 1;
      v_history := v_history + 1;
      continue;
    end if;

    insert into public.foodics_observation_history (
      business_key, business_key_hash, branch_id, report_type, grain,
      business_date, period_start, period_end, entity_type,
      raw_entity_label, normalized_entity_label, canonical_entity_id,
      metrics, metrics_fingerprint, semantics, cost_semantics,
      active_source_id, active_exported_at, superseded_by_source_id, note
    ) values (
      v_existing.business_key,
      v_existing.business_key_hash,
      v_existing.branch_id,
      v_existing.report_type,
      v_existing.grain,
      v_existing.business_date,
      v_existing.period_start,
      v_existing.period_end,
      v_existing.entity_type,
      v_existing.raw_entity_label,
      v_existing.normalized_entity_label,
      v_existing.canonical_entity_id,
      v_existing.metrics,
      v_existing.metrics_fingerprint,
      v_existing.semantics,
      v_existing.cost_semantics,
      v_existing.active_source_id,
      v_existing.active_exported_at,
      v_source_id,
      'value_corrected_or_updated'
    );
    v_history := v_history + 1;

    update public.foodics_normalized_observations
    set metrics = coalesce(v_obs->'metrics', '{}'::jsonb),
        metrics_fingerprint = v_fp,
        raw_entity_label = v_obs->>'raw_entity_label',
        normalized_entity_label = v_obs->>'normalized_entity_label',
        previous_metrics = v_existing.metrics,
        last_seen_at = v_incoming_ingested,
        last_source_id = v_source_id,
        active_source_id = v_source_id,
        active_exported_at = v_incoming_exported,
        source_row_ref = v_obs->>'source_row_ref',
        updated_at = now()
    where id = v_existing.id;
    v_updated := v_updated + 1;
  end loop;

  update public.foodics_export_sources
  set ingestion_status = 'ingested',
      observation_count = coalesce(jsonb_array_length(p->'observations'), 0)
  where id = v_source_id;

  -- Advance sync cursor only for successful daily grain inside same transaction
  if (p->'source'->>'grain') = 'day' and coalesce((p->>'advance_sync')::boolean, false) then
    insert into public.foodics_sync_state (branch_id, report_type, last_success_date, overlap_days, updated_at)
    values (v_branch, v_report, v_date_to, coalesce((p->>'overlap_days')::int, 3), now())
    on conflict (branch_id, report_type) do update set
      last_success_date = case
        when public.foodics_sync_state.last_success_date is null
          or excluded.last_success_date > public.foodics_sync_state.last_success_date
        then excluded.last_success_date
        else public.foodics_sync_state.last_success_date
      end,
      updated_at = now();
  end if;

  return jsonb_build_object(
    'ok', true,
    'skipped', false,
    'source_id', v_source_id,
    'inserted', v_inserted,
    'updated', v_updated,
    'noop', v_noop,
    'stale', v_stale,
    'history', v_history,
    'aliases', v_aliases
  );
exception when others then
  raise;
end;
$$;

revoke all on function public.foodics_bridge_ingest_export(jsonb) from public, anon, authenticated;
grant execute on function public.foodics_bridge_ingest_export(jsonb) to service_role;

-- Read helper for Ask NAC / intelligence (branch-scoped via RLS on underlying table)
create or replace function public.foodics_query_daily_observations(
  p_branch text,
  p_report_type text,
  p_date_from date,
  p_date_to date,
  p_entity_label text default null
)
returns setof public.foodics_normalized_observations
language sql
stable
security invoker
set search_path = public
as $$
  select o.*
  from public.foodics_normalized_observations o
  where o.branch_id = public.nac_normalize_branch_id(p_branch)
    and o.report_type = p_report_type
    and o.grain = 'day'
    and o.is_current
    and o.business_date >= p_date_from
    and o.business_date <= p_date_to
    and (
      p_entity_label is null
      or o.normalized_entity_label = lower(trim(p_entity_label))
      or o.raw_entity_label ilike p_entity_label
    )
  order by o.business_date, o.normalized_entity_label;
$$;

grant execute on function public.foodics_query_daily_observations(text, text, date, date, text)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RLS — reuse ask_nac_vault_branch_allowed
-- ---------------------------------------------------------------------------
alter table public.foodics_export_sources enable row level security;
alter table public.foodics_entity_aliases enable row level security;
alter table public.foodics_normalized_observations enable row level security;
alter table public.foodics_observation_history enable row level security;
alter table public.foodics_sync_state enable row level security;

revoke all on public.foodics_export_sources from anon, public;
revoke all on public.foodics_entity_aliases from anon, public;
revoke all on public.foodics_normalized_observations from anon, public;
revoke all on public.foodics_observation_history from anon, public;
revoke all on public.foodics_sync_state from anon, public;

drop policy if exists foodics_export_sources_select on public.foodics_export_sources;
create policy foodics_export_sources_select on public.foodics_export_sources
  for select to authenticated
  using (public.ask_nac_vault_branch_allowed(branch_id));

drop policy if exists foodics_entity_aliases_select on public.foodics_entity_aliases;
create policy foodics_entity_aliases_select on public.foodics_entity_aliases
  for select to authenticated
  using (public.ask_nac_vault_branch_allowed(branch_id));

drop policy if exists foodics_obs_select on public.foodics_normalized_observations;
create policy foodics_obs_select on public.foodics_normalized_observations
  for select to authenticated
  using (public.ask_nac_vault_branch_allowed(branch_id));

drop policy if exists foodics_obs_history_select on public.foodics_observation_history;
create policy foodics_obs_history_select on public.foodics_observation_history
  for select to authenticated
  using (public.ask_nac_vault_branch_allowed(branch_id));

drop policy if exists foodics_sync_state_select on public.foodics_sync_state;
create policy foodics_sync_state_select on public.foodics_sync_state
  for select to authenticated
  using (public.ask_nac_vault_branch_allowed(branch_id));

-- No authenticated writes — bridge uses service_role only
grant select on public.foodics_export_sources to authenticated;
grant select on public.foodics_entity_aliases to authenticated;
grant select on public.foodics_normalized_observations to authenticated;
grant select on public.foodics_observation_history to authenticated;
grant select on public.foodics_sync_state to authenticated;

grant all on public.foodics_export_sources to service_role;
grant all on public.foodics_entity_aliases to service_role;
grant all on public.foodics_normalized_observations to service_role;
grant all on public.foodics_observation_history to service_role;
grant all on public.foodics_sync_state to service_role;
