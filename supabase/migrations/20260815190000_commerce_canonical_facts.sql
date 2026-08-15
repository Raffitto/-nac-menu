-- Authorized 2026-08-15: apply to NAC production if non-destructive.
-- Orchestrator tables added before first apply so one migration owns the contract.
-- Validated 2026-08-15 against a real Foodics console order
-- (id 78aeffe9-589d-4e95-92c4-47e9e4fd3661, Khobar Done dine-in).
-- Why required:
--   foodics_sales_items is period-grain. Official Orders CSV is email-async.
--   Console order JSON has stable UUID order id + line-item UUID + product UUID,
--   guests, table id, type, status. Canonical store must be source-agnostic.
-- Observed Foodics: status 4=Done, 2=Active; type 1=Dine In; guests present.
-- Official export max range: 31 days. List filters do not apply to exports.

create table if not exists public.commerce_ingest_health (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  branch_id text not null,
  report_type text not null,
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_success_date date,
  last_failure_reason text,
  session_auth_ok boolean,
  coverage_through date,
  metadata jsonb not null default '{}'::jsonb,
  unique (source, branch_id, report_type)
);

create table if not exists public.commerce_product_map (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  source_product_id text,
  source_name text,
  canonical_menu_item_id text,
  nac_category_id text,
  canonical_family text not null default 'unclassified',
  updated_at timestamptz not null default now(),
  unique (source, source_product_id)
);

create table if not exists public.commerce_orders (
  source text not null,
  source_order_id text not null,
  source_revision text not null default '1',
  branch_id text not null,
  business_date date not null,
  opened_at timestamptz,
  closed_at timestamptz,
  order_type text not null default 'dine_in',
  table_id text,
  covers numeric,
  subtotal numeric,
  discount numeric,
  tax numeric,
  net_sales numeric,
  status text not null default 'completed',
  check_number text,
  source_metadata jsonb not null default '{}'::jsonb,
  ingested_at timestamptz not null default now(),
  primary key (source, source_order_id)
);

create index if not exists idx_commerce_orders_branch_date
  on public.commerce_orders (branch_id, business_date);

create table if not exists public.commerce_order_items (
  source text not null,
  source_order_id text not null,
  source_order_item_id text not null,
  branch_id text not null,
  business_date date not null,
  product_id text,
  canonical_menu_item_id text,
  item_name text not null,
  source_category text,
  canonical_category text not null default 'unclassified',
  quantity numeric not null default 0,
  gross_amount numeric,
  discount_amount numeric,
  net_amount numeric,
  status text not null default 'completed',
  ingested_at timestamptz not null default now(),
  primary key (source, source_order_item_id)
);

create index if not exists idx_commerce_items_order
  on public.commerce_order_items (source, source_order_id);
create index if not exists idx_commerce_items_branch_date
  on public.commerce_order_items (branch_id, business_date);

alter table public.commerce_ingest_health enable row level security;
alter table public.commerce_product_map enable row level security;
alter table public.commerce_orders enable row level security;
alter table public.commerce_order_items enable row level security;

drop policy if exists commerce_health_auth on public.commerce_ingest_health;
create policy commerce_health_auth on public.commerce_ingest_health
  for all to authenticated using (true) with check (true);

drop policy if exists commerce_map_auth on public.commerce_product_map;
create policy commerce_map_auth on public.commerce_product_map
  for all to authenticated using (true) with check (true);

drop policy if exists commerce_orders_auth on public.commerce_orders;
create policy commerce_orders_auth on public.commerce_orders
  for all to authenticated using (
    branch_id = coalesce(auth.jwt() ->> 'branch_id', branch_id)
    or coalesce(auth.jwt() ->> 'all_branches', 'false') = 'true'
  ) with check (true);

drop policy if exists commerce_items_auth on public.commerce_order_items;
create policy commerce_items_auth on public.commerce_order_items
  for all to authenticated using (
    branch_id = coalesce(auth.jwt() ->> 'branch_id', branch_id)
    or coalesce(auth.jwt() ->> 'all_branches', 'false') = 'true'
  ) with check (true);

revoke all on public.commerce_ingest_health from anon;
revoke all on public.commerce_product_map from anon;
revoke all on public.commerce_orders from anon;
revoke all on public.commerce_order_items from anon;
grant all on public.commerce_ingest_health to authenticated;
grant all on public.commerce_product_map to authenticated;
grant all on public.commerce_orders to authenticated;
grant all on public.commerce_order_items to authenticated;

comment on table public.commerce_orders is
  'NAC canonical checks/orders. Source-agnostic. Do not treat as Cash Up headline sales.';

create table if not exists public.commerce_export_requests (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'foodics',
  dataset text not null,
  branch_id text not null,
  period_start date not null,
  period_end date not null,
  requested_at timestamptz not null default now(),
  source_request_id text,
  source_response jsonb not null default '{}'::jsonb,
  delivery_mode text,
  companion_dataset text,
  publication_group_id uuid,
  status text not null default 'requested',
  retry_count integer not null default 0,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists idx_commerce_export_requests_pending
  on public.commerce_export_requests (source, dataset, branch_id, status, requested_at desc);

create table if not exists public.commerce_raw_batches (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'foodics',
  dataset text not null,
  branch_id text not null,
  period_start date not null,
  period_end date not null,
  acquisition_mode text not null,
  export_request_id uuid,
  source_request_id text,
  requested_at timestamptz,
  received_at timestamptz not null default now(),
  original_filename text,
  original_reference text,
  checksum text not null,
  schema_fingerprint text,
  row_count integer not null default 0,
  source_metadata jsonb not null default '{}'::jsonb,
  status text not null default 'received',
  retry_count integer not null default 0,
  unique (source, dataset, branch_id, period_start, period_end, checksum)
);

create table if not exists public.commerce_publication_groups (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'foodics',
  group_name text not null default 'commerce_sessions',
  branch_id text not null,
  period_start date not null,
  period_end date not null,
  status text not null default 'requested',
  orders_batch_id uuid,
  items_batch_id uuid,
  published_snapshot_id uuid,
  quality jsonb not null default '{}'::jsonb,
  lineage jsonb not null default '{}'::jsonb,
  unique (source, group_name, branch_id, period_start, period_end)
);

create table if not exists public.commerce_dataset_freshness (
  source text not null,
  dataset text not null,
  branch_id text not null,
  data_through date,
  complete_through timestamptz,
  last_success_at timestamptz,
  status text not null default 'unavailable',
  source_mode text,
  quality jsonb not null default '{}'::jsonb,
  primary key (source, dataset, branch_id)
);

create table if not exists public.commerce_published_snapshots (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'foodics',
  branch_id text not null,
  period_start date not null,
  period_end date not null,
  capability_set text not null default 'commerce.session_mix',
  status text not null default 'published',
  mix jsonb not null,
  comparison jsonb,
  item_mix jsonb,
  mapping_quality jsonb,
  evidence_summary jsonb not null default '{}'::jsonb,
  lineage jsonb not null default '{}'::jsonb,
  published_at timestamptz not null default now()
);

create index if not exists idx_commerce_snapshots_branch
  on public.commerce_published_snapshots (branch_id, period_end desc, published_at desc);

create table if not exists public.commerce_sessions (
  source text not null,
  source_order_id text not null,
  branch_id text not null,
  business_date date not null,
  covers numeric,
  net_sales numeric,
  item_count numeric,
  archetype text not null,
  flags jsonb not null default '{}'::jsonb,
  published_snapshot_id uuid,
  primary key (source, source_order_id)
);

create index if not exists idx_commerce_sessions_branch_date
  on public.commerce_sessions (branch_id, business_date);

create table if not exists public.commerce_reconciliation (
  branch_id text not null,
  business_date date not null,
  cash_up_sales numeric,
  foodics_sales numeric,
  absolute_difference numeric,
  percentage_difference numeric,
  primary key (branch_id, business_date)
);

alter table public.commerce_export_requests enable row level security;
alter table public.commerce_raw_batches enable row level security;
alter table public.commerce_publication_groups enable row level security;
alter table public.commerce_dataset_freshness enable row level security;
alter table public.commerce_published_snapshots enable row level security;
alter table public.commerce_sessions enable row level security;
alter table public.commerce_reconciliation enable row level security;

drop policy if exists commerce_export_requests_auth on public.commerce_export_requests;
create policy commerce_export_requests_auth on public.commerce_export_requests
  for all to authenticated using (true) with check (true);

drop policy if exists commerce_raw_batches_auth on public.commerce_raw_batches;
create policy commerce_raw_batches_auth on public.commerce_raw_batches
  for all to authenticated using (true) with check (true);

drop policy if exists commerce_pub_groups_auth on public.commerce_publication_groups;
create policy commerce_pub_groups_auth on public.commerce_publication_groups
  for all to authenticated using (
    branch_id = coalesce(auth.jwt() ->> 'branch_id', branch_id)
    or coalesce(auth.jwt() ->> 'all_branches', 'false') = 'true'
  ) with check (true);

drop policy if exists commerce_freshness_auth on public.commerce_dataset_freshness;
create policy commerce_freshness_auth on public.commerce_dataset_freshness
  for all to authenticated using (
    branch_id = coalesce(auth.jwt() ->> 'branch_id', branch_id)
    or coalesce(auth.jwt() ->> 'all_branches', 'false') = 'true'
  ) with check (true);

drop policy if exists commerce_snapshots_auth on public.commerce_published_snapshots;
create policy commerce_snapshots_auth on public.commerce_published_snapshots
  for select to authenticated using (
    branch_id = coalesce(auth.jwt() ->> 'branch_id', branch_id)
    or coalesce(auth.jwt() ->> 'all_branches', 'false') = 'true'
  );

drop policy if exists commerce_sessions_auth on public.commerce_sessions;
create policy commerce_sessions_auth on public.commerce_sessions
  for all to authenticated using (
    branch_id = coalesce(auth.jwt() ->> 'branch_id', branch_id)
    or coalesce(auth.jwt() ->> 'all_branches', 'false') = 'true'
  ) with check (true);

drop policy if exists commerce_recon_auth on public.commerce_reconciliation;
create policy commerce_recon_auth on public.commerce_reconciliation
  for all to authenticated using (
    branch_id = coalesce(auth.jwt() ->> 'branch_id', branch_id)
    or coalesce(auth.jwt() ->> 'all_branches', 'false') = 'true'
  ) with check (true);

revoke all on public.commerce_export_requests from anon;
revoke all on public.commerce_raw_batches from anon;
revoke all on public.commerce_publication_groups from anon;
revoke all on public.commerce_dataset_freshness from anon;
revoke all on public.commerce_published_snapshots from anon;
revoke all on public.commerce_sessions from anon;
revoke all on public.commerce_reconciliation from anon;

grant all on public.commerce_export_requests to authenticated;
grant all on public.commerce_raw_batches to authenticated;
grant all on public.commerce_publication_groups to authenticated;
grant all on public.commerce_dataset_freshness to authenticated;
grant select on public.commerce_published_snapshots to authenticated;
grant all on public.commerce_sessions to authenticated;
grant all on public.commerce_reconciliation to authenticated;
