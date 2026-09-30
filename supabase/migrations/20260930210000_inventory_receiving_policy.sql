-- Supplier receiving policy. Missing price stays null.
-- Company-settled quantity receipts move stock and do not invent a cost.
-- Existing suppliers stay unknown. Nothing is bulk-classified.

alter table public.inventory_suppliers
  add column if not exists settlement_mode text not null default 'unknown',
  add column if not exists price_required_on_receiving boolean,
  add column if not exists sku_reliability text not null default 'unknown',
  add column if not exists profile_confirmed_by uuid references auth.users(id),
  add column if not exists profile_confirmed_at timestamptz,
  add column if not exists profile_evidence jsonb not null default '{}'::jsonb;

alter table public.inventory_suppliers
  drop constraint if exists inventory_suppliers_settlement_mode_check;
alter table public.inventory_suppliers
  add constraint inventory_suppliers_settlement_mode_check
  check (settlement_mode in ('unknown', 'supplier_credit', 'company_settled', 'cash_market'));
alter table public.inventory_suppliers
  drop constraint if exists inventory_suppliers_sku_reliability_check;
alter table public.inventory_suppliers
  add constraint inventory_suppliers_sku_reliability_check
  check (sku_reliability in ('unknown', 'reliable', 'unreliable'));

alter table public.inventory_invoices
  add column if not exists document_kind text;
alter table public.inventory_invoices
  drop constraint if exists inventory_invoices_document_kind_check;
alter table public.inventory_invoices
  add constraint inventory_invoices_document_kind_check
  check (document_kind is null or document_kind in ('invoice', 'delivery_note', 'credit_note', 'cash_receipt', 'other'));

alter table public.inventory_invoice_lines
  add column if not exists cost_basis text,
  add column if not exists pack_status text;
alter table public.inventory_invoice_lines
  drop constraint if exists inventory_invoice_lines_cost_basis_check;
alter table public.inventory_invoice_lines
  add constraint inventory_invoice_lines_cost_basis_check
  check (cost_basis is null or cost_basis in (
    'actual_document_price', 'company_settled_price_not_required',
    'price_missing_but_required', 'historical_reference_only'
  ));
alter table public.inventory_invoice_lines
  drop constraint if exists inventory_invoice_lines_pack_status_check;
alter table public.inventory_invoice_lines
  add constraint inventory_invoice_lines_pack_status_check
  check (pack_status is null or pack_status in ('verified', 'uncertain', 'not_applicable'));

alter table public.inventory_purchase_receipts
  alter column subtotal drop not null,
  alter column total drop not null;
alter table public.inventory_purchase_receipt_lines
  alter column unit_price drop not null,
  alter column unit_cost_canonical drop not null,
  alter column line_total drop not null;

alter table public.inventory_ingredient_cost_state
  add column if not exists unvalued_quantity numeric(24,10) not null default 0;

create table if not exists public.inventory_supplier_knowledge (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.inventory_suppliers(id) on delete cascade,
  knowledge_type text not null check (knowledge_type in (
    'settlement_policy', 'sku_mapping', 'pack_conversion', 'alias', 'receiving_location'
  )),
  subject_key text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'verified' check (status in ('suggested', 'verified', 'retired')),
  evidence jsonb not null default '{}'::jsonb,
  confirmed_by uuid references auth.users(id),
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (supplier_id, knowledge_type, subject_key)
);

alter table public.inventory_supplier_knowledge enable row level security;
revoke all on public.inventory_supplier_knowledge from anon, authenticated;
grant select on public.inventory_supplier_knowledge to authenticated;

create or replace function public.inventory_confirm_supplier_profile(
  p_supplier_id uuid,
  p_settlement_mode text,
  p_price_required boolean,
  p_reason text default 'manager_confirmed_receiving_profile'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_row public.inventory_suppliers%rowtype;
begin
  if v_actor is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if public.ask_nac_vault_role() not in (
    'ceo', 'super_admin', 'ops_manager', 'branch_manager', 'cost_controller'
  ) then
    raise exception 'Supplier profile confirmation denied' using errcode = '42501';
  end if;
  if p_settlement_mode not in ('unknown', 'supplier_credit', 'company_settled', 'cash_market') then
    raise exception 'Unsupported settlement mode' using errcode = '22023';
  end if;
  update public.inventory_suppliers
  set settlement_mode = p_settlement_mode,
      price_required_on_receiving = p_price_required,
      profile_confirmed_by = v_actor,
      profile_confirmed_at = now(),
      profile_evidence = jsonb_build_object('reason', p_reason),
      updated_at = now()
  where id = p_supplier_id
  returning * into v_row;
  if not found then raise exception 'Supplier not found'; end if;
  insert into public.inventory_supplier_knowledge (
    supplier_id, knowledge_type, subject_key, payload, status, evidence, confirmed_by, confirmed_at
  ) values (
    p_supplier_id, 'settlement_policy', 'receiving',
    jsonb_build_object(
      'settlementMode', p_settlement_mode,
      'priceRequiredOnReceiving', p_price_required
    ),
    'verified', jsonb_build_object('reason', p_reason), v_actor, now()
  )
  on conflict (supplier_id, knowledge_type, subject_key) do update
  set payload = excluded.payload,
      status = 'verified',
      evidence = excluded.evidence,
      confirmed_by = excluded.confirmed_by,
      confirmed_at = excluded.confirmed_at;
  insert into public.inventory_audit_log (
    event_type, actor_id, entity_type, entity_id, new_value, reason
  ) values (
    'supplier_profile_confirmed', v_actor, 'supplier', p_supplier_id, to_jsonb(v_row), p_reason
  );
  return to_jsonb(v_row);
end;
$$;

revoke all on function public.inventory_confirm_supplier_profile(uuid, text, boolean, text) from public;
grant execute on function public.inventory_confirm_supplier_profile(uuid, text, boolean, text) to authenticated;

create or replace function public.inventory_remember_verified_line()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_supplier uuid;
begin
  select supplier_id into v_supplier from public.inventory_invoices where id = new.invoice_id;
  if v_supplier is null then
    return new;
  end if;
  if new.review_status = 'verified' and new.ingredient_id is not null and new.supplier_sku is not null
     and (tg_op = 'INSERT' or old.review_status is distinct from new.review_status or old.ingredient_id is distinct from new.ingredient_id or old.supplier_sku is distinct from new.supplier_sku) then
    insert into public.inventory_supplier_knowledge (
      supplier_id, knowledge_type, subject_key, payload, status, evidence, confirmed_by, confirmed_at
    ) values (
      v_supplier, 'sku_mapping', new.supplier_sku,
      jsonb_build_object('ingredientId', new.ingredient_id, 'description', new.original_description),
      'verified',
      jsonb_build_object('invoiceLineId', new.id, 'matchMethod', new.match_method),
      new.verified_by, coalesce(new.verified_at, now())
    )
    on conflict (supplier_id, knowledge_type, subject_key) do update
    set payload = excluded.payload,
        status = 'verified',
        evidence = excluded.evidence,
        confirmed_by = excluded.confirmed_by,
        confirmed_at = excluded.confirmed_at;
  end if;
  if new.pack_status = 'verified' and new.supplier_sku is not null and new.conversion_factor is not null
     and (tg_op = 'INSERT' or old.pack_status is distinct from new.pack_status or old.conversion_factor is distinct from new.conversion_factor) then
    insert into public.inventory_supplier_knowledge (
      supplier_id, knowledge_type, subject_key, payload, status, evidence, confirmed_by, confirmed_at
    ) values (
      v_supplier, 'pack_conversion', new.supplier_sku,
      jsonb_build_object(
        'conversionFactor', new.conversion_factor,
        'canonicalUnit', new.canonical_unit,
        'description', new.original_description
      ),
      'verified',
      jsonb_build_object('invoiceLineId', new.id),
      coalesce(new.verified_by, auth.uid()), now()
    )
    on conflict (supplier_id, knowledge_type, subject_key) do update
    set payload = excluded.payload,
        status = 'verified',
        evidence = excluded.evidence,
        confirmed_by = excluded.confirmed_by,
        confirmed_at = excluded.confirmed_at;
  end if;
  return new;
end;
$$;

drop trigger if exists inventory_invoice_lines_remember_knowledge on public.inventory_invoice_lines;
create trigger inventory_invoice_lines_remember_knowledge
  after insert or update of review_status, ingredient_id, supplier_sku, pack_status, conversion_factor
  on public.inventory_invoice_lines
  for each row execute function public.inventory_remember_verified_line();




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
begin
  if v_actor is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select * into v_invoice from public.inventory_invoices where id = p_invoice_id for update;
  if not found then raise exception 'Invoice not found'; end if;
  select * into v_supplier from public.inventory_suppliers where id = v_invoice.supplier_id;
  v_price_required := not (
    v_supplier.settlement_mode = 'company_settled'
    and v_supplier.price_required_on_receiving is false
    and coalesce(v_invoice.purchase_channel, 'supplier_credit') <> 'cash_market'
  );
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
        or l.original_quantity <= 0 or l.original_unit is null
        or l.pack_quantity is null or l.pack_size is null or l.pack_unit is null
        or coalesce(l.pack_status, '') = 'uncertain'
        or (v_price_required and (l.unit_price is null or l.line_total is null))
        or l.review_status not in ('auto_matched', 'verified')
      )
  ) then
    raise exception 'Every active invoice line must have a verified ingredient and conversion' using errcode = '23514';
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

  v_location_id := null;
  if v_invoice.receiving_location_id is not null then
    select id into v_location_id
    from public.inventory_storage_locations
    where id = v_invoice.receiving_location_id
      and branch_id = v_invoice.branch_id
      and active;
  end if;
  if v_location_id is null then
    select id into v_location_id
    from public.inventory_storage_locations
    where branch_id = v_invoice.branch_id and is_default_receiving and active
    limit 1;
  end if;
  if v_location_id is null then
    raise exception 'No receiving location configured for branch %', v_invoice.branch_id;
  end if;
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
    coalesce(v_invoice.purchase_channel, 'supplier_credit'),
    v_invoice.purchase_reason
  ) returning * into v_receipt;

  for v_line in
    select * from public.inventory_invoice_lines
    where invoice_id = p_invoice_id and active order by line_number
  loop
    v_unvalued := not v_price_required
      and v_line.unit_price is null
      and v_line.line_total is null;
    if v_unvalued then
      v_unit_cost := null;
    else
      v_unit_cost := greatest(v_line.line_total - coalesce(v_line.tax_amount, 0), 0)
        / v_line.canonical_received_quantity;
    end if;

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
      v_line.supplier_catalogue_item_id, v_line.original_quantity, v_line.original_unit,
      v_line.pack_quantity, v_line.pack_size, v_line.pack_unit, v_line.conversion_factor,
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
        'purchaseChannel', coalesce(v_invoice.purchase_channel, 'supplier_credit')
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
        when coalesce(v_invoice.purchase_channel, 'supplier_credit') = 'cash_market'
          then inventory_ingredient_cost_state.last_purchase_price
        else excluded.last_purchase_price
      end,
      last_purchase_at = case
        when coalesce(v_invoice.purchase_channel, 'supplier_credit') = 'cash_market'
          then inventory_ingredient_cost_state.last_purchase_at
        else excluded.last_purchase_at
      end,
      updated_at = now();

    if coalesce(v_invoice.purchase_channel, 'supplier_credit') <> 'cash_market' then
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
          when coalesce(v_invoice.purchase_channel, 'supplier_credit') = 'cash_market' then 'cash_market_premium'
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

-- Received quantity is editable before posting and is what the movement uses.
-- original_quantity remains the invoiced quantity.

create or replace function public.inventory_update_invoice_line(
  p_invoice_id uuid,
  p_line_id uuid,
  p_patch jsonb,
  p_reason text default 'review_correction'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice public.inventory_invoices%rowtype;
  v_before public.inventory_invoice_lines%rowtype;
  v_after public.inventory_invoice_lines%rowtype;
begin
  select * into v_invoice from public.inventory_invoices where id = p_invoice_id for update;
  if not public.inventory_branch_allowed(v_invoice.branch_id) then
    raise exception 'Invoice access denied' using errcode = '42501';
  end if;
  if v_invoice.status in ('posted', 'rejected', 'cancelled') then
    raise exception 'Finalized invoice cannot be edited' using errcode = '55000';
  end if;
  select * into v_before
  from public.inventory_invoice_lines
  where id = p_line_id and invoice_id = p_invoice_id
  for update;
  if not found then raise exception 'Invoice line not found'; end if;
  if p_patch ? 'receivedQuantity' and coalesce((p_patch ->> 'receivedQuantity')::numeric, 0) <= 0 then
    raise exception 'Received quantity must be positive' using errcode = '22023';
  end if;
  if p_patch ? 'packStatus' and coalesce(p_patch ->> 'packStatus', '') not in ('verified', 'uncertain', 'not_applicable') then
    raise exception 'Unsupported pack status' using errcode = '22023';
  end if;

  update public.inventory_invoice_lines
  set normalized_description = coalesce(p_patch ->> 'normalizedDescription', normalized_description),
      original_quantity = coalesce((p_patch ->> 'quantity')::numeric, original_quantity),
      original_unit = coalesce(p_patch ->> 'unit', original_unit),
      pack_quantity = coalesce((p_patch ->> 'packQuantity')::numeric, pack_quantity),
      pack_size = coalesce((p_patch ->> 'packSize')::numeric, pack_size),
      pack_unit = coalesce(p_patch ->> 'packUnit', pack_unit),
      unit_price = coalesce((p_patch ->> 'unitPrice')::numeric, unit_price),
      line_discount = coalesce((p_patch ->> 'lineDiscount')::numeric, line_discount),
      tax_rate = coalesce((p_patch ->> 'taxRate')::numeric, tax_rate),
      tax_amount = coalesce((p_patch ->> 'taxAmount')::numeric, tax_amount),
      line_total = coalesce((p_patch ->> 'lineTotal')::numeric, line_total),
      canonical_received_quantity = coalesce((p_patch ->> 'receivedQuantity')::numeric, canonical_received_quantity),
      pack_status = case
        when p_patch ? 'packStatus' then p_patch ->> 'packStatus'
        else pack_status
      end,
      manual_overrides = manual_overrides || jsonb_build_object(
        'reviewCorrection', jsonb_build_object('patch', p_patch, 'actorId', auth.uid(), 'at', now())
      )
  where id = p_line_id
  returning * into v_after;

  insert into public.inventory_audit_log (
    event_type, actor_id, branch_id, entity_type, entity_id, previous_value, new_value, reason
  ) values (
    'line_corrected', auth.uid(), v_invoice.branch_id, 'invoice_line', p_line_id,
    to_jsonb(v_before), to_jsonb(v_after), p_reason
  );
  return to_jsonb(v_after);
end;
$$;

