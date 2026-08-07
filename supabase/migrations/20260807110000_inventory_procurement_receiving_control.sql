-- Inventory & Cost Control Phase B, slice 1: procurement and receiving control.
-- Extends the canonical invoice -> receipt -> immutable movement path.
-- Scope direction: operational records remain branch-owned. Shared definitions
-- can later resolve branch override -> brand default -> company/group default
-- without changing these branch ownership keys. This migration intentionally
-- adds no brand/company inheritance engine.

create table if not exists public.inventory_purchase_orders (
  id uuid primary key default gen_random_uuid(),
  branch_id text not null,
  supplier_id uuid not null references public.inventory_suppliers(id),
  destination_branch_id text not null,
  destination_location_id uuid not null references public.inventory_storage_locations(id),
  reference_number text not null,
  business_context text,
  expected_delivery_date date,
  expected_delivery_time time,
  notes text,
  currency text not null default 'SAR' check (currency ~ '^[A-Z]{3}$'),
  expected_total numeric(20,6) not null default 0 check (expected_total >= 0),
  status text not null default 'draft' check (status in (
    'draft', 'submitted', 'approved', 'partially_received', 'received',
    'closed', 'cancelled', 'rejected'
  )),
  created_by uuid not null references auth.users(id),
  submitted_by uuid references auth.users(id),
  submitted_at timestamptz,
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  closed_by uuid references auth.users(id),
  closed_at timestamptz,
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_purchase_orders_destination_check check (branch_id = destination_branch_id),
  unique (branch_id, reference_number)
);

create table if not exists public.inventory_purchase_order_lines (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.inventory_purchase_orders(id),
  line_number integer not null check (line_number > 0),
  ingredient_id uuid not null references public.inventory_ingredients(id),
  requested_quantity numeric(20,8) not null check (requested_quantity > 0),
  requested_unit text not null,
  normalized_base_quantity numeric(24,10) not null check (normalized_base_quantity > 0),
  canonical_unit text not null check (canonical_unit in ('each', 'gram', 'kilogram', 'millilitre', 'litre')),
  expected_unit_cost numeric(24,10) check (expected_unit_cost is null or expected_unit_cost >= 0),
  expected_total_cost numeric(24,10) generated always as (
    normalized_base_quantity * coalesce(expected_unit_cost, 0)
  ) stored,
  notes text,
  created_at timestamptz not null default now(),
  unique (purchase_order_id, line_number)
);

create index if not exists inventory_purchase_orders_branch_status_idx
  on public.inventory_purchase_orders (branch_id, status, expected_delivery_date);
create index if not exists inventory_purchase_orders_supplier_idx
  on public.inventory_purchase_orders (supplier_id, created_at desc);
create index if not exists inventory_purchase_order_lines_item_idx
  on public.inventory_purchase_order_lines (ingredient_id, purchase_order_id);

comment on table public.inventory_purchase_orders is
  'Branch-owned procurement transaction. Future shared supplier/item defaults may resolve through brand and company scope.';
comment on table public.inventory_purchase_order_lines is
  'Branch procurement lines referencing canonical items without duplicating item definitions.';

drop trigger if exists inventory_purchase_orders_touch_updated_at on public.inventory_purchase_orders;
create trigger inventory_purchase_orders_touch_updated_at
before update on public.inventory_purchase_orders
for each row execute function public.inventory_touch_updated_at();

alter table public.inventory_invoices
  add column if not exists purchase_order_id uuid references public.inventory_purchase_orders(id),
  add column if not exists additional_cost numeric(20,6) not null default 0
    check (additional_cost >= 0);

alter table public.inventory_invoice_lines
  add column if not exists purchase_order_line_id uuid references public.inventory_purchase_order_lines(id);

create or replace function public.inventory_validate_invoice_po_link()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.purchase_order_id is null then return new; end if;
  if not exists (
    select 1 from public.inventory_purchase_orders po
    where po.id = new.purchase_order_id
      and po.branch_id = new.branch_id
      and po.supplier_id = new.supplier_id
      and po.status in ('approved', 'partially_received', 'received')
  ) then
    raise exception 'Purchase order is not approved for this supplier and branch' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists inventory_invoice_validate_po_link on public.inventory_invoices;
create trigger inventory_invoice_validate_po_link
before insert or update of purchase_order_id, supplier_id, branch_id
on public.inventory_invoices
for each row execute function public.inventory_validate_invoice_po_link();

create or replace function public.inventory_validate_invoice_line_po_link()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.purchase_order_line_id is null then return new; end if;
  if not exists (
    select 1
    from public.inventory_invoices i
    join public.inventory_purchase_order_lines pol
      on pol.purchase_order_id = i.purchase_order_id
    where i.id = new.invoice_id
      and pol.id = new.purchase_order_line_id
      and pol.ingredient_id = new.ingredient_id
  ) then
    raise exception 'Invoice line does not match its purchase-order line' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists inventory_invoice_line_validate_po_link on public.inventory_invoice_lines;
create trigger inventory_invoice_line_validate_po_link
before insert or update of purchase_order_line_id, ingredient_id
on public.inventory_invoice_lines
for each row execute function public.inventory_validate_invoice_line_po_link();

alter table public.inventory_purchase_receipts
  add column if not exists purchase_order_id uuid references public.inventory_purchase_orders(id),
  add column if not exists business_date date,
  add column if not exists document_date date,
  add column if not exists invoice_number text,
  add column if not exists additional_cost numeric(20,6) not null default 0
    check (additional_cost >= 0);

update public.inventory_purchase_receipts r
set
  business_date = coalesce(r.business_date, (r.effective_at at time zone 'Asia/Riyadh')::date),
  document_date = coalesce(r.document_date, i.invoice_date),
  invoice_number = coalesce(r.invoice_number, i.invoice_number),
  purchase_order_id = coalesce(r.purchase_order_id, i.purchase_order_id),
  additional_cost = coalesce(i.additional_cost, 0)
from public.inventory_invoices i
where i.id = r.invoice_id
  and (
    r.business_date is null
    or r.document_date is null
    or r.invoice_number is null
    or r.purchase_order_id is distinct from i.purchase_order_id
    or r.additional_cost is distinct from coalesce(i.additional_cost, 0)
  );

alter table public.inventory_purchase_receipts
  alter column business_date set not null;

alter table public.inventory_purchase_receipt_lines
  add column if not exists purchase_order_line_id uuid references public.inventory_purchase_order_lines(id);

create index if not exists inventory_receipts_po_idx
  on public.inventory_purchase_receipts (purchase_order_id, effective_at);
create index if not exists inventory_receipt_lines_po_line_idx
  on public.inventory_purchase_receipt_lines (purchase_order_line_id);

create table if not exists public.inventory_supplier_returns (
  id uuid primary key default gen_random_uuid(),
  branch_id text not null,
  supplier_id uuid not null references public.inventory_suppliers(id),
  storage_location_id uuid not null references public.inventory_storage_locations(id),
  original_receipt_id uuid references public.inventory_purchase_receipts(id),
  purchase_order_id uuid references public.inventory_purchase_orders(id),
  reference_number text not null,
  business_date date not null,
  document_date date,
  effective_at timestamptz not null,
  reason text not null,
  notes text,
  status text not null default 'posted' check (status in ('posted', 'reversed')),
  created_by uuid not null references auth.users(id),
  submitted_by uuid not null references auth.users(id),
  submitted_at timestamptz not null,
  approved_by uuid not null references auth.users(id),
  approved_at timestamptz not null,
  idempotency_key text not null unique,
  evidence_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (branch_id, reference_number)
);

create table if not exists public.inventory_supplier_return_lines (
  id uuid primary key default gen_random_uuid(),
  supplier_return_id uuid not null references public.inventory_supplier_returns(id),
  line_number integer not null check (line_number > 0),
  original_receipt_line_id uuid references public.inventory_purchase_receipt_lines(id),
  purchase_order_line_id uuid references public.inventory_purchase_order_lines(id),
  ingredient_id uuid not null references public.inventory_ingredients(id),
  source_item_name text,
  source_sku text,
  source_quantity numeric(20,8) not null check (source_quantity > 0),
  source_unit text not null,
  conversion_factor numeric(24,10) not null check (conversion_factor > 0),
  normalized_quantity numeric(24,10) not null check (normalized_quantity > 0),
  canonical_unit text not null check (canonical_unit in ('each', 'gram', 'kilogram', 'millilitre', 'litre')),
  unit_cost_basis numeric(24,10),
  total_cost numeric(24,10),
  reason text,
  movement_id uuid not null references public.inventory_movements(id),
  evidence_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (supplier_return_id, line_number)
);

create index if not exists inventory_supplier_returns_branch_idx
  on public.inventory_supplier_returns (branch_id, business_date desc);
create index if not exists inventory_supplier_returns_receipt_idx
  on public.inventory_supplier_returns (original_receipt_id);
create index if not exists inventory_supplier_return_lines_item_idx
  on public.inventory_supplier_return_lines (ingredient_id, supplier_return_id);

comment on table public.inventory_supplier_returns is
  'Branch-owned supplier return preserving shared supplier identity and original receipt evidence.';

create or replace view public.inventory_purchase_order_progress
with (security_invoker = true)
as
select
  po.id as purchase_order_id,
  pol.id as purchase_order_line_id,
  po.branch_id,
  po.supplier_id,
  po.status,
  pol.line_number,
  pol.ingredient_id,
  pol.normalized_base_quantity as ordered_quantity,
  pol.canonical_unit,
  coalesce(sum(
    case when r.status = 'posted' then rl.canonical_quantity else 0 end
  ), 0) as received_quantity,
  greatest(
    pol.normalized_base_quantity - coalesce(sum(
      case when r.status = 'posted' then rl.canonical_quantity else 0 end
    ), 0),
    0
  ) as remaining_quantity,
  coalesce(sum(
    case when r.status = 'posted' then rl.canonical_quantity else 0 end
  ), 0) > pol.normalized_base_quantity as over_received
from public.inventory_purchase_orders po
join public.inventory_purchase_order_lines pol on pol.purchase_order_id = po.id
left join public.inventory_purchase_receipt_lines rl on rl.purchase_order_line_id = pol.id
left join public.inventory_purchase_receipts r on r.id = rl.receipt_id
group by po.id, pol.id;

create or replace function public.inventory_create_purchase_order(
  p_payload jsonb,
  p_lines jsonb,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_branch text := nullif(p_payload ->> 'branchId', '');
  v_supplier_id uuid := nullif(p_payload ->> 'supplierId', '')::uuid;
  v_location_id uuid := nullif(p_payload ->> 'destinationLocationId', '')::uuid;
  v_reference text := nullif(trim(p_payload ->> 'referenceNumber'), '');
  v_order public.inventory_purchase_orders%rowtype;
  v_line jsonb;
  v_line_number integer := 0;
  v_ingredient public.inventory_ingredients%rowtype;
begin
  if auth.uid() is null or not public.inventory_branch_allowed(v_branch) then
    raise exception 'Purchase order creation denied' using errcode = '42501';
  end if;
  select * into v_order from public.inventory_purchase_orders
  where idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('status', v_order.status, 'purchaseOrderId', v_order.id, 'idempotent', true);
  end if;
  if v_supplier_id is null or v_location_id is null or v_reference is null then
    raise exception 'Supplier, destination, and reference number are required' using errcode = '23514';
  end if;
  if coalesce(jsonb_typeof(p_lines), '') <> 'array'
    or coalesce(jsonb_array_length(p_lines), 0) = 0
  then
    raise exception 'Purchase order requires at least one line' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.inventory_supplier_branches sb
    where sb.supplier_id = v_supplier_id and sb.branch_id = v_branch and sb.active
  ) then
    raise exception 'Supplier is not enabled for destination branch' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.inventory_storage_locations l
    where l.id = v_location_id
      and l.branch_id = v_branch
      and l.active
      and l.is_default_receiving
  ) then
    raise exception 'Destination must be the active default receiving location for branch'
      using errcode = '23514';
  end if;

  insert into public.inventory_purchase_orders (
    branch_id, supplier_id, destination_branch_id, destination_location_id,
    reference_number, business_context, expected_delivery_date, expected_delivery_time,
    notes, currency, created_by, idempotency_key
  ) values (
    v_branch, v_supplier_id, v_branch, v_location_id, v_reference,
    nullif(trim(p_payload ->> 'businessContext'), ''),
    nullif(p_payload ->> 'expectedDeliveryDate', '')::date,
    nullif(p_payload ->> 'expectedDeliveryTime', '')::time,
    nullif(trim(p_payload ->> 'notes'), ''),
    coalesce(nullif(p_payload ->> 'currency', ''), 'SAR'),
    auth.uid(), p_idempotency_key
  ) returning * into v_order;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    v_line_number := v_line_number + 1;
    select * into v_ingredient from public.inventory_ingredients
    where id = nullif(v_line ->> 'ingredientId', '')::uuid
      and active
      and (scope = 'network' or branch_id = v_branch);
    if not found then
      raise exception 'Purchase order line % has an unavailable canonical item', v_line_number using errcode = '23514';
    end if;
    if nullif(v_line ->> 'requestedQuantity', '')::numeric is null
      or nullif(v_line ->> 'normalizedBaseQuantity', '')::numeric is null
      or (v_line ->> 'requestedQuantity')::numeric <= 0
      or (v_line ->> 'normalizedBaseQuantity')::numeric <= 0
      or nullif(trim(v_line ->> 'requestedUnit'), '') is null
      or nullif(trim(v_line ->> 'canonicalUnit'), '') is null
    then
      raise exception 'Purchase order line % has invalid quantity or unit', v_line_number using errcode = '22023';
    end if;
    if v_line ->> 'canonicalUnit' <> v_ingredient.base_inventory_unit then
      raise exception 'Purchase order line % canonical unit does not match item master', v_line_number using errcode = '23514';
    end if;
    insert into public.inventory_purchase_order_lines (
      purchase_order_id, line_number, ingredient_id, requested_quantity,
      requested_unit, normalized_base_quantity, canonical_unit,
      expected_unit_cost, notes
    ) values (
      v_order.id, coalesce(nullif(v_line ->> 'lineNumber', '')::integer, v_line_number),
      v_ingredient.id, (v_line ->> 'requestedQuantity')::numeric,
      v_line ->> 'requestedUnit', (v_line ->> 'normalizedBaseQuantity')::numeric,
      v_line ->> 'canonicalUnit', nullif(v_line ->> 'expectedUnitCost', '')::numeric,
      nullif(trim(v_line ->> 'notes'), '')
    );
  end loop;

  update public.inventory_purchase_orders po
  set expected_total = (
    select coalesce(sum(l.expected_total_cost), 0)
    from public.inventory_purchase_order_lines l where l.purchase_order_id = po.id
  )
  where po.id = v_order.id
  returning * into v_order;

  insert into public.inventory_audit_log (
    event_type, actor_id, branch_id, entity_type, entity_id, new_value, reason, metadata
  ) values (
    'purchase_order_created', auth.uid(), v_branch, 'inventory_purchase_order',
    v_order.id, to_jsonb(v_order), 'purchase_order_creation',
    jsonb_build_object('lineCount', v_line_number)
  );
  return jsonb_build_object('status', v_order.status, 'purchaseOrderId', v_order.id, 'idempotent', false);
end;
$$;

create or replace function public.inventory_transition_purchase_order(
  p_purchase_order_id uuid,
  p_target_status text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.inventory_purchase_orders%rowtype;
  v_previous text;
  v_allowed boolean := false;
begin
  if nullif(trim(p_reason), '') is null then
    raise exception 'A transition reason is required' using errcode = '22023';
  end if;
  select * into v_order from public.inventory_purchase_orders
  where id = p_purchase_order_id for update;
  if not found or not public.inventory_branch_allowed(v_order.branch_id) then
    raise exception 'Purchase order not found or access denied' using errcode = '42501';
  end if;
  if v_order.status = p_target_status then
    return jsonb_build_object('status', v_order.status, 'purchaseOrderId', v_order.id, 'idempotent', true);
  end if;
  if p_target_status in ('partially_received', 'received') then
    raise exception 'Receipt progress statuses are system managed' using errcode = '42501';
  end if;
  v_allowed := case
    when v_order.status = 'draft' and p_target_status in ('submitted', 'cancelled') then true
    when v_order.status = 'submitted' and p_target_status in ('approved', 'rejected', 'cancelled') then true
    when v_order.status = 'approved' and p_target_status in ('closed', 'cancelled') then true
    when v_order.status in ('partially_received', 'received') and p_target_status = 'closed' then true
    else false
  end;
  if not v_allowed then
    raise exception 'Purchase order cannot move from % to %', v_order.status, p_target_status using errcode = '55000';
  end if;
  if p_target_status <> 'submitted' and not public.inventory_can_approve(v_order.branch_id) then
    raise exception 'Purchase order approval denied' using errcode = '42501';
  end if;

  v_previous := v_order.status;
  update public.inventory_purchase_orders
  set
    status = p_target_status,
    submitted_by = case when p_target_status = 'submitted' then auth.uid() else submitted_by end,
    submitted_at = case when p_target_status = 'submitted' then now() else submitted_at end,
    approved_by = case when p_target_status = 'approved' then auth.uid() else approved_by end,
    approved_at = case when p_target_status = 'approved' then now() else approved_at end,
    closed_by = case when p_target_status in ('closed', 'cancelled', 'rejected') then auth.uid() else closed_by end,
    closed_at = case when p_target_status in ('closed', 'cancelled', 'rejected') then now() else closed_at end
  where id = v_order.id
  returning * into v_order;

  insert into public.inventory_audit_log (
    event_type, actor_id, branch_id, entity_type, entity_id,
    previous_value, new_value, reason
  ) values (
    'purchase_order_status_changed', auth.uid(), v_order.branch_id,
    'inventory_purchase_order', v_order.id,
    jsonb_build_object('status', v_previous),
    jsonb_build_object('status', v_order.status), p_reason
  );
  return jsonb_build_object('status', v_order.status, 'purchaseOrderId', v_order.id, 'idempotent', false);
end;
$$;

create or replace function public.inventory_link_invoice_purchase_order(
  p_invoice_id uuid,
  p_purchase_order_id uuid,
  p_additional_cost numeric default 0,
  p_reason text default 'receiving_control_link'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice public.inventory_invoices%rowtype;
  v_order public.inventory_purchase_orders%rowtype;
  v_ambiguous integer := 0;
begin
  select * into v_invoice from public.inventory_invoices where id = p_invoice_id for update;
  if not found or not public.inventory_branch_allowed(v_invoice.branch_id) then
    raise exception 'Invoice not found or access denied' using errcode = '42501';
  end if;
  if v_invoice.status in ('posted', 'rejected', 'cancelled') then
    raise exception 'Finalized invoice cannot be relinked' using errcode = '55000';
  end if;
  if coalesce(p_additional_cost, 0) < 0 then
    raise exception 'Additional cost cannot be negative' using errcode = '22023';
  end if;
  if p_purchase_order_id is not null then
    select * into v_order from public.inventory_purchase_orders where id = p_purchase_order_id;
    if not found or v_order.branch_id <> v_invoice.branch_id
      or v_order.supplier_id is distinct from v_invoice.supplier_id
      or v_order.status not in ('approved', 'partially_received', 'received')
    then
      raise exception 'Purchase order is not approved for this supplier and branch' using errcode = '23514';
    end if;
  end if;

  update public.inventory_invoices
  set
    purchase_order_id = p_purchase_order_id,
    purchase_order_reference = case when p_purchase_order_id is null
      then purchase_order_reference else v_order.reference_number end,
    additional_cost = coalesce(p_additional_cost, 0)
  where id = p_invoice_id;

  update public.inventory_invoice_lines il
  set purchase_order_line_id = (
    select pol.id
    from public.inventory_purchase_order_lines pol
    where pol.purchase_order_id = p_purchase_order_id
      and pol.ingredient_id = il.ingredient_id
      and (
        select count(*)
        from public.inventory_purchase_order_lines matching
        where matching.purchase_order_id = p_purchase_order_id
          and matching.ingredient_id = il.ingredient_id
      ) = 1
    limit 1
  )
  where il.invoice_id = p_invoice_id and il.active;

  select count(*) into v_ambiguous
  from public.inventory_invoice_lines il
  where il.invoice_id = p_invoice_id and il.active
    and il.ingredient_id is not null
    and p_purchase_order_id is not null
    and il.purchase_order_line_id is null;

  if v_ambiguous > 0 then
    insert into public.inventory_invoice_exceptions (
      invoice_id, exception_type, severity, message, details
    )
    select
      p_invoice_id, 'po_line_mapping_required', 'review',
      'One or more invoice lines could not be linked uniquely to a purchase-order line.',
      jsonb_build_object('unlinkedLineCount', v_ambiguous, 'purchaseOrderId', p_purchase_order_id)
    where not exists (
      select 1 from public.inventory_invoice_exceptions e
      where e.invoice_id = p_invoice_id
        and e.exception_type = 'po_line_mapping_required'
        and e.status = 'open'
    );
  end if;

  insert into public.inventory_invoice_exceptions (
    invoice_id, invoice_line_id, exception_type, severity, message, details
  )
  select
    il.invoice_id,
    il.id,
    'po_over_receipt',
    'blocking',
    'Receiving this line would exceed the approved purchase-order quantity.',
    jsonb_build_object(
      'purchaseOrderId', p_purchase_order_id,
      'purchaseOrderLineId', pol.id,
      'orderedQuantity', pol.normalized_base_quantity,
      'previouslyReceivedQuantity', coalesce(received.received_quantity, 0),
      'proposedReceiptQuantity', il.canonical_received_quantity,
      'overReceiptQuantity',
        coalesce(received.received_quantity, 0)
        + il.canonical_received_quantity
        - pol.normalized_base_quantity
    )
  from public.inventory_invoice_lines il
  join public.inventory_purchase_order_lines pol on pol.id = il.purchase_order_line_id
  left join lateral (
    select coalesce(sum(rl.canonical_quantity), 0) as received_quantity
    from public.inventory_purchase_receipt_lines rl
    join public.inventory_purchase_receipts r on r.id = rl.receipt_id
    where rl.purchase_order_line_id = pol.id and r.status = 'posted'
  ) received on true
  where il.invoice_id = p_invoice_id
    and il.active
    and il.canonical_received_quantity is not null
    and coalesce(received.received_quantity, 0) + il.canonical_received_quantity
      > pol.normalized_base_quantity
    and not exists (
      select 1 from public.inventory_invoice_exceptions e
      where e.invoice_line_id = il.id
        and e.exception_type = 'po_over_receipt'
        and e.status = 'open'
    );

  insert into public.inventory_audit_log (
    event_type, actor_id, branch_id, entity_type, entity_id,
    previous_value, new_value, reason, metadata
  ) values (
    'invoice_purchase_order_linked', auth.uid(), v_invoice.branch_id,
    'inventory_invoice', v_invoice.id,
    jsonb_build_object('purchaseOrderId', v_invoice.purchase_order_id, 'additionalCost', v_invoice.additional_cost),
    jsonb_build_object('purchaseOrderId', p_purchase_order_id, 'additionalCost', coalesce(p_additional_cost, 0)),
    p_reason, jsonb_build_object('ambiguousLineCount', v_ambiguous)
  );
  return jsonb_build_object(
    'status', 'linked', 'invoiceId', p_invoice_id,
    'purchaseOrderId', p_purchase_order_id, 'ambiguousLineCount', v_ambiguous
  );
end;
$$;

create or replace function public.inventory_prepare_receipt_po_link()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice public.inventory_invoices%rowtype;
begin
  select * into v_invoice from public.inventory_invoices where id = new.invoice_id;
  new.purchase_order_id := coalesce(new.purchase_order_id, v_invoice.purchase_order_id);
  new.business_date := coalesce(new.business_date, (new.effective_at at time zone 'Asia/Riyadh')::date);
  new.document_date := coalesce(new.document_date, v_invoice.invoice_date);
  new.invoice_number := coalesce(new.invoice_number, v_invoice.invoice_number);
  new.additional_cost := coalesce(v_invoice.additional_cost, new.additional_cost, 0);
  return new;
end;
$$;

drop trigger if exists inventory_receipt_prepare_po_link on public.inventory_purchase_receipts;
create trigger inventory_receipt_prepare_po_link
before insert on public.inventory_purchase_receipts
for each row execute function public.inventory_prepare_receipt_po_link();

create or replace function public.inventory_prepare_receipt_line_po_link()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.purchase_order_line_id is null then
    select il.purchase_order_line_id into new.purchase_order_line_id
    from public.inventory_invoice_lines il where il.id = new.invoice_line_id;
  end if;
  if new.purchase_order_line_id is not null
    and (
      select coalesce(sum(rl.canonical_quantity), 0)
      from public.inventory_purchase_receipt_lines rl
      join public.inventory_purchase_receipts r on r.id = rl.receipt_id
      where rl.purchase_order_line_id = new.purchase_order_line_id
        and r.status = 'posted'
    ) + new.canonical_quantity > (
      select pol.normalized_base_quantity
      from public.inventory_purchase_order_lines pol
      where pol.id = new.purchase_order_line_id
    )
    and not exists (
      select 1
      from public.inventory_invoice_exceptions e
      where e.invoice_line_id = new.invoice_line_id
        and e.exception_type = 'po_over_receipt'
        and e.status in ('resolved', 'dismissed')
        and nullif(trim(e.resolution_reason), '') is not null
    )
  then
    raise exception 'Over-receipt requires privileged exception resolution with a reason'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists inventory_receipt_line_prepare_po_link on public.inventory_purchase_receipt_lines;
create trigger inventory_receipt_line_prepare_po_link
before insert on public.inventory_purchase_receipt_lines
for each row execute function public.inventory_prepare_receipt_line_po_link();

create or replace function public.inventory_refresh_purchase_order_progress()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po_id uuid;
  v_po public.inventory_purchase_orders%rowtype;
  v_ordered numeric;
  v_received numeric;
  v_previous_status text;
begin
  if new.purchase_order_line_id is null then return new; end if;
  select purchase_order_id into v_po_id from public.inventory_purchase_order_lines
  where id = new.purchase_order_line_id;
  select * into v_po from public.inventory_purchase_orders where id = v_po_id for update;

  select
    coalesce(sum(pol.normalized_base_quantity), 0),
    coalesce(sum(received.received_quantity), 0)
  into v_ordered, v_received
  from public.inventory_purchase_order_lines pol
  left join lateral (
    select coalesce(sum(rl.canonical_quantity), 0) as received_quantity
    from public.inventory_purchase_receipt_lines rl
    join public.inventory_purchase_receipts r on r.id = rl.receipt_id
    where rl.purchase_order_line_id = pol.id and r.status = 'posted'
  ) received on true
  where pol.purchase_order_id = v_po_id;

  if (
    select coalesce(sum(rl.canonical_quantity), 0)
    from public.inventory_purchase_receipt_lines rl
    join public.inventory_purchase_receipts r on r.id = rl.receipt_id
    where rl.purchase_order_line_id = new.purchase_order_line_id and r.status = 'posted'
  ) > (
    select normalized_base_quantity from public.inventory_purchase_order_lines
    where id = new.purchase_order_line_id
  ) then
    insert into public.inventory_exceptions (
      branch_id, ingredient_id, entity_type, entity_id, exception_type,
      likely_cause, severity, title, message, evidence, confidence
    )
    select
      v_po.branch_id, new.ingredient_id, 'purchase_order_line', new.purchase_order_line_id,
      'over_receipt', 'PURCHASE_ENTRY_ERROR', 'review',
      'Received quantity exceeds purchase order',
      'Cumulative received quantity is above the approved purchase-order quantity.',
      jsonb_build_object(
        'purchaseOrderId', v_po_id, 'purchaseOrderLineId', new.purchase_order_line_id,
        'receiptLineId', new.id
      ), 1
    where not exists (
      select 1 from public.inventory_exceptions e
      where e.entity_type = 'purchase_order_line'
        and e.entity_id = new.purchase_order_line_id
        and e.exception_type = 'over_receipt'
        and e.status = 'open'
    );
  end if;

  v_previous_status := v_po.status;
  if v_po.status not in ('closed', 'cancelled', 'rejected') then
    update public.inventory_purchase_orders
    set status = case
      when v_received >= v_ordered and v_ordered > 0 then 'received'
      when v_received > 0 then 'partially_received'
      else status
    end
    where id = v_po_id
    returning status into v_po.status;
  end if;
  if v_po.status is distinct from v_previous_status then
    insert into public.inventory_audit_log (
      event_type, actor_id, branch_id, entity_type, entity_id,
      previous_value, new_value, reason, metadata
    ) values (
      'purchase_order_receipt_progressed', auth.uid(), v_po.branch_id,
      'inventory_purchase_order', v_po_id,
      jsonb_build_object('status', v_previous_status),
      jsonb_build_object('status', v_po.status),
      'receipt_posting',
      jsonb_build_object('orderedQuantity', v_ordered, 'receivedQuantity', v_received)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists inventory_receipt_line_refresh_po on public.inventory_purchase_receipt_lines;
create trigger inventory_receipt_line_refresh_po
after insert on public.inventory_purchase_receipt_lines
for each row execute function public.inventory_refresh_purchase_order_progress();

create or replace function public.inventory_post_supplier_return(
  p_payload jsonb,
  p_lines jsonb,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_branch text := nullif(p_payload ->> 'branchId', '');
  v_supplier_id uuid := nullif(p_payload ->> 'supplierId', '')::uuid;
  v_location_id uuid := nullif(p_payload ->> 'locationId', '')::uuid;
  v_receipt_id uuid := nullif(p_payload ->> 'originalReceiptId', '')::uuid;
  v_po_id uuid := nullif(p_payload ->> 'purchaseOrderId', '')::uuid;
  v_business_date date := nullif(p_payload ->> 'businessDate', '')::date;
  v_effective_at timestamptz;
  v_return public.inventory_supplier_returns%rowtype;
  v_line jsonb;
  v_line_id uuid;
  v_movement_id uuid;
  v_line_number integer := 0;
  v_receipt_line public.inventory_purchase_receipt_lines%rowtype;
  v_quantity numeric;
  v_unit_cost numeric;
  v_existing_returned numeric;
  v_ingredient public.inventory_ingredients%rowtype;
begin
  if not public.inventory_can_approve(v_branch) then
    raise exception 'Supplier return posting denied' using errcode = '42501';
  end if;
  select * into v_return from public.inventory_supplier_returns
  where idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('status', v_return.status, 'supplierReturnId', v_return.id, 'idempotent', true);
  end if;
  if v_supplier_id is null or v_location_id is null or v_business_date is null
    or nullif(trim(p_payload ->> 'referenceNumber'), '') is null
    or nullif(trim(p_payload ->> 'reason'), '') is null
  then
    raise exception 'Supplier, location, reference, business date, and reason are required' using errcode = '23514';
  end if;
  if coalesce(jsonb_typeof(p_lines), '') <> 'array'
    or coalesce(jsonb_array_length(p_lines), 0) = 0
  then
    raise exception 'Supplier return requires at least one line' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.inventory_supplier_branches sb
    where sb.supplier_id = v_supplier_id and sb.branch_id = v_branch and sb.active
  ) then
    raise exception 'Supplier is not enabled for branch' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.inventory_storage_locations l
    where l.id = v_location_id and l.branch_id = v_branch and l.active
  ) then
    raise exception 'Return location is not active for branch' using errcode = '23514';
  end if;
  if v_receipt_id is not null and not exists (
    select 1 from public.inventory_purchase_receipts r
    where r.id = v_receipt_id and r.branch_id = v_branch and r.supplier_id = v_supplier_id
  ) then
    raise exception 'Original receipt does not match supplier and branch' using errcode = '23514';
  end if;
  if v_po_id is not null and not exists (
    select 1 from public.inventory_purchase_orders po
    where po.id = v_po_id and po.branch_id = v_branch and po.supplier_id = v_supplier_id
  ) then
    raise exception 'Purchase order does not match supplier and branch' using errcode = '23514';
  end if;
  v_effective_at := coalesce(
    nullif(p_payload ->> 'effectiveAt', '')::timestamptz,
    (v_business_date + time '12:00') at time zone 'Asia/Riyadh'
  );

  insert into public.inventory_supplier_returns (
    branch_id, supplier_id, storage_location_id, original_receipt_id,
    purchase_order_id, reference_number, business_date, document_date,
    effective_at, reason, notes, created_by, submitted_by, submitted_at,
    approved_by, approved_at, idempotency_key, evidence_metadata
  ) values (
    v_branch, v_supplier_id, v_location_id, v_receipt_id, v_po_id,
    trim(p_payload ->> 'referenceNumber'), v_business_date,
    nullif(p_payload ->> 'documentDate', '')::date, v_effective_at,
    trim(p_payload ->> 'reason'), nullif(trim(p_payload ->> 'notes'), ''),
    auth.uid(), auth.uid(), now(), auth.uid(), now(), p_idempotency_key,
    coalesce(p_payload -> 'evidence', '{}'::jsonb)
  ) returning * into v_return;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    v_line_number := v_line_number + 1;
    v_quantity := nullif(v_line ->> 'normalizedQuantity', '')::numeric;
    if v_quantity is null or v_quantity <= 0 then
      raise exception 'Supplier return line % requires a positive normalized quantity', v_line_number using errcode = '22023';
    end if;
    select * into v_ingredient from public.inventory_ingredients
    where id = nullif(v_line ->> 'ingredientId', '')::uuid
      and (scope = 'network' or branch_id = v_branch);
    if not found or v_line ->> 'canonicalUnit' <> v_ingredient.base_inventory_unit then
      raise exception 'Supplier return line % does not match the canonical item unit', v_line_number using errcode = '23514';
    end if;
    v_receipt_line := null;
    if nullif(v_line ->> 'originalReceiptLineId', '') is not null then
      select * into v_receipt_line from public.inventory_purchase_receipt_lines
      where id = (v_line ->> 'originalReceiptLineId')::uuid;
      if not found or (v_receipt_id is not null and v_receipt_line.receipt_id <> v_receipt_id)
        or v_receipt_line.ingredient_id <> (v_line ->> 'ingredientId')::uuid
        or not exists (
          select 1 from public.inventory_purchase_receipts linked_receipt
          where linked_receipt.id = v_receipt_line.receipt_id
            and linked_receipt.branch_id = v_branch
            and linked_receipt.supplier_id = v_supplier_id
        )
      then
        raise exception 'Supplier return line % does not match original receipt evidence', v_line_number using errcode = '23514';
      end if;
      select coalesce(sum(l.normalized_quantity), 0) into v_existing_returned
      from public.inventory_supplier_return_lines l
      join public.inventory_supplier_returns r on r.id = l.supplier_return_id
      where l.original_receipt_line_id = v_receipt_line.id and r.status = 'posted';
      if v_existing_returned + v_quantity > v_receipt_line.canonical_quantity then
        raise exception 'Supplier return line % exceeds received quantity', v_line_number using errcode = '23514';
      end if;
      v_unit_cost := v_receipt_line.unit_cost_canonical;
    else
      v_unit_cost := nullif(v_line ->> 'unitCostBasis', '')::numeric;
      if v_unit_cost is null then
        select h.weighted_average_cost into v_unit_cost
        from public.inventory_ingredient_cost_history h
        where h.branch_id = v_branch
          and h.ingredient_id = (v_line ->> 'ingredientId')::uuid
          and h.effective_at <= v_effective_at
        order by h.effective_at desc, h.recorded_at desc limit 1;
      end if;
    end if;

    v_line_id := gen_random_uuid();
    v_movement_id := gen_random_uuid();
    insert into public.inventory_movements (
      id, branch_id, storage_location_id, ingredient_id, movement_type,
      signed_canonical_quantity, canonical_unit, original_quantity, original_unit,
      conversion_factor, unit_cost, total_cost, effective_at, business_date,
      document_date, recorded_at, actor_id, submitted_by, submitted_at,
      approved_by, approved_at, source_type, source_id, source_reference,
      receipt_id, receipt_line_id, supplier_id, idempotency_key, reason_code,
      notes, evidence_metadata, metadata
    ) values (
      v_movement_id, v_branch, v_location_id, (v_line ->> 'ingredientId')::uuid,
      'return_to_supplier', -abs(v_quantity), v_line ->> 'canonicalUnit',
      coalesce(nullif(v_line ->> 'sourceQuantity', '')::numeric, v_quantity),
      coalesce(nullif(v_line ->> 'sourceUnit', ''), v_line ->> 'canonicalUnit'),
      coalesce(nullif(v_line ->> 'conversionFactor', '')::numeric, 1),
      v_unit_cost, -abs(v_quantity) * v_unit_cost, v_effective_at, v_business_date,
      v_return.document_date, now(), auth.uid(), auth.uid(), now(), auth.uid(), now(),
      'supplier_return_line', v_line_id, v_return.reference_number,
      v_receipt_id, v_receipt_line.id, v_supplier_id,
      p_idempotency_key || ':movement:' || v_line_number,
      coalesce(nullif(v_line ->> 'reason', ''), v_return.reason),
      nullif(v_line ->> 'notes', ''),
      coalesce(v_line -> 'evidence', '{}'::jsonb),
      jsonb_build_object('supplierReturnId', v_return.id, 'originalReceiptId', v_receipt_id)
    );

    insert into public.inventory_supplier_return_lines (
      id, supplier_return_id, line_number, original_receipt_line_id,
      purchase_order_line_id, ingredient_id, source_item_name, source_sku,
      source_quantity, source_unit, conversion_factor, normalized_quantity,
      canonical_unit, unit_cost_basis, total_cost, reason, movement_id,
      evidence_metadata
    ) values (
      v_line_id, v_return.id, coalesce(nullif(v_line ->> 'lineNumber', '')::integer, v_line_number),
      v_receipt_line.id, nullif(v_line ->> 'purchaseOrderLineId', '')::uuid,
      (v_line ->> 'ingredientId')::uuid, nullif(v_line ->> 'sourceItemName', ''),
      nullif(v_line ->> 'sourceSku', ''),
      coalesce(nullif(v_line ->> 'sourceQuantity', '')::numeric, v_quantity),
      coalesce(nullif(v_line ->> 'sourceUnit', ''), v_line ->> 'canonicalUnit'),
      coalesce(nullif(v_line ->> 'conversionFactor', '')::numeric, 1),
      v_quantity, v_line ->> 'canonicalUnit', v_unit_cost,
      v_quantity * v_unit_cost, nullif(v_line ->> 'reason', ''),
      v_movement_id, coalesce(v_line -> 'evidence', '{}'::jsonb)
    );

    if v_unit_cost is null then
      insert into public.inventory_exceptions (
        branch_id, ingredient_id, entity_type, entity_id, exception_type,
        likely_cause, severity, title, message, evidence, confidence
      ) values (
        v_branch, (v_line ->> 'ingredientId')::uuid, 'supplier_return_line', v_line_id,
        'zero_cost_anomaly', 'MISSING_COST', 'review',
        'Supplier return posted without historical cost',
        'The stock movement is valid, but its cost basis requires review.',
        jsonb_build_object('supplierReturnId', v_return.id, 'movementId', v_movement_id), 1
      );
    end if;
  end loop;

  insert into public.inventory_audit_log (
    event_type, actor_id, branch_id, entity_type, entity_id,
    new_value, reason, metadata
  ) values (
    'supplier_return_posted', auth.uid(), v_branch, 'inventory_supplier_return',
    v_return.id, to_jsonb(v_return), v_return.reason,
    jsonb_build_object('lineCount', v_line_number)
  );
  return jsonb_build_object(
    'status', 'posted', 'supplierReturnId', v_return.id,
    'lineCount', v_line_number, 'idempotent', false
  );
end;
$$;

drop trigger if exists inventory_supplier_returns_immutable on public.inventory_supplier_returns;
create trigger inventory_supplier_returns_immutable
before update or delete on public.inventory_supplier_returns
for each row execute function public.inventory_prevent_posted_mutation();

drop trigger if exists inventory_supplier_return_lines_immutable on public.inventory_supplier_return_lines;
create trigger inventory_supplier_return_lines_immutable
before update or delete on public.inventory_supplier_return_lines
for each row execute function public.inventory_prevent_posted_mutation();

alter table public.inventory_purchase_orders enable row level security;
alter table public.inventory_purchase_order_lines enable row level security;
alter table public.inventory_supplier_returns enable row level security;
alter table public.inventory_supplier_return_lines enable row level security;

revoke all on public.inventory_purchase_orders from anon, authenticated;
revoke all on public.inventory_purchase_order_lines from anon, authenticated;
revoke all on public.inventory_supplier_returns from anon, authenticated;
revoke all on public.inventory_supplier_return_lines from anon, authenticated;
grant select on public.inventory_purchase_orders to authenticated;
grant select on public.inventory_purchase_order_lines to authenticated;
grant select on public.inventory_supplier_returns to authenticated;
grant select on public.inventory_supplier_return_lines to authenticated;
grant select on public.inventory_purchase_order_progress to authenticated;

create policy inventory_purchase_orders_branch on public.inventory_purchase_orders
for select to authenticated using (public.inventory_branch_allowed(branch_id));
create policy inventory_purchase_order_lines_branch on public.inventory_purchase_order_lines
for select to authenticated using (exists (
  select 1 from public.inventory_purchase_orders po
  where po.id = purchase_order_id and public.inventory_branch_allowed(po.branch_id)
));
create policy inventory_supplier_returns_branch on public.inventory_supplier_returns
for select to authenticated using (public.inventory_branch_allowed(branch_id));
create policy inventory_supplier_return_lines_branch on public.inventory_supplier_return_lines
for select to authenticated using (exists (
  select 1 from public.inventory_supplier_returns r
  where r.id = supplier_return_id and public.inventory_branch_allowed(r.branch_id)
));

revoke all on function public.inventory_create_purchase_order(jsonb, jsonb, text) from public;
revoke all on function public.inventory_transition_purchase_order(uuid, text, text) from public;
revoke all on function public.inventory_link_invoice_purchase_order(uuid, uuid, numeric, text) from public;
revoke all on function public.inventory_post_supplier_return(jsonb, jsonb, text) from public;
revoke all on function public.inventory_validate_invoice_po_link() from public;
revoke all on function public.inventory_validate_invoice_line_po_link() from public;
revoke all on function public.inventory_prepare_receipt_po_link() from public;
revoke all on function public.inventory_prepare_receipt_line_po_link() from public;
revoke all on function public.inventory_refresh_purchase_order_progress() from public;
grant execute on function public.inventory_create_purchase_order(jsonb, jsonb, text) to authenticated;
grant execute on function public.inventory_transition_purchase_order(uuid, text, text) to authenticated;
grant execute on function public.inventory_link_invoice_purchase_order(uuid, uuid, numeric, text) to authenticated;
grant execute on function public.inventory_post_supplier_return(jsonb, jsonb, text) to authenticated;
