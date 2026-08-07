-- Hardening found during production verification.
-- No source-data rewrite: guards future writes and wraps theoretical-consumption output.

create or replace function public.inventory_modifier_quantity_factor(
  p_branch_id text,
  p_addon_id uuid,
  p_period_start date,
  p_period_end date
)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_rule public.inventory_addon_consumption_rules%rowtype;
  v_recipe public.inventory_recipes%rowtype;
  v_version public.inventory_recipe_versions%rowtype;
  v_output numeric;
begin
  select * into v_rule
  from public.inventory_addon_consumption_rules rule
  where rule.addon_id = p_addon_id
    and rule.active
    and (
      (rule.scope = 'branch' and rule.branch_id = p_branch_id)
      or rule.scope = 'network'
    )
  order by (rule.scope = 'branch') desc, rule.updated_at desc
  limit 1;
  if not found or v_rule.effect_type = 'NO_STOCK_EFFECT' or v_rule.recipe_id is null then
    return 1;
  end if;

  select * into v_recipe from public.inventory_recipes where id = v_rule.recipe_id;
  select * into v_version
  from public.inventory_recipe_versions version
  where version.recipe_id = v_rule.recipe_id
    and version.status in ('active', 'retired')
    and version.effective_from::date <= p_period_start
    and (version.effective_to is null or version.effective_to::date > p_period_end)
  order by version.effective_from desc, version.version_number desc
  limit 1;
  if not found then return 1; end if;

  v_output := coalesce(v_version.output_quantity, v_recipe.output_quantity)
    * (v_version.yield_percentage / 100.0);
  if coalesce(v_version.portion_count, v_recipe.portion_count) > 0 then
    return v_output / coalesce(v_version.portion_count, v_recipe.portion_count);
  end if;
  if coalesce(v_version.portion_size, v_recipe.portion_size) > 0
    and coalesce(v_version.portion_unit, v_recipe.portion_unit)
      = coalesce(v_version.output_unit, v_recipe.output_unit)
  then
    return coalesce(v_version.portion_size, v_recipe.portion_size);
  end if;
  return 1;
end;
$$;

alter function public.inventory_theoretical_consumption(text, date, date)
  rename to inventory_theoretical_consumption_base;

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
  v_item jsonb;
  v_evidence jsonb;
  v_items jsonb := '[]'::jsonb;
  v_evidence_rows jsonb;
  v_total numeric;
  v_quantity numeric;
  v_factor numeric;
  v_factor_cache jsonb := '{}'::jsonb;
  v_factor_key text;
  v_source_count integer := 0;
  v_min_start date;
  v_max_end date;
  v_covered_days integer := 0;
  v_requested_days integer := p_period_end - p_period_start + 1;
  v_has_overlap boolean := false;
  v_period_complete boolean := false;
begin
  v_result := public.inventory_theoretical_consumption_base(
    p_branch_id, p_period_start, p_period_end
  );

  select
    count(*),
    min(batch.period_start),
    max(batch.period_end),
    coalesce(sum(batch.period_end - batch.period_start + 1), 0)
  into v_source_count, v_min_start, v_max_end, v_covered_days
  from public.inventory_sales_consumption_batches selected
  join public.foodics_import_batches batch on batch.id = selected.batch_id
  where selected.branch_id = p_branch_id
    and selected.status = 'approved'
    and selected.quantity_semantics = 'net_of_voids_refunds'
    and batch.period_start >= p_period_start
    and batch.period_end <= p_period_end;

  select exists (
    select 1
    from public.inventory_sales_consumption_batches selected
    join public.foodics_import_batches batch on batch.id = selected.batch_id
    where selected.branch_id = p_branch_id
      and selected.status = 'approved'
      and daterange(batch.period_start, batch.period_end, '[]')
        && daterange(p_period_start, p_period_end, '[]')
  ) into v_has_overlap;

  v_period_complete := v_source_count > 0
    and v_min_start = p_period_start
    and v_max_end = p_period_end
    and v_covered_days = v_requested_days;

  for v_item in
    select value from jsonb_array_elements(coalesce(v_result -> 'items', '[]'::jsonb))
  loop
    v_evidence_rows := '[]'::jsonb;
    v_total := 0;
    for v_evidence in
      select value from jsonb_array_elements(coalesce(v_item -> 'evidence', '[]'::jsonb))
    loop
      v_quantity := coalesce(nullif(v_evidence ->> 'quantity', '')::numeric, 0);
      if v_evidence ->> 'sourceType' = 'MODIFIER'
        and nullif(v_evidence ->> 'addonId', '') is not null
      then
        v_factor_key := concat(
          v_evidence ->> 'addonId', ':',
          v_evidence ->> 'periodStart', ':',
          v_evidence ->> 'periodEnd'
        );
        if v_factor_cache ? v_factor_key then
          v_factor := (v_factor_cache ->> v_factor_key)::numeric;
        else
          v_factor := public.inventory_modifier_quantity_factor(
            p_branch_id,
            (v_evidence ->> 'addonId')::uuid,
            (v_evidence ->> 'periodStart')::date,
            (v_evidence ->> 'periodEnd')::date
          );
          v_factor_cache := jsonb_set(
            v_factor_cache,
            array[v_factor_key],
            to_jsonb(v_factor),
            true
          );
        end if;
        v_quantity := v_quantity * v_factor;
        v_evidence := jsonb_set(
          v_evidence,
          '{quantity}',
          to_jsonb(v_quantity),
          true
        );
      end if;
      v_total := v_total + v_quantity;
      v_evidence_rows := v_evidence_rows || jsonb_build_array(v_evidence);
    end loop;
    v_item := jsonb_set(v_item, '{evidence}', v_evidence_rows, true);
    v_item := jsonb_set(v_item, '{theoreticalQuantity}', to_jsonb(v_total), true);
    v_items := v_items || jsonb_build_array(v_item);
  end loop;

  v_result := jsonb_set(v_result, '{items}', v_items, true);
  v_result := jsonb_set(
    v_result,
    '{periodCoverage}',
    jsonb_build_object(
      'complete', v_period_complete,
      'approvedSourceCount', v_source_count,
      'coveredDays', v_covered_days,
      'requestedDays', v_requested_days,
      'firstCoveredDate', v_min_start,
      'lastCoveredDate', v_max_end
    ),
    true
  );
  if not v_period_complete then
    v_result := jsonb_set(v_result, '{complete}', 'false'::jsonb, true);
    v_result := jsonb_set(
      v_result,
      '{status}',
      to_jsonb(case when v_has_overlap or v_source_count > 0
        then 'PARTIAL_PERIOD' else 'NO_APPROVED_SALES_SOURCE' end),
      true
    );
  end if;
  return v_result;
end;
$$;

create or replace function public.inventory_validate_sales_consumption_selection()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch public.foodics_import_batches%rowtype;
begin
  select * into v_batch from public.foodics_import_batches where id = new.batch_id;
  if not found or v_batch.branch_id <> new.branch_id then
    raise exception 'Sales selection branch must match its source batch';
  end if;
  if new.status = 'approved' then
    if new.quantity_semantics <> 'net_of_voids_refunds' then
      raise exception 'Approved consumption source must be net of voids/refunds';
    end if;
    perform pg_advisory_xact_lock(
      hashtextextended('inventory-sales-consumption:' || new.branch_id, 0)
    );
    if exists (
      select 1
      from public.inventory_sales_consumption_batches selected
      join public.foodics_import_batches other on other.id = selected.batch_id
      where selected.branch_id = new.branch_id
        and selected.status = 'approved'
        and selected.id <> new.id
        and daterange(other.period_start, other.period_end, '[]')
          && daterange(v_batch.period_start, v_batch.period_end, '[]')
    ) then
      raise exception 'Approved sales-consumption periods cannot overlap';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists inventory_sales_consumption_selection_guard
  on public.inventory_sales_consumption_batches;
create trigger inventory_sales_consumption_selection_guard
before insert or update of batch_id, branch_id, status, quantity_semantics
on public.inventory_sales_consumption_batches
for each row execute function public.inventory_validate_sales_consumption_selection();

create or replace function public.inventory_validate_foodics_sales_batch_branch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_branch_id text;
  v_period_start date;
  v_period_end date;
begin
  select branch_id, period_start, period_end
  into v_branch_id, v_period_start, v_period_end
  from public.foodics_import_batches
  where id = new.batch_id;
  if not found
    or new.branch_id <> v_branch_id
    or new.period_start <> v_period_start
    or new.period_end <> v_period_end
  then
    raise exception 'Foodics sales row must match its parent batch branch and period';
  end if;
  return new;
end;
$$;

drop trigger if exists foodics_sales_batch_branch_guard on public.foodics_sales_items;
create trigger foodics_sales_batch_branch_guard
before insert or update of batch_id, branch_id, period_start, period_end
on public.foodics_sales_items
for each row execute function public.inventory_validate_foodics_sales_batch_branch();

create or replace function public.inventory_enforce_network_recipe_link_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.menu_item_id is distinct from old.menu_item_id
    and new.branch_id is null
    and not public.ask_nac_vault_has_all_branches()
  then
    raise exception 'Network recipe linkage requires all-branch authority'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists inventory_network_recipe_link_scope on public.inventory_recipes;
create trigger inventory_network_recipe_link_scope
before update of menu_item_id on public.inventory_recipes
for each row execute function public.inventory_enforce_network_recipe_link_scope();

create or replace function public.inventory_protect_recipe_version_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status not in ('active', 'retired') then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Active or retired recipe versions are immutable';
  end if;
  if old.status = 'active'
    and new.status = 'retired'
    and (to_jsonb(new) - array['status', 'effective_to', 'updated_at', 'updated_by'])
      = (to_jsonb(old) - array['status', 'effective_to', 'updated_at', 'updated_by'])
    and new.effective_to is not null
  then
    return new;
  end if;
  raise exception 'Active or retired recipe versions are immutable';
end;
$$;

drop trigger if exists inventory_recipe_version_history_guard
  on public.inventory_recipe_versions;
create trigger inventory_recipe_version_history_guard
before update or delete on public.inventory_recipe_versions
for each row execute function public.inventory_protect_recipe_version_history();

create or replace function public.inventory_protect_active_recipe_lines()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
begin
  if tg_op <> 'INSERT' and exists (
    select 1 from public.inventory_recipe_versions version
    where version.id = old.recipe_version_id
      and version.status in ('active', 'retired')
  ) then
    raise exception 'Lines of active or retired recipe versions are immutable';
  end if;
  if tg_op <> 'DELETE' and exists (
    select 1 from public.inventory_recipe_versions version
    where version.id = new.recipe_version_id
      and version.status in ('active', 'retired')
  ) then
    raise exception 'Lines of active or retired recipe versions are immutable';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists inventory_active_recipe_lines_guard
  on public.inventory_recipe_version_lines;
create trigger inventory_active_recipe_lines_guard
before insert or update or delete on public.inventory_recipe_version_lines
for each row execute function public.inventory_protect_active_recipe_lines();

revoke all on function public.inventory_modifier_quantity_factor(text, uuid, date, date) from public;
revoke all on function public.inventory_theoretical_consumption_base(text, date, date) from public;
revoke all on function public.inventory_theoretical_consumption(text, date, date) from public;
revoke all on function public.inventory_validate_sales_consumption_selection() from public;
revoke all on function public.inventory_validate_foodics_sales_batch_branch() from public;
revoke all on function public.inventory_enforce_network_recipe_link_scope() from public;
revoke all on function public.inventory_protect_recipe_version_history() from public;
revoke all on function public.inventory_protect_active_recipe_lines() from public;

grant execute on function public.inventory_theoretical_consumption(text, date, date) to authenticated;

comment on function public.inventory_theoretical_consumption(text, date, date) is
  'Strict theoretical consumption with complete-period gating and portion-aware modifier quantities.';
