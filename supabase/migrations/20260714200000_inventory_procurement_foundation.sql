-- NAC OS Inventory + Procurement Intelligence foundation.
-- New isolated domain; no menu publishing, reviews, Vault authorization, or shared navigation changes.

create extension if not exists pg_trgm with schema extensions;

create or replace function public.inventory_normalize_text(p_value text)
returns text
language sql
immutable
parallel safe
as $$
  select trim(regexp_replace(
    lower(
      translate(
        coalesce(p_value, ''),
        'إأآٱىةؤئ',
        'اااايهوي'
      )
    ),
    '[^[:alnum:]\u0600-\u06ff]+',
    ' ',
    'g'
  ));
$$;

create table if not exists public.inventory_ingredients (
  id uuid primary key default gen_random_uuid(),
  canonical_name text not null,
  normalized_search_name text not null,
  description text,
  category text,
  base_inventory_unit text not null check (base_inventory_unit in ('each', 'gram', 'kilogram', 'millilitre', 'litre')),
  purchasing_unit text check (purchasing_unit is null or purchasing_unit in ('each', 'gram', 'kilogram', 'millilitre', 'litre')),
  yield_percentage numeric(7,4) not null default 100 check (yield_percentage > 0 and yield_percentage <= 100),
  scope text not null default 'network' check (scope in ('network', 'branch')),
  branch_id text check (branch_id is null or branch_id in ('khobar', 'riyadh', 'jeddah')),
  allergen_metadata jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_ingredients_scope_branch_check check (
    (scope = 'network' and branch_id is null) or
    (scope = 'branch' and branch_id is not null)
  )
);

create unique index if not exists inventory_ingredients_network_name_uidx
  on public.inventory_ingredients (normalized_search_name) where scope = 'network';
create unique index if not exists inventory_ingredients_branch_name_uidx
  on public.inventory_ingredients (branch_id, normalized_search_name) where scope = 'branch';
create index if not exists inventory_ingredients_search_trgm_idx
  on public.inventory_ingredients using gin (normalized_search_name extensions.gin_trgm_ops);
create index if not exists inventory_ingredients_branch_active_idx
  on public.inventory_ingredients (branch_id, active);

create table if not exists public.inventory_suppliers (
  id uuid primary key default gen_random_uuid(),
  supplier_name text not null,
  normalized_name text not null,
  legal_name text,
  vat_number text,
  contact_information jsonb not null default '{}'::jsonb,
  payment_terms text,
  currency text not null default 'SAR' check (currency ~ '^[A-Z]{3}$'),
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists inventory_suppliers_normalized_name_uidx
  on public.inventory_suppliers (normalized_name);
create unique index if not exists inventory_suppliers_vat_uidx
  on public.inventory_suppliers (vat_number) where vat_number is not null;
create index if not exists inventory_suppliers_search_trgm_idx
  on public.inventory_suppliers using gin (normalized_name extensions.gin_trgm_ops);

create table if not exists public.inventory_supplier_branches (
  supplier_id uuid not null references public.inventory_suppliers(id) on delete cascade,
  branch_id text not null check (branch_id in ('khobar', 'riyadh', 'jeddah')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (supplier_id, branch_id)
);

create table if not exists public.inventory_storage_locations (
  id uuid primary key default gen_random_uuid(),
  branch_id text not null check (branch_id in ('khobar', 'riyadh', 'jeddah')),
  name text not null,
  normalized_name text not null,
  location_type text not null default 'store'
    check (location_type in ('receiving', 'kitchen', 'pastry', 'bar', 'store', 'chiller', 'freezer', 'other')),
  is_default_receiving boolean not null default false,
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (branch_id, normalized_name)
);

create unique index if not exists inventory_storage_default_receiving_uidx
  on public.inventory_storage_locations (branch_id) where is_default_receiving and active;

create table if not exists public.inventory_supplier_catalogue_items (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.inventory_suppliers(id),
  supplier_sku text,
  original_product_name text not null,
  normalized_product_name text not null,
  ingredient_id uuid not null references public.inventory_ingredients(id),
  purchase_unit text not null check (purchase_unit in ('each', 'gram', 'kilogram', 'millilitre', 'litre')),
  pack_quantity numeric(20,8) not null default 1 check (pack_quantity > 0),
  pack_size numeric(20,8) not null default 1 check (pack_size > 0),
  pack_unit text not null check (pack_unit in ('each', 'gram', 'kilogram', 'millilitre', 'litre')),
  conversion_factor numeric(24,10) not null check (conversion_factor > 0),
  last_purchase_price numeric(20,6) check (last_purchase_price is null or last_purchase_price >= 0),
  last_purchase_at timestamptz,
  default_tax_rate numeric(7,4) not null default 0 check (default_tax_rate >= 0 and default_tax_rate <= 100),
  active boolean not null default true,
  verification_state text not null default 'unverified'
    check (verification_state in ('unverified', 'suggested', 'verified', 'rejected')),
  confidence numeric(5,4) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  created_by uuid references auth.users(id) on delete set null,
  verified_by uuid references auth.users(id) on delete set null,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists inventory_supplier_catalogue_sku_uidx
  on public.inventory_supplier_catalogue_items (supplier_id, supplier_sku)
  where supplier_sku is not null and active;
create index if not exists inventory_supplier_catalogue_name_idx
  on public.inventory_supplier_catalogue_items (supplier_id, normalized_product_name);
create index if not exists inventory_supplier_catalogue_name_trgm_idx
  on public.inventory_supplier_catalogue_items using gin (normalized_product_name extensions.gin_trgm_ops);
create index if not exists inventory_supplier_catalogue_ingredient_idx
  on public.inventory_supplier_catalogue_items (ingredient_id, supplier_id);

create table if not exists public.inventory_supplier_item_aliases (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.inventory_suppliers(id),
  catalogue_item_id uuid not null references public.inventory_supplier_catalogue_items(id),
  supplier_sku text,
  original_description text not null,
  normalized_description text not null,
  verification_state text not null default 'verified'
    check (verification_state in ('suggested', 'verified', 'rejected', 'retired')),
  confidence numeric(5,4) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  source_invoice_line_id uuid,
  created_by uuid references auth.users(id) on delete set null,
  verified_by uuid references auth.users(id) on delete set null,
  verified_at timestamptz,
  retired_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists inventory_supplier_alias_active_name_uidx
  on public.inventory_supplier_item_aliases (supplier_id, normalized_description, coalesce(supplier_sku, ''))
  where verification_state in ('suggested', 'verified');
create index if not exists inventory_supplier_alias_name_idx
  on public.inventory_supplier_item_aliases (supplier_id, normalized_description);

create table if not exists public.inventory_invoices (
  id uuid primary key default gen_random_uuid(),
  branch_id text not null check (branch_id in ('khobar', 'riyadh', 'jeddah')),
  supplier_id uuid references public.inventory_suppliers(id),
  source_filename text not null,
  storage_bucket text not null default 'inventory-invoices',
  storage_path text not null,
  mime_type text not null check (mime_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  file_size_bytes bigint check (file_size_bytes is null or file_size_bytes > 0),
  file_hash text not null check (file_hash ~ '^[a-f0-9]{64}$'),
  status text not null default 'uploaded' check (status in (
    'uploaded', 'ocr_processing', 'ocr_failed', 'extracted', 'needs_review',
    'approved', 'posted', 'rejected', 'duplicate', 'cancelled'
  )),
  ocr_status text not null default 'pending'
    check (ocr_status in ('pending', 'processing', 'completed', 'failed', 'not_required')),
  processing_status text not null default 'uploaded'
    check (processing_status in ('uploaded', 'processing', 'extracted', 'needs_review', 'ready', 'failed', 'posted')),
  approval_status text not null default 'pending'
    check (approval_status in ('pending', 'needs_review', 'approved', 'rejected', 'cancelled')),
  uploader_id uuid not null references auth.users(id),
  reviewer_id uuid references auth.users(id),
  approver_id uuid references auth.users(id),
  uploaded_at timestamptz not null default now(),
  reviewed_at timestamptz,
  approved_at timestamptz,
  posted_at timestamptz,
  invoice_date date,
  delivery_date date,
  effective_receipt_date date,
  invoice_number text,
  purchase_order_reference text,
  currency text not null default 'SAR' check (currency ~ '^[A-Z]{3}$'),
  subtotal numeric(20,6),
  discount numeric(20,6) not null default 0,
  tax numeric(20,6) not null default 0,
  total numeric(20,6),
  ocr_confidence numeric(5,4) check (ocr_confidence is null or (ocr_confidence >= 0 and ocr_confidence <= 1)),
  duplicate_status text not null default 'unchecked'
    check (duplicate_status in ('unchecked', 'clear', 'warning', 'confirmed_duplicate', 'overridden')),
  duplicate_of_invoice_id uuid references public.inventory_invoices(id),
  line_fingerprint text,
  raw_ocr_text text,
  structured_extraction jsonb,
  ocr_evidence jsonb not null default '[]'::jsonb,
  ocr_provider text,
  ocr_model_version text,
  ocr_provider_metadata jsonb not null default '{}'::jsonb,
  ocr_processed_at timestamptz,
  notes text,
  failure_details jsonb,
  posted_receipt_id uuid,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (idempotency_key),
  unique (storage_bucket, storage_path)
);

create index if not exists inventory_invoices_branch_date_idx
  on public.inventory_invoices (branch_id, invoice_date desc);
create index if not exists inventory_invoices_supplier_number_idx
  on public.inventory_invoices (supplier_id, invoice_number);
create index if not exists inventory_invoices_file_hash_idx
  on public.inventory_invoices (file_hash);
create index if not exists inventory_invoices_status_idx
  on public.inventory_invoices (branch_id, status, uploaded_at desc);
create unique index if not exists inventory_invoices_posted_supplier_number_uidx
  on public.inventory_invoices (supplier_id, invoice_number)
  where status = 'posted' and invoice_number is not null;

create table if not exists public.inventory_ocr_requests (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.inventory_invoices(id) on delete cascade,
  idempotency_key text not null unique,
  provider text,
  model_version text,
  status text not null default 'queued' check (status in ('queued', 'processing', 'completed', 'failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  requested_by uuid not null references auth.users(id),
  started_at timestamptz,
  completed_at timestamptz,
  error_details jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.inventory_invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.inventory_invoices(id) on delete cascade,
  line_number integer not null check (line_number > 0),
  page_number integer,
  original_description text not null,
  normalized_description text,
  supplier_sku text,
  original_quantity numeric(20,8),
  original_unit text,
  pack_quantity numeric(20,8),
  pack_size numeric(20,8),
  pack_unit text,
  conversion_factor numeric(24,10),
  canonical_received_quantity numeric(24,10),
  canonical_unit text check (canonical_unit is null or canonical_unit in ('each', 'gram', 'kilogram', 'millilitre', 'litre')),
  unit_price numeric(20,6),
  line_discount numeric(20,6) not null default 0,
  tax_rate numeric(7,4),
  tax_amount numeric(20,6) not null default 0,
  line_total numeric(20,6),
  ingredient_id uuid references public.inventory_ingredients(id),
  supplier_catalogue_item_id uuid references public.inventory_supplier_catalogue_items(id),
  matching_confidence numeric(5,4) check (matching_confidence is null or (matching_confidence >= 0 and matching_confidence <= 1)),
  match_method text check (match_method is null or match_method in (
    'exact_supplier_sku', 'exact_verified_alias', 'normalized_text_alias',
    'supplier_catalogue_similarity', 'canonical_ingredient_similarity',
    'ai_suggestion', 'manual_review'
  )),
  match_candidates jsonb not null default '[]'::jsonb,
  manually_overridden boolean not null default false,
  verified_by uuid references auth.users(id),
  verified_at timestamptz,
  ocr_confidence numeric(5,4) check (ocr_confidence is null or (ocr_confidence >= 0 and ocr_confidence <= 1)),
  evidence jsonb not null default '{}'::jsonb,
  manual_overrides jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  review_status text not null default 'pending'
    check (review_status in ('pending', 'auto_matched', 'needs_review', 'verified', 'ignored')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (invoice_id, line_number)
);

alter table public.inventory_supplier_item_aliases
  drop constraint if exists inventory_supplier_item_aliases_source_invoice_line_id_fkey;
alter table public.inventory_supplier_item_aliases
  add constraint inventory_supplier_item_aliases_source_invoice_line_id_fkey
  foreign key (source_invoice_line_id) references public.inventory_invoice_lines(id) on delete set null;

create index if not exists inventory_invoice_lines_pending_idx
  on public.inventory_invoice_lines (invoice_id, review_status) where active;
create index if not exists inventory_invoice_lines_ingredient_idx
  on public.inventory_invoice_lines (ingredient_id);
create index if not exists inventory_invoice_lines_supplier_sku_idx
  on public.inventory_invoice_lines (supplier_sku);

create table if not exists public.inventory_invoice_exceptions (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.inventory_invoices(id) on delete cascade,
  invoice_line_id uuid references public.inventory_invoice_lines(id) on delete cascade,
  exception_type text not null,
  severity text not null check (severity in ('info', 'warning', 'review', 'blocking')),
  status text not null default 'open' check (status in ('open', 'acknowledged', 'resolved', 'dismissed')),
  message text not null,
  details jsonb not null default '{}'::jsonb,
  acknowledged_by uuid references auth.users(id),
  acknowledged_at timestamptz,
  resolved_by uuid references auth.users(id),
  resolved_at timestamptz,
  resolution_reason text,
  created_at timestamptz not null default now()
);

create index if not exists inventory_invoice_exceptions_open_idx
  on public.inventory_invoice_exceptions (invoice_id, severity) where status = 'open';

create table if not exists public.inventory_purchase_receipts (
  id uuid primary key default gen_random_uuid(),
  branch_id text not null check (branch_id in ('khobar', 'riyadh', 'jeddah')),
  supplier_id uuid not null references public.inventory_suppliers(id),
  invoice_id uuid not null unique references public.inventory_invoices(id),
  purchase_order_reference text,
  storage_location_id uuid not null references public.inventory_storage_locations(id),
  effective_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  received_by uuid references auth.users(id),
  approved_by uuid not null references auth.users(id),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  subtotal numeric(20,6) not null,
  discount numeric(20,6) not null default 0,
  tax numeric(20,6) not null default 0,
  total numeric(20,6) not null,
  source_reference text not null,
  status text not null default 'posted' check (status in ('posted', 'reversed')),
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.inventory_invoices
  drop constraint if exists inventory_invoices_posted_receipt_id_fkey;
alter table public.inventory_invoices
  add constraint inventory_invoices_posted_receipt_id_fkey
  foreign key (posted_receipt_id) references public.inventory_purchase_receipts(id);

create table if not exists public.inventory_purchase_receipt_lines (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.inventory_purchase_receipts(id),
  invoice_line_id uuid not null unique references public.inventory_invoice_lines(id),
  line_number integer not null,
  original_description text not null,
  normalized_description text,
  supplier_sku text,
  ingredient_id uuid not null references public.inventory_ingredients(id),
  supplier_catalogue_item_id uuid references public.inventory_supplier_catalogue_items(id),
  original_quantity numeric(20,8) not null,
  original_unit text not null,
  pack_quantity numeric(20,8) not null,
  pack_size numeric(20,8) not null,
  pack_unit text not null,
  conversion_factor numeric(24,10) not null,
  canonical_quantity numeric(24,10) not null check (canonical_quantity > 0),
  canonical_unit text not null check (canonical_unit in ('each', 'gram', 'kilogram', 'millilitre', 'litre')),
  unit_price numeric(20,6) not null,
  unit_cost_canonical numeric(24,10) not null,
  line_discount numeric(20,6) not null default 0,
  tax_rate numeric(7,4),
  tax_amount numeric(20,6) not null default 0,
  line_total numeric(20,6) not null,
  match_method text,
  matching_confidence numeric(5,4),
  interpretation_snapshot jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  branch_id text not null check (branch_id in ('khobar', 'riyadh', 'jeddah')),
  storage_location_id uuid not null references public.inventory_storage_locations(id),
  ingredient_id uuid not null references public.inventory_ingredients(id),
  movement_type text not null check (movement_type in (
    'opening_balance', 'purchase_receipt', 'transfer_in', 'transfer_out',
    'production_in', 'production_out', 'sale_consumption', 'wastage',
    'staff_meal', 'complimentary', 'physical_count_adjustment',
    'manual_adjustment', 'correction', 'return_to_supplier'
  )),
  signed_canonical_quantity numeric(24,10) not null check (signed_canonical_quantity <> 0),
  canonical_unit text not null check (canonical_unit in ('each', 'gram', 'kilogram', 'millilitre', 'litre')),
  original_quantity numeric(20,8),
  original_unit text,
  conversion_factor numeric(24,10),
  unit_cost numeric(24,10),
  total_cost numeric(24,10),
  effective_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  actor_id uuid references auth.users(id),
  source_type text not null,
  source_id uuid,
  invoice_id uuid references public.inventory_invoices(id),
  receipt_id uuid references public.inventory_purchase_receipts(id),
  receipt_line_id uuid references public.inventory_purchase_receipt_lines(id),
  supplier_id uuid references public.inventory_suppliers(id),
  idempotency_key text not null unique,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  reversal_of_movement_id uuid references public.inventory_movements(id),
  status text not null default 'posted' check (status in ('posted', 'reversed')),
  created_at timestamptz not null default now()
);

create index if not exists inventory_movements_balance_idx
  on public.inventory_movements (branch_id, storage_location_id, ingredient_id, effective_at);
create index if not exists inventory_movements_ingredient_effective_idx
  on public.inventory_movements (ingredient_id, effective_at desc);
create index if not exists inventory_movements_source_idx
  on public.inventory_movements (source_type, source_id);
create index if not exists inventory_movements_receipt_idx
  on public.inventory_movements (receipt_id);

create table if not exists public.inventory_ingredient_cost_history (
  id uuid primary key default gen_random_uuid(),
  branch_id text not null check (branch_id in ('khobar', 'riyadh', 'jeddah')),
  ingredient_id uuid not null references public.inventory_ingredients(id),
  supplier_id uuid references public.inventory_suppliers(id),
  invoice_id uuid references public.inventory_invoices(id),
  receipt_id uuid references public.inventory_purchase_receipts(id),
  receipt_line_id uuid references public.inventory_purchase_receipt_lines(id),
  purchase_date date not null,
  purchase_quantity numeric(20,8) not null,
  canonical_quantity numeric(24,10) not null,
  purchase_unit_cost numeric(20,6) not null,
  canonical_unit text not null,
  canonical_unit_cost numeric(24,10) not null,
  currency text not null,
  tax_exclusive_cost numeric(20,6) not null,
  tax_inclusive_cost numeric(20,6),
  allocated_discount numeric(20,6) not null default 0,
  previous_purchase_price numeric(24,10),
  percentage_price_change numeric(16,8),
  weighted_average_cost numeric(24,10) not null,
  stock_quantity_after numeric(24,10) not null,
  costing_method text not null default 'weighted_average',
  effective_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  idempotency_key text not null unique,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists inventory_cost_history_lookup_idx
  on public.inventory_ingredient_cost_history (branch_id, ingredient_id, effective_at desc, recorded_at desc);
create index if not exists inventory_cost_history_supplier_idx
  on public.inventory_ingredient_cost_history (supplier_id, ingredient_id, effective_at desc);

create table if not exists public.inventory_ingredient_cost_state (
  branch_id text not null check (branch_id in ('khobar', 'riyadh', 'jeddah')),
  ingredient_id uuid not null references public.inventory_ingredients(id),
  current_quantity numeric(24,10) not null default 0,
  weighted_average_cost numeric(24,10) not null default 0,
  last_purchase_price numeric(24,10),
  last_purchase_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (branch_id, ingredient_id)
);

create table if not exists public.inventory_price_variance_alerts (
  id uuid primary key default gen_random_uuid(),
  branch_id text not null,
  ingredient_id uuid not null references public.inventory_ingredients(id),
  supplier_id uuid references public.inventory_suppliers(id),
  invoice_id uuid references public.inventory_invoices(id),
  invoice_line_id uuid references public.inventory_invoice_lines(id),
  alert_type text not null check (alert_type in (
    'price_increase', 'price_decrease', 'price_threshold', 'quantity_unit_mismatch',
    'pack_size_change', 'supplier_history_outlier', 'invoice_total_mismatch',
    'tax_mismatch', 'cheaper_supplier_available'
  )),
  previous_value numeric(24,10),
  current_value numeric(24,10),
  percentage_change numeric(16,8),
  threshold_percentage numeric(10,4),
  comparison_details jsonb not null default '{}'::jsonb,
  status text not null default 'open' check (status in ('open', 'acknowledged', 'resolved', 'dismissed')),
  acknowledged_by uuid references auth.users(id),
  acknowledged_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists inventory_price_variance_open_idx
  on public.inventory_price_variance_alerts (branch_id, status, created_at desc);

create table if not exists public.inventory_recipes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  normalized_name text not null,
  recipe_type text not null default 'menu_item' check (recipe_type in ('menu_item', 'preparation', 'sub_recipe')),
  menu_item_id uuid,
  branch_id text check (branch_id is null or branch_id in ('khobar', 'riyadh', 'jeddah')),
  output_quantity numeric(20,8) not null default 1 check (output_quantity > 0),
  output_unit text not null check (output_unit in ('each', 'gram', 'kilogram', 'millilitre', 'litre')),
  active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists inventory_recipes_menu_item_idx
  on public.inventory_recipes (menu_item_id, branch_id) where active;

create table if not exists public.inventory_recipe_versions (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.inventory_recipes(id),
  version_number integer not null check (version_number > 0),
  effective_from timestamptz not null,
  effective_to timestamptz,
  status text not null default 'draft' check (status in ('draft', 'active', 'retired')),
  yield_percentage numeric(7,4) not null default 100 check (yield_percentage > 0 and yield_percentage <= 100),
  created_by uuid references auth.users(id),
  approved_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (recipe_id, version_number),
  check (effective_to is null or effective_to > effective_from)
);

create table if not exists public.inventory_recipe_version_lines (
  id uuid primary key default gen_random_uuid(),
  recipe_version_id uuid not null references public.inventory_recipe_versions(id) on delete cascade,
  ingredient_id uuid references public.inventory_ingredients(id),
  sub_recipe_id uuid references public.inventory_recipes(id),
  quantity numeric(20,8) not null check (quantity > 0),
  unit text not null,
  canonical_quantity numeric(24,10) not null check (canonical_quantity > 0),
  canonical_unit text not null check (canonical_unit in ('each', 'gram', 'kilogram', 'millilitre', 'litre')),
  yield_waste_factor numeric(12,8) not null default 1 check (yield_waste_factor > 0),
  created_at timestamptz not null default now(),
  constraint inventory_recipe_line_source_check check (
    (ingredient_id is not null and sub_recipe_id is null) or
    (ingredient_id is null and sub_recipe_id is not null)
  )
);

create table if not exists public.inventory_recipe_cost_snapshots (
  id uuid primary key default gen_random_uuid(),
  branch_id text not null,
  recipe_id uuid not null references public.inventory_recipes(id),
  recipe_version_id uuid not null references public.inventory_recipe_versions(id),
  total_cost numeric(24,10) not null,
  output_unit_cost numeric(24,10) not null,
  currency text not null default 'SAR',
  effective_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  source_cost_history_ids uuid[] not null default '{}',
  calculation_details jsonb not null default '{}'::jsonb,
  idempotency_key text not null unique
);

create index if not exists inventory_recipe_cost_asof_idx
  on public.inventory_recipe_cost_snapshots (branch_id, recipe_id, effective_at desc);

create table if not exists public.inventory_menu_item_margin_snapshots (
  id uuid primary key default gen_random_uuid(),
  branch_id text not null,
  menu_item_id uuid not null,
  recipe_id uuid not null references public.inventory_recipes(id),
  selling_price numeric(20,6) not null,
  tax_rate numeric(7,4) not null default 15,
  selling_price_includes_tax boolean not null default true,
  recipe_cost numeric(24,10) not null,
  food_cost_percentage numeric(16,8),
  gross_profit numeric(24,10),
  gross_margin_percentage numeric(16,8),
  previous_recipe_cost numeric(24,10),
  cost_change_percentage numeric(16,8),
  price_sensitivity jsonb not null default '{}'::jsonb,
  effective_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  idempotency_key text not null unique
);

create index if not exists inventory_menu_margin_asof_idx
  on public.inventory_menu_item_margin_snapshots (branch_id, menu_item_id, effective_at desc);

create table if not exists public.inventory_stock_counts (
  id uuid primary key default gen_random_uuid(),
  branch_id text not null,
  storage_location_id uuid not null references public.inventory_storage_locations(id),
  effective_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  status text not null default 'draft' check (status in ('draft', 'submitted', 'approved', 'posted', 'rejected', 'cancelled')),
  created_by uuid not null references auth.users(id),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  idempotency_key text not null unique,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.inventory_stock_count_lines (
  id uuid primary key default gen_random_uuid(),
  stock_count_id uuid not null references public.inventory_stock_counts(id) on delete cascade,
  ingredient_id uuid not null references public.inventory_ingredients(id),
  expected_quantity numeric(24,10) not null,
  counted_quantity numeric(24,10) not null,
  variance_quantity numeric(24,10) generated always as (counted_quantity - expected_quantity) stored,
  canonical_unit text not null,
  adjustment_movement_id uuid references public.inventory_movements(id),
  notes text,
  unique (stock_count_id, ingredient_id)
);

create table if not exists public.inventory_audit_log (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  actor_id uuid references auth.users(id),
  branch_id text,
  entity_type text not null,
  entity_id uuid,
  previous_value jsonb,
  new_value jsonb,
  source text not null default 'nac_os',
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists inventory_audit_entity_idx
  on public.inventory_audit_log (entity_type, entity_id, created_at desc);
create index if not exists inventory_audit_branch_idx
  on public.inventory_audit_log (branch_id, created_at desc);

create or replace view public.inventory_current_stock
with (security_invoker = true)
as
select
  m.branch_id,
  m.storage_location_id,
  m.ingredient_id,
  m.canonical_unit,
  sum(m.signed_canonical_quantity) as canonical_quantity,
  max(m.recorded_at) as last_recorded_at,
  max(m.effective_at) as last_effective_at,
  coalesce(cs.weighted_average_cost, 0::numeric) as weighted_average_cost,
  sum(m.signed_canonical_quantity) * coalesce(cs.weighted_average_cost, 0::numeric) as inventory_value
from public.inventory_movements m
left join public.inventory_ingredient_cost_state cs
  on cs.branch_id = m.branch_id and cs.ingredient_id = m.ingredient_id
where m.status = 'posted'
group by m.branch_id, m.storage_location_id, m.ingredient_id, m.canonical_unit, cs.weighted_average_cost;

comment on view public.inventory_current_stock is
  'Derived stock only. No mutable current-stock quantity is stored.';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'inventory-invoices',
  'inventory-invoices',
  false,
  52428800,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
