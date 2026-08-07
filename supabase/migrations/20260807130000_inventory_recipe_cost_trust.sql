-- Phase C: branch-explicit historical recipe cost trust.
-- Additive only: no stock, cost-history, purchase, recipe, or snapshot rows are rewritten.

alter table public.inventory_ingredients
  add column if not exists legitimate_zero_cost boolean not null default false;

alter table public.inventory_recipe_versions
  add column if not exists output_quantity numeric(20,8) check (output_quantity is null or output_quantity > 0),
  add column if not exists output_unit text check (
    output_unit is null or output_unit in ('each', 'gram', 'kilogram', 'millilitre', 'litre')
  ),
  add column if not exists portion_count numeric(20,8) check (portion_count is null or portion_count > 0),
  add column if not exists portion_size numeric(20,8) check (portion_size is null or portion_size > 0),
  add column if not exists portion_unit text check (
    portion_unit is null or portion_unit in ('each', 'gram', 'kilogram', 'millilitre', 'litre')
  );

comment on column public.inventory_ingredients.legitimate_zero_cost is
  'Explicit controller confirmation that a zero historical unit cost is valid, not missing data.';
comment on column public.inventory_recipe_versions.output_quantity is
  'Version-pinned expected output. Null on legacy versions means the historical output definition was not captured.';

create index if not exists inventory_recipe_versions_effective_lookup_idx
  on public.inventory_recipe_versions (recipe_id, effective_from desc, effective_to, version_number desc)
  where status in ('active', 'retired');

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
  v_recipe public.inventory_recipes%rowtype;
  v_version public.inventory_recipe_versions%rowtype;
  v_line record;
  v_item jsonb;
  v_cost_evidence jsonb;
  v_nested jsonb;
  v_lines jsonb := '[]'::jsonb;
  v_missing jsonb := '[]'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
  v_cost_history_ids jsonb := '[]'::jsonb;
  v_status text;
  v_line_warnings jsonb;
  v_line_missing jsonb;
  v_line_cost numeric;
  v_unit_cost numeric;
  v_known_cost numeric := 0;
  v_total_cost numeric;
  v_output_quantity numeric;
  v_output_unit_cost numeric;
  v_cost_per_portion numeric;
  v_cost_effective_at timestamptz;
  v_cost_age_days integer;
  v_total_lines integer := 0;
  v_resolved_lines integer := 0;
  v_unresolved_lines integer := 0;
  v_stale_lines integer := 0;
  v_nested_total integer;
  v_nested_resolved integer;
  v_nested_unresolved integer;
  v_nested_stale integer;
  v_completeness numeric;
  v_confidence numeric;
  v_trust text;
  v_line_resolved boolean;
  v_has_warning boolean := false;
begin
  if p_recipe_id is null or p_branch_id is null or p_as_of is null then
    raise exception 'Recipe, branch, and as-of date are required';
  end if;
  if not public.inventory_branch_allowed(p_branch_id) then
    raise exception 'Recipe cost branch access denied' using errcode = '42501';
  end if;
  if p_recipe_id = any(coalesce(p_path, '{}'::uuid[])) then
    return jsonb_build_object(
      'recipeId', p_recipe_id,
      'branchId', p_branch_id,
      'asOf', p_as_of,
      'costStatus', 'INCOMPLETE_SUBRECIPE',
      'trustStatus', 'UNRELIABLE',
      'totalCost', null,
      'outputUnitCost', null,
      'costPerPortion', null,
      'totalCostBearingLines', 1,
      'resolvedLines', 0,
      'unresolvedLines', 1,
      'staleLines', 0,
      'completenessPct', 0,
      'missingComponents', jsonb_build_array(jsonb_build_object(
        'recipeId', p_recipe_id,
        'status', 'INCOMPLETE_SUBRECIPE',
        'reason', 'recipe_cycle'
      )),
      'warnings', jsonb_build_array('RECIPE_CYCLE'),
      'lines', '[]'::jsonb,
      'costHistoryIds', '[]'::jsonb
    );
  end if;

  select * into v_recipe
  from public.inventory_recipes
  where id = p_recipe_id;
  if not found then
    return jsonb_build_object(
      'recipeId', p_recipe_id,
      'branchId', p_branch_id,
      'asOf', p_as_of,
      'costStatus', 'INVALID_RECIPE_LINE',
      'trustStatus', 'UNRELIABLE',
      'totalCost', null,
      'outputUnitCost', null,
      'costPerPortion', null,
      'totalCostBearingLines', 1,
      'resolvedLines', 0,
      'unresolvedLines', 1,
      'staleLines', 0,
      'completenessPct', 0,
      'missingComponents', jsonb_build_array(jsonb_build_object(
        'recipeId', p_recipe_id,
        'status', 'INVALID_RECIPE_LINE',
        'reason', 'recipe_not_found'
      )),
      'warnings', '[]'::jsonb,
      'lines', '[]'::jsonb,
      'costHistoryIds', '[]'::jsonb
    );
  end if;
  if v_recipe.branch_id is not null and v_recipe.branch_id <> p_branch_id then
    raise exception 'Recipe is not available for requested branch' using errcode = '42501';
  end if;

  if not v_recipe.active then
    v_warnings := v_warnings || jsonb_build_array('RECIPE_INACTIVE');
    v_has_warning := true;
  end if;

  if p_recipe_version_id is not null then
    select * into v_version
    from public.inventory_recipe_versions
    where id = p_recipe_version_id
      and recipe_id = p_recipe_id;
  else
    select * into v_version
    from public.inventory_recipe_versions
    where recipe_id = p_recipe_id
      and status in ('active', 'retired')
      and effective_from <= p_as_of
      and (effective_to is null or effective_to > p_as_of)
    order by effective_from desc, version_number desc
    limit 1;
  end if;

  if not found then
    return jsonb_build_object(
      'recipeId', v_recipe.id,
      'recipeName', v_recipe.name,
      'recipeType', v_recipe.recipe_type,
      'recipeVersionId', p_recipe_version_id,
      'branchId', p_branch_id,
      'asOf', p_as_of,
      'costStatus', 'INVALID_RECIPE_LINE',
      'trustStatus', 'UNRELIABLE',
      'totalCost', null,
      'outputUnitCost', null,
      'costPerPortion', null,
      'totalCostBearingLines', 1,
      'resolvedLines', 0,
      'unresolvedLines', 1,
      'staleLines', 0,
      'completenessPct', 0,
      'missingComponents', jsonb_build_array(jsonb_build_object(
        'recipeId', v_recipe.id,
        'recipeName', v_recipe.name,
        'status', 'INVALID_RECIPE_LINE',
        'reason', 'no_effective_recipe_version'
      )),
      'warnings', v_warnings || jsonb_build_array('NO_EFFECTIVE_RECIPE_VERSION'),
      'lines', '[]'::jsonb,
      'costHistoryIds', '[]'::jsonb
    );
  end if;

  for v_line in
    select *
    from public.inventory_recipe_version_lines
    where recipe_version_id = v_version.id
    order by sort_order, created_at, id
  loop
    v_line_warnings := '[]'::jsonb;
    v_line_missing := '[]'::jsonb;
    v_line_cost := null;
    v_unit_cost := null;
    v_cost_evidence := null;
    v_cost_effective_at := null;
    v_cost_age_days := null;
    v_line_resolved := false;

    if v_line.ingredient_id is not null then
      v_total_lines := v_total_lines + 1;
      v_item := p_item_cache -> v_line.ingredient_id::text;
      if v_item is null then
        v_status := 'UNRESOLVED_ITEM';
      elsif nullif(v_line.canonical_unit, '') is null
        or nullif(v_item ->> 'baseUnit', '') is null
        or v_line.canonical_unit <> (v_item ->> 'baseUnit') then
        v_status := 'UNRESOLVED_UNIT';
      elsif coalesce((v_item ->> 'recipeCostEligible')::boolean, true) = false then
        v_status := 'INVALID_RECIPE_LINE';
        v_line_warnings := v_line_warnings || jsonb_build_array('ITEM_NOT_RECIPE_COST_ELIGIBLE');
      else
        if (v_item ->> 'active')::boolean = false then
          v_line_warnings := v_line_warnings || jsonb_build_array('INACTIVE_INVENTORY_ITEM');
          v_has_warning := true;
        end if;
        if (v_item -> 'recipeCostEligible') = 'null'::jsonb then
          v_line_warnings := v_line_warnings || jsonb_build_array('RECIPE_COST_ELIGIBILITY_UNSET');
          v_has_warning := true;
        end if;
        v_cost_evidence := p_cost_cache -> v_line.ingredient_id::text;
        if v_cost_evidence is null then
          v_status := 'NO_HISTORICAL_COST';
        else
          v_unit_cost := nullif(v_cost_evidence ->> 'weightedAverageCost', '')::numeric;
          v_cost_effective_at := (v_cost_evidence ->> 'effectiveAt')::timestamptz;
          v_cost_age_days := greatest(0, p_as_of::date - v_cost_effective_at::date);
          if v_unit_cost is null or v_unit_cost < 0 then
            v_status := 'MISSING_COST';
          elsif v_unit_cost = 0
            and coalesce((v_item ->> 'legitimateZeroCost')::boolean, false) then
            v_status := 'LEGITIMATE_ZERO_COST';
            v_line_resolved := true;
          elsif v_unit_cost = 0 then
            v_status := 'MISSING_COST';
          elsif v_cost_age_days > p_stale_after_days then
            v_status := 'STALE_COST';
            v_line_resolved := true;
            v_stale_lines := v_stale_lines + 1;
            v_line_warnings := v_line_warnings || jsonb_build_array('STALE_HISTORICAL_COST');
          else
            v_status := 'VALID_COST';
            v_line_resolved := true;
          end if;
        end if;
      end if;

      if v_line_resolved then
        v_line_cost := v_unit_cost * v_line.canonical_quantity * v_line.yield_waste_factor;
        v_known_cost := v_known_cost + v_line_cost;
        v_resolved_lines := v_resolved_lines + 1;
        if v_cost_evidence ->> 'costHistoryId' is not null then
          v_cost_history_ids := v_cost_history_ids
            || jsonb_build_array(v_cost_evidence ->> 'costHistoryId');
        end if;
      else
        v_unresolved_lines := v_unresolved_lines + 1;
        v_line_missing := jsonb_build_array(jsonb_build_object(
          'lineId', v_line.id,
          'inventoryItemId', v_line.ingredient_id,
          'itemName', v_item ->> 'name',
          'status', v_status,
          'recipeQuantity', v_line.quantity,
          'recipeUnit', v_line.unit
        ));
        v_missing := v_missing || v_line_missing;
      end if;

      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'lineId', v_line.id,
        'lineType', 'inventory_item',
        'inventoryItemId', v_line.ingredient_id,
        'itemName', v_item ->> 'name',
        'requiredQuantity', v_line.quantity,
        'recipeUnit', v_line.unit,
        'normalizedBaseQuantity', v_line.canonical_quantity,
        'normalizedBaseUnit', v_line.canonical_unit,
        'yieldWasteFactor', v_line.yield_waste_factor,
        'historicalUnitCost', v_unit_cost,
        'extendedLineCost', v_line_cost,
        'costStatus', v_status,
        'resolved', v_line_resolved,
        'warnings', v_line_warnings,
        'costEvidence', case when v_cost_evidence is null then null else jsonb_build_object(
          'source', 'HISTORICAL_WEIGHTED_AVERAGE_COST',
          'costHistoryId', v_cost_evidence ->> 'costHistoryId',
          'effectiveAt', v_cost_evidence ->> 'effectiveAt',
          'recordedAt', v_cost_evidence ->> 'recordedAt',
          'receiptId', v_cost_evidence ->> 'receiptId',
          'receiptLineId', v_cost_evidence ->> 'receiptLineId',
          'supplierId', v_cost_evidence ->> 'supplierId',
          'normalizedUnit', v_cost_evidence ->> 'canonicalUnit',
          'ageDays', v_cost_age_days
        ) end
      ));
    elsif v_line.sub_recipe_id is not null then
      v_nested := public.inventory_recipe_cost_trust_component(
        v_line.sub_recipe_id,
        null,
        p_branch_id,
        p_as_of,
        p_item_cache,
        p_cost_cache,
        array_append(coalesce(p_path, '{}'::uuid[]), p_recipe_id),
        p_stale_after_days
      );
      v_nested_total := greatest(coalesce((v_nested ->> 'totalCostBearingLines')::integer, 0), 1);
      v_nested_resolved := coalesce((v_nested ->> 'resolvedLines')::integer, 0);
      v_nested_unresolved := coalesce((v_nested ->> 'unresolvedLines')::integer, 1);
      v_nested_stale := coalesce((v_nested ->> 'staleLines')::integer, 0);
      v_total_lines := v_total_lines + v_nested_total;
      v_resolved_lines := v_resolved_lines + v_nested_resolved;
      v_unresolved_lines := v_unresolved_lines + v_nested_unresolved;
      v_stale_lines := v_stale_lines + v_nested_stale;

      if nullif(v_nested ->> 'outputUnitCost', '') is null then
        v_status := 'INCOMPLETE_SUBRECIPE';
      elsif nullif(v_nested ->> 'outputUnit', '') is null
        or v_line.canonical_unit <> (v_nested ->> 'outputUnit') then
        v_status := 'UNRESOLVED_UNIT';
        v_unresolved_lines := v_unresolved_lines + 1;
      else
        v_unit_cost := (v_nested ->> 'outputUnitCost')::numeric;
        v_line_cost := v_unit_cost * v_line.canonical_quantity * v_line.yield_waste_factor;
        v_known_cost := v_known_cost + v_line_cost;
        v_line_resolved := true;
        v_status := case
          when v_nested ->> 'costStatus' = 'STALE_COST' then 'STALE_COST'
          else 'VALID_COST'
        end;
      end if;

      if jsonb_typeof(v_nested -> 'missingComponents') = 'array' then
        v_missing := v_missing || (v_nested -> 'missingComponents');
      end if;
      if not v_line_resolved and jsonb_array_length(v_nested -> 'missingComponents') = 0 then
        v_missing := v_missing || jsonb_build_array(jsonb_build_object(
          'lineId', v_line.id,
          'subRecipeId', v_line.sub_recipe_id,
          'status', v_status
        ));
      end if;
      if jsonb_typeof(v_nested -> 'costHistoryIds') = 'array' then
        v_cost_history_ids := v_cost_history_ids || (v_nested -> 'costHistoryIds');
      end if;
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'lineId', v_line.id,
        'lineType', 'subrecipe',
        'subRecipeId', v_line.sub_recipe_id,
        'requiredQuantity', v_line.quantity,
        'recipeUnit', v_line.unit,
        'normalizedBaseQuantity', v_line.canonical_quantity,
        'normalizedBaseUnit', v_line.canonical_unit,
        'yieldWasteFactor', v_line.yield_waste_factor,
        'historicalUnitCost', v_unit_cost,
        'extendedLineCost', v_line_cost,
        'costStatus', v_status,
        'resolved', v_line_resolved,
        'componentCost', v_nested
      ));
    else
      v_total_lines := v_total_lines + 1;
      v_unresolved_lines := v_unresolved_lines + 1;
      v_missing := v_missing || jsonb_build_array(jsonb_build_object(
        'lineId', v_line.id,
        'status', 'INVALID_RECIPE_LINE',
        'reason', 'line_has_no_source'
      ));
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'lineId', v_line.id,
        'costStatus', 'INVALID_RECIPE_LINE',
        'resolved', false
      ));
    end if;
  end loop;

  if v_recipe.recipe_type = 'direct_stock' and jsonb_array_length(v_lines) <> 1 then
    v_warnings := v_warnings || jsonb_build_array('DIRECT_STOCK_REQUIRES_ONE_INVENTORY_LINE');
    v_unresolved_lines := v_unresolved_lines + 1;
    v_total_lines := greatest(v_total_lines, 1);
    v_missing := v_missing || jsonb_build_array(jsonb_build_object(
      'recipeId', v_recipe.id,
      'status', 'INVALID_RECIPE_LINE',
      'reason', 'direct_stock_line_count'
    ));
  end if;

  if v_version.output_quantity is null or v_version.output_unit is null then
    v_warnings := v_warnings || jsonb_build_array('VERSION_OUTPUT_NOT_SNAPSHOTTED');
    v_has_warning := true;
  end if;
  v_output_quantity := coalesce(v_version.output_quantity, v_recipe.output_quantity)
    * (v_version.yield_percentage / 100.0);
  if v_output_quantity <= 0 then
    v_unresolved_lines := v_unresolved_lines + 1;
    v_total_lines := greatest(v_total_lines, 1);
    v_missing := v_missing || jsonb_build_array(jsonb_build_object(
      'recipeId', v_recipe.id,
      'status', 'INVALID_RECIPE_LINE',
      'reason', 'invalid_output_yield'
    ));
  end if;

  v_completeness := case
    when v_total_lines = 0 then 0
    else round(100.0 * v_resolved_lines / v_total_lines, 2)
  end;
  v_total_cost := case when v_unresolved_lines = 0 then v_known_cost else null end;
  v_output_unit_cost := case
    when v_total_cost is not null and v_output_quantity > 0
      then v_total_cost / v_output_quantity
    else null
  end;
  v_cost_per_portion := case
    when v_total_cost is null then null
    when coalesce(v_version.portion_count, v_recipe.portion_count) is not null
      and coalesce(v_version.portion_count, v_recipe.portion_count) > 0
      then v_total_cost / coalesce(v_version.portion_count, v_recipe.portion_count)
    when coalesce(v_version.portion_size, v_recipe.portion_size) is not null
      and coalesce(v_version.portion_size, v_recipe.portion_size) > 0
      and coalesce(v_version.portion_unit, v_recipe.portion_unit)
        = coalesce(v_version.output_unit, v_recipe.output_unit)
      then v_output_unit_cost * coalesce(v_version.portion_size, v_recipe.portion_size)
    when coalesce(v_version.output_unit, v_recipe.output_unit) = 'each' then v_output_unit_cost
    else null
  end;

  v_trust := case
    when v_total_lines = 0 then 'UNRELIABLE'
    when v_unresolved_lines = 0 and v_stale_lines = 0 and not v_has_warning then 'TRUSTED'
    when v_unresolved_lines = 0 then 'MOSTLY_COMPLETE'
    when v_completeness >= 80 then 'MOSTLY_COMPLETE'
    when v_completeness >= 50 then 'INCOMPLETE'
    else 'UNRELIABLE'
  end;
  v_confidence := round(
    least(100, greatest(0, v_completeness - case when v_stale_lines > 0 then 15 else 0 end)),
    2
  );

  return jsonb_build_object(
    'recipeId', v_recipe.id,
    'recipeName', v_recipe.name,
    'recipeType', v_recipe.recipe_type,
    'recipeScope', case when v_recipe.branch_id is null then 'network' else 'branch' end,
    'recipeBranchId', v_recipe.branch_id,
    'recipeVersionId', v_version.id,
    'recipeVersionNumber', v_version.version_number,
    'recipeVersionStatus', v_version.status,
    'versionEffectiveFrom', v_version.effective_from,
    'versionEffectiveTo', v_version.effective_to,
    'branchId', p_branch_id,
    'asOf', p_as_of,
    'currency', 'SAR',
    'calculationMethod', 'HISTORICAL_WEIGHTED_AVERAGE_AS_OF',
    'totalCost', v_total_cost,
    'resolvedCostSubtotal', v_known_cost,
    'definedOutputQuantity', coalesce(v_version.output_quantity, v_recipe.output_quantity),
    'yieldPercentage', v_version.yield_percentage,
    'outputQuantity', v_output_quantity,
    'outputUnit', coalesce(v_version.output_unit, v_recipe.output_unit),
    'outputUnitCost', v_output_unit_cost,
    'portionCount', coalesce(v_version.portion_count, v_recipe.portion_count),
    'portionSize', coalesce(v_version.portion_size, v_recipe.portion_size),
    'portionUnit', coalesce(v_version.portion_unit, v_recipe.portion_unit),
    'costPerPortion', v_cost_per_portion,
    'totalCostBearingLines', v_total_lines,
    'resolvedLines', v_resolved_lines,
    'unresolvedLines', v_unresolved_lines,
    'staleLines', v_stale_lines,
    'completenessPct', v_completeness,
    'confidencePct', v_confidence,
    'trustStatus', v_trust,
    'costStatus', case
      when v_unresolved_lines > 0 then 'MISSING_COST'
      when v_stale_lines > 0 then 'STALE_COST'
      when v_total_cost = 0 then 'LEGITIMATE_ZERO_COST'
      else 'VALID_COST'
    end,
    'profitabilityAvailable', v_trust = 'TRUSTED',
    'missingComponents', v_missing,
    'warnings', v_warnings,
    'lines', v_lines,
    'costHistoryIds', (
      select coalesce(jsonb_agg(distinct value), '[]'::jsonb)
      from jsonb_array_elements(v_cost_history_ids)
    )
  );
end;
$$;

revoke all on function public.inventory_recipe_cost_trust_component(
  uuid, uuid, text, timestamptz, jsonb, jsonb, uuid[], integer
) from public;

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
  if p_as_of is null then
    raise exception 'Business date is required';
  end if;
  if p_stale_after_days < 1 then
    raise exception 'Stale cost threshold must be at least one day';
  end if;
  if not public.inventory_branch_allowed(p_branch_id) then
    raise exception 'Recipe cost branch access denied' using errcode = '42501';
  end if;
  v_as_of := (p_as_of + time '23:59:59.999999') at time zone 'Asia/Riyadh';

  select coalesce(jsonb_object_agg(x.id::text, to_jsonb(x)), '{}'::jsonb)
  into v_item_cache
  from (
    select
      i.id,
      i.canonical_name as "name",
      i.base_inventory_unit as "baseUnit",
      i.active,
      i.recipe_cost_eligible as "recipeCostEligible",
      i.legitimate_zero_cost as "legitimateZeroCost",
      i.inventory_classification as "classification",
      i.scope,
      i.branch_id as "branchId"
    from public.inventory_ingredients i
    where i.branch_id is null or i.branch_id = p_branch_id
  ) x;

  select coalesce(jsonb_object_agg(x.ingredient_id::text, to_jsonb(x)), '{}'::jsonb)
  into v_cost_cache
  from (
    select distinct on (h.ingredient_id)
      h.ingredient_id,
      h.id as "costHistoryId",
      h.weighted_average_cost as "weightedAverageCost",
      h.canonical_unit as "canonicalUnit",
      h.effective_at as "effectiveAt",
      h.recorded_at as "recordedAt",
      h.receipt_id as "receiptId",
      h.receipt_line_id as "receiptLineId",
      h.invoice_id as "invoiceId",
      h.supplier_id as "supplierId",
      h.costing_method as "costingMethod"
    from public.inventory_ingredient_cost_history h
    where h.branch_id = p_branch_id
      and h.effective_at <= v_as_of
    order by h.ingredient_id, h.effective_at desc, h.recorded_at desc, h.id desc
  ) x;

  v_result := public.inventory_recipe_cost_trust_component(
    p_recipe_id,
    p_recipe_version_id,
    p_branch_id,
    v_as_of,
    v_item_cache,
    v_cost_cache,
    '{}'::uuid[],
    p_stale_after_days
  );
  return v_result || jsonb_build_object('businessDate', p_as_of);
end;
$$;

revoke all on function public.inventory_recipe_cost_trust_as_of(
  uuid, text, date, uuid, integer
) from public;
grant execute on function public.inventory_recipe_cost_trust_as_of(
  uuid, text, date, uuid, integer
) to authenticated;

create or replace function public.inventory_product_cost_trust_as_of(
  p_menu_item_id uuid,
  p_branch_id text,
  p_as_of date,
  p_stale_after_days integer default 90
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_menu record;
  v_recipe_id uuid;
  v_recipe_cost jsonb;
  v_price numeric;
  v_net_price numeric;
  v_sold_portion_cost numeric;
  v_trusted boolean;
begin
  if not public.inventory_branch_allowed(p_branch_id) then
    raise exception 'Product cost branch access denied' using errcode = '42501';
  end if;
  select m.* into v_menu
  from public.menu_items m
  where m.id = p_menu_item_id
    and m.branch_id = p_branch_id;
  if not found then
    raise exception 'Menu item is not available for requested branch' using errcode = '42501';
  end if;

  v_price := nullif(regexp_replace(v_menu.price, '[^0-9.]', '', 'g'), '')::numeric;
  select r.id into v_recipe_id
  from public.inventory_recipes r
  where r.active
    and (r.branch_id is null or r.branch_id = p_branch_id)
    and (
      r.menu_item_id = p_menu_item_id
      or (
        v_menu.placement_group_id is not null
        and r.placement_group_id = v_menu.placement_group_id
      )
    )
  order by (r.branch_id is not null) desc, r.updated_at desc, r.id
  limit 1;

  if v_recipe_id is null then
    return jsonb_build_object(
      'menuItemId', p_menu_item_id,
      'menuItemName', v_menu.name_en,
      'branchId', p_branch_id,
      'businessDate', p_as_of,
      'sellingPrice', v_price,
      'recipeId', null,
      'recipeCost', null,
      'costPerSoldPortion', null,
      'foodCostPercentage', null,
      'grossMargin', null,
      'grossMarginPercentage', null,
      'costCompletenessPct', 0,
      'costConfidencePct', 0,
      'costTrustStatus', 'UNRELIABLE',
      'costStatus', 'MISSING_RECIPE',
      'profitabilityAvailable', false,
      'menuEngineeringClassification', 'COST_DATA_INCOMPLETE',
      'missingComponents', jsonb_build_array(jsonb_build_object(
        'menuItemId', p_menu_item_id,
        'status', 'MISSING_RECIPE'
      ))
    );
  end if;

  v_recipe_cost := public.inventory_recipe_cost_trust_as_of(
    v_recipe_id, p_branch_id, p_as_of, null, p_stale_after_days
  );
  v_sold_portion_cost := coalesce(
    nullif(v_recipe_cost ->> 'costPerPortion', '')::numeric,
    nullif(v_recipe_cost ->> 'outputUnitCost', '')::numeric
  );
  v_trusted := v_recipe_cost ->> 'trustStatus' = 'TRUSTED'
    and v_sold_portion_cost is not null;
  v_net_price := case when v_price is null then null else v_price / 1.15 end;

  return jsonb_build_object(
    'menuItemId', p_menu_item_id,
    'menuItemName', v_menu.name_en,
    'branchId', p_branch_id,
    'businessDate', p_as_of,
    'sellingPrice', v_price,
    'sellingPriceExcludingTax', v_net_price,
    'recipeId', v_recipe_id,
    'recipeVersionId', v_recipe_cost ->> 'recipeVersionId',
    'recipeCost', v_recipe_cost -> 'totalCost',
    'costPerSoldPortion', v_sold_portion_cost,
    'foodCostPercentage', case
      when v_trusted and v_net_price > 0 then v_sold_portion_cost / v_net_price * 100
      else null
    end,
    'grossMargin', case
      when v_trusted and v_net_price is not null then v_net_price - v_sold_portion_cost
      else null
    end,
    'grossMarginPercentage', case
      when v_trusted and v_net_price > 0
        then (v_net_price - v_sold_portion_cost) / v_net_price * 100
      else null
    end,
    'costCompletenessPct', v_recipe_cost -> 'completenessPct',
    'costConfidencePct', v_recipe_cost -> 'confidencePct',
    'costTrustStatus', v_recipe_cost ->> 'trustStatus',
    'costStatus', v_recipe_cost ->> 'costStatus',
    'profitabilityAvailable', v_trusted,
    'menuEngineeringClassification', case
      when v_trusted then null
      else 'COST_DATA_INCOMPLETE'
    end,
    'missingComponents', v_recipe_cost -> 'missingComponents',
    'warnings', v_recipe_cost -> 'warnings',
    'recipeCostEvidence', v_recipe_cost
  );
end;
$$;

revoke all on function public.inventory_product_cost_trust_as_of(
  uuid, text, date, integer
) from public;
grant execute on function public.inventory_product_cost_trust_as_of(
  uuid, text, date, integer
) to authenticated;

create or replace function public.inventory_cost_health_as_of(
  p_branch_id text,
  p_as_of date,
  p_stale_after_days integer default 90
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_menu record;
  v_recipe record;
  v_product jsonb;
  v_recipe_cost jsonb;
  v_products jsonb := '[]'::jsonb;
  v_recipes jsonb := '[]'::jsonb;
  v_missing_items jsonb;
  v_total integer := 0;
  v_trusted integer := 0;
  v_mostly integer := 0;
  v_incomplete integer := 0;
  v_unreliable integer := 0;
  v_missing_recipe integer := 0;
  v_direct_stock_missing integer := 0;
  v_stale integer := 0;
  v_total_recipes integer := 0;
  v_trusted_recipes integer := 0;
  v_incomplete_recipes integer := 0;
begin
  if not public.inventory_branch_allowed(p_branch_id) then
    raise exception 'Cost health branch access denied' using errcode = '42501';
  end if;

  for v_menu in
    select id
    from public.menu_items
    where branch_id = p_branch_id
      and active
    order by name_en, id
  loop
    v_product := public.inventory_product_cost_trust_as_of(
      v_menu.id, p_branch_id, p_as_of, p_stale_after_days
    );
    v_products := v_products || jsonb_build_array(v_product - 'recipeCostEvidence');
    v_total := v_total + 1;
    case v_product ->> 'costTrustStatus'
      when 'TRUSTED' then v_trusted := v_trusted + 1;
      when 'MOSTLY_COMPLETE' then v_mostly := v_mostly + 1;
      when 'INCOMPLETE' then v_incomplete := v_incomplete + 1;
      else v_unreliable := v_unreliable + 1;
    end case;
    if v_product ->> 'costStatus' = 'MISSING_RECIPE' then
      v_missing_recipe := v_missing_recipe + 1;
    end if;
    if v_product ->> 'costStatus' = 'STALE_COST' then
      v_stale := v_stale + 1;
    end if;
    if v_product ->> 'costStatus' <> 'VALID_COST'
      and exists (
        select 1
        from public.inventory_recipes r
        where r.id = (v_product ->> 'recipeId')::uuid
          and r.recipe_type = 'direct_stock'
      ) then
      v_direct_stock_missing := v_direct_stock_missing + 1;
    end if;
  end loop;

  for v_recipe in
    select id
    from public.inventory_recipes
    where active
      and (branch_id is null or branch_id = p_branch_id)
    order by name, id
  loop
    v_recipe_cost := public.inventory_recipe_cost_trust_as_of(
      v_recipe.id, p_branch_id, p_as_of, null, p_stale_after_days
    );
    v_recipes := v_recipes || jsonb_build_array(v_recipe_cost - 'lines');
    v_total_recipes := v_total_recipes + 1;
    if v_recipe_cost ->> 'trustStatus' = 'TRUSTED' then
      v_trusted_recipes := v_trusted_recipes + 1;
    else
      v_incomplete_recipes := v_incomplete_recipes + 1;
    end if;
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object(
    'inventoryItemId', i.id,
    'itemName', i.canonical_name,
    'baseUnit', i.base_inventory_unit,
    'status', case
      when h.id is null then 'NO_HISTORICAL_COST'
      when h.weighted_average_cost = 0 and not i.legitimate_zero_cost then 'MISSING_COST'
      when p_as_of - h.effective_at::date > p_stale_after_days then 'STALE_COST'
      else 'VALID_COST'
    end
  ) order by i.canonical_name), '[]'::jsonb)
  into v_missing_items
  from public.inventory_ingredients i
  left join lateral (
    select h.id, h.weighted_average_cost, h.effective_at
    from public.inventory_ingredient_cost_history h
    where h.branch_id = p_branch_id
      and h.ingredient_id = i.id
      and h.effective_at < ((p_as_of + 1)::timestamp at time zone 'Asia/Riyadh')
    order by h.effective_at desc, h.recorded_at desc, h.id desc
    limit 1
  ) h on true
  where i.active
    and coalesce(i.recipe_cost_eligible, true)
    and (i.branch_id is null or i.branch_id = p_branch_id)
    and (
      h.id is null
      or (h.weighted_average_cost = 0 and not i.legitimate_zero_cost)
      or p_as_of - h.effective_at::date > p_stale_after_days
    );

  return jsonb_build_object(
    'branchId', p_branch_id,
    'businessDate', p_as_of,
    'staleAfterDays', p_stale_after_days,
    'summary', jsonb_build_object(
      'totalProducts', v_total,
      'trustedProducts', v_trusted,
      'mostlyCompleteProducts', v_mostly,
      'incompleteProducts', v_incomplete,
      'unreliableProducts', v_unreliable,
      'productsMissingRecipe', v_missing_recipe,
      'staleCostProducts', v_stale,
      'directStockProductsMissingCost', v_direct_stock_missing,
      'coveragePct', case when v_total = 0 then 0 else round(100.0 * v_trusted / v_total, 2) end,
      'totalRecipes', v_total_recipes,
      'trustedRecipes', v_trusted_recipes,
      'incompleteRecipes', v_incomplete_recipes,
      'recipeCoveragePct', case
        when v_total_recipes = 0 then 0
        else round(100.0 * v_trusted_recipes / v_total_recipes, 2)
      end,
      'ingredientsMissingOrStaleCost', jsonb_array_length(v_missing_items)
    ),
    'products', v_products,
    'recipes', v_recipes,
    'ingredientsMissingOrStaleCost', v_missing_items
  );
end;
$$;

revoke all on function public.inventory_cost_health_as_of(text, date, integer) from public;
grant execute on function public.inventory_cost_health_as_of(text, date, integer) to authenticated;

create or replace function public.inventory_prepare_recipe_draft_version(
  p_recipe_id uuid,
  p_documentation jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recipe public.inventory_recipes%rowtype;
  v_version public.inventory_recipe_versions%rowtype;
  v_next_version integer;
begin
  select * into v_recipe
  from public.inventory_recipes
  where id = p_recipe_id
  for update;
  if not found then raise exception 'Recipe not found'; end if;
  if not (
    case when v_recipe.branch_id is null
      then public.ask_nac_vault_has_all_branches()
      else public.inventory_can_approve(v_recipe.branch_id)
    end
  ) then
    raise exception 'Recipe version access denied' using errcode = '42501';
  end if;

  select * into v_version
  from public.inventory_recipe_versions
  where recipe_id = p_recipe_id and status = 'draft'
  order by version_number desc
  limit 1
  for update;
  if found then
    update public.inventory_recipe_versions
    set documentation = coalesce(p_documentation, '{}'::jsonb),
        updated_at = now(),
        updated_by = auth.uid()
    where id = v_version.id
    returning * into v_version;
  else
    select coalesce(max(version_number), 0) + 1
    into v_next_version
    from public.inventory_recipe_versions
    where recipe_id = p_recipe_id;
    insert into public.inventory_recipe_versions (
      recipe_id, version_number, effective_from, status, yield_percentage,
      output_quantity, output_unit, portion_count, portion_size, portion_unit,
      documentation, created_by, updated_by
    ) values (
      p_recipe_id, v_next_version, now(), 'draft', 100,
      v_recipe.output_quantity, v_recipe.output_unit, v_recipe.portion_count,
      v_recipe.portion_size, v_recipe.portion_unit,
      coalesce(p_documentation, '{}'::jsonb), auth.uid(), auth.uid()
    ) returning * into v_version;
  end if;

  return to_jsonb(v_version);
end;
$$;

revoke all on function public.inventory_prepare_recipe_draft_version(uuid, jsonb) from public;
grant execute on function public.inventory_prepare_recipe_draft_version(uuid, jsonb) to authenticated;

create or replace function public.inventory_activate_recipe_version(
  p_recipe_version_id uuid,
  p_effective_from timestamptz,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_version public.inventory_recipe_versions%rowtype;
  v_recipe public.inventory_recipes%rowtype;
  v_previous public.inventory_recipe_versions%rowtype;
begin
  if nullif(trim(p_reason), '') is null then
    raise exception 'Activation reason is required';
  end if;
  select * into v_version
  from public.inventory_recipe_versions
  where id = p_recipe_version_id
  for update;
  if not found or v_version.status <> 'draft' then
    raise exception 'Only a draft recipe version can be activated';
  end if;
  select * into v_recipe
  from public.inventory_recipes
  where id = v_version.recipe_id
  for update;
  if not (
    case when v_recipe.branch_id is null
      then public.ask_nac_vault_has_all_branches()
      else public.inventory_can_approve(v_recipe.branch_id)
    end
  ) then
    raise exception 'Recipe version access denied' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.inventory_recipe_version_lines
    where recipe_version_id = p_recipe_version_id
  ) then
    raise exception 'Cannot activate an empty recipe version';
  end if;
  if v_version.output_quantity is null or v_version.output_unit is null then
    raise exception 'Recipe version output and unit must be captured before activation';
  end if;
  if exists (
    select 1
    from public.inventory_recipe_versions
    where recipe_id = v_recipe.id
      and id <> p_recipe_version_id
      and status in ('active', 'retired')
      and effective_from >= p_effective_from
  ) then
    raise exception 'Effective date must follow existing recipe history';
  end if;

  select * into v_previous
  from public.inventory_recipe_versions
  where recipe_id = v_recipe.id
    and status = 'active'
    and effective_from < p_effective_from
    and (effective_to is null or effective_to > p_effective_from)
  order by effective_from desc, version_number desc
  limit 1
  for update;
  if found then
    update public.inventory_recipe_versions
    set status = 'retired',
        effective_to = p_effective_from,
        updated_at = now(),
        updated_by = auth.uid()
    where id = v_previous.id;
  end if;
  if exists (
    select 1
    from public.inventory_recipe_versions
    where recipe_id = v_recipe.id
      and id <> p_recipe_version_id
      and status in ('active', 'retired')
      and effective_from < p_effective_from
      and coalesce(effective_to, 'infinity'::timestamptz) > p_effective_from
  ) then
    raise exception 'Recipe effective dates overlap';
  end if;

  update public.inventory_recipe_versions
  set status = 'active',
      effective_from = p_effective_from,
      effective_to = null,
      approved_by = auth.uid(),
      updated_at = now(),
      updated_by = auth.uid()
  where id = p_recipe_version_id
  returning * into v_version;

  insert into public.inventory_audit_log (
    event_type, actor_id, branch_id, entity_type, entity_id,
    previous_value, new_value, reason, metadata
  ) values (
    'recipe_version_activated', auth.uid(), v_recipe.branch_id,
    'inventory_recipe_version', v_version.id,
    case when v_previous.id is null then null else to_jsonb(v_previous) end,
    to_jsonb(v_version), trim(p_reason),
    jsonb_build_object('recipeId', v_recipe.id, 'effectiveFrom', p_effective_from)
  );
  return to_jsonb(v_version);
end;
$$;

revoke all on function public.inventory_activate_recipe_version(uuid, timestamptz, text) from public;
grant execute on function public.inventory_activate_recipe_version(uuid, timestamptz, text) to authenticated;

comment on function public.inventory_recipe_cost_trust_as_of(uuid, text, date, uuid, integer) is
  'Canonical read-only Phase C recipe cost: explicit branch and business date, historical WAC evidence, recursive subrecipes, yield, completeness, and trust.';
comment on function public.inventory_product_cost_trust_as_of(uuid, text, date, integer) is
  'Product cost and profitability gate. Margin fields remain null unless recipe cost is trusted.';
comment on function public.inventory_cost_health_as_of(text, date, integer) is
  'Compact branch cost coverage overview. Performs no writes and creates no exception rows.';
