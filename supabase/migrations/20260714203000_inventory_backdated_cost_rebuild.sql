-- Rebuild derived weighted-average fields in effective-time order after posting.
-- Receipt/cost records remain append-only; only their derived average snapshots are corrected.

create or replace function public.inventory_rebuild_ingredient_cost_history(
  p_branch_id text,
  p_ingredient_id uuid
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_history public.inventory_ingredient_cost_history%rowtype;
  v_existing_quantity numeric;
  v_previous_average numeric := 0;
  v_new_quantity numeric;
  v_new_average numeric;
  v_current_quantity numeric;
begin
  for v_history in
    select *
    from public.inventory_ingredient_cost_history h
    where h.branch_id = p_branch_id
      and h.ingredient_id = p_ingredient_id
    order by h.effective_at, h.recorded_at, h.id
    for update
  loop
    select coalesce(sum(m.signed_canonical_quantity), 0)
    into v_existing_quantity
    from public.inventory_movements m
    where m.branch_id = p_branch_id
      and m.ingredient_id = p_ingredient_id
      and m.status = 'posted'
      and (
        m.effective_at < v_history.effective_at
        or (
          m.effective_at = v_history.effective_at
          and m.recorded_at < v_history.recorded_at
          and m.receipt_line_id is distinct from v_history.receipt_line_id
        )
      );

    v_new_quantity := v_existing_quantity + v_history.canonical_quantity;
    if v_existing_quantity <= 0 then
      v_new_average := v_history.canonical_unit_cost;
    else
      v_new_average := (
        (v_existing_quantity * v_previous_average) +
        (v_history.canonical_quantity * v_history.canonical_unit_cost)
      ) / nullif(v_new_quantity, 0);
    end if;

    update public.inventory_ingredient_cost_history
    set weighted_average_cost = v_new_average,
        stock_quantity_after = v_new_quantity,
        metadata = metadata || jsonb_build_object(
          'effectiveTimeRebuiltAt', now(),
          'pathologicalExistingStock', v_existing_quantity < 0
        )
    where id = v_history.id;
    v_previous_average := v_new_average;
  end loop;

  select coalesce(sum(m.signed_canonical_quantity), 0)
  into v_current_quantity
  from public.inventory_movements m
  where m.branch_id = p_branch_id
    and m.ingredient_id = p_ingredient_id
    and m.status = 'posted';

  insert into public.inventory_ingredient_cost_state (
    branch_id, ingredient_id, current_quantity, weighted_average_cost,
    last_purchase_price, last_purchase_at
  )
  select
    p_branch_id,
    p_ingredient_id,
    v_current_quantity,
    coalesce(v_previous_average, 0),
    latest.canonical_unit_cost,
    latest.effective_at
  from (
    select h.canonical_unit_cost, h.effective_at
    from public.inventory_ingredient_cost_history h
    where h.branch_id = p_branch_id and h.ingredient_id = p_ingredient_id
    order by h.effective_at desc, h.recorded_at desc
    limit 1
  ) latest
  on conflict (branch_id, ingredient_id) do update set
    current_quantity = excluded.current_quantity,
    weighted_average_cost = excluded.weighted_average_cost,
    last_purchase_price = excluded.last_purchase_price,
    last_purchase_at = excluded.last_purchase_at,
    updated_at = now();

  return coalesce(v_previous_average, 0);
end;
$$;

create or replace function public.inventory_rebuild_posted_invoice_costs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ingredient_id uuid;
begin
  if new.status = 'posted' and old.status is distinct from 'posted' then
    for v_ingredient_id in
      select distinct h.ingredient_id
      from public.inventory_ingredient_cost_history h
      where h.invoice_id = new.id
    loop
      perform public.inventory_rebuild_ingredient_cost_history(new.branch_id, v_ingredient_id);
      perform public.inventory_recalculate_recipe_costs(
        new.branch_id,
        v_ingredient_id,
        new.effective_receipt_date::timestamptz,
        'effective-rebuild:' || new.id || ':' || v_ingredient_id
      );
    end loop;
  end if;
  return new;
end;
$$;

drop trigger if exists inventory_invoice_posted_cost_rebuild on public.inventory_invoices;
create trigger inventory_invoice_posted_cost_rebuild
after update of status on public.inventory_invoices
for each row execute function public.inventory_rebuild_posted_invoice_costs();

revoke all on function public.inventory_rebuild_ingredient_cost_history(text, uuid) from public;
comment on function public.inventory_rebuild_ingredient_cost_history(text, uuid) is
  'Recomputes derived weighted-average snapshots in effective-time order so backdated receipts do not rewrite ledger history or use recorded-time ordering.';
