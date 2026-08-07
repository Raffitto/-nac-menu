-- Controlled, source-cited recipe cohort onboarding.
-- Adds approved external cost baselines without altering stock, WAC state,
-- movement history, receipts, or historical cost rows.

create table if not exists public.inventory_recipe_onboarding_batches (
  id uuid primary key default gen_random_uuid(),
  branch_id text not null check (branch_id in ('khobar', 'riyadh', 'jeddah')),
  cohort_name text not null,
  source_file_ids uuid[] not null default '{}',
  payload jsonb not null,
  preview jsonb not null default '{}'::jsonb,
  status text not null default 'draft'
    check (status in ('draft', 'approved', 'rejected', 'applied')),
  idempotency_key text not null unique,
  created_by uuid references auth.users(id),
  approved_by uuid references auth.users(id),
  applied_by uuid references auth.users(id),
  approval_reason text,
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  applied_at timestamptz
);

create index if not exists inventory_recipe_onboarding_branch_status_idx
  on public.inventory_recipe_onboarding_batches (branch_id, status, created_at desc);

create table if not exists public.inventory_approved_cost_baselines (
  id uuid primary key default gen_random_uuid(),
  branch_id text not null check (branch_id in ('khobar', 'riyadh', 'jeddah')),
  ingredient_id uuid not null references public.inventory_ingredients(id),
  effective_date date not null,
  canonical_unit text not null
    check (canonical_unit in ('each', 'gram', 'kilogram', 'millilitre', 'litre')),
  canonical_unit_cost numeric(24,10) not null check (canonical_unit_cost >= 0),
  currency text not null default 'SAR' check (currency ~ '^[A-Z]{3}$'),
  source_file_id uuid not null references public.ask_nac_files(id),
  source_locator text not null,
  source_value jsonb not null default '{}'::jsonb,
  status text not null default 'approved' check (status in ('approved', 'retired')),
  approved_by uuid not null references auth.users(id),
  approved_at timestamptz not null default now(),
  retired_by uuid references auth.users(id),
  retired_at timestamptz,
  reason text not null,
  onboarding_batch_id uuid references public.inventory_recipe_onboarding_batches(id),
  idempotency_key text not null unique,
  created_at timestamptz not null default now()
);

create index if not exists inventory_cost_baseline_lookup_idx
  on public.inventory_approved_cost_baselines
  (branch_id, ingredient_id, effective_date desc, approved_at desc)
  where status = 'approved';

alter table public.inventory_recipe_onboarding_batches enable row level security;
alter table public.inventory_approved_cost_baselines enable row level security;

drop policy if exists inventory_recipe_onboarding_select
  on public.inventory_recipe_onboarding_batches;
create policy inventory_recipe_onboarding_select
on public.inventory_recipe_onboarding_batches for select to authenticated
using (public.inventory_branch_allowed(branch_id));

drop policy if exists inventory_cost_baselines_select
  on public.inventory_approved_cost_baselines;
create policy inventory_cost_baselines_select
on public.inventory_approved_cost_baselines for select to authenticated
using (public.inventory_branch_allowed(branch_id));

revoke all on public.inventory_recipe_onboarding_batches from anon, authenticated;
revoke all on public.inventory_approved_cost_baselines from anon, authenticated;
grant select on public.inventory_recipe_onboarding_batches to authenticated;
grant select on public.inventory_approved_cost_baselines to authenticated;

create or replace function public.inventory_preview_recipe_onboarding(
  p_branch_id text,
  p_payload jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_issues jsonb := '[]'::jsonb;
  v_ingredient_keys text[];
  v_cost_keys text[];
  v_source_ids uuid[];
  v_row jsonb;
  v_key text;
  v_menu_id uuid;
begin
  if not public.inventory_branch_allowed(p_branch_id) then
    raise exception 'Recipe onboarding branch access denied' using errcode = '42501';
  end if;
  if jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Onboarding payload must be an object';
  end if;

  select coalesce(array_agg(value ->> 'key'), '{}'::text[])
  into v_ingredient_keys
  from jsonb_array_elements(coalesce(p_payload -> 'ingredients', '[]'::jsonb));

  select coalesce(array_agg(value::uuid), '{}'::uuid[])
  into v_source_ids
  from jsonb_array_elements_text(coalesce(p_payload -> 'sourceFileIds', '[]'::jsonb));

  select coalesce(array_agg(value ->> 'ingredientKey'), '{}'::text[])
  into v_cost_keys
  from jsonb_array_elements(coalesce(p_payload -> 'costs', '[]'::jsonb));

  if cardinality(v_source_ids) = 0 then
    v_issues := v_issues || jsonb_build_array(jsonb_build_object(
      'severity', 'BLOCKING', 'code', 'MISSING_SOURCE_FILE'
    ));
  elsif exists (
    select 1 from unnest(v_source_ids) source_id
    where not exists (
      select 1 from public.ask_nac_files file
      where file.id = source_id and file.status = 'active'
    )
  ) then
    v_issues := v_issues || jsonb_build_array(jsonb_build_object(
      'severity', 'BLOCKING', 'code', 'SOURCE_FILE_NOT_ACTIVE_OR_VISIBLE'
    ));
  end if;

  for v_row in
    select value from jsonb_array_elements(coalesce(p_payload -> 'ingredients', '[]'::jsonb))
  loop
    v_key := nullif(trim(v_row ->> 'key'), '');
    if v_key is null or nullif(trim(v_row ->> 'name'), '') is null then
      v_issues := v_issues || jsonb_build_array(jsonb_build_object(
        'severity', 'BLOCKING', 'code', 'INVALID_INGREDIENT_IDENTITY', 'key', v_key
      ));
    end if;
    if coalesce(v_row ->> 'baseUnit', '') not in
      ('each', 'gram', 'kilogram', 'millilitre', 'litre')
      or coalesce(v_row ->> 'classification', '') not in (
        'food_ingredient', 'beverage', 'packaging', 'cleaning',
        'operating_supply', 'chemical', 'equipment_consumable', 'other'
      )
    then
      v_issues := v_issues || jsonb_build_array(jsonb_build_object(
        'severity', 'BLOCKING', 'code', 'INVALID_INGREDIENT_UNIT', 'key', v_key
      ));
    end if;
    if exists (
      select 1 from public.inventory_ingredients ingredient
      where ingredient.normalized_search_name
        = public.inventory_normalize_text(v_row ->> 'name')
        and (
          ingredient.base_inventory_unit <> v_row ->> 'baseUnit'
          or ingredient.inventory_classification
            is distinct from v_row ->> 'classification'
        )
    ) then
      v_issues := v_issues || jsonb_build_array(jsonb_build_object(
        'severity', 'BLOCKING', 'code', 'INGREDIENT_COLLISION', 'key', v_key
      ));
    end if;
  end loop;

  if cardinality(v_ingredient_keys) <> (
    select count(distinct key) from unnest(v_ingredient_keys) key
  ) then
    v_issues := v_issues || jsonb_build_array(jsonb_build_object(
      'severity', 'BLOCKING', 'code', 'DUPLICATE_INGREDIENT_KEY'
    ));
  end if;

  for v_row in
    select value from jsonb_array_elements(coalesce(p_payload -> 'costs', '[]'::jsonb))
  loop
    if not (v_row ->> 'ingredientKey' = any(v_ingredient_keys))
      or coalesce((v_row ->> 'unitCost')::numeric, -1) < 0
      or coalesce(v_row ->> 'unit', '') not in
        ('each', 'gram', 'kilogram', 'millilitre', 'litre')
      or nullif(v_row ->> 'effectiveDate', '') is null
      or nullif(v_row ->> 'sourceFileId', '') is null
      or nullif(trim(v_row ->> 'sourceLocator'), '') is null
      or not ((v_row ->> 'sourceFileId')::uuid = any(v_source_ids))
      or not exists (
        select 1
        from jsonb_array_elements(coalesce(p_payload -> 'ingredients', '[]'::jsonb)) item
        where item ->> 'key' = v_row ->> 'ingredientKey'
          and item ->> 'baseUnit' = v_row ->> 'unit'
      )
    then
      v_issues := v_issues || jsonb_build_array(jsonb_build_object(
        'severity', 'BLOCKING', 'code', 'INVALID_COST_BASELINE',
        'ingredientKey', v_row ->> 'ingredientKey'
      ));
    end if;
  end loop;
  if cardinality(v_cost_keys) <> (
    select count(distinct key) from unnest(v_cost_keys) key
  ) then
    v_issues := v_issues || jsonb_build_array(jsonb_build_object(
      'severity', 'BLOCKING', 'code', 'DUPLICATE_COST_BASELINE'
    ));
  end if;

  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_payload -> 'recipes', '[]'::jsonb)) recipe,
      jsonb_array_elements(coalesce(recipe -> 'lines', '[]'::jsonb)) line
    where not (line ->> 'ingredientKey' = any(v_cost_keys))
  ) then
    v_issues := v_issues || jsonb_build_array(jsonb_build_object(
      'severity', 'BLOCKING', 'code', 'MISSING_COST_EVIDENCE'
    ));
  end if;

  if (
    select count(*) from jsonb_array_elements(coalesce(p_payload -> 'recipes', '[]'::jsonb))
  ) <> (
    select count(distinct value ->> 'menuItemId')
    from jsonb_array_elements(coalesce(p_payload -> 'recipes', '[]'::jsonb))
  ) then
    v_issues := v_issues || jsonb_build_array(jsonb_build_object(
      'severity', 'BLOCKING', 'code', 'DUPLICATE_RECIPE_MENU_ITEM'
    ));
  end if;

  for v_row in
    select value from jsonb_array_elements(coalesce(p_payload -> 'recipes', '[]'::jsonb))
  loop
    begin
      v_menu_id := (v_row ->> 'menuItemId')::uuid;
    exception when others then
      v_menu_id := null;
    end;
    if v_menu_id is null or not exists (
      select 1 from public.menu_items menu
      where menu.id = v_menu_id and menu.branch_id = p_branch_id and menu.active
    ) then
      v_issues := v_issues || jsonb_build_array(jsonb_build_object(
        'severity', 'BLOCKING', 'code', 'MENU_ITEM_NOT_AVAILABLE',
        'recipeKey', v_row ->> 'key'
      ));
    end if;
    if coalesce(v_row ->> 'recipeType', '') not in ('menu_item', 'direct_stock')
      or coalesce((v_row ->> 'outputQuantity')::numeric, 0) <= 0
      or coalesce((v_row ->> 'yieldPercentage')::numeric, 0) <= 0
      or coalesce((v_row ->> 'portionCount')::numeric, 0) <= 0
      or jsonb_array_length(coalesce(v_row -> 'lines', '[]'::jsonb)) = 0
      or nullif(v_row ->> 'effectiveFrom', '') is null
      or nullif(v_row #>> '{source,fileId}', '') is null
      or not ((v_row #>> '{source,fileId}')::uuid = any(v_source_ids))
      or nullif(trim(v_row #>> '{source,locator}'), '') is null
    then
      v_issues := v_issues || jsonb_build_array(jsonb_build_object(
        'severity', 'BLOCKING', 'code', 'INVALID_RECIPE_HEADER',
        'recipeKey', v_row ->> 'key'
      ));
    end if;
    if v_row ->> 'recipeType' = 'direct_stock'
      and jsonb_array_length(coalesce(v_row -> 'lines', '[]'::jsonb)) <> 1
    then
      v_issues := v_issues || jsonb_build_array(jsonb_build_object(
        'severity', 'BLOCKING', 'code', 'DIRECT_STOCK_REQUIRES_ONE_ITEM',
        'recipeKey', v_row ->> 'key'
      ));
    end if;
    if exists (
      select 1
      from jsonb_array_elements(coalesce(v_row -> 'lines', '[]'::jsonb)) line
      where not (line ->> 'ingredientKey' = any(v_ingredient_keys))
        or coalesce((line ->> 'canonicalQuantity')::numeric, 0) <= 0
        or coalesce(line ->> 'canonicalUnit', '') not in
          ('each', 'gram', 'kilogram', 'millilitre', 'litre')
        or nullif(trim(line ->> 'sourceLocator'), '') is null
        or not exists (
          select 1
          from jsonb_array_elements(coalesce(p_payload -> 'ingredients', '[]'::jsonb)) item
          where item ->> 'key' = line ->> 'ingredientKey'
            and item ->> 'baseUnit' = line ->> 'canonicalUnit'
        )
    ) then
      v_issues := v_issues || jsonb_build_array(jsonb_build_object(
        'severity', 'BLOCKING', 'code', 'INVALID_RECIPE_LINE',
        'recipeKey', v_row ->> 'key'
      ));
    end if;
    if exists (
      select 1 from public.inventory_recipes recipe
      left join public.menu_items menu on menu.id = v_menu_id
      where recipe.active
        and (
          recipe.menu_item_id = v_menu_id
          or (
            menu.placement_group_id is not null
            and recipe.placement_group_id = menu.placement_group_id
          )
        )
    ) then
      v_issues := v_issues || jsonb_build_array(jsonb_build_object(
        'severity', 'BLOCKING', 'code', 'ACTIVE_RECIPE_ALREADY_EXISTS',
        'recipeKey', v_row ->> 'key'
      ));
    end if;
  end loop;

  return jsonb_build_object(
    'branchId', p_branch_id,
    'ingredientCount', jsonb_array_length(coalesce(p_payload -> 'ingredients', '[]'::jsonb)),
    'costBaselineCount', jsonb_array_length(coalesce(p_payload -> 'costs', '[]'::jsonb)),
    'recipeCount', jsonb_array_length(coalesce(p_payload -> 'recipes', '[]'::jsonb)),
    'issues', v_issues,
    'blockingIssueCount', (
      select count(*) from jsonb_array_elements(v_issues) issue
      where issue ->> 'severity' = 'BLOCKING'
    ),
    'safeToApply', not exists (
      select 1 from jsonb_array_elements(v_issues) issue
      where issue ->> 'severity' = 'BLOCKING'
    )
  );
end;
$$;

create or replace function public.inventory_create_recipe_onboarding_batch(
  p_branch_id text,
  p_cohort_name text,
  p_payload jsonb,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_preview jsonb;
  v_batch public.inventory_recipe_onboarding_batches%rowtype;
  v_source_ids uuid[];
begin
  if not public.inventory_can_approve(p_branch_id) then
    raise exception 'Recipe onboarding approval access denied' using errcode = '42501';
  end if;
  if nullif(trim(p_cohort_name), '') is null
    or nullif(trim(p_idempotency_key), '') is null
  then
    raise exception 'Cohort name and idempotency key are required';
  end if;
  v_preview := public.inventory_preview_recipe_onboarding(p_branch_id, p_payload);
  select coalesce(array_agg(value::uuid), '{}'::uuid[])
  into v_source_ids
  from jsonb_array_elements_text(coalesce(p_payload -> 'sourceFileIds', '[]'::jsonb));

  insert into public.inventory_recipe_onboarding_batches (
    branch_id, cohort_name, source_file_ids, payload, preview,
    idempotency_key, created_by
  ) values (
    p_branch_id, trim(p_cohort_name), v_source_ids, p_payload, v_preview,
    trim(p_idempotency_key), auth.uid()
  )
  on conflict (idempotency_key) do update
  set preview = excluded.preview
  where inventory_recipe_onboarding_batches.status = 'draft'
  returning * into v_batch;

  if not found then
    select * into v_batch from public.inventory_recipe_onboarding_batches
    where idempotency_key = trim(p_idempotency_key);
  end if;
  return to_jsonb(v_batch);
end;
$$;

create or replace function public.inventory_review_recipe_onboarding_batch(
  p_batch_id uuid,
  p_status text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch public.inventory_recipe_onboarding_batches%rowtype;
begin
  if p_status not in ('approved', 'rejected')
    or nullif(trim(p_reason), '') is null
  then
    raise exception 'Approval or rejection with a reason is required';
  end if;
  select * into v_batch
  from public.inventory_recipe_onboarding_batches
  where id = p_batch_id for update;
  if not found or v_batch.status <> 'draft' then
    raise exception 'Only a draft onboarding batch can be reviewed';
  end if;
  if not public.inventory_can_approve(v_batch.branch_id) then
    raise exception 'Recipe onboarding approval access denied' using errcode = '42501';
  end if;
  if p_status = 'approved'
    and coalesce((v_batch.preview ->> 'blockingIssueCount')::integer, 0) > 0
  then
    raise exception 'A batch with blocking preview issues cannot be approved';
  end if;
  update public.inventory_recipe_onboarding_batches
  set status = p_status,
      approval_reason = trim(p_reason),
      approved_by = auth.uid(),
      approved_at = now()
  where id = p_batch_id
  returning * into v_batch;
  return to_jsonb(v_batch);
end;
$$;

create or replace function public.inventory_apply_recipe_onboarding_batch(
  p_batch_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch public.inventory_recipe_onboarding_batches%rowtype;
  v_preview jsonb;
  v_row jsonb;
  v_line jsonb;
  v_key text;
  v_ingredient_id uuid;
  v_ingredient_map jsonb := '{}'::jsonb;
  v_menu public.menu_items%rowtype;
  v_recipe_id uuid;
  v_version_id uuid;
  v_result jsonb := jsonb_build_object(
    'ingredients', '[]'::jsonb,
    'costBaselines', '[]'::jsonb,
    'recipes', '[]'::jsonb
  );
begin
  if nullif(trim(p_reason), '') is null then
    raise exception 'Apply reason is required';
  end if;
  select * into v_batch
  from public.inventory_recipe_onboarding_batches
  where id = p_batch_id for update;
  if not found then raise exception 'Onboarding batch not found'; end if;
  if v_batch.status = 'applied' then return v_batch.result; end if;
  if v_batch.status <> 'approved' then
    raise exception 'Only an approved onboarding batch can be applied';
  end if;
  if not public.inventory_can_approve(v_batch.branch_id) then
    raise exception 'Recipe onboarding apply access denied' using errcode = '42501';
  end if;
  if not public.ask_nac_vault_has_all_branches() then
    raise exception 'Network recipe onboarding requires all-branch authority'
      using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended('inventory-recipe-onboarding:' || v_batch.branch_id, 0)
  );
  v_preview := public.inventory_preview_recipe_onboarding(
    v_batch.branch_id, v_batch.payload
  );
  if not coalesce((v_preview ->> 'safeToApply')::boolean, false) then
    raise exception 'Onboarding preview contains blocking issues';
  end if;

  for v_row in
    select value from jsonb_array_elements(v_batch.payload -> 'ingredients')
  loop
    v_key := v_row ->> 'key';
    select id into v_ingredient_id
    from public.inventory_ingredients
    where normalized_search_name = public.inventory_normalize_text(v_row ->> 'name')
      and scope = 'network'
    limit 1;
    if not found then
      insert into public.inventory_ingredients (
        canonical_name, normalized_search_name, description, category,
        base_inventory_unit, purchasing_unit, yield_percentage,
        scope, branch_id, active, created_by,
        inventory_classification, recipe_cost_eligible, legitimate_zero_cost
      ) values (
        trim(v_row ->> 'name'),
        public.inventory_normalize_text(v_row ->> 'name'),
        nullif(trim(v_row ->> 'description'), ''),
        nullif(trim(v_row ->> 'sourceCategory'), ''),
        v_row ->> 'baseUnit',
        nullif(v_row ->> 'purchasingUnit', ''),
        coalesce((v_row ->> 'yieldPercentage')::numeric, 100),
        'network', null, true, auth.uid(),
        v_row ->> 'classification',
        coalesce((v_row ->> 'recipeCostEligible')::boolean, true),
        coalesce((v_row ->> 'legitimateZeroCost')::boolean, false)
      ) returning id into v_ingredient_id;
    end if;
    v_ingredient_map := jsonb_set(
      v_ingredient_map, array[v_key], to_jsonb(v_ingredient_id::text), true
    );
    v_result := jsonb_set(
      v_result, '{ingredients}',
      (v_result -> 'ingredients') || jsonb_build_array(jsonb_build_object(
        'key', v_key, 'ingredientId', v_ingredient_id
      )), true
    );
  end loop;

  for v_row in
    select value from jsonb_array_elements(v_batch.payload -> 'costs')
  loop
    v_ingredient_id := (v_ingredient_map ->> (v_row ->> 'ingredientKey'))::uuid;
    v_recipe_id := null;
    insert into public.inventory_approved_cost_baselines (
      branch_id, ingredient_id, effective_date, canonical_unit,
      canonical_unit_cost, currency, source_file_id, source_locator,
      source_value, approved_by, reason, onboarding_batch_id, idempotency_key
    ) values (
      v_batch.branch_id, v_ingredient_id, (v_row ->> 'effectiveDate')::date,
      v_row ->> 'unit', (v_row ->> 'unitCost')::numeric,
      coalesce(nullif(v_row ->> 'currency', ''), 'SAR'),
      (v_row ->> 'sourceFileId')::uuid, v_row ->> 'sourceLocator',
      coalesce(v_row -> 'sourceValue', '{}'::jsonb), auth.uid(),
      trim(p_reason), v_batch.id,
      concat('cohort:', v_batch.id, ':cost:', v_row ->> 'ingredientKey')
    ) on conflict (idempotency_key) do nothing
    returning id into v_recipe_id;
    if v_recipe_id is null then
      select id into v_recipe_id
      from public.inventory_approved_cost_baselines
      where idempotency_key = concat(
        'cohort:', v_batch.id, ':cost:', v_row ->> 'ingredientKey'
      );
    end if;
    v_result := jsonb_set(
      v_result, '{costBaselines}',
      (v_result -> 'costBaselines') || jsonb_build_array(jsonb_build_object(
        'ingredientKey', v_row ->> 'ingredientKey',
        'baselineId', v_recipe_id
      )), true
    );
  end loop;

  for v_row in
    select value from jsonb_array_elements(v_batch.payload -> 'recipes')
  loop
    select * into v_menu from public.menu_items
    where id = (v_row ->> 'menuItemId')::uuid
      and branch_id = v_batch.branch_id for update;

    insert into public.inventory_recipes (
      name, normalized_name, recipe_type, menu_item_id, placement_group_id,
      branch_id, output_quantity, output_unit, active, created_by,
      name_en, name_ar, internal_name, portion_count, portion_size,
      portion_unit, updated_by
    ) values (
      trim(v_row ->> 'name'),
      public.inventory_normalize_text(v_row ->> 'name'),
      v_row ->> 'recipeType', v_menu.id, v_menu.placement_group_id,
      null, (v_row ->> 'outputQuantity')::numeric, v_row ->> 'outputUnit',
      true, auth.uid(), trim(v_row ->> 'name'),
      nullif(trim(v_row ->> 'nameAr'), ''),
      nullif(trim(v_row ->> 'internalName'), ''),
      (v_row ->> 'portionCount')::numeric,
      nullif(v_row ->> 'portionSize', '')::numeric,
      nullif(v_row ->> 'portionUnit', ''), auth.uid()
    ) returning id into v_recipe_id;

    insert into public.inventory_recipe_versions (
      recipe_id, version_number, effective_from, status, yield_percentage,
      output_quantity, output_unit, portion_count, portion_size, portion_unit,
      documentation, created_by, updated_by
    ) values (
      v_recipe_id, 1, (v_row ->> 'effectiveFrom')::timestamptz, 'draft',
      (v_row ->> 'yieldPercentage')::numeric,
      (v_row ->> 'outputQuantity')::numeric, v_row ->> 'outputUnit',
      (v_row ->> 'portionCount')::numeric,
      nullif(v_row ->> 'portionSize', '')::numeric,
      nullif(v_row ->> 'portionUnit', ''),
      jsonb_build_object(
        'sourceEvidence', v_row -> 'source',
        'onboardingBatchId', v_batch.id,
        'instructions', coalesce(v_row -> 'instructions', '[]'::jsonb)
      ),
      auth.uid(), auth.uid()
    ) returning id into v_version_id;

    for v_line in
      select value from jsonb_array_elements(v_row -> 'lines')
    loop
      v_ingredient_id := (
        v_ingredient_map ->> (v_line ->> 'ingredientKey')
      )::uuid;
      insert into public.inventory_recipe_version_lines (
        recipe_version_id, ingredient_id, quantity, unit,
        canonical_quantity, canonical_unit, yield_waste_factor,
        preparation_note, is_optional, waste_percentage, sort_order
      ) values (
        v_version_id, v_ingredient_id,
        coalesce((v_line ->> 'quantity')::numeric,
          (v_line ->> 'canonicalQuantity')::numeric),
        coalesce(nullif(v_line ->> 'unit', ''), v_line ->> 'canonicalUnit'),
        (v_line ->> 'canonicalQuantity')::numeric,
        v_line ->> 'canonicalUnit',
        coalesce((v_line ->> 'yieldWasteFactor')::numeric, 1),
        nullif(trim(v_line ->> 'preparationNote'), ''),
        coalesce((v_line ->> 'isOptional')::boolean, false),
        coalesce((v_line ->> 'wastePercentage')::numeric, 0),
        coalesce((v_line ->> 'sortOrder')::integer, 0)
      );
    end loop;

    perform public.inventory_activate_recipe_version(
      v_version_id,
      (v_row ->> 'effectiveFrom')::timestamptz,
      trim(p_reason)
    );
    perform public.inventory_set_menu_item_costing_intent(
      v_batch.branch_id,
      v_menu.id,
      case when v_row ->> 'recipeType' = 'direct_stock'
        then 'direct_stock' else 'recipe_required' end,
      trim(p_reason),
      jsonb_build_object(
        'source', 'recipe_onboarding_batch',
        'batchId', v_batch.id
      )
    );

    v_result := jsonb_set(
      v_result, '{recipes}',
      (v_result -> 'recipes') || jsonb_build_array(jsonb_build_object(
        'recipeKey', v_row ->> 'key',
        'recipeId', v_recipe_id,
        'recipeVersionId', v_version_id,
        'menuItemId', v_menu.id
      )), true
    );
  end loop;

  insert into public.inventory_audit_log (
    event_type, actor_id, branch_id, entity_type, entity_id,
    previous_value, new_value, reason, metadata
  ) values (
    'recipe_onboarding_batch_applied', auth.uid(), v_batch.branch_id,
    'inventory_recipe_onboarding_batch', v_batch.id, null, v_result,
    trim(p_reason), jsonb_build_object('sourceFileIds', v_batch.source_file_ids)
  );

  update public.inventory_recipe_onboarding_batches
  set status = 'applied',
      applied_by = auth.uid(),
      applied_at = now(),
      preview = v_preview,
      result = v_result
  where id = v_batch.id;
  return v_result;
end;
$$;

-- Preserve the canonical recursive calculator and annotate approved baselines.
alter function public.inventory_recipe_cost_trust_component(
  uuid, uuid, text, timestamptz, jsonb, jsonb, uuid[], integer
) rename to inventory_recipe_cost_trust_component_base;

create or replace function public.inventory_recipe_cost_trust_component(
  p_recipe_id uuid,
  p_recipe_version_id uuid,
  p_branch_id text,
  p_as_of timestamptz,
  p_item_cache jsonb,
  p_cost_cache jsonb,
  p_path uuid[],
  p_stale_after_days integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_result jsonb;
  v_line jsonb;
  v_lines jsonb := '[]'::jsonb;
  v_evidence_id uuid;
  v_baseline public.inventory_approved_cost_baselines%rowtype;
  v_history_ids jsonb := '[]'::jsonb;
  v_baseline_ids jsonb := '[]'::jsonb;
  v_value jsonb;
begin
  v_result := public.inventory_recipe_cost_trust_component_base(
    p_recipe_id, p_recipe_version_id, p_branch_id, p_as_of,
    p_item_cache, p_cost_cache, p_path, p_stale_after_days
  );
  for v_line in
    select value from jsonb_array_elements(coalesce(v_result -> 'lines', '[]'::jsonb))
  loop
    if v_line ->> 'lineType' = 'inventory_item'
      and nullif(v_line #>> '{costEvidence,costHistoryId}', '') is not null
    then
      v_evidence_id := (v_line #>> '{costEvidence,costHistoryId}')::uuid;
      select * into v_baseline
      from public.inventory_approved_cost_baselines
      where id = v_evidence_id and status = 'approved';
      if found then
        v_line := jsonb_set(
          v_line,
          '{costEvidence}',
          (v_line -> 'costEvidence')
            || jsonb_build_object(
              'source', 'APPROVED_EXTERNAL_BASELINE',
              'costHistoryId', null,
              'baselineId', v_baseline.id,
              'sourceFileId', v_baseline.source_file_id,
              'sourceLocator', v_baseline.source_locator
            ),
          true
        );
      end if;
    end if;
    v_lines := v_lines || jsonb_build_array(v_line);
  end loop;

  for v_value in
    select value from jsonb_array_elements(coalesce(v_result -> 'costHistoryIds', '[]'::jsonb))
  loop
    if exists (
      select 1 from public.inventory_approved_cost_baselines baseline
      where baseline.id = (v_value #>> '{}')::uuid
    ) then
      v_baseline_ids := v_baseline_ids || jsonb_build_array(v_value);
    else
      v_history_ids := v_history_ids || jsonb_build_array(v_value);
    end if;
  end loop;
  return jsonb_set(
    jsonb_set(v_result, '{lines}', v_lines, true),
    '{costHistoryIds}', v_history_ids, true
  ) || jsonb_build_object(
    'costBaselineIds', v_baseline_ids,
    'calculationMethod', case
      when jsonb_array_length(v_baseline_ids) > 0
        then 'HISTORICAL_WAC_WITH_APPROVED_EXTERNAL_BASELINE'
      else v_result ->> 'calculationMethod'
    end
  );
end;
$$;

create or replace function public.inventory_recipe_cost_trust_as_of(
  p_recipe_id uuid,
  p_branch_id text,
  p_as_of date,
  p_recipe_version_id uuid default null,
  p_stale_after_days integer default 90
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_as_of timestamptz;
  v_item_cache jsonb;
  v_cost_cache jsonb;
  v_result jsonb;
begin
  if p_as_of is null then raise exception 'Business date is required'; end if;
  if p_stale_after_days < 1 then
    raise exception 'Stale cost threshold must be at least one day';
  end if;
  if not public.inventory_branch_allowed(p_branch_id) then
    raise exception 'Recipe cost branch access denied' using errcode = '42501';
  end if;
  v_as_of := (p_as_of + time '23:59:59.999999') at time zone 'Asia/Riyadh';

  select coalesce(jsonb_object_agg(item.id::text, to_jsonb(item)), '{}'::jsonb)
  into v_item_cache
  from (
    select
      ingredient.id,
      ingredient.canonical_name as "name",
      ingredient.base_inventory_unit as "baseUnit",
      ingredient.active,
      ingredient.recipe_cost_eligible as "recipeCostEligible",
      ingredient.legitimate_zero_cost as "legitimateZeroCost",
      ingredient.inventory_classification as "classification",
      ingredient.scope,
      ingredient.branch_id as "branchId"
    from public.inventory_ingredients ingredient
    where ingredient.branch_id is null or ingredient.branch_id = p_branch_id
  ) item;

  select coalesce(
    jsonb_object_agg(cost.ingredient_id::text, to_jsonb(cost)), '{}'::jsonb
  ) into v_cost_cache
  from (
    select distinct on (candidate.ingredient_id)
      candidate.*
    from (
      select
        history.ingredient_id,
        history.id as "costHistoryId",
        history.weighted_average_cost as "weightedAverageCost",
        history.canonical_unit as "canonicalUnit",
        history.effective_at as "effectiveAt",
        history.recorded_at as "recordedAt",
        history.receipt_id as "receiptId",
        history.receipt_line_id as "receiptLineId",
        history.invoice_id as "invoiceId",
        history.supplier_id as "supplierId",
        history.costing_method as "costingMethod",
        1 as source_priority
      from public.inventory_ingredient_cost_history history
      where history.branch_id = p_branch_id and history.effective_at <= v_as_of
      union all
      select
        baseline.ingredient_id,
        baseline.id as "costHistoryId",
        baseline.canonical_unit_cost as "weightedAverageCost",
        baseline.canonical_unit as "canonicalUnit",
        baseline.effective_date::timestamp at time zone 'Asia/Riyadh' as "effectiveAt",
        baseline.approved_at as "recordedAt",
        null::uuid as "receiptId",
        null::uuid as "receiptLineId",
        null::uuid as "invoiceId",
        null::uuid as "supplierId",
        'approved_external_baseline'::text as "costingMethod",
        2 as source_priority
      from public.inventory_approved_cost_baselines baseline
      where baseline.branch_id = p_branch_id
        and baseline.status = 'approved'
        and baseline.effective_date <= p_as_of
    ) candidate
    order by candidate.ingredient_id, candidate.source_priority,
      candidate."effectiveAt" desc, candidate."recordedAt" desc
  ) cost;

  v_result := public.inventory_recipe_cost_trust_component(
    p_recipe_id, p_recipe_version_id, p_branch_id, v_as_of,
    v_item_cache, v_cost_cache, '{}'::uuid[], p_stale_after_days
  );
  return v_result || jsonb_build_object('businessDate', p_as_of);
end;
$$;

create or replace function public.inventory_theoretical_consumption_scope(
  p_branch_id text,
  p_period_start date,
  p_period_end date,
  p_menu_item_ids uuid[]
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_full jsonb;
  v_item jsonb;
  v_items jsonb := '[]'::jsonb;
  v_scoped_evidence jsonb;
  v_quantity numeric;
  v_gaps jsonb;
  v_complete boolean;
begin
  if not public.inventory_branch_allowed(p_branch_id) then
    raise exception 'Theoretical consumption branch access denied' using errcode = '42501';
  end if;
  if coalesce(cardinality(p_menu_item_ids), 0) = 0 then
    raise exception 'At least one menu item is required';
  end if;
  if exists (
    select 1 from unnest(p_menu_item_ids) menu_id
    where not exists (
      select 1 from public.menu_items menu
      where menu.id = menu_id and menu.branch_id = p_branch_id
    )
  ) then
    raise exception 'Scoped menu item is not available for branch';
  end if;
  v_full := public.inventory_theoretical_consumption(
    p_branch_id, p_period_start, p_period_end
  );

  for v_item in
    select value from jsonb_array_elements(coalesce(v_full -> 'items', '[]'::jsonb))
  loop
    select
      coalesce(jsonb_agg(evidence), '[]'::jsonb),
      coalesce(sum((evidence ->> 'quantity')::numeric), 0)
    into v_scoped_evidence, v_quantity
    from jsonb_array_elements(coalesce(v_item -> 'evidence', '[]'::jsonb)) evidence
    where evidence ->> 'sourceType' = 'PRODUCT'
      and (evidence ->> 'menuItemId')::uuid = any(p_menu_item_ids);
    if jsonb_array_length(v_scoped_evidence) > 0 then
      v_items := v_items || jsonb_build_array(
        jsonb_set(
          jsonb_set(v_item, '{evidence}', v_scoped_evidence, true),
          '{theoreticalQuantity}', to_jsonb(v_quantity), true
        )
      );
    end if;
  end loop;

  select coalesce(jsonb_agg(gap), '[]'::jsonb)
  into v_gaps
  from jsonb_array_elements(coalesce(v_full -> 'gaps', '[]'::jsonb)) gap
  where gap ->> 'sourceType' = 'PRODUCT'
    and nullif(gap ->> 'menuItemId', '') is not null
    and (gap ->> 'menuItemId')::uuid = any(p_menu_item_ids);

  v_complete := coalesce((v_full #>> '{periodCoverage,complete}')::boolean, false)
    and jsonb_array_length(v_gaps) = 0;
  return jsonb_build_object(
    'branchId', p_branch_id,
    'periodStart', p_period_start,
    'periodEnd', p_period_end,
    'status', case
      when v_full ->> 'status' = 'NO_APPROVED_SALES_SOURCE'
        then 'NO_APPROVED_SALES_SOURCE'
      when not coalesce((v_full #>> '{periodCoverage,complete}')::boolean, false)
        then 'PARTIAL_PERIOD'
      when jsonb_array_length(v_gaps) > 0 then 'PARTIAL'
      else 'COMPLETE'
    end,
    'complete', v_complete,
    'scope', jsonb_build_object(
      'type', 'SELECTED_PRODUCTS',
      'menuItemIds', to_jsonb(p_menu_item_ids),
      'modifierTreatment', 'EXCLUDED_UNLESS_SEPARATELY_REPORTED'
    ),
    'periodCoverage', v_full -> 'periodCoverage',
    'items', v_items,
    'gaps', v_gaps
  );
end;
$$;

revoke all on function public.inventory_preview_recipe_onboarding(text, jsonb) from public;
revoke all on function public.inventory_create_recipe_onboarding_batch(
  text, text, jsonb, text
) from public;
revoke all on function public.inventory_review_recipe_onboarding_batch(
  uuid, text, text
) from public;
revoke all on function public.inventory_apply_recipe_onboarding_batch(uuid, text) from public;
revoke all on function public.inventory_recipe_cost_trust_component(
  uuid, uuid, text, timestamptz, jsonb, jsonb, uuid[], integer
) from public;
revoke all on function public.inventory_recipe_cost_trust_component_base(
  uuid, uuid, text, timestamptz, jsonb, jsonb, uuid[], integer
) from public;
revoke all on function public.inventory_recipe_cost_trust_as_of(
  uuid, text, date, uuid, integer
) from public;
revoke all on function public.inventory_theoretical_consumption_scope(
  text, date, date, uuid[]
) from public;

grant execute on function public.inventory_preview_recipe_onboarding(text, jsonb)
  to authenticated;
grant execute on function public.inventory_create_recipe_onboarding_batch(
  text, text, jsonb, text
) to authenticated;
grant execute on function public.inventory_review_recipe_onboarding_batch(
  uuid, text, text
) to authenticated;
grant execute on function public.inventory_apply_recipe_onboarding_batch(uuid, text)
  to authenticated;
grant execute on function public.inventory_recipe_cost_trust_as_of(
  uuid, text, date, uuid, integer
) to authenticated;
grant execute on function public.inventory_theoretical_consumption_scope(
  text, date, date, uuid[]
) to authenticated;

comment on table public.inventory_approved_cost_baselines is
  'Approved source-cited cost observations used only when no historical WAC exists; never changes stock or WAC state.';
comment on function public.inventory_theoretical_consumption_scope(
  text, date, date, uuid[]
) is 'Trusted selected-product consumption without claiming full-catalogue coverage.';
