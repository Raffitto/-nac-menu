-- Foodics manual import schema (authenticated CRUD only)
-- Run after menu_schema.sql in Supabase SQL editor

-- ---------------------------------------------------------------------------
-- 1) Import batches
-- ---------------------------------------------------------------------------
create table if not exists public.foodics_import_batches (
  id uuid primary key default gen_random_uuid(),
  branch_id text not null default 'khobar',
  period_type text not null check (period_type in ('weekly', 'biweekly', 'monthly', 'custom')),
  period_start date not null,
  period_end date not null,
  source_file_name text,
  uploaded_by text,
  uploaded_at timestamptz not null default now(),
  notes text
);

create index if not exists idx_foodics_batches_branch on public.foodics_import_batches (branch_id);
create index if not exists idx_foodics_batches_period on public.foodics_import_batches (period_start, period_end);
create index if not exists idx_foodics_batches_uploaded on public.foodics_import_batches (uploaded_at desc);

-- ---------------------------------------------------------------------------
-- 2) Sales line items per import
-- ---------------------------------------------------------------------------
create table if not exists public.foodics_sales_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.foodics_import_batches (id) on delete cascade,
  branch_id text not null default 'khobar',
  period_start date not null,
  period_end date not null,
  raw_item_name text not null,
  normalized_item_name text,
  matched_menu_item_id uuid references public.menu_items (id) on delete set null,
  matched_menu_item_name text,
  category text,
  quantity_sold numeric not null default 0,
  net_sales numeric,
  gross_sales numeric,
  discount numeric,
  created_at timestamptz not null default now()
);

create index if not exists idx_foodics_sales_batch on public.foodics_sales_items (batch_id);
create index if not exists idx_foodics_sales_normalized on public.foodics_sales_items (normalized_item_name);
create index if not exists idx_foodics_sales_matched_name on public.foodics_sales_items (matched_menu_item_name);
create index if not exists idx_foodics_sales_period on public.foodics_sales_items (period_start, period_end);
create index if not exists idx_foodics_sales_branch on public.foodics_sales_items (branch_id);

-- ---------------------------------------------------------------------------
-- 3) Manual name mapping overrides
-- ---------------------------------------------------------------------------
create table if not exists public.menu_item_name_map (
  id uuid primary key default gen_random_uuid(),
  raw_name text not null unique,
  normalized_name text not null,
  menu_item_name_en text not null,
  menu_item_id uuid references public.menu_items (id) on delete set null,
  confidence numeric not null default 1,
  created_at timestamptz not null default now()
);

create index if not exists idx_menu_name_map_normalized on public.menu_item_name_map (normalized_name);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.foodics_import_batches enable row level security;
alter table public.foodics_sales_items enable row level security;
alter table public.menu_item_name_map enable row level security;

drop policy if exists foodics_batches_auth on public.foodics_import_batches;
create policy foodics_batches_auth on public.foodics_import_batches
  for all to authenticated using (true) with check (true);

drop policy if exists foodics_sales_auth on public.foodics_sales_items;
create policy foodics_sales_auth on public.foodics_sales_items
  for all to authenticated using (true) with check (true);

drop policy if exists menu_name_map_auth on public.menu_item_name_map;
create policy menu_name_map_auth on public.menu_item_name_map
  for all to authenticated using (true) with check (true);

revoke all on public.foodics_import_batches from anon;
revoke all on public.foodics_sales_items from anon;
revoke all on public.menu_item_name_map from anon;

grant all on public.foodics_import_batches to authenticated;
grant all on public.foodics_sales_items to authenticated;
grant all on public.menu_item_name_map to authenticated;
