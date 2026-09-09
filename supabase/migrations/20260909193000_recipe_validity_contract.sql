-- Canonical recipe-validity contract.
-- Replaces cost-eligible / exact-unit gates with operational identity + UOM + yield rules.
-- Preserves live overlapping-date, portion-count, and direct-stock guards.
-- Does not reclassify ingredients, write costs, or mutate recipe lines.

create or replace function public.inventory_recipe_units_compatible(p_left text, p_right text)
returns boolean
language sql
immutable
parallel safe
as $$
  select case
    when p_left is null or p_right is null then false
    when p_left = p_right then true
    when p_left in ('gram', 'kilogram') and p_right in ('gram', 'kilogram') then true
    when p_left in ('millilitre', 'litre') and p_right in ('millilitre', 'litre') then true
    else false
  end;
$$;

create or replace function public.inventory_is_documentation_recipe_line(p_name text)
returns boolean
language sql
immutable
parallel safe
as $$
  select coalesce(p_name, '') ~* '^(total|portions?|finished weight|fin?ished weight|bases|except the olive oil,?|notes|timing:?.*|method|equipment|yield)$';
$$;

create or replace function public.inventory_validate_recipe_version_activation(p_recipe_version_id uuid, p_effective_from timestamp with time zone)
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
  v_output_quantity numeric;
  v_output_unit text;
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

  v_output_quantity := coalesce(v_version.output_quantity, v_recipe.output_quantity);
  v_output_unit := coalesce(v_version.output_unit, v_recipe.output_unit);
  if v_output_quantity is null or v_output_quantity <= 0 or v_output_unit is null then
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
    select 1
    from public.inventory_recipe_version_lines l
    left join public.inventory_ingredients i on i.id = l.ingredient_id
    where l.recipe_version_id = p_recipe_version_id
      and not public.inventory_is_documentation_recipe_line(coalesce(i.canonical_name, ''))
  ) then
    v_errors := v_errors || jsonb_build_array('EMPTY_RECIPE');
  end if;

  if exists (
    select 1
    from public.inventory_recipe_version_lines l
    left join public.inventory_ingredients i on i.id = l.ingredient_id
    where l.recipe_version_id = p_recipe_version_id
      and not public.inventory_is_documentation_recipe_line(coalesce(i.canonical_name, ''))
      and (
        (l.ingredient_id is null and l.sub_recipe_id is null)
        or (l.ingredient_id is not null and l.sub_recipe_id is not null)
        or l.canonical_quantity <= 0
        or (
          l.ingredient_id is not null
          and (
            i.id is null
            or not i.active
            or i.canonical_name ~* '(ocr|temp verify)'
            or i.base_inventory_unit is null
            or not public.inventory_recipe_units_compatible(i.base_inventory_unit, l.canonical_unit)
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
        or not public.inventory_recipe_units_compatible(
          coalesce(nested.output_unit, nested_recipe.output_unit),
          line.canonical_unit
        )
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

comment on function public.inventory_validate_recipe_version_activation(uuid, timestamptz) is
  'Canonical recipe activation validator: identity, UOM compatibility, documentation exclusion, effective-dated sub-recipes. Cost eligibility is not a structural gate.';

comment on function public.inventory_recipe_units_compatible(text, text) is
  'Same-dimension recipe UOM compatibility: g↔kg and ml↔L. Mass↔volume and each↔mass/volume stay incompatible.';
