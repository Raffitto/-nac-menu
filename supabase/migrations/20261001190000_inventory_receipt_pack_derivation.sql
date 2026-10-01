-- Receipt pack fields are derived from supplier quantity times verified conversion.
-- pack_quantity is the count of supplier units. pack_size is the canonical units in one supplier unit.

create or replace function public.inventory_derive_receipt_pack(
  p_original_quantity numeric,
  p_original_unit text,
  p_pack_quantity numeric,
  p_pack_size numeric,
  p_pack_unit text,
  p_conversion_factor numeric,
  p_canonical_quantity numeric,
  p_canonical_unit text
) returns jsonb
language plpgsql
immutable
as $$
declare
  v_pack_quantity numeric;
  v_pack_size numeric;
begin
  if p_original_quantity is null or p_original_quantity <= 0
     or p_conversion_factor is null or p_conversion_factor <= 0
     or p_canonical_quantity is null or p_canonical_quantity <= 0
     or p_canonical_unit is null then
    raise exception 'Verified conversion is required before a receipt line is written' using errcode = '23514';
  end if;
  if abs(p_original_quantity * p_conversion_factor - p_canonical_quantity) > 0.0000001 then
    raise exception 'Canonical quantity does not match supplier quantity times conversion' using errcode = '23514';
  end if;
  if p_pack_quantity is not null and p_pack_size is not null
     and abs(p_pack_quantity * p_pack_size - p_canonical_quantity) > 0.0000001 then
    raise exception 'Stored pack quantity does not match the canonical received quantity' using errcode = '23514';
  end if;
  v_pack_quantity := coalesce(p_pack_quantity, p_original_quantity);
  v_pack_size := coalesce(p_pack_size, p_conversion_factor);
  return jsonb_build_object(
    'packQuantity', v_pack_quantity,
    'packSize', v_pack_size,
    'packUnit', coalesce(p_pack_unit, p_canonical_unit),
    'originalUnit', coalesce(p_original_unit, case when p_conversion_factor = 1 then p_canonical_unit else 'pack' end)
  );
end;
$$;

revoke all on function public.inventory_derive_receipt_pack(numeric, text, numeric, numeric, text, numeric, numeric, text) from public;
grant execute on function public.inventory_derive_receipt_pack(numeric, text, numeric, numeric, text, numeric, numeric, text) to authenticated;

create or replace function public.inventory_fill_receipt_line_pack()
returns trigger
language plpgsql
as $$
declare
  v_pack jsonb;
begin
  v_pack := public.inventory_derive_receipt_pack(
    new.original_quantity, new.original_unit, new.pack_quantity, new.pack_size,
    new.pack_unit, new.conversion_factor, new.canonical_quantity, new.canonical_unit
  );
  new.pack_quantity := (v_pack ->> 'packQuantity')::numeric;
  new.pack_size := (v_pack ->> 'packSize')::numeric;
  new.pack_unit := v_pack ->> 'packUnit';
  new.original_unit := v_pack ->> 'originalUnit';
  return new;
end;
$$;

drop trigger if exists inventory_receipt_lines_fill_pack on public.inventory_purchase_receipt_lines;
create trigger inventory_receipt_lines_fill_pack
  before insert on public.inventory_purchase_receipt_lines
  for each row execute function public.inventory_fill_receipt_line_pack();

create or replace function public.inventory_approve_and_post_invoice(
  p_invoice_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice public.inventory_invoices%rowtype;
  v_existing_receipt public.inventory_purchase_receipts%rowtype;
  v_receipt public.inventory_purchase_receipts%rowtype;
  v_receipt_line public.inventory_purchase_receipt_lines%rowtype;
  v_line public.inventory_invoice_lines%rowtype;
  v_pack jsonb;
  v_location_id uuid;
  v_actor uuid := auth.uid();
  v_effective_at timestamptz;
  v_unit_cost numeric;
  v_previous_price numeric;
  v_existing_qty numeric;
  v_existing_avg numeric;
  v_new_qty numeric;
  v_new_avg numeric;
  v_change numeric;
  v_pathological boolean;
  v_duplicate uuid;
  v_supplier public.inventory_suppliers%rowtype;
  v_price_required boolean;
  v_unvalued boolean;
  v_channel text;
begin
  if v_actor is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select * into v_invoice from public.inventory_invoices where id = p_invoice_id for update;
  if not found then raise exception 'Invoice not found'; end if;
  select * into v_supplier from public.inventory_suppliers where id = v_invoice.supplier_id;
  if not public.inventory_can_approve(v_invoice.branch_id) then
    raise exception 'Invoice approval denied' using errcode = '42501';
  end if;

  select * into v_existing_receipt
  from public.inventory_purchase_receipts
  where invoice_id = p_invoice_id or idempotency_key = p_idempotency_key
  limit 1;
  if found then
    return jsonb_build_object(
      'status', 'already_posted', 'invoiceId', p_invoice_id,
      'receiptId', v_existing_receipt.id, 'idempotent', true
    );
  end if;

  if v_invoice.receiving_treatment is null then
    raise exception 'Confirm how this document should be received before posting' using errcode = '23514';
  end if;
  if v_invoice.receiving_treatment not in ('normal_supplier_invoice', 'company_settled_document', 'cash_market') then
    raise exception 'Unsupported receiving treatment %', v_invoice.receiving_treatment using errcode = '22023';
  end if;
  v_price_required := v_invoice.receiving_treatment <> 'company_settled_document';
  v_channel := case
    when v_invoice.receiving_treatment = 'cash_market' then 'cash_market'
    else 'supplier_credit'
  end;
  perform public.inventory_reconcile_invoice_exceptions(p_invoice_id);

  if v_invoice.status not in ('extracted', 'needs_review', 'approved') then
    raise exception 'Invoice cannot post from status %', v_invoice.status using errcode = '55000';
  end if;
  if v_invoice.supplier_id is null or v_invoice.invoice_date is null
    or v_invoice.effective_receipt_date is null
    or (v_price_required and v_invoice.total is null) then
    raise exception 'Invoice header is incomplete' using errcode = '23514';
  end if;
  if v_invoice.currency <> 'SAR' then
    raise exception 'Unsupported posting currency: %', v_invoice.currency using errcode = '22023';
  end if;
  if exists (
    select 1 from public.inventory_invoice_lines l
    where l.invoice_id = p_invoice_id and l.active
      and (
        l.ingredient_id is null or l.canonical_received_quantity is null
        or l.canonical_received_quantity <= 0 or l.conversion_factor is null
        or l.canonical_unit is null or l.original_quantity is null
        or l.original_quantity <= 0
        or (l.original_unit is null and l.canonical_unit is null)
        or coalesce(l.pack_status, '') = 'uncertain'
        or (v_price_required and (l.unit_price is null or l.line_total is null))
        or l.review_status not in ('auto_matched', 'verified')
      )
  ) then
    raise exception 'Every active invoice line must have a verified ingredient and conversion' using errcode = '23514';
  end if;
  if exists (
    select 1
    from public.inventory_invoice_lines a
    join public.inventory_invoice_lines b
      on b.invoice_id = a.invoice_id and b.id <> a.id and b.active
     and b.ingredient_id = a.ingredient_id
     and b.supplier_sku is distinct from a.supplier_sku
    where a.invoice_id = p_invoice_id and a.active and a.ingredient_id is not null
  ) then
    raise exception 'Different supplier products are mapped to the same inventory item' using errcode = '23514';
  end if;
  if exists (
    select 1 from public.inventory_invoice_exceptions e
    where e.invoice_id = p_invoice_id and e.status = 'open' and e.severity = 'blocking'
  ) then
    raise exception 'Blocking invoice exceptions must be resolved' using errcode = '23514';
  end if;

  select i.id into v_duplicate
  from public.inventory_invoices i
  where i.id <> p_invoice_id and i.status = 'posted' and (
    i.file_hash = v_invoice.file_hash or
    (
      i.supplier_id = v_invoice.supplier_id
      and i.invoice_number is not null and v_invoice.invoice_number is not null
      and lower(i.invoice_number) = lower(v_invoice.invoice_number)
    ) or (
      i.supplier_id = v_invoice.supplier_id
      and i.invoice_date = v_invoice.invoice_date
      and i.total = v_invoice.total
      and i.line_fingerprint is not null
      and i.line_fingerprint = v_invoice.line_fingerprint
    )
  ) limit 1;
  if v_duplicate is not null and v_invoice.duplicate_status <> 'overridden' then
    update public.inventory_invoices
    set status = 'duplicate', duplicate_status = 'confirmed_duplicate',
        duplicate_of_invoice_id = v_duplicate
    where id = p_invoice_id;
    insert into public.inventory_audit_log (
      event_type, actor_id, branch_id, entity_type, entity_id, new_value, reason
    ) values (
      'duplicate_blocked', v_actor, v_invoice.branch_id, 'invoice', p_invoice_id,
      jsonb_build_object('duplicateOfInvoiceId', v_duplicate), 'posting_duplicate_detection'
    );
    return jsonb_build_object(
      'status', 'duplicate', 'invoiceId', p_invoice_id,
      'duplicateOfInvoiceId', v_duplicate, 'idempotent', true
    );
  end if;

  v_location_id := public.inventory_resolve_receiving_location(
    v_invoice.branch_id,
    v_invoice.receiving_location_id
  );
  v_effective_at := v_invoice.effective_receipt_date::timestamptz;

  insert into public.inventory_purchase_receipts (
    branch_id, supplier_id, invoice_id, purchase_order_reference,
    storage_location_id, effective_at, received_by, approved_by,
    currency, subtotal, discount, tax, total, source_reference, idempotency_key,
    purchase_channel, purchase_reason
  ) values (
    v_invoice.branch_id, v_invoice.supplier_id, v_invoice.id,
    v_invoice.purchase_order_reference, v_location_id, v_effective_at,
    v_invoice.uploader_id, v_actor, v_invoice.currency, v_invoice.subtotal,
    coalesce(v_invoice.discount, 0), coalesce(v_invoice.tax, 0), v_invoice.total,
    'invoice:' || v_invoice.id, p_idempotency_key,
    v_channel,
    v_invoice.purchase_reason
  ) returning * into v_receipt;

  for v_line in
    select * from public.inventory_invoice_lines
    where invoice_id = p_invoice_id and active order by line_number
  loop
    v_unvalued := v_invoice.receiving_treatment = 'company_settled_document';
    if v_unvalued then
      v_unit_cost := null;
    else
      v_unit_cost := greatest(v_line.line_total - coalesce(v_line.tax_amount, 0), 0)
        / v_line.canonical_received_quantity;
    end if;

    v_pack := public.inventory_derive_receipt_pack(
      v_line.original_quantity, v_line.original_unit, v_line.pack_quantity, v_line.pack_size,
      v_line.pack_unit, v_line.conversion_factor, v_line.canonical_received_quantity, v_line.canonical_unit
    );

    insert into public.inventory_purchase_receipt_lines (
      receipt_id, invoice_line_id, line_number, original_description,
      normalized_description, supplier_sku, ingredient_id, supplier_catalogue_item_id,
      original_quantity, original_unit, pack_quantity, pack_size, pack_unit,
      conversion_factor, canonical_quantity, canonical_unit, unit_price,
      unit_cost_canonical, line_discount, tax_rate, tax_amount, line_total,
      match_method, matching_confidence, interpretation_snapshot
    ) values (
      v_receipt.id, v_line.id, v_line.line_number, v_line.original_description,
      v_line.normalized_description, v_line.supplier_sku, v_line.ingredient_id,
      v_line.supplier_catalogue_item_id, v_line.original_quantity, v_pack ->> 'originalUnit',
      (v_pack ->> 'packQuantity')::numeric, (v_pack ->> 'packSize')::numeric, v_pack ->> 'packUnit', v_line.conversion_factor,
      v_line.canonical_received_quantity, v_line.canonical_unit, v_line.unit_price,
      v_unit_cost, v_line.line_discount, v_line.tax_rate, v_line.tax_amount,
      v_line.line_total, v_line.match_method, v_line.matching_confidence,
      to_jsonb(v_line)
    ) returning * into v_receipt_line;

    select
      coalesce(sum(m.signed_canonical_quantity), 0),
      coalesce(max(s.weighted_average_cost), 0)
    into v_existing_qty, v_existing_avg
    from public.inventory_movements m
    left join public.inventory_ingredient_cost_state s
      on s.branch_id = v_invoice.branch_id and s.ingredient_id = v_line.ingredient_id
    where m.branch_id = v_invoice.branch_id
      and m.ingredient_id = v_line.ingredient_id
      and m.status = 'posted';

    v_pathological := v_existing_qty < 0;
    v_new_qty := v_existing_qty + v_line.canonical_received_quantity;
    if v_unvalued then
      v_new_avg := v_existing_avg;
    elsif v_existing_qty <= 0 then
      v_new_avg := v_unit_cost;
    else
      v_new_avg := (
        (v_existing_qty * v_existing_avg) +
        (v_line.canonical_received_quantity * v_unit_cost)
      ) / nullif(v_new_qty, 0);
    end if;

    select h.canonical_unit_cost into v_previous_price
    from public.inventory_ingredient_cost_history h
    where h.branch_id = v_invoice.branch_id
      and h.ingredient_id = v_line.ingredient_id
      and h.canonical_unit = v_line.canonical_unit
      and coalesce(h.metadata ->> 'purchaseChannel', 'supplier_credit') <> 'cash_market'
    order by h.effective_at desc, h.recorded_at desc
    limit 1;
    v_change := case when coalesce(v_previous_price, 0) = 0 then null
      else (v_unit_cost - v_previous_price) / v_previous_price * 100 end;

    insert into public.inventory_movements (
      branch_id, storage_location_id, ingredient_id, movement_type,
      signed_canonical_quantity, canonical_unit, original_quantity,
      original_unit, conversion_factor, unit_cost, total_cost, effective_at,
      actor_id, source_type, source_id, invoice_id, receipt_id, receipt_line_id,
      supplier_id, idempotency_key, metadata
    ) values (
      v_invoice.branch_id, v_location_id, v_line.ingredient_id, 'purchase_receipt',
      v_line.canonical_received_quantity, v_line.canonical_unit,
      v_line.original_quantity, v_line.original_unit, v_line.conversion_factor,
      v_unit_cost, v_unit_cost * v_line.canonical_received_quantity, v_effective_at,
      v_actor, 'purchase_receipt_line', v_receipt_line.id, v_invoice.id,
      v_receipt.id, v_receipt_line.id, v_invoice.supplier_id,
      p_idempotency_key || ':movement:' || v_line.id,
      jsonb_build_object(
        'recordedAt', now(),
        'pathologicalExistingStock', v_pathological,
        'costBasis', case when v_unvalued then 'company_settled_price_not_required' else 'actual_document_price' end,
        'valuationUpdated', not v_unvalued
      )
    );

    if v_unvalued then
      insert into public.inventory_ingredient_cost_state (
        branch_id, ingredient_id, current_quantity, weighted_average_cost,
        last_purchase_price, last_purchase_at, unvalued_quantity
      ) values (
        v_invoice.branch_id, v_line.ingredient_id, v_new_qty,
        coalesce(v_existing_avg, 0), null, null, v_line.canonical_received_quantity
      ) on conflict (branch_id, ingredient_id) do update set
        current_quantity = excluded.current_quantity,
        unvalued_quantity = inventory_ingredient_cost_state.unvalued_quantity + v_line.canonical_received_quantity,
        updated_at = now();
    else
    insert into public.inventory_ingredient_cost_history (
      branch_id, ingredient_id, supplier_id, invoice_id, receipt_id, receipt_line_id,
      purchase_date, purchase_quantity, canonical_quantity, purchase_unit_cost,
      canonical_unit, canonical_unit_cost, currency, tax_exclusive_cost,
      tax_inclusive_cost, allocated_discount, previous_purchase_price,
      percentage_price_change, weighted_average_cost, stock_quantity_after,
      effective_at, idempotency_key, metadata
    ) values (
      v_invoice.branch_id, v_line.ingredient_id, v_invoice.supplier_id,
      v_invoice.id, v_receipt.id, v_receipt_line.id, v_invoice.invoice_date,
      v_line.original_quantity, v_line.canonical_received_quantity, v_line.unit_price,
      v_line.canonical_unit, v_unit_cost, v_invoice.currency,
      v_line.line_total - v_line.tax_amount, v_line.line_total,
      v_line.line_discount, v_previous_price, v_change, v_new_avg, v_new_qty,
      v_effective_at, p_idempotency_key || ':cost:' || v_line.id,
      jsonb_build_object(
        'pathologicalExistingStock', v_pathological,
        'costBasis', 'actual_document_price',
        'purchaseChannel', v_channel
      )
    );

    insert into public.inventory_ingredient_cost_state (
      branch_id, ingredient_id, current_quantity, weighted_average_cost,
      last_purchase_price, last_purchase_at
    ) values (
      v_invoice.branch_id, v_line.ingredient_id, v_new_qty, v_new_avg,
      v_unit_cost, v_effective_at
    ) on conflict (branch_id, ingredient_id) do update set
      current_quantity = excluded.current_quantity,
      weighted_average_cost = excluded.weighted_average_cost,
      last_purchase_price = case
        when v_channel = 'cash_market'
          then inventory_ingredient_cost_state.last_purchase_price
        else excluded.last_purchase_price
      end,
      last_purchase_at = case
        when v_channel = 'cash_market'
          then inventory_ingredient_cost_state.last_purchase_at
        else excluded.last_purchase_at
      end,
      updated_at = now();

    if v_channel <> 'cash_market' then
      update public.inventory_supplier_catalogue_items
      set last_purchase_price = v_line.unit_price,
          last_purchase_at = v_effective_at,
          updated_at = now()
      where id = v_line.supplier_catalogue_item_id;
    end if;

    if v_change is not null and abs(v_change) >= 5 then
      insert into public.inventory_price_variance_alerts (
        branch_id, ingredient_id, supplier_id, invoice_id, invoice_line_id,
        alert_type, previous_value, current_value, percentage_change,
        threshold_percentage, comparison_details
      ) values (
        v_invoice.branch_id, v_line.ingredient_id, v_invoice.supplier_id,
        v_invoice.id, v_line.id,
        case
          when v_channel = 'cash_market' then 'cash_market_premium'
          when v_change >= 0 then 'price_increase'
          else 'price_decrease'
        end,
        v_previous_price, v_unit_cost, v_change, 5,
        jsonb_build_object('canonicalUnit', v_line.canonical_unit)
      );
    end if;

    perform public.inventory_recalculate_recipe_costs(
      v_invoice.branch_id, v_line.ingredient_id, v_effective_at,
      p_idempotency_key || ':costing:' || v_line.id
    );
    end if;

  end loop;

  update public.inventory_invoices
  set status = 'posted', processing_status = 'posted', approval_status = 'approved',
      approver_id = v_actor, approved_at = now(), posted_at = now(),
      posted_receipt_id = v_receipt.id, duplicate_status = 'clear'
  where id = p_invoice_id;

  insert into public.inventory_audit_log (
    event_type, actor_id, branch_id, entity_type, entity_id, new_value, reason
  ) values
    ('invoice_approved', v_actor, v_invoice.branch_id, 'invoice', v_invoice.id,
      jsonb_build_object('receiptId', v_receipt.id), 'approval'),
    ('invoice_posted', v_actor, v_invoice.branch_id, 'purchase_receipt', v_receipt.id,
      to_jsonb(v_receipt), 'atomic_invoice_posting');

  return jsonb_build_object(
    'status', 'posted', 'invoiceId', p_invoice_id,
    'receiptId', v_receipt.id, 'idempotent', false
  );
end;
$$;

