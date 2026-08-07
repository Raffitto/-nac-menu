-- Phase C follow-up: avoid one product-cost RPC per menu item with no recipe.

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
  v_costed_recipe_ids uuid[] := '{}'::uuid[];
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

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'menuItemId', m.id,
      'menuItemName', m.name_en,
      'branchId', p_branch_id,
      'businessDate', p_as_of,
      'sellingPrice', nullif(regexp_replace(m.price, '[^0-9.]', '', 'g'), '')::numeric,
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
        'menuItemId', m.id,
        'status', 'MISSING_RECIPE'
      ))
    )
    order by m.name_en, m.id
  ), '[]'::jsonb)
  into v_products
  from public.menu_items m
  where m.branch_id = p_branch_id
    and m.active
    and not exists (
      select 1
      from public.inventory_recipes r
      where r.active
        and (r.branch_id is null or r.branch_id = p_branch_id)
        and (
          r.menu_item_id = m.id
          or (m.placement_group_id is not null and r.placement_group_id = m.placement_group_id)
        )
    );

  v_missing_recipe := jsonb_array_length(v_products);
  v_unreliable := v_missing_recipe;
  v_total := v_missing_recipe;

  for v_menu in
    select m.id, linked.recipe_id, linked.recipe_type
    from public.menu_items m
    join lateral (
      select r.id as recipe_id, r.recipe_type
      from public.inventory_recipes r
      where r.active
        and (r.branch_id is null or r.branch_id = p_branch_id)
        and (
          r.menu_item_id = m.id
          or (m.placement_group_id is not null and r.placement_group_id = m.placement_group_id)
        )
      order by (r.branch_id is not null) desc, r.updated_at desc, r.id
      limit 1
    ) linked on true
    where m.branch_id = p_branch_id
      and m.active
    order by m.name_en, m.id
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
    if v_product ->> 'costStatus' = 'STALE_COST' then
      v_stale := v_stale + 1;
    end if;
    if v_product ->> 'costStatus' <> 'VALID_COST'
      and v_menu.recipe_type = 'direct_stock' then
      v_direct_stock_missing := v_direct_stock_missing + 1;
    end if;
    if not v_menu.recipe_id = any(v_costed_recipe_ids) then
      v_recipe_cost := v_product -> 'recipeCostEvidence';
      v_recipes := v_recipes || jsonb_build_array(v_recipe_cost - 'lines');
      v_costed_recipe_ids := array_append(v_costed_recipe_ids, v_menu.recipe_id);
      v_total_recipes := v_total_recipes + 1;
      if v_recipe_cost ->> 'trustStatus' = 'TRUSTED' then
        v_trusted_recipes := v_trusted_recipes + 1;
      else
        v_incomplete_recipes := v_incomplete_recipes + 1;
      end if;
    end if;
  end loop;

  for v_recipe in
    select id
    from public.inventory_recipes
    where active
      and (branch_id is null or branch_id = p_branch_id)
      and not (id = any(v_costed_recipe_ids))
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
