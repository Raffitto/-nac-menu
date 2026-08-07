-- Real NAC data readiness.
-- Additive control metadata only: no menu, recipe, movement, cost-history, or sales-history rewrite.

create table if not exists public.inventory_menu_item_costing_intents (
  id uuid primary key default gen_random_uuid(),
  branch_id text not null,
  menu_item_id uuid not null references public.menu_items(id),
  costing_intent text not null check (costing_intent in (
    'recipe_required', 'direct_stock', 'modifier_addon', 'free_non_cost_bearing',
    'composite_prep', 'intentionally_excluded', 'unresolved'
  )),
  status text not null default 'confirmed' check (status in ('confirmed', 'needs_review', 'retired')),
  notes text,
  evidence jsonb not null default '{}'::jsonb,
  confirmed_by uuid not null references auth.users(id),
  confirmed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (branch_id, menu_item_id)
);

create table if not exists public.inventory_sales_consumption_batches (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null unique references public.foodics_import_batches(id),
  branch_id text not null,
  status text not null default 'pending' check (status in (
    'pending', 'approved', 'rejected', 'superseded'
  )),
  quantity_semantics text not null default 'unknown' check (quantity_semantics in (
    'unknown', 'net_of_voids_refunds', 'gross_without_void_detail'
  )),
  source_granularity text not null default 'period' check (source_granularity in (
    'daily', 'period'
  )),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  review_reason text,
  source_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists inventory_sales_consumption_approved_period_uidx
  on public.inventory_sales_consumption_batches (branch_id, batch_id)
  where status = 'approved';
create index if not exists inventory_sales_consumption_branch_status_idx
  on public.inventory_sales_consumption_batches (branch_id, status, updated_at desc);

create table if not exists public.inventory_addon_consumption_rules (
  id uuid primary key default gen_random_uuid(),
  addon_id uuid not null references public.add_ons(id),
  scope text not null default 'network' check (scope in ('network', 'branch')),
  branch_id text,
  effect_type text not null check (effect_type in (
    'ADDITIVE', 'REPLACEMENT', 'NO_STOCK_EFFECT'
  )),
  recipe_id uuid references public.inventory_recipes(id),
  replaced_ingredient_id uuid references public.inventory_ingredients(id),
  replaced_quantity numeric(24,10),
  replaced_unit text,
  active boolean not null default true,
  notes text,
  evidence jsonb not null default '{}'::jsonb,
  confirmed_by uuid not null references auth.users(id),
  confirmed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (scope = 'network' and branch_id is null)
    or (scope = 'branch' and branch_id is not null)
  ),
  check (
    (effect_type = 'NO_STOCK_EFFECT' and recipe_id is null and replaced_ingredient_id is null)
    or (effect_type = 'ADDITIVE' and recipe_id is not null and replaced_ingredient_id is null)
    or (
      effect_type = 'REPLACEMENT'
      and recipe_id is not null
      and replaced_ingredient_id is not null
      and replaced_quantity > 0
      and replaced_unit is not null
    )
  )
);

create unique index if not exists inventory_addon_rule_network_uidx
  on public.inventory_addon_consumption_rules (addon_id)
  where scope = 'network' and active;
create unique index if not exists inventory_addon_rule_branch_uidx
  on public.inventory_addon_consumption_rules (branch_id, addon_id)
  where scope = 'branch' and active;

create table if not exists public.inventory_sales_modifier_aliases (
  id uuid primary key default gen_random_uuid(),
  branch_id text not null,
  normalized_source_name text not null,
  source_name text not null,
  addon_id uuid not null references public.add_ons(id),
  status text not null default 'confirmed' check (status in ('confirmed', 'retired')),
  confirmed_by uuid not null references auth.users(id),
  confirmed_at timestamptz not null default now(),
  evidence jsonb not null default '{}'::jsonb,
  unique (branch_id, normalized_source_name)
);

alter table public.inventory_menu_item_costing_intents enable row level security;
alter table public.inventory_sales_consumption_batches enable row level security;
alter table public.inventory_addon_consumption_rules enable row level security;
alter table public.inventory_sales_modifier_aliases enable row level security;

revoke all on public.inventory_menu_item_costing_intents from anon, authenticated;
revoke all on public.inventory_sales_consumption_batches from anon, authenticated;
revoke all on public.inventory_addon_consumption_rules from anon, authenticated;
revoke all on public.inventory_sales_modifier_aliases from anon, authenticated;
grant select on public.inventory_menu_item_costing_intents to authenticated;
grant select on public.inventory_sales_consumption_batches to authenticated;
grant select on public.inventory_addon_consumption_rules to authenticated;
grant select on public.inventory_sales_modifier_aliases to authenticated;

create policy inventory_menu_costing_intents_select
on public.inventory_menu_item_costing_intents
for select to authenticated
using (public.inventory_branch_allowed(branch_id));

create policy inventory_sales_consumption_batches_select
on public.inventory_sales_consumption_batches
for select to authenticated
using (public.inventory_branch_allowed(branch_id));

create policy inventory_addon_rules_select
on public.inventory_addon_consumption_rules
for select to authenticated
using (
  (scope = 'network' and public.ask_nac_has_any_branch_access())
  or (scope = 'branch' and public.inventory_branch_allowed(branch_id))
);

create policy inventory_modifier_aliases_select
on public.inventory_sales_modifier_aliases
for select to authenticated
using (public.inventory_branch_allowed(branch_id));

-- Existing Foodics imports were authenticated-wide. The inventory consumption path
-- requires branch isolation while preserving current authenticated CRUD behavior.
drop policy if exists foodics_batches_auth on public.foodics_import_batches;
drop policy if exists foodics_sales_auth on public.foodics_sales_items;

create policy foodics_batches_branch_select
on public.foodics_import_batches for select to authenticated
using (public.ask_nac_vault_branch_allowed(branch_id));
create policy foodics_batches_branch_insert
on public.foodics_import_batches for insert to authenticated
with check (public.ask_nac_vault_branch_allowed(branch_id));
create policy foodics_batches_branch_update
on public.foodics_import_batches for update to authenticated
using (public.ask_nac_vault_branch_allowed(branch_id))
with check (public.ask_nac_vault_branch_allowed(branch_id));
create policy foodics_batches_branch_delete
on public.foodics_import_batches for delete to authenticated
using (public.ask_nac_vault_branch_allowed(branch_id));

create policy foodics_sales_branch_select
on public.foodics_sales_items for select to authenticated
using (public.ask_nac_vault_branch_allowed(branch_id));
create policy foodics_sales_branch_insert
on public.foodics_sales_items for insert to authenticated
with check (public.ask_nac_vault_branch_allowed(branch_id));
create policy foodics_sales_branch_update
on public.foodics_sales_items for update to authenticated
using (public.ask_nac_vault_branch_allowed(branch_id))
with check (public.ask_nac_vault_branch_allowed(branch_id));
create policy foodics_sales_branch_delete
on public.foodics_sales_items for delete to authenticated
using (public.ask_nac_vault_branch_allowed(branch_id));

create or replace function public.inventory_set_menu_item_costing_intent(
  p_branch_id text,
  p_menu_item_id uuid,
  p_costing_intent text,
  p_reason text,
  p_evidence jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_intent public.inventory_menu_item_costing_intents%rowtype;
  v_previous public.inventory_menu_item_costing_intents%rowtype;
  v_menu public.menu_items%rowtype;
begin
  if p_costing_intent not in (
    'recipe_required', 'direct_stock', 'modifier_addon', 'free_non_cost_bearing',
    'composite_prep', 'intentionally_excluded', 'unresolved'
  ) then
    raise exception 'Invalid menu-item costing intent';
  end if;
  if nullif(trim(p_reason), '') is null then
    raise exception 'Costing-intent confirmation reason is required';
  end if;
  if not public.inventory_can_approve(p_branch_id) then
    raise exception 'Menu-item costing intent denied' using errcode = '42501';
  end if;
  select * into v_menu
  from public.menu_items m
  where m.id = p_menu_item_id and m.branch_id = p_branch_id;
  if not found then
    raise exception 'Menu item is not available for branch' using errcode = '42501';
  end if;

  select * into v_previous
  from public.inventory_menu_item_costing_intents
  where branch_id = p_branch_id and menu_item_id = p_menu_item_id
  for update;

  insert into public.inventory_menu_item_costing_intents (
    branch_id, menu_item_id, costing_intent, status, notes, evidence,
    confirmed_by, confirmed_at
  )
  select
    p_branch_id, placement.id, p_costing_intent, 'confirmed',
    trim(p_reason), coalesce(p_evidence, '{}'::jsonb), auth.uid(), now()
  from public.menu_items placement
  where placement.branch_id = p_branch_id
    and (
      placement.id = p_menu_item_id
      or (
        v_menu.placement_group_id is not null
        and placement.placement_group_id = v_menu.placement_group_id
      )
    )
  on conflict (branch_id, menu_item_id)
  do update set
    costing_intent = excluded.costing_intent,
    status = 'confirmed',
    notes = excluded.notes,
    evidence = excluded.evidence,
    confirmed_by = auth.uid(),
    confirmed_at = now(),
    updated_at = now();

  select * into v_intent
  from public.inventory_menu_item_costing_intents
  where branch_id = p_branch_id and menu_item_id = p_menu_item_id;

  insert into public.inventory_audit_log (
    event_type, actor_id, branch_id, entity_type, entity_id,
    previous_value, new_value, reason, metadata
  ) values (
    'menu_item_costing_intent_confirmed', auth.uid(), p_branch_id,
    'inventory_menu_item_costing_intent', v_intent.id,
    case when v_previous.id is null then null else to_jsonb(v_previous) end,
    to_jsonb(v_intent), trim(p_reason),
    jsonb_build_object(
      'menuItemId', p_menu_item_id,
      'placementGroupId', v_menu.placement_group_id,
      'sourceHistoryChanged', false
    )
  );
  return to_jsonb(v_intent);
end;
$$;

create or replace function public.inventory_review_sales_consumption_batch(
  p_batch_id uuid,
  p_status text,
  p_quantity_semantics text,
  p_reason text,
  p_source_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch public.foodics_import_batches%rowtype;
  v_review public.inventory_sales_consumption_batches%rowtype;
  v_previous public.inventory_sales_consumption_batches%rowtype;
begin
  if p_status not in ('approved', 'rejected', 'superseded') then
    raise exception 'Invalid sales-source review status';
  end if;
  if p_quantity_semantics not in (
    'unknown', 'net_of_voids_refunds', 'gross_without_void_detail'
  ) then
    raise exception 'Invalid sales quantity semantics';
  end if;
  if nullif(trim(p_reason), '') is null then
    raise exception 'Sales-source review reason is required';
  end if;

  select * into v_batch from public.foodics_import_batches
  where id = p_batch_id for update;
  if not found or not public.inventory_can_approve(v_batch.branch_id) then
    raise exception 'Sales-source review denied' using errcode = '42501';
  end if;
  if p_status = 'approved' and p_quantity_semantics <> 'net_of_voids_refunds' then
    raise exception 'Theoretical consumption requires confirmed net-of-void/refund quantity semantics';
  end if;
  if p_status = 'approved' and not exists (
    select 1 from public.foodics_sales_items s where s.batch_id = p_batch_id
  ) then
    raise exception 'Cannot approve an empty sales batch';
  end if;
  if p_status = 'approved' and exists (
    select 1 from public.foodics_sales_items s
    where s.batch_id = p_batch_id
      and (
        s.branch_id <> v_batch.branch_id
        or s.period_start <> v_batch.period_start
        or s.period_end <> v_batch.period_end
      )
  ) then
    raise exception 'Sales batch contains rows with mismatched branch or period';
  end if;
  if p_status = 'approved' and exists (
    select 1
    from public.inventory_sales_consumption_batches selected
    join public.foodics_import_batches other on other.id = selected.batch_id
    where selected.branch_id = v_batch.branch_id
      and selected.status = 'approved'
      and selected.batch_id <> p_batch_id
      and daterange(other.period_start, other.period_end, '[]')
        && daterange(v_batch.period_start, v_batch.period_end, '[]')
  ) then
    raise exception 'Approved sales-consumption periods cannot overlap';
  end if;

  select * into v_previous
  from public.inventory_sales_consumption_batches
  where batch_id = p_batch_id
  for update;

  insert into public.inventory_sales_consumption_batches (
    batch_id, branch_id, status, quantity_semantics, source_granularity,
    reviewed_by, reviewed_at, review_reason, source_metadata
  ) values (
    p_batch_id, v_batch.branch_id, p_status, p_quantity_semantics, 'period',
    auth.uid(), now(), trim(p_reason), coalesce(p_source_metadata, '{}'::jsonb)
  )
  on conflict (batch_id)
  do update set
    status = excluded.status,
    quantity_semantics = excluded.quantity_semantics,
    source_granularity = excluded.source_granularity,
    reviewed_by = auth.uid(),
    reviewed_at = now(),
    review_reason = excluded.review_reason,
    source_metadata = excluded.source_metadata,
    updated_at = now()
  returning * into v_review;

  insert into public.inventory_audit_log (
    event_type, actor_id, branch_id, entity_type, entity_id,
    previous_value, new_value, reason, metadata
  ) values (
    'sales_consumption_batch_reviewed', auth.uid(), v_batch.branch_id,
    'inventory_sales_consumption_batch', v_review.id,
    case when v_previous.id is null then null else to_jsonb(v_previous) end,
    to_jsonb(v_review), trim(p_reason),
    jsonb_build_object(
      'batchId', p_batch_id,
      'periodStart', v_batch.period_start,
      'periodEnd', v_batch.period_end,
      'salesHistoryChanged', false
    )
  );
  return to_jsonb(v_review);
end;
$$;

create or replace function public.inventory_link_menu_item_recipe(
  p_branch_id text,
  p_menu_item_id uuid,
  p_recipe_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_menu public.menu_items%rowtype;
  v_recipe public.inventory_recipes%rowtype;
  v_previous public.inventory_recipes%rowtype;
begin
  if nullif(trim(p_reason), '') is null then
    raise exception 'Recipe-link reason is required';
  end if;
  if not public.inventory_can_approve(p_branch_id) then
    raise exception 'Recipe linkage denied' using errcode = '42501';
  end if;
  select * into v_menu from public.menu_items
  where id = p_menu_item_id and branch_id = p_branch_id for update;
  if not found then
    raise exception 'Menu item is not available for branch' using errcode = '42501';
  end if;
  select * into v_recipe from public.inventory_recipes
  where id = p_recipe_id for update;
  if not found or not v_recipe.active
    or v_recipe.recipe_type not in ('menu_item', 'direct_stock')
    or (v_recipe.branch_id is not null and v_recipe.branch_id <> p_branch_id)
  then
    raise exception 'Recipe is not linkable for branch';
  end if;
  if v_recipe.menu_item_id is not null and v_recipe.menu_item_id <> p_menu_item_id then
    raise exception 'Recipe is already linked to another menu item';
  end if;
  if exists (
    select 1 from public.inventory_recipes existing
    where existing.id <> p_recipe_id
      and existing.active
      and (
        existing.menu_item_id = p_menu_item_id
        or (
          v_menu.placement_group_id is not null
          and existing.placement_group_id = v_menu.placement_group_id
        )
      )
  ) then
    raise exception 'Menu item already has an active recipe';
  end if;
  v_previous := v_recipe;

  update public.inventory_recipes
  set menu_item_id = p_menu_item_id,
      placement_group_id = coalesce(placement_group_id, v_menu.placement_group_id),
      updated_by = auth.uid(),
      updated_at = now()
  where id = p_recipe_id
  returning * into v_recipe;

  insert into public.inventory_audit_log (
    event_type, actor_id, branch_id, entity_type, entity_id,
    previous_value, new_value, reason, metadata
  ) values (
    'menu_item_recipe_linked', auth.uid(), p_branch_id,
    'inventory_recipe', v_recipe.id, to_jsonb(v_previous), to_jsonb(v_recipe),
    trim(p_reason), jsonb_build_object(
      'menuItemId', p_menu_item_id,
      'recipeVersionsChanged', false
    )
  );
  return to_jsonb(v_recipe);
end;
$$;

create or replace function public.inventory_set_addon_consumption_rule(
  p_branch_id text,
  p_addon_id uuid,
  p_effect_type text,
  p_recipe_id uuid,
  p_replaced_ingredient_id uuid,
  p_replaced_quantity numeric,
  p_replaced_unit text,
  p_source_names text[],
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rule public.inventory_addon_consumption_rules%rowtype;
  v_source_name text;
  v_normalized text;
begin
  if p_effect_type not in ('ADDITIVE', 'REPLACEMENT', 'NO_STOCK_EFFECT') then
    raise exception 'Invalid add-on inventory effect';
  end if;
  if nullif(trim(p_reason), '') is null then
    raise exception 'Add-on rule confirmation reason is required';
  end if;
  if not public.inventory_can_approve(p_branch_id) then
    raise exception 'Add-on rule update denied' using errcode = '42501';
  end if;
  if not exists (select 1 from public.add_ons where id = p_addon_id) then
    raise exception 'Add-on does not exist';
  end if;
  if p_effect_type in ('ADDITIVE', 'REPLACEMENT') and not exists (
    select 1 from public.inventory_recipes r
    where r.id = p_recipe_id and r.active
      and (r.branch_id is null or r.branch_id = p_branch_id)
  ) then
    raise exception 'Add-on recipe is not active for branch';
  end if;
  if p_effect_type = 'REPLACEMENT' and (
    p_replaced_ingredient_id is null
    or coalesce(p_replaced_quantity, 0) <= 0
    or nullif(trim(p_replaced_unit), '') is null
  ) then
    raise exception 'Replacement add-on requires the replaced item, quantity, and unit';
  end if;
  if p_effect_type = 'REPLACEMENT' and not exists (
    select 1 from public.inventory_ingredients i
    where i.id = p_replaced_ingredient_id
      and i.base_inventory_unit = p_replaced_unit
      and (i.branch_id is null or i.branch_id = p_branch_id)
  ) then
    raise exception 'Replacement item/unit is not available for branch';
  end if;

  update public.inventory_addon_consumption_rules
  set active = false, updated_at = now()
  where addon_id = p_addon_id and scope = 'branch' and branch_id = p_branch_id and active;

  insert into public.inventory_addon_consumption_rules (
    addon_id, scope, branch_id, effect_type, recipe_id,
    replaced_ingredient_id, replaced_quantity, replaced_unit,
    notes, confirmed_by
  ) values (
    p_addon_id, 'branch', p_branch_id, p_effect_type,
    case when p_effect_type = 'NO_STOCK_EFFECT' then null else p_recipe_id end,
    case when p_effect_type = 'REPLACEMENT' then p_replaced_ingredient_id else null end,
    case when p_effect_type = 'REPLACEMENT' then p_replaced_quantity else null end,
    case when p_effect_type = 'REPLACEMENT' then p_replaced_unit else null end,
    trim(p_reason), auth.uid()
  ) returning * into v_rule;

  foreach v_source_name in array coalesce(p_source_names, '{}'::text[])
  loop
    v_normalized := public.inventory_normalize_text(v_source_name);
    if v_normalized <> '' then
      insert into public.inventory_sales_modifier_aliases (
        branch_id, normalized_source_name, source_name, addon_id,
        confirmed_by, evidence
      ) values (
        p_branch_id, v_normalized, v_source_name, p_addon_id, auth.uid(),
        jsonb_build_object('ruleId', v_rule.id)
      )
      on conflict (branch_id, normalized_source_name)
      do update set
        source_name = excluded.source_name,
        addon_id = excluded.addon_id,
        status = 'confirmed',
        confirmed_by = auth.uid(),
        confirmed_at = now(),
        evidence = excluded.evidence;
    end if;
  end loop;

  insert into public.inventory_audit_log (
    event_type, actor_id, branch_id, entity_type, entity_id,
    new_value, reason, metadata
  ) values (
    'addon_consumption_rule_confirmed', auth.uid(), p_branch_id,
    'inventory_addon_consumption_rule', v_rule.id, to_jsonb(v_rule), trim(p_reason),
    jsonb_build_object('addonId', p_addon_id, 'sourceNames', p_source_names)
  );
  return to_jsonb(v_rule);
end;
$$;

create or replace function public.inventory_create_item_from_invoice_candidate(
  p_invoice_line_id uuid,
  p_payload jsonb,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line public.inventory_invoice_lines%rowtype;
  v_invoice public.inventory_invoices%rowtype;
  v_item public.inventory_ingredients%rowtype;
  v_catalogue public.inventory_supplier_catalogue_items%rowtype;
  v_name text := nullif(trim(p_payload ->> 'canonicalName'), '');
  v_normalized text;
  v_base_unit text := nullif(p_payload ->> 'baseUnit', '');
  v_classification text := nullif(p_payload ->> 'classification', '');
  v_conversion numeric := nullif(p_payload ->> 'conversionFactor', '')::numeric;
  v_pack_quantity numeric := coalesce(nullif(p_payload ->> 'packQuantity', '')::numeric, 1);
  v_pack_size numeric := coalesce(nullif(p_payload ->> 'packSize', '')::numeric, 1);
  v_pack_unit text := coalesce(nullif(p_payload ->> 'packUnit', ''), v_base_unit);
begin
  if nullif(trim(p_reason), '') is null then
    raise exception 'Canonical creation reason is required';
  end if;
  select * into v_line from public.inventory_invoice_lines
  where id = p_invoice_line_id for update;
  if not found then raise exception 'Invoice line not found'; end if;
  select * into v_invoice from public.inventory_invoices
  where id = v_line.invoice_id for update;
  if not public.inventory_can_approve(v_invoice.branch_id) then
    raise exception 'Canonical item creation denied' using errcode = '42501';
  end if;
  if v_invoice.status in ('posted', 'approved', 'rejected', 'duplicate', 'cancelled') then
    raise exception 'Finalized invoice lines cannot create canonical items';
  end if;
  if not v_line.active or v_line.review_status in ('verified', 'auto_matched') then
    raise exception 'Invoice line is not an unresolved onboarding candidate';
  end if;
  if v_name is null or v_base_unit not in ('each', 'gram', 'kilogram', 'millilitre', 'litre')
    or v_classification not in (
      'food_ingredient', 'beverage', 'packaging', 'cleaning',
      'operating_supply', 'chemical', 'equipment_consumable', 'other'
    )
    or coalesce(v_conversion, 0) <= 0
  then
    raise exception 'Canonical name, valid units/classification, and conversion are required';
  end if;
  v_normalized := public.inventory_normalize_text(v_name);
  if exists (
    select 1 from public.inventory_ingredients i
    where i.normalized_search_name = v_normalized
      and (i.branch_id is null or i.branch_id = v_invoice.branch_id)
  ) then
    raise exception 'Duplicate canonical item candidate requires linking to the existing item';
  end if;
  if v_invoice.supplier_id is not null and v_line.supplier_sku is not null and exists (
    select 1 from public.inventory_supplier_catalogue_items c
    where c.supplier_id = v_invoice.supplier_id
      and c.supplier_sku = v_line.supplier_sku
      and c.active
  ) then
    raise exception 'Supplier SKU already belongs to a canonical catalogue item';
  end if;

  insert into public.inventory_ingredients (
    canonical_name, normalized_search_name, description, category,
    base_inventory_unit, purchasing_unit, yield_percentage,
    scope, branch_id, active, inventory_classification,
    recipe_cost_eligible, legitimate_zero_cost, created_by
  ) values (
    v_name, v_normalized,
    coalesce(nullif(p_payload ->> 'description', ''), 'Created from reviewed supplier source'),
    nullif(p_payload ->> 'sourceCategory', ''),
    v_base_unit, v_base_unit, 100,
    'branch', v_invoice.branch_id, true, v_classification,
    coalesce((p_payload ->> 'recipeCostEligible')::boolean, false),
    coalesce((p_payload ->> 'legitimateZeroCost')::boolean, false),
    auth.uid()
  ) returning * into v_item;

  if v_invoice.supplier_id is not null then
    insert into public.inventory_supplier_catalogue_items (
      supplier_id, supplier_sku, original_product_name, normalized_product_name,
      ingredient_id, purchase_unit, pack_quantity, pack_size, pack_unit,
      conversion_factor, default_tax_rate, verification_state, confidence,
      created_by, verified_by, verified_at
    ) values (
      v_invoice.supplier_id, v_line.supplier_sku, v_line.original_description,
      v_line.normalized_description, v_item.id, v_base_unit,
      v_pack_quantity, v_pack_size, v_pack_unit, v_conversion,
      coalesce(v_line.tax_rate, 0), 'verified', 1,
      auth.uid(), auth.uid(), now()
    ) returning * into v_catalogue;

    insert into public.inventory_supplier_item_aliases (
      supplier_id, catalogue_item_id, supplier_sku, original_description,
      normalized_description, verification_state, confidence,
      source_invoice_line_id, created_by, verified_by, verified_at
    ) values (
      v_invoice.supplier_id, v_catalogue.id, v_line.supplier_sku,
      v_line.original_description, v_line.normalized_description,
      'verified', 1, v_line.id, auth.uid(), auth.uid(), now()
    );
  end if;

  update public.inventory_invoice_lines
  set ingredient_id = v_item.id,
      supplier_catalogue_item_id = v_catalogue.id,
      conversion_factor = v_conversion,
      canonical_received_quantity = v_line.original_quantity * v_conversion,
      canonical_unit = v_base_unit,
      review_status = 'verified',
      match_method = 'manual_review',
      matching_confidence = 1,
      manually_overridden = true,
      manual_overrides = coalesce(v_line.manual_overrides, '{}'::jsonb)
        || jsonb_build_object(
          'canonicalCreationReason', trim(p_reason),
          'sourceQuantity', v_line.original_quantity,
          'sourceUnit', v_line.original_unit
        ),
      verified_by = auth.uid(),
      verified_at = now(),
      updated_at = now()
  where id = v_line.id;

  insert into public.inventory_audit_log (
    event_type, actor_id, branch_id, entity_type, entity_id,
    previous_value, new_value, reason, metadata
  ) values (
    'canonical_item_created_from_invoice', auth.uid(), v_invoice.branch_id,
    'inventory_ingredient', v_item.id, to_jsonb(v_line), to_jsonb(v_item),
    trim(p_reason), jsonb_build_object(
      'invoiceId', v_invoice.id,
      'invoiceLineId', v_line.id,
      'catalogueItemId', v_catalogue.id,
      'rawSourcePreserved', true
    )
  );
  return jsonb_build_object(
    'ingredient', to_jsonb(v_item),
    'catalogueItem', case when v_catalogue.id is null then null else to_jsonb(v_catalogue) end,
    'invoiceLineId', v_line.id
  );
end;
$$;

create or replace function public.inventory_validate_recipe_version_activation(
  p_recipe_version_id uuid,
  p_effective_from timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_version public.inventory_recipe_versions%rowtype;
  v_recipe public.inventory_recipes%rowtype;
  v_errors jsonb := '[]'::jsonb;
  v_cycle boolean := false;
  v_invalid_nested boolean := false;
begin
  select * into v_version from public.inventory_recipe_versions
  where id = p_recipe_version_id;
  if not found then
    return jsonb_build_object('valid', false, 'errors', jsonb_build_array('VERSION_NOT_FOUND'));
  end if;
  select * into v_recipe from public.inventory_recipes where id = v_version.recipe_id;
  if not (
    case when v_recipe.branch_id is null
      then public.ask_nac_vault_has_all_branches()
      else public.inventory_branch_allowed(v_recipe.branch_id)
    end
  ) then
    raise exception 'Recipe activation validation denied' using errcode = '42501';
  end if;

  if v_version.output_quantity is null or v_version.output_quantity <= 0
    or v_version.output_unit is null
  then
    v_errors := v_errors || jsonb_build_array('INVALID_OUTPUT');
  end if;
  if p_effective_from is null then
    v_errors := v_errors || jsonb_build_array('INVALID_EFFECTIVE_DATE');
  elsif exists (
    select 1
    from public.inventory_recipe_versions existing
    where existing.recipe_id = v_recipe.id
      and existing.id <> v_version.id
      and existing.status in ('active', 'retired')
      and existing.effective_from < 'infinity'::timestamptz
      and coalesce(existing.effective_to, 'infinity'::timestamptz) > p_effective_from
  ) then
    v_errors := v_errors || jsonb_build_array('OVERLAPPING_EFFECTIVE_DATE');
  end if;
  if v_version.yield_percentage is null or v_version.yield_percentage <= 0 then
    v_errors := v_errors || jsonb_build_array('INVALID_YIELD');
  end if;
  if v_version.portion_count is not null and v_version.portion_count <= 0 then
    v_errors := v_errors || jsonb_build_array('INVALID_PORTION_COUNT');
  end if;
  if not exists (
    select 1 from public.inventory_recipe_version_lines l
    where l.recipe_version_id = p_recipe_version_id
  ) then
    v_errors := v_errors || jsonb_build_array('EMPTY_RECIPE');
  end if;
  if exists (
    select 1
    from public.inventory_recipe_version_lines l
    left join public.inventory_ingredients i on i.id = l.ingredient_id
    where l.recipe_version_id = p_recipe_version_id
      and (
        (l.ingredient_id is null and l.sub_recipe_id is null)
        or (l.ingredient_id is not null and l.sub_recipe_id is not null)
        or l.canonical_quantity <= 0
        or (
          l.ingredient_id is not null
          and (
            i.id is null or not i.active
            or i.recipe_cost_eligible is not true
            or i.base_inventory_unit <> l.canonical_unit
          )
        )
      )
  ) then
    v_errors := v_errors || jsonb_build_array('UNRESOLVED_RECIPE_LINE');
  end if;
  if v_recipe.recipe_type = 'direct_stock' and (
    select count(*) from public.inventory_recipe_version_lines l
    where l.recipe_version_id = p_recipe_version_id
      and l.ingredient_id is not null
      and l.sub_recipe_id is null
  ) <> 1 then
    v_errors := v_errors || jsonb_build_array('DIRECT_STOCK_REQUIRES_ONE_ITEM');
  end if;
  if v_recipe.recipe_type = 'direct_stock' and (
    select count(*) from public.inventory_recipe_version_lines l
    where l.recipe_version_id = p_recipe_version_id
  ) <> 1 then
    v_errors := v_errors || jsonb_build_array('DIRECT_STOCK_REQUIRES_ONE_ITEM');
  end if;

  with recursive dependency_tree as (
    select
      v_recipe.id as recipe_id,
      p_recipe_version_id as version_id,
      array[v_recipe.id]::uuid[] as path,
      false as cycle,
      false as invalid_nested
    union all
    select
      line.sub_recipe_id,
      nested.id,
      tree.path || line.sub_recipe_id,
      line.sub_recipe_id = any(tree.path),
      nested.id is null
        or coalesce(nested.output_quantity, nested_recipe.output_quantity) <= 0
        or coalesce(nested.output_unit, nested_recipe.output_unit) <> line.canonical_unit
    from dependency_tree tree
    join public.inventory_recipe_version_lines line
      on line.recipe_version_id = tree.version_id
      and line.sub_recipe_id is not null
    left join public.inventory_recipes nested_recipe on nested_recipe.id = line.sub_recipe_id
    left join lateral (
      select rv.id, rv.output_quantity, rv.output_unit
      from public.inventory_recipe_versions rv
      where rv.recipe_id = line.sub_recipe_id
        and rv.status in ('active', 'retired')
        and rv.effective_from <= p_effective_from
        and (rv.effective_to is null or rv.effective_to > p_effective_from)
      order by rv.effective_from desc, rv.version_number desc
      limit 1
    ) nested on true
    where not tree.cycle and tree.version_id is not null
  )
  select
    coalesce(bool_or(cycle), false),
    coalesce(bool_or(invalid_nested), false)
  into v_cycle, v_invalid_nested
  from dependency_tree;

  if v_cycle then
    v_errors := v_errors || jsonb_build_array('RECIPE_CYCLE');
  end if;
  if v_invalid_nested then
    v_errors := v_errors || jsonb_build_array('INVALID_SUBRECIPE_VERSION_OR_UNIT');
  end if;

  return jsonb_build_object(
    'valid', jsonb_array_length(v_errors) = 0,
    'recipeId', v_recipe.id,
    'recipeVersionId', v_version.id,
    'effectiveFrom', p_effective_from,
    'errors', v_errors
  );
end;
$$;

create or replace function public.inventory_enforce_recipe_activation_quality()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_validation jsonb;
begin
  if new.status = 'active' then
    if tg_op = 'INSERT' then
      raise exception 'Recipe versions must be created as draft and activated through review'
        using errcode = '23514';
    elsif old.status <> 'active' then
      v_validation := public.inventory_validate_recipe_version_activation(
        new.id, new.effective_from
      );
      if coalesce((v_validation ->> 'valid')::boolean, false) = false then
        raise exception 'Recipe activation validation failed: %', v_validation -> 'errors'
          using errcode = '23514';
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists inventory_recipe_activation_quality
  on public.inventory_recipe_versions;
create trigger inventory_recipe_activation_quality
before insert or update of status on public.inventory_recipe_versions
for each row execute function public.inventory_enforce_recipe_activation_quality();

create or replace function public.inventory_theoretical_consumption(
  p_branch_id text,
  p_period_start date,
  p_period_end date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if p_period_end < p_period_start then
    raise exception 'Invalid theoretical-consumption period';
  end if;
  if not public.inventory_branch_allowed(p_branch_id) then
    raise exception 'Theoretical consumption branch access denied' using errcode = '42501';
  end if;

  with recursive
  approved_batches as materialized (
    select
      selected.id as selection_id,
      batch.id as batch_id,
      batch.period_start,
      batch.period_end,
      batch.source_file_name,
      selected.source_granularity,
      selected.quantity_semantics
    from public.inventory_sales_consumption_batches selected
    join public.foodics_import_batches batch on batch.id = selected.batch_id
    where selected.branch_id = p_branch_id
      and selected.status = 'approved'
      and selected.quantity_semantics = 'net_of_voids_refunds'
      and batch.period_start >= p_period_start
      and batch.period_end <= p_period_end
  ),
  batch_health as materialized (
    select
      batch.batch_id,
      public.inventory_cost_health_as_of(p_branch_id, batch.period_end, 90) as health
    from approved_batches batch
  ),
  product_sales as (
    select
      batch.batch_id,
      batch.period_start,
      batch.period_end,
      case
        when sales.matched_menu_item_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          then sales.matched_menu_item_id::uuid
        else null
      end as menu_item_id,
      sum(sales.quantity_sold) as sold_quantity,
      sum(sales.net_sales) as net_sales,
      jsonb_agg(sales.id) as sales_row_ids
    from approved_batches batch
    join public.foodics_sales_items sales on sales.batch_id = batch.batch_id
    where sales.branch_id = p_branch_id
      and not coalesce(sales.is_modifier, false)
    group by batch.batch_id, batch.period_start, batch.period_end,
      case
        when sales.matched_menu_item_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          then sales.matched_menu_item_id::uuid
        else null
      end
  ),
  product_roots as (
    select
      concat('product:', sales.batch_id, ':', coalesce(sales.menu_item_id::text, 'unmatched')) as source_key,
      'PRODUCT'::text as source_type,
      sales.batch_id,
      sales.period_start,
      sales.period_end,
      sales.menu_item_id,
      null::uuid as addon_id,
      menu.name_en as source_name,
      sales.sold_quantity,
      sales.net_sales,
      sales.sales_row_ids,
      recipe.id as recipe_id,
      version.id as recipe_version_id,
      case
        when coalesce(version.portion_count, recipe.portion_count) > 0
          then sales.sold_quantity / coalesce(version.portion_count, recipe.portion_count)
        when coalesce(version.portion_size, recipe.portion_size) > 0
          and coalesce(version.portion_unit, recipe.portion_unit)
            = coalesce(version.output_unit, recipe.output_unit)
          then (
            sales.sold_quantity * coalesce(version.portion_size, recipe.portion_size)
          ) / (
            coalesce(version.output_quantity, recipe.output_quantity)
            * (version.yield_percentage / 100.0)
          )
        when coalesce(version.output_quantity, recipe.output_quantity)
          * (version.yield_percentage / 100.0) > 0
          then sales.sold_quantity / (
            coalesce(version.output_quantity, recipe.output_quantity)
            * (version.yield_percentage / 100.0)
          )
        else null
      end as multiplier,
      trusted_product.product ->> 'costTrustStatus' as trust_status,
      case
        when sales.menu_item_id is null then 'UNRESOLVED_MENU_ITEM'
        when menu.id is null then 'MENU_ITEM_NOT_AVAILABLE_FOR_BRANCH'
        when recipe.id is null then 'MISSING_RECIPE'
        when version.id is null then 'NO_VERSION_COVERS_SALES_PERIOD'
        when (trusted_product.product ->> 'costTrustStatus') is distinct from 'TRUSTED'
          then 'RECIPE_OR_COST_UNTRUSTED'
        when coalesce(version.output_quantity, recipe.output_quantity)
          * (version.yield_percentage / 100.0) <= 0 then 'INVALID_RECIPE_OUTPUT'
        else null
      end as gap_status
    from product_sales sales
    left join public.menu_items menu
      on menu.id = sales.menu_item_id and menu.branch_id = p_branch_id
    left join lateral (
      select r.*
      from public.inventory_recipes r
      where (
          r.menu_item_id = sales.menu_item_id
          or (
            menu.placement_group_id is not null
            and r.placement_group_id = menu.placement_group_id
          )
        )
        and r.active
        and (r.branch_id is null or r.branch_id = p_branch_id)
      order by (r.branch_id = p_branch_id) desc, r.updated_at desc, r.id
      limit 1
    ) recipe on true
    left join lateral (
      select rv.*
      from public.inventory_recipe_versions rv
      where rv.recipe_id = recipe.id
        and rv.status in ('active', 'retired')
        and rv.effective_from::date <= sales.period_start
        and (rv.effective_to is null or rv.effective_to::date > sales.period_end)
      order by rv.effective_from desc, rv.version_number desc
      limit 1
    ) version on true
    left join batch_health health on health.batch_id = sales.batch_id
    left join lateral (
      select product
      from jsonb_array_elements(coalesce(health.health -> 'products', '[]'::jsonb)) product
      where product ->> 'menuItemId' = sales.menu_item_id::text
      limit 1
    ) trusted_product on true
  ),
  modifier_sales as (
    select
      batch.batch_id,
      batch.period_start,
      batch.period_end,
      public.inventory_normalize_text(sales.raw_item_name) as normalized_source_name,
      min(sales.raw_item_name) as source_name,
      sum(sales.quantity_sold) as sold_quantity,
      sum(sales.net_sales) as net_sales,
      jsonb_agg(sales.id) as sales_row_ids
    from approved_batches batch
    join public.foodics_sales_items sales on sales.batch_id = batch.batch_id
    where sales.branch_id = p_branch_id
      and coalesce(sales.is_modifier, false)
    group by batch.batch_id, batch.period_start, batch.period_end,
      public.inventory_normalize_text(sales.raw_item_name)
  ),
  modifier_roots as (
    select
      concat('modifier:', sales.batch_id, ':', sales.normalized_source_name) as source_key,
      'MODIFIER'::text as source_type,
      sales.batch_id,
      sales.period_start,
      sales.period_end,
      null::uuid as menu_item_id,
      alias.addon_id,
      sales.source_name,
      sales.sold_quantity,
      sales.net_sales,
      sales.sales_row_ids,
      rule.recipe_id,
      version.id as recipe_version_id,
      case
        when rule.effect_type = 'NO_STOCK_EFFECT' then 0
        when coalesce(version.output_quantity, recipe.output_quantity)
          * (version.yield_percentage / 100.0) > 0
          then sales.sold_quantity / (
            coalesce(version.output_quantity, recipe.output_quantity)
            * (version.yield_percentage / 100.0)
          )
        else null
      end as multiplier,
      case
        when rule.effect_type = 'NO_STOCK_EFFECT' then 'TRUSTED'
        else trust.result ->> 'trustStatus'
      end as trust_status,
      case
        when alias.id is null then 'UNRESOLVED_MODIFIER_ALIAS'
        when rule.id is null then 'MISSING_MODIFIER_RULE'
        when rule.effect_type = 'NO_STOCK_EFFECT' then null
        when version.id is null then 'NO_MODIFIER_VERSION_COVERS_SALES_PERIOD'
        when (trust.result ->> 'trustStatus') is distinct from 'TRUSTED'
          then 'MODIFIER_RECIPE_UNTRUSTED'
        else null
      end as gap_status,
      rule.effect_type,
      rule.replaced_ingredient_id,
      rule.replaced_quantity,
      rule.replaced_unit,
      rule.id as rule_id
    from modifier_sales sales
    left join public.inventory_sales_modifier_aliases alias
      on alias.branch_id = p_branch_id
      and alias.normalized_source_name = sales.normalized_source_name
      and alias.status = 'confirmed'
    left join lateral (
      select r.*
      from public.inventory_addon_consumption_rules r
      where r.addon_id = alias.addon_id
        and r.active
        and (
          (r.scope = 'branch' and r.branch_id = p_branch_id)
          or r.scope = 'network'
        )
      order by (r.scope = 'branch') desc, r.updated_at desc
      limit 1
    ) rule on true
    left join public.inventory_recipes recipe on recipe.id = rule.recipe_id
    left join lateral (
      select rv.*
      from public.inventory_recipe_versions rv
      where rv.recipe_id = rule.recipe_id
        and rv.status in ('active', 'retired')
        and rv.effective_from::date <= sales.period_start
        and (rv.effective_to is null or rv.effective_to::date > sales.period_end)
      order by rv.effective_from desc, rv.version_number desc
      limit 1
    ) version on true
    left join lateral (
      select case
        when rule.recipe_id is null or version.id is null then null
        else public.inventory_recipe_cost_trust_as_of(
          rule.recipe_id, p_branch_id, sales.period_end, version.id, 90
        )
      end as result
    ) trust on true
  ),
  roots as (
    select
      source_key, source_type, batch_id, period_start, period_end,
      menu_item_id, addon_id, source_name, sold_quantity, net_sales,
      sales_row_ids, recipe_id, recipe_version_id, multiplier,
      trust_status, gap_status
    from product_roots
    union all
    select
      source_key, source_type, batch_id, period_start, period_end,
      menu_item_id, addon_id, source_name, sold_quantity, net_sales,
      sales_row_ids, recipe_id, recipe_version_id, multiplier,
      trust_status, gap_status
    from modifier_roots
    where effect_type is distinct from 'NO_STOCK_EFFECT'
  ),
  recipe_nodes as (
    select
      root.source_key,
      root.source_type,
      root.batch_id,
      root.period_start,
      root.period_end,
      root.menu_item_id,
      root.addon_id,
      root.source_name,
      root.sold_quantity,
      root.net_sales,
      root.sales_row_ids,
      root.recipe_id,
      root.recipe_version_id,
      root.multiplier,
      array[root.recipe_id]::uuid[] as path
    from roots root
    where root.gap_status is null
      and root.recipe_id is not null
      and root.recipe_version_id is not null
      and root.multiplier is not null
    union all
    select
      node.source_key,
      node.source_type,
      node.batch_id,
      node.period_start,
      node.period_end,
      node.menu_item_id,
      node.addon_id,
      node.source_name,
      node.sold_quantity,
      node.net_sales,
      node.sales_row_ids,
      line.sub_recipe_id,
      nested.id,
      node.multiplier * line.canonical_quantity * line.yield_waste_factor / (
        coalesce(nested.output_quantity, nested_recipe.output_quantity)
        * (nested.yield_percentage / 100.0)
      ),
      node.path || line.sub_recipe_id
    from recipe_nodes node
    join public.inventory_recipe_version_lines line
      on line.recipe_version_id = node.recipe_version_id
      and line.sub_recipe_id is not null
    join public.inventory_recipes nested_recipe on nested_recipe.id = line.sub_recipe_id
    join lateral (
      select rv.*
      from public.inventory_recipe_versions rv
      where rv.recipe_id = line.sub_recipe_id
        and rv.status in ('active', 'retired')
        and rv.effective_from::date <= node.period_start
        and (rv.effective_to is null or rv.effective_to::date > node.period_end)
      order by rv.effective_from desc, rv.version_number desc
      limit 1
    ) nested on true
    where not line.sub_recipe_id = any(node.path)
      and coalesce(nested.output_quantity, nested_recipe.output_quantity)
        * (nested.yield_percentage / 100.0) > 0
  ),
  ingredient_contributions as (
    select
      node.source_key,
      node.source_type,
      node.batch_id,
      node.period_start,
      node.period_end,
      node.menu_item_id,
      node.addon_id,
      node.source_name,
      node.recipe_id,
      node.recipe_version_id,
      line.ingredient_id,
      line.canonical_unit,
      node.multiplier * line.canonical_quantity * line.yield_waste_factor
        as theoretical_quantity,
      node.sales_row_ids
    from recipe_nodes node
    join public.inventory_recipe_version_lines line
      on line.recipe_version_id = node.recipe_version_id
      and line.ingredient_id is not null
  ),
  replacement_contributions as (
    select
      root.source_key,
      'MODIFIER_REPLACEMENT'::text as source_type,
      root.batch_id,
      root.period_start,
      root.period_end,
      null::uuid as menu_item_id,
      root.addon_id,
      root.source_name,
      root.recipe_id,
      root.recipe_version_id,
      root.replaced_ingredient_id as ingredient_id,
      root.replaced_unit as canonical_unit,
      -(root.sold_quantity * root.replaced_quantity) as theoretical_quantity,
      root.sales_row_ids
    from modifier_roots root
    where root.gap_status is null
      and root.effect_type = 'REPLACEMENT'
  ),
  all_contributions as (
    select * from ingredient_contributions
    union all
    select * from replacement_contributions
  ),
  ingredient_totals as (
    select
      contribution.ingredient_id,
      item.canonical_name as item_name,
      contribution.canonical_unit,
      sum(contribution.theoretical_quantity) as theoretical_quantity,
      jsonb_agg(jsonb_build_object(
        'sourceKey', contribution.source_key,
        'sourceType', contribution.source_type,
        'batchId', contribution.batch_id,
        'periodStart', contribution.period_start,
        'periodEnd', contribution.period_end,
        'menuItemId', contribution.menu_item_id,
        'addonId', contribution.addon_id,
        'sourceName', contribution.source_name,
        'recipeId', contribution.recipe_id,
        'recipeVersionId', contribution.recipe_version_id,
        'quantity', contribution.theoretical_quantity,
        'salesRowIds', contribution.sales_row_ids
      )) as evidence
    from all_contributions contribution
    join public.inventory_ingredients item on item.id = contribution.ingredient_id
    group by contribution.ingredient_id, item.canonical_name, contribution.canonical_unit
  ),
  gap_rows as (
    select
      root.source_key,
      root.source_type,
      root.batch_id,
      root.menu_item_id,
      root.addon_id,
      root.source_name,
      root.sold_quantity,
      root.net_sales,
      root.gap_status,
      root.sales_row_ids
    from roots root
    where root.gap_status is not null
  ),
  coverage as (
    select
      coalesce(sum(sold_quantity) filter (where source_type = 'PRODUCT'), 0) as total_product_units,
      coalesce(sum(net_sales) filter (where source_type = 'PRODUCT'), 0) as total_product_sales,
      coalesce(sum(sold_quantity) filter (
        where source_type = 'PRODUCT' and gap_status is null
      ), 0) as trusted_product_units,
      coalesce(sum(net_sales) filter (
        where source_type = 'PRODUCT' and gap_status is null
      ), 0) as trusted_product_sales
    from roots
  )
  select jsonb_build_object(
    'branchId', p_branch_id,
    'periodStart', p_period_start,
    'periodEnd', p_period_end,
    'status', case
      when not exists (select 1 from approved_batches) then 'NO_APPROVED_SALES_SOURCE'
      when exists (select 1 from gap_rows) then 'PARTIAL'
      else 'COMPLETE'
    end,
    'complete', exists (select 1 from approved_batches)
      and not exists (select 1 from gap_rows),
    'approvedBatches', coalesce((
      select jsonb_agg(jsonb_build_object(
        'selectionId', batch.selection_id,
        'batchId', batch.batch_id,
        'periodStart', batch.period_start,
        'periodEnd', batch.period_end,
        'sourceFileName', batch.source_file_name,
        'sourceGranularity', batch.source_granularity,
        'quantitySemantics', batch.quantity_semantics
      ) order by batch.period_start)
      from approved_batches batch
    ), '[]'::jsonb),
    'coverage', jsonb_build_object(
      'totalSoldUnits', case
        when exists (select 1 from approved_batches) then coverage.total_product_units
        else null
      end,
      'trustedSoldUnits', case
        when exists (select 1 from approved_batches) then coverage.trusted_product_units
        else null
      end,
      'unitCoveragePct', case
        when not exists (select 1 from approved_batches) then null
        when coverage.total_product_units = 0 then 0
        else round(100.0 * coverage.trusted_product_units / coverage.total_product_units, 2)
      end,
      'totalSalesValue', case
        when exists (select 1 from approved_batches) then coverage.total_product_sales
        else null
      end,
      'trustedSalesValue', case
        when exists (select 1 from approved_batches) then coverage.trusted_product_sales
        else null
      end,
      'salesValueCoveragePct', case
        when not exists (select 1 from approved_batches) then null
        when coverage.total_product_sales = 0 then 0
        else round(100.0 * coverage.trusted_product_sales / coverage.total_product_sales, 2)
      end
    ),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'inventoryItemId', total.ingredient_id,
        'itemName', total.item_name,
        'canonicalUnit', total.canonical_unit,
        'theoreticalQuantity', total.theoretical_quantity,
        'evidence', total.evidence
      ) order by abs(total.theoretical_quantity) desc)
      from ingredient_totals total
    ), '[]'::jsonb),
    'gaps', coalesce((
      select jsonb_agg(jsonb_build_object(
        'sourceKey', gap.source_key,
        'sourceType', gap.source_type,
        'batchId', gap.batch_id,
        'menuItemId', gap.menu_item_id,
        'addonId', gap.addon_id,
        'sourceName', gap.source_name,
        'soldQuantity', gap.sold_quantity,
        'netSales', gap.net_sales,
        'status', gap.gap_status,
        'salesRowIds', gap.sales_row_ids
      ) order by gap.sold_quantity desc)
      from gap_rows gap
    ), '[]'::jsonb)
  ) into v_result
  from coverage;

  return v_result;
end;
$$;

create or replace function public.inventory_data_readiness_overview(
  p_branch_id text,
  p_as_of date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_cost_health jsonb;
  v_result jsonb;
begin
  if not public.inventory_branch_allowed(p_branch_id) then
    raise exception 'Inventory data-readiness access denied' using errcode = '42501';
  end if;
  v_cost_health := public.inventory_cost_health_as_of(p_branch_id, p_as_of, 90);

  with
  product_costs as (
    select product
    from jsonb_array_elements(coalesce(v_cost_health -> 'products', '[]'::jsonb)) product
  ),
  approved_sales as (
    select selected.batch_id
    from public.inventory_sales_consumption_batches selected
    where selected.branch_id = p_branch_id and selected.status = 'approved'
  ),
  product_sales as (
    select
      case
        when sales.matched_menu_item_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          then sales.matched_menu_item_id::uuid
        else null
      end as menu_item_id,
      sum(sales.quantity_sold) as sold_units,
      sum(sales.net_sales) as sales_value
    from public.foodics_sales_items sales
    join approved_sales approved on approved.batch_id = sales.batch_id
    where sales.branch_id = p_branch_id and not coalesce(sales.is_modifier, false)
    group by case
      when sales.matched_menu_item_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        then sales.matched_menu_item_id::uuid
      else null
    end
  ),
  products as (
    select
      menu.id as menu_item_id,
      menu.name_en,
      menu.name_ar,
      menu.price,
      menu.active,
      menu.placement_group_id,
      category.name_en as category_name,
      section.name_en as section_name,
      intent.id as intent_id,
      intent.costing_intent,
      intent.status as intent_status,
      recipe.id as recipe_id,
      recipe.name as recipe_name,
      recipe.recipe_type,
      recipe.active as recipe_active,
      version.id as recipe_version_id,
      version.status as recipe_version_status,
      cost.product ->> 'costTrustStatus' as cost_trust_status,
      nullif(cost.product ->> 'costCompletenessPct', '')::numeric as cost_completeness_pct,
      coalesce(sales.sold_units, 0) as sold_units,
      coalesce(sales.sales_value, 0) as sales_value,
      case
        when intent.costing_intent is not null then intent.costing_intent
        when lower(section.name_en) = 'add ons' then 'modifier_addon'
        when lower(section.name_en) = 'soft drinks' then 'direct_stock'
        else 'recipe_required'
      end as suggested_intent,
      case
        when intent.costing_intent is not null then 'CONFIRMED'
        when lower(section.name_en) in ('add ons', 'soft drinks') then 'MEDIUM'
        else 'LOW'
      end as suggestion_confidence,
      case
        when intent.costing_intent in ('intentionally_excluded', 'free_non_cost_bearing', 'modifier_addon')
          then 'EXCLUDED'
        when recipe.id is null then 'MISSING_RECIPE'
        when recipe.recipe_type = 'direct_stock' and cost.product ->> 'costTrustStatus' = 'TRUSTED'
          then 'DIRECT_STOCK'
        when version.id is null then 'INCOMPLETE_RECIPE'
        when cost.product ->> 'costStatus' in ('UNRESOLVED_ITEM', 'UNRESOLVED_UNIT', 'INVALID_RECIPE_LINE')
          then 'MISSING_INGREDIENT_MAP'
        when cost.product ->> 'costStatus' in (
          'MISSING_COST', 'NO_HISTORICAL_COST', 'STALE_COST', 'INCOMPLETE_SUBRECIPE'
        ) then 'MISSING_COST'
        when cost.product ->> 'costTrustStatus' = 'TRUSTED' then 'TRUSTED'
        else 'NEEDS_REVIEW'
      end as coverage_status
    from public.menu_items menu
    left join public.sections section on section.id = menu.section_id
    left join public.categories category on category.id = section.category_id
    left join public.inventory_menu_item_costing_intents intent
      on intent.branch_id = p_branch_id and intent.menu_item_id = menu.id
      and intent.status <> 'retired'
    left join lateral (
      select r.*
      from public.inventory_recipes r
      where (
          r.menu_item_id = menu.id
          or (
            menu.placement_group_id is not null
            and r.placement_group_id = menu.placement_group_id
          )
        )
        and r.active
        and (r.branch_id is null or r.branch_id = p_branch_id)
      order by (r.branch_id = p_branch_id) desc, r.updated_at desc, r.id
      limit 1
    ) recipe on true
    left join lateral (
      select rv.*
      from public.inventory_recipe_versions rv
      where rv.recipe_id = recipe.id
        and rv.status in ('active', 'retired', 'draft')
      order by (rv.status = 'active') desc, rv.version_number desc
      limit 1
    ) version on true
    left join product_costs cost on cost.product ->> 'menuItemId' = menu.id::text
    left join product_sales sales on sales.menu_item_id = menu.id
    where menu.branch_id = p_branch_id and menu.active
  ),
  ingredient_coverage as (
    select
      count(distinct line.ingredient_id) filter (where line.ingredient_id is not null)
        as referenced_ingredients,
      count(distinct line.ingredient_id) filter (
        where item.id is not null and item.active
      ) as canonical_mapped,
      count(distinct line.ingredient_id) filter (
        where exists (
          select 1 from public.inventory_ingredient_cost_history history
          where history.branch_id = p_branch_id
            and history.ingredient_id = line.ingredient_id
            and history.effective_at::date <= p_as_of
        )
      ) as historical_cost_available,
      count(*) filter (
        where (line.ingredient_id is null and line.sub_recipe_id is null)
          or (
            line.ingredient_id is not null
            and (
              item.id is null or not item.active
              or item.base_inventory_unit <> line.canonical_unit
            )
          )
      ) as unresolved_lines
    from public.inventory_recipes recipe
    join public.inventory_recipe_versions version
      on version.recipe_id = recipe.id and version.status in ('active', 'draft')
    join public.inventory_recipe_version_lines line
      on line.recipe_version_id = version.id
    left join public.inventory_ingredients item on item.id = line.ingredient_id
    where recipe.active and (recipe.branch_id is null or recipe.branch_id = p_branch_id)
  ),
  catalogue_candidates as (
    select
      line.id as invoice_line_id,
      invoice.id as invoice_id,
      invoice.status as invoice_status,
      invoice.branch_id,
      invoice.supplier_id,
      supplier.supplier_name,
      line.original_description,
      line.normalized_description,
      line.supplier_sku,
      line.original_quantity,
      line.original_unit,
      line.pack_quantity,
      line.pack_size,
      line.pack_unit,
      line.unit_price,
      line.review_status,
      line.evidence,
      duplicate.id as duplicate_ingredient_id,
      duplicate.canonical_name as duplicate_ingredient_name,
      sku_match.id as supplier_catalogue_item_id,
      sku_item.id as supplier_catalogue_ingredient_id,
      sku_item.canonical_name as supplier_catalogue_ingredient_name,
      case
        when duplicate.id is not null or sku_match.id is not null then 'DUPLICATE_CANDIDATE'
        when invoice.status in ('posted', 'approved', 'rejected', 'duplicate', 'cancelled')
          then 'SOURCE_FINALIZED'
        else 'UNRESOLVED'
      end as candidate_status
    from public.inventory_invoice_lines line
    join public.inventory_invoices invoice on invoice.id = line.invoice_id
    left join public.inventory_suppliers supplier on supplier.id = invoice.supplier_id
    left join lateral (
      select i.id, i.canonical_name
      from public.inventory_ingredients i
      where i.normalized_search_name = line.normalized_description
        and (i.branch_id is null or i.branch_id = invoice.branch_id)
      order by i.active desc
      limit 1
    ) duplicate on true
    left join lateral (
      select c.*
      from public.inventory_supplier_catalogue_items c
      where c.supplier_id = invoice.supplier_id
        and c.supplier_sku = line.supplier_sku
        and c.active
      limit 1
    ) sku_match on true
    left join public.inventory_ingredients sku_item on sku_item.id = sku_match.ingredient_id
    where invoice.branch_id = p_branch_id
      and line.active
      and line.review_status not in ('verified', 'auto_matched')
  ),
  sales_sources as (
    select
      batch.id as batch_id,
      batch.import_type,
      batch.period_type,
      batch.period_start,
      batch.period_end,
      batch.source_file_name,
      batch.uploaded_at,
      coalesce(review.status, 'pending') as review_status,
      coalesce(review.quantity_semantics, 'unknown') as quantity_semantics,
      review.review_reason,
      count(sales.id) as row_count,
      coalesce(sum(sales.quantity_sold), 0) as sold_units,
      coalesce(sum(sales.net_sales), 0) as sales_value,
      count(*) filter (where sales.matched_menu_item_id is null) as unmatched_rows,
      count(*) filter (where coalesce(sales.is_modifier, false)) as modifier_rows,
      count(*) filter (where sales.sold_at is not null) as dated_rows,
      exists (
        select 1
        from public.foodics_import_batches other
        where other.branch_id = batch.branch_id
          and other.id <> batch.id
          and daterange(other.period_start, other.period_end, '[]')
            && daterange(batch.period_start, batch.period_end, '[]')
      ) as has_overlapping_source
    from public.foodics_import_batches batch
    left join public.inventory_sales_consumption_batches review on review.batch_id = batch.id
    left join public.foodics_sales_items sales on sales.batch_id = batch.id
    where batch.branch_id = p_branch_id
    group by batch.id, review.id
  )
  select jsonb_build_object(
    'branchId', p_branch_id,
    'asOf', p_as_of,
    'productCoverage', jsonb_build_object(
      'totalActiveProducts', (select count(*) from products),
      'recipeRequired', (select count(*) from products where costing_intent = 'recipe_required'),
      'mapped', (select count(*) from products where recipe_id is not null),
      'trusted', (select count(*) from products where cost_trust_status = 'TRUSTED'),
      'directStock', (select count(*) from products where recipe_type = 'direct_stock'),
      'unresolved', (select count(*) from products where costing_intent is null),
      'intentionallyExcluded', (select count(*) from products where coverage_status = 'EXCLUDED'),
      'suggestedRecipeRequired', (select count(*) from products where costing_intent is null and suggested_intent = 'recipe_required'),
      'suggestedDirectStock', (select count(*) from products where costing_intent is null and suggested_intent = 'direct_stock'),
      'suggestedModifierAddon', (select count(*) from products where costing_intent is null and suggested_intent = 'modifier_addon')
    ),
    'ingredientCoverage', jsonb_build_object(
      'referencedIngredients', coalesce((select referenced_ingredients from ingredient_coverage), 0),
      'canonicalMapped', coalesce((select canonical_mapped from ingredient_coverage), 0),
      'historicalCostAvailable', coalesce((select historical_cost_available from ingredient_coverage), 0),
      'unresolvedLines', coalesce((select unresolved_lines from ingredient_coverage), 0)
    ),
    'salesCoverage', jsonb_build_object(
      'approvedBatchCount', (select count(*) from approved_sales),
      'soldUnits', case when exists (select 1 from approved_sales)
        then (select coalesce(sum(sold_units), 0) from products) else null end,
      'trustedSoldUnits', case when exists (select 1 from approved_sales)
        then (select coalesce(sum(sold_units), 0) from products where cost_trust_status = 'TRUSTED') else null end,
      'unitCoveragePct', case
        when not exists (select 1 from approved_sales) then null
        when (select coalesce(sum(sold_units), 0) from products) = 0 then 0
        else round(100.0
          * (select coalesce(sum(sold_units), 0) from products where cost_trust_status = 'TRUSTED')
          / (select sum(sold_units) from products), 2)
      end,
      'salesValue', case when exists (select 1 from approved_sales)
        then (select coalesce(sum(sales_value), 0) from products) else null end,
      'trustedSalesValue', case when exists (select 1 from approved_sales)
        then (select coalesce(sum(sales_value), 0) from products where cost_trust_status = 'TRUSTED') else null end,
      'salesValueCoveragePct', case
        when not exists (select 1 from approved_sales) then null
        when (select coalesce(sum(sales_value), 0) from products) = 0 then 0
        else round(100.0
          * (select coalesce(sum(sales_value), 0) from products where cost_trust_status = 'TRUSTED')
          / (select sum(sales_value) from products), 2)
      end
    ),
    'products', coalesce((
      select jsonb_agg(jsonb_build_object(
        'menuItemId', product.menu_item_id,
        'name', product.name_en,
        'nameAr', product.name_ar,
        'price', product.price,
        'placementGroupId', product.placement_group_id,
        'category', product.category_name,
        'section', product.section_name,
        'costingIntent', product.costing_intent,
        'intentStatus', product.intent_status,
        'suggestedIntent', product.suggested_intent,
        'suggestionConfidence', product.suggestion_confidence,
        'recipeId', product.recipe_id,
        'recipeName', product.recipe_name,
        'recipeType', product.recipe_type,
        'recipeVersionId', product.recipe_version_id,
        'recipeVersionStatus', product.recipe_version_status,
        'coverageStatus', product.coverage_status,
        'costTrustStatus', product.cost_trust_status,
        'costCompletenessPct', product.cost_completeness_pct,
        'soldUnits', product.sold_units,
        'salesValue', product.sales_value
      ) order by product.sales_value desc, product.sold_units desc, product.name_en)
      from products product
    ), '[]'::jsonb),
    'catalogueCandidates', coalesce((
      select jsonb_agg(to_jsonb(candidate) order by candidate.original_description)
      from catalogue_candidates candidate
    ), '[]'::jsonb),
    'salesSources', coalesce((
      select jsonb_agg(to_jsonb(source) order by source.period_end desc, source.uploaded_at desc)
      from sales_sources source
    ), '[]'::jsonb),
    'addonRules', coalesce((
      select jsonb_agg(jsonb_build_object(
        'ruleId', rule.id,
        'addonId', addon.id,
        'addonName', addon.name_en,
        'effectType', rule.effect_type,
        'recipeId', rule.recipe_id,
        'replacedIngredientId', rule.replaced_ingredient_id,
        'replacedQuantity', rule.replaced_quantity,
        'replacedUnit', rule.replaced_unit,
        'scope', rule.scope,
        'branchId', rule.branch_id
      ) order by addon.name_en)
      from public.inventory_addon_consumption_rules rule
      join public.add_ons addon on addon.id = rule.addon_id
      where rule.active and (
        (rule.scope = 'network' and public.ask_nac_has_any_branch_access())
        or (rule.scope = 'branch' and rule.branch_id = p_branch_id)
      )
    ), '[]'::jsonb),
    'availableRecipes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'recipeId', recipe.id,
        'name', recipe.name,
        'recipeType', recipe.recipe_type,
        'branchId', recipe.branch_id,
        'menuItemId', recipe.menu_item_id
      ) order by recipe.name)
      from public.inventory_recipes recipe
      where recipe.active
        and recipe.recipe_type in ('menu_item', 'direct_stock')
        and recipe.menu_item_id is null
        and (recipe.branch_id is null or recipe.branch_id = p_branch_id)
    ), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

revoke all on function public.inventory_set_menu_item_costing_intent(text, uuid, text, text, jsonb) from public;
revoke all on function public.inventory_review_sales_consumption_batch(uuid, text, text, text, jsonb) from public;
revoke all on function public.inventory_link_menu_item_recipe(text, uuid, uuid, text) from public;
revoke all on function public.inventory_set_addon_consumption_rule(text, uuid, text, uuid, uuid, numeric, text, text[], text) from public;
revoke all on function public.inventory_create_item_from_invoice_candidate(uuid, jsonb, text) from public;
revoke all on function public.inventory_validate_recipe_version_activation(uuid, timestamptz) from public;
revoke all on function public.inventory_enforce_recipe_activation_quality() from public;
revoke all on function public.inventory_theoretical_consumption(text, date, date) from public;
revoke all on function public.inventory_data_readiness_overview(text, date) from public;

grant execute on function public.inventory_set_menu_item_costing_intent(text, uuid, text, text, jsonb) to authenticated;
grant execute on function public.inventory_review_sales_consumption_batch(uuid, text, text, text, jsonb) to authenticated;
grant execute on function public.inventory_link_menu_item_recipe(text, uuid, uuid, text) to authenticated;
grant execute on function public.inventory_set_addon_consumption_rule(text, uuid, text, uuid, uuid, numeric, text, text[], text) to authenticated;
grant execute on function public.inventory_create_item_from_invoice_candidate(uuid, jsonb, text) to authenticated;
grant execute on function public.inventory_validate_recipe_version_activation(uuid, timestamptz) to authenticated;
grant execute on function public.inventory_theoretical_consumption(text, date, date) to authenticated;
grant execute on function public.inventory_data_readiness_overview(text, date) to authenticated;

comment on function public.inventory_theoretical_consumption(text, date, date) is
  'Strict batched sales-to-recipe quantity explosion. Uses only explicitly approved non-overlapping sales sources and trusted recipes; unresolved sources remain gaps, never zero.';
comment on function public.inventory_data_readiness_overview(text, date) is
  'Branch-explicit product, ingredient, sales, catalogue, and add-on readiness without modifying source data.';
