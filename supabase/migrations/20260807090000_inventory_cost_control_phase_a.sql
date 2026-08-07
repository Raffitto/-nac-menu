-- Inventory & Cost Control v1 — Phase A.
-- Additive extension of the canonical ingredient, immutable movement, costing,
-- stock-count, audit, and branch-RLS architecture.

alter table public.inventory_ingredients
  add column if not exists inventory_classification text not null default 'food_ingredient',
  add column if not exists recipe_cost_eligible boolean not null default true;

alter table public.inventory_ingredients
  drop constraint if exists inventory_ingredients_classification_check;
alter table public.inventory_ingredients
  add constraint inventory_ingredients_classification_check check (
    inventory_classification in (
      'food_ingredient', 'beverage', 'packaging', 'cleaning',
      'operating_supply', 'chemical', 'equipment_consumable', 'other'
    )
  );

update public.inventory_ingredients
set inventory_classification = case
      when lower(coalesce(category, '')) ~ 'packag|takeaway|disposable' then 'packaging'
      when lower(coalesce(category, '')) ~ 'clean|janitorial' then 'cleaning'
      when lower(coalesce(category, '')) ~ 'chemical' then 'chemical'
      when lower(coalesce(category, '')) ~ 'beverage|coffee|tea|juice|drink' then 'beverage'
      when lower(coalesce(category, '')) ~ 'operating|supply|glove|paper' then 'operating_supply'
      else inventory_classification
    end,
    recipe_cost_eligible = case
      when lower(coalesce(category, '')) ~ 'packag|takeaway|disposable|clean|janitorial|chemical|operating|supply|glove|paper'
        then false
      else recipe_cost_eligible
    end;

drop trigger if exists inventory_movements_immutable on public.inventory_movements;

alter table public.inventory_movements
  add column if not exists business_date date,
  add column if not exists document_date date,
  add column if not exists source_reference text,
  add column if not exists submitted_by uuid references auth.users(id),
  add column if not exists submitted_at timestamptz,
  add column if not exists approved_by uuid references auth.users(id),
  add column if not exists approved_at timestamptz,
  add column if not exists reason_code text,
  add column if not exists evidence_metadata jsonb not null default '{}'::jsonb;

update public.inventory_movements
set business_date = (effective_at at time zone 'Asia/Riyadh')::date
where business_date is null;

alter table public.inventory_movements
  alter column business_date set not null,
  alter column business_date drop default;

create or replace function public.inventory_set_movement_business_date()
returns trigger
language plpgsql
as $$
begin
  new.business_date := coalesce(
    new.business_date,
    (new.effective_at at time zone 'Asia/Riyadh')::date
  );
  return new;
end;
$$;

drop trigger if exists inventory_movement_business_date on public.inventory_movements;
create trigger inventory_movement_business_date
before insert on public.inventory_movements
for each row execute function public.inventory_set_movement_business_date();

create trigger inventory_movements_immutable
before update or delete on public.inventory_movements
for each row execute function public.inventory_prevent_posted_mutation();

alter table public.inventory_movements
  drop constraint if exists inventory_movements_movement_type_check;
alter table public.inventory_movements
  add constraint inventory_movements_movement_type_check check (movement_type in (
    'opening_balance', 'purchase_receipt', 'transfer_in', 'transfer_out',
    'production_in', 'production_out', 'production_consumption', 'production_output',
    'production_waste', 'sale_consumption', 'order_consumption', 'order_waste',
    'wastage', 'disposal', 'operational_use', 'spoilage', 'breakage',
    'staff_meal', 'complimentary', 'complimentary_internal_use',
    'physical_count_adjustment', 'manual_adjustment', 'correction',
    'return_to_supplier'
  ));

comment on column public.inventory_movements.business_date is
  'Operational accounting date, distinct from document, recorded, submitted, and approved timestamps.';
comment on column public.inventory_movements.evidence_metadata is
  'Immutable source/evidence context copied from the source transaction at posting.';

create table if not exists public.inventory_operational_events (
  id uuid primary key default gen_random_uuid(),
  branch_id text not null check (branch_id in ('khobar', 'riyadh', 'jeddah')),
  storage_location_id uuid not null references public.inventory_storage_locations(id),
  event_type text not null check (event_type in (
    'disposal', 'operational_use', 'staff_meal', 'production_consumption',
    'production_output', 'production_waste', 'order_consumption', 'order_waste',
    'spoilage', 'breakage', 'complimentary_internal_use', 'return_to_supplier',
    'manual_adjustment', 'legacy_wastage', 'legacy_production'
  )),
  status text not null default 'posted' check (status in ('draft', 'submitted', 'approved', 'posted', 'reversed', 'cancelled')),
  business_date date not null,
  effective_at timestamptz not null,
  source_reference text,
  reason_code text not null,
  notes text,
  evidence_metadata jsonb not null default '{}'::jsonb,
  production_context jsonb not null default '{}'::jsonb,
  created_by uuid not null references auth.users(id),
  submitted_by uuid references auth.users(id),
  submitted_at timestamptz,
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  posted_at timestamptz,
  idempotency_key text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.inventory_operational_event_lines (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.inventory_operational_events(id),
  ingredient_id uuid not null references public.inventory_ingredients(id),
  line_role text not null check (line_role in (
    'consumption', 'output', 'recorded_waste', 'disposal', 'adjustment'
  )),
  source_quantity numeric(20,8),
  source_unit text,
  normalized_quantity numeric(24,10) not null check (normalized_quantity <> 0),
  canonical_unit text not null check (canonical_unit in ('each', 'gram', 'kilogram', 'millilitre', 'litre')),
  conversion_factor numeric(24,10),
  unit_cost numeric(24,10),
  total_cost numeric(24,10),
  movement_id uuid not null unique references public.inventory_movements(id),
  evidence_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists inventory_operational_events_branch_date_idx
  on public.inventory_operational_events (branch_id, business_date desc, event_type);
create index if not exists inventory_operational_lines_ingredient_idx
  on public.inventory_operational_event_lines (ingredient_id, event_id);

create table if not exists public.inventory_exceptions (
  id uuid primary key default gen_random_uuid(),
  branch_id text not null check (branch_id in ('khobar', 'riyadh', 'jeddah')),
  ingredient_id uuid references public.inventory_ingredients(id),
  entity_type text not null,
  entity_id uuid,
  exception_type text not null check (exception_type in (
    'quantity_anomaly', 'unit_cost_anomaly', 'unexpected_unit_change',
    'quantity_cost_mismatch', 'possible_duplicate', 'pack_conversion_anomaly',
    'implausible_count', 'negative_theoretical_stock', 'missing_recipe_consumption',
    'opposing_related_sku_variance', 'zero_cost_anomaly', 'supplier_price_movement',
    'transfer_mismatch', 'production_yield_variance', 'needs_review'
  )),
  likely_cause text,
  severity text not null check (severity in ('info', 'warning', 'review', 'blocking')),
  status text not null default 'open' check (status in ('open', 'acknowledged', 'resolved', 'dismissed')),
  title text not null,
  message text not null,
  evidence jsonb not null default '{}'::jsonb,
  confidence numeric(5,4) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  rule_version text not null default 'phase_a_v1',
  detected_at timestamptz not null default now(),
  acknowledged_by uuid references auth.users(id),
  acknowledged_at timestamptz,
  resolved_by uuid references auth.users(id),
  resolved_at timestamptz,
  resolution_reason text,
  override_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists inventory_exceptions_open_idx
  on public.inventory_exceptions (branch_id, status, severity, detected_at desc);
create index if not exists inventory_exceptions_ingredient_idx
  on public.inventory_exceptions (branch_id, ingredient_id, detected_at desc);

create table if not exists public.inventory_related_items (
  id uuid primary key default gen_random_uuid(),
  branch_id text not null check (branch_id in ('khobar', 'riyadh', 'jeddah')),
  ingredient_id uuid not null references public.inventory_ingredients(id),
  related_ingredient_id uuid not null references public.inventory_ingredients(id),
  relationship_type text not null check (relationship_type in (
    'substitute_for', 'same_operational_ingredient', 'equivalent_pack', 'supersedes'
  )),
  notes text,
  active boolean not null default true,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  check (ingredient_id <> related_ingredient_id),
  unique (branch_id, ingredient_id, related_ingredient_id, relationship_type)
);

create or replace function public.inventory_audit_related_item()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.inventory_audit_log (
    event_type, actor_id, branch_id, entity_type, entity_id,
    previous_value, new_value, reason
  ) values (
    case when tg_op = 'INSERT' then 'related_item_created' else 'related_item_updated' end,
    auth.uid(), new.branch_id, 'inventory_related_item', new.id,
    case when tg_op = 'UPDATE' then to_jsonb(old) else null end,
    to_jsonb(new), 'related_item_maintenance'
  );
  return new;
end;
$$;

drop trigger if exists inventory_related_item_audit on public.inventory_related_items;
create trigger inventory_related_item_audit
after insert or update on public.inventory_related_items
for each row execute function public.inventory_audit_related_item();

alter table public.inventory_stock_counts
  add column if not exists business_date date,
  add column if not exists counted_by uuid references auth.users(id),
  add column if not exists submitted_by uuid references auth.users(id),
  add column if not exists submitted_at timestamptz,
  add column if not exists reviewed_by uuid references auth.users(id),
  add column if not exists reviewed_at timestamptz,
  add column if not exists evidence_metadata jsonb not null default '{}'::jsonb;

update public.inventory_stock_counts
set business_date = (effective_at at time zone 'Asia/Riyadh')::date,
    counted_by = created_by
where business_date is null or counted_by is null;

alter table public.inventory_stock_counts
  alter column business_date set not null,
  alter column counted_by set not null;
alter table public.inventory_stock_counts
  drop constraint if exists inventory_stock_counts_status_check;
alter table public.inventory_stock_counts
  add constraint inventory_stock_counts_status_check check (
    status in ('draft', 'in_progress', 'submitted', 'reviewed', 'approved', 'posted', 'rejected', 'cancelled')
  );

create or replace function public.inventory_set_stock_count_defaults()
returns trigger
language plpgsql
as $$
begin
  new.business_date := coalesce(
    new.business_date,
    (new.effective_at at time zone 'Asia/Riyadh')::date
  );
  new.counted_by := coalesce(new.counted_by, new.created_by);
  return new;
end;
$$;

drop trigger if exists inventory_stock_count_defaults on public.inventory_stock_counts;
create trigger inventory_stock_count_defaults
before insert on public.inventory_stock_counts
for each row execute function public.inventory_set_stock_count_defaults();

alter table public.inventory_stock_count_lines
  add column if not exists source_counted_quantity numeric(20,8),
  add column if not exists source_count_unit text,
  add column if not exists conversion_factor numeric(24,10),
  add column if not exists expected_snapshot_at timestamptz,
  add column if not exists expected_unit_cost numeric(24,10),
  add column if not exists variance_value numeric(24,10),
  add column if not exists evidence_metadata jsonb not null default '{}'::jsonb,
  add column if not exists guardrail_warnings jsonb not null default '[]'::jsonb,
  add column if not exists warning_confirmed_by uuid references auth.users(id),
  add column if not exists warning_confirmed_at timestamptz,
  add column if not exists warning_confirmation_reason text;

update public.inventory_stock_count_lines l
set source_counted_quantity = l.counted_quantity,
    source_count_unit = l.canonical_unit,
    conversion_factor = 1,
    expected_snapshot_at = coalesce(l.expected_snapshot_at, c.effective_at)
from public.inventory_stock_counts c
where c.id = l.stock_count_id
  and l.source_counted_quantity is null;

create or replace function public.inventory_build_count_guardrails(
  p_count_id uuid,
  p_ingredient_id uuid,
  p_source_quantity numeric,
  p_source_unit text,
  p_normalized_quantity numeric,
  p_canonical_unit text,
  p_conversion_factor numeric
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_count public.inventory_stock_counts%rowtype;
  v_expected numeric := 0;
  v_previous numeric;
  v_baseline numeric;
  v_warnings jsonb := '[]'::jsonb;
  v_source_unit text := lower(trim(coalesce(p_source_unit, '')));
begin
  select * into v_count from public.inventory_stock_counts where id = p_count_id;
  if not found or not public.inventory_branch_allowed(v_count.branch_id) then
    raise exception 'Stock count not found or access denied' using errcode = '42501';
  end if;

  select coalesce(sum(m.signed_canonical_quantity), 0)
  into v_expected
  from public.inventory_movements m
  where m.branch_id = v_count.branch_id
    and m.storage_location_id = v_count.storage_location_id
    and m.ingredient_id = p_ingredient_id
    and m.status = 'posted'
    and m.effective_at <= v_count.effective_at;

  select l.counted_quantity
  into v_previous
  from public.inventory_stock_count_lines l
  join public.inventory_stock_counts c on c.id = l.stock_count_id
  where c.branch_id = v_count.branch_id
    and c.storage_location_id = v_count.storage_location_id
    and l.ingredient_id = p_ingredient_id
    and c.status = 'posted'
    and c.effective_at < v_count.effective_at
  order by c.effective_at desc
  limit 1;

  v_baseline := greatest(abs(v_expected), abs(coalesce(v_previous, 0)));

  if v_source_unit in ('box', 'boxes', 'pack', 'packs', 'packet', 'packets', 'case', 'cases', 'bottle', 'bottles', 'roll', 'rolls')
    and (p_conversion_factor is null or p_conversion_factor = 1)
  then
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
      'code', 'pack_conversion_anomaly',
      'severity', 'review',
      'message', 'This item is counted in a pack unit. Confirm the explicit conversion to the base unit.',
      'evidence', jsonb_build_object('sourceUnit', p_source_unit, 'conversionFactor', p_conversion_factor)
    ));
  end if;

  if v_baseline > 0 and abs(p_normalized_quantity) >= greatest(v_baseline * 10, v_baseline + 10) then
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
      'code', 'implausible_count',
      'severity', 'review',
      'message', 'Unusual quantity compared with expected stock and the previous posted count.',
      'evidence', jsonb_build_object(
        'entered', p_normalized_quantity,
        'expected', v_expected,
        'previousCount', v_previous,
        'multipleOfBaseline', round(abs(p_normalized_quantity) / nullif(v_baseline, 0), 2)
      )
    ));
  end if;

  if p_canonical_unit = 'kilogram'
    and v_baseline > 0 and v_baseline < 1
    and abs(p_normalized_quantity) >= 10
  then
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
      'code', 'possible_grams_as_kilograms',
      'severity', 'review',
      'message', format(
        'This item is normally below 1 kg. You entered %s kg. Did you mean %s g / %s kg?',
        p_normalized_quantity, p_source_quantity, p_source_quantity / 1000
      ),
      'evidence', jsonb_build_object('expected', v_expected, 'previousCount', v_previous)
    ));
  end if;

  return v_warnings;
end;
$$;

create or replace function public.inventory_apply_count_guardrails()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.source_counted_quantity := coalesce(new.source_counted_quantity, new.counted_quantity);
  new.source_count_unit := coalesce(new.source_count_unit, new.canonical_unit);
  new.conversion_factor := coalesce(new.conversion_factor, 1);
  new.expected_snapshot_at := coalesce(new.expected_snapshot_at, now());
  new.guardrail_warnings := public.inventory_build_count_guardrails(
    new.stock_count_id,
    new.ingredient_id,
    new.source_counted_quantity,
    new.source_count_unit,
    new.counted_quantity,
    new.canonical_unit,
    new.conversion_factor
  );
  if new.guardrail_warnings = '[]'::jsonb then
    new.warning_confirmed_by := null;
    new.warning_confirmed_at := null;
    new.warning_confirmation_reason := null;
  end if;
  return new;
end;
$$;

drop trigger if exists inventory_stock_count_line_guardrails on public.inventory_stock_count_lines;
create trigger inventory_stock_count_line_guardrails
before insert or update of source_counted_quantity, source_count_unit, counted_quantity, canonical_unit, conversion_factor
on public.inventory_stock_count_lines
for each row execute function public.inventory_apply_count_guardrails();

create or replace function public.inventory_create_operational_movement(
  p_action text,
  p_payload jsonb,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_branch text := p_payload ->> 'branchId';
  v_event_type text;
  v_movement_type text;
  v_line_role text;
  v_quantity numeric := (p_payload ->> 'canonicalQuantity')::numeric;
  v_signed_quantity numeric;
  v_business_date date := coalesce(
    nullif(p_payload ->> 'businessDate', '')::date,
    ((p_payload ->> 'effectiveAt')::timestamptz at time zone 'Asia/Riyadh')::date
  );
  v_effective_at timestamptz := coalesce(
    nullif(p_payload ->> 'effectiveAt', '')::timestamptz,
    (v_business_date + time '12:00') at time zone 'Asia/Riyadh'
  );
  v_reason text := coalesce(nullif(trim(p_payload ->> 'reason'), ''), nullif(trim(p_payload ->> 'reasonCode'), ''));
  v_event public.inventory_operational_events%rowtype;
  v_movement public.inventory_movements%rowtype;
  v_unit_cost numeric;
begin
  if not public.inventory_can_approve(v_branch) then
    raise exception 'Movement creation denied' using errcode = '42501';
  end if;
  if v_quantity is null or v_quantity = 0 then
    raise exception 'Movement quantity cannot be zero' using errcode = '22023';
  end if;
  if v_business_date is null then
    raise exception 'Business date is required' using errcode = '22023';
  end if;
  if v_reason is null and p_action in ('wastage', 'manual_adjustment', 'return_to_supplier', 'staff_meal', 'complimentary', 'production') then
    v_reason := 'legacy_' || p_action;
  end if;
  if v_reason is null then
    raise exception 'A movement reason is required' using errcode = '22023';
  end if;
  if p_action = 'return_to_supplier' and nullif(p_payload ->> 'supplierId', '') is null then
    raise exception 'Supplier is required for a return-to-supplier movement' using errcode = '22023';
  end if;

  v_event_type := case p_action
    when 'disposal' then 'disposal'
    when 'operational_use' then 'operational_use'
    when 'staff_meal' then 'staff_meal'
    when 'production_consumption' then 'production_consumption'
    when 'production_output' then 'production_output'
    when 'production_waste' then 'production_waste'
    when 'order_consumption' then 'order_consumption'
    when 'order_waste' then 'order_waste'
    when 'spoilage' then 'spoilage'
    when 'breakage' then 'breakage'
    when 'complimentary_internal_use' then 'complimentary_internal_use'
    when 'return_to_supplier' then 'return_to_supplier'
    when 'manual_adjustment' then 'manual_adjustment'
    when 'wastage' then 'legacy_wastage'
    when 'complimentary' then 'complimentary_internal_use'
    when 'production' then 'legacy_production'
    else null
  end;
  v_movement_type := case p_action
    when 'disposal' then 'disposal'
    when 'operational_use' then 'operational_use'
    when 'staff_meal' then 'staff_meal'
    when 'production_consumption' then 'production_consumption'
    when 'production_output' then 'production_output'
    when 'production_waste' then 'production_waste'
    when 'order_consumption' then 'order_consumption'
    when 'order_waste' then 'order_waste'
    when 'spoilage' then 'spoilage'
    when 'breakage' then 'breakage'
    when 'complimentary_internal_use' then 'complimentary_internal_use'
    when 'return_to_supplier' then 'return_to_supplier'
    when 'manual_adjustment' then 'manual_adjustment'
    when 'wastage' then 'wastage'
    when 'complimentary' then 'complimentary'
    when 'production' then case when v_quantity >= 0 then 'production_in' else 'production_out' end
    else null
  end;
  if v_event_type is null or v_movement_type is null then
    raise exception 'Unsupported movement action: %', p_action using errcode = '22023';
  end if;

  v_signed_quantity := case
    when p_action in ('manual_adjustment', 'production') then v_quantity
    when p_action = 'production_output' then abs(v_quantity)
    else -abs(v_quantity)
  end;
  v_line_role := case
    when p_action = 'production_output' or (p_action = 'production' and v_signed_quantity > 0) then 'output'
    when p_action in ('production_waste', 'order_waste', 'wastage', 'spoilage') then 'recorded_waste'
    when p_action in ('disposal', 'operational_use', 'breakage') then 'disposal'
    when p_action = 'manual_adjustment' then 'adjustment'
    else 'consumption'
  end;

  select * into v_event
  from public.inventory_operational_events
  where idempotency_key = p_idempotency_key;
  if found then
    select * into v_movement
    from public.inventory_movements
    where source_type = 'operational_event' and source_id = v_event.id
    order by created_at
    limit 1;
    return jsonb_build_object(
      'status', 'already_posted', 'eventId', v_event.id,
      'movementId', v_movement.id, 'idempotent', true
    );
  end if;

  if not exists (
    select 1 from public.inventory_storage_locations l
    where l.id = (p_payload ->> 'locationId')::uuid
      and l.branch_id = v_branch and l.active
  ) then
    raise exception 'Storage location does not belong to branch' using errcode = '23514';
  end if;

  select h.weighted_average_cost into v_unit_cost
  from public.inventory_ingredient_cost_history h
  where h.branch_id = v_branch
    and h.ingredient_id = (p_payload ->> 'ingredientId')::uuid
    and h.effective_at <= v_effective_at
  order by h.effective_at desc, h.recorded_at desc
  limit 1;

  insert into public.inventory_operational_events (
    branch_id, storage_location_id, event_type, business_date, effective_at,
    source_reference, reason_code, notes, evidence_metadata, production_context,
    created_by, submitted_by, submitted_at, approved_by, approved_at, posted_at,
    idempotency_key
  ) values (
    v_branch, (p_payload ->> 'locationId')::uuid, v_event_type, v_business_date, v_effective_at,
    p_payload ->> 'sourceReference', v_reason, p_payload ->> 'notes',
    coalesce(p_payload -> 'evidence', '{}'::jsonb),
    coalesce(p_payload -> 'productionContext', '{}'::jsonb),
    auth.uid(), auth.uid(), now(), auth.uid(), now(), now(), p_idempotency_key
  ) returning * into v_event;

  insert into public.inventory_movements (
    branch_id, storage_location_id, ingredient_id, movement_type,
    signed_canonical_quantity, canonical_unit, original_quantity, original_unit,
    conversion_factor, unit_cost, total_cost, effective_at, business_date,
    document_date, recorded_at, actor_id, submitted_by, submitted_at,
    approved_by, approved_at, source_type, source_id, source_reference,
    supplier_id, idempotency_key, reason_code, notes, evidence_metadata, metadata
  ) values (
    v_branch, v_event.storage_location_id, (p_payload ->> 'ingredientId')::uuid, v_movement_type,
    v_signed_quantity, p_payload ->> 'canonicalUnit',
    coalesce(nullif(p_payload ->> 'sourceQuantity', '')::numeric, abs(v_quantity)),
    coalesce(p_payload ->> 'sourceUnit', p_payload ->> 'canonicalUnit'),
    coalesce(nullif(p_payload ->> 'conversionFactor', '')::numeric, 1),
    v_unit_cost, v_signed_quantity * v_unit_cost, v_effective_at, v_business_date,
    nullif(p_payload ->> 'documentDate', '')::date, now(), auth.uid(), auth.uid(), now(),
    auth.uid(), now(), 'operational_event', v_event.id, p_payload ->> 'sourceReference',
    nullif(p_payload ->> 'supplierId', '')::uuid, p_idempotency_key || ':movement',
    v_reason, p_payload ->> 'notes', coalesce(p_payload -> 'evidence', '{}'::jsonb), p_payload
  ) returning * into v_movement;

  insert into public.inventory_operational_event_lines (
    event_id, ingredient_id, line_role, source_quantity, source_unit,
    normalized_quantity, canonical_unit, conversion_factor, unit_cost,
    total_cost, movement_id, evidence_metadata
  ) values (
    v_event.id, v_movement.ingredient_id, v_line_role,
    v_movement.original_quantity, v_movement.original_unit,
    v_movement.signed_canonical_quantity, v_movement.canonical_unit,
    v_movement.conversion_factor, v_movement.unit_cost, v_movement.total_cost,
    v_movement.id, v_movement.evidence_metadata
  );

  if v_unit_cost is null then
    insert into public.inventory_exceptions (
      branch_id, ingredient_id, entity_type, entity_id, exception_type,
      likely_cause, severity, title, message, evidence, confidence
    ) values (
      v_branch, v_movement.ingredient_id, 'operational_event', v_event.id,
      'zero_cost_anomaly', 'MISSING_COST', 'review',
      'Movement posted without historical cost',
      'The stock movement is valid, but its cost is unresolved for the selected business date.',
      jsonb_build_object('businessDate', v_business_date, 'movementId', v_movement.id),
      1
    );
  end if;

  insert into public.inventory_audit_log (
    event_type, actor_id, branch_id, entity_type, entity_id, new_value, reason, metadata
  ) values (
    'operational_event_posted', auth.uid(), v_branch, 'inventory_operational_event',
    v_event.id, to_jsonb(v_event), v_reason,
    jsonb_build_object('movementId', v_movement.id, 'movementType', v_movement_type)
  );

  return jsonb_build_object(
    'status', 'posted', 'eventId', v_event.id,
    'movementId', v_movement.id, 'idempotent', false
  );
end;
$$;

create or replace function public.inventory_confirm_count_warning(
  p_count_line_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line public.inventory_stock_count_lines%rowtype;
  v_count public.inventory_stock_counts%rowtype;
begin
  if nullif(trim(p_reason), '') is null then
    raise exception 'A confirmation reason is required' using errcode = '22023';
  end if;
  select * into v_line from public.inventory_stock_count_lines where id = p_count_line_id for update;
  select * into v_count from public.inventory_stock_counts where id = v_line.stock_count_id for update;
  if not found or not public.inventory_can_approve(v_count.branch_id) then
    raise exception 'Count warning confirmation denied' using errcode = '42501';
  end if;
  if v_count.status not in ('draft', 'in_progress', 'submitted', 'reviewed') then
    raise exception 'Count warning cannot be changed in status %', v_count.status using errcode = '55000';
  end if;
  if v_line.guardrail_warnings = '[]'::jsonb then
    return jsonb_build_object('status', 'not_required', 'lineId', v_line.id);
  end if;

  update public.inventory_stock_count_lines
  set warning_confirmed_by = auth.uid(),
      warning_confirmed_at = now(),
      warning_confirmation_reason = p_reason
  where id = p_count_line_id;

  insert into public.inventory_audit_log (
    event_type, actor_id, branch_id, entity_type, entity_id,
    previous_value, new_value, reason
  ) values (
    'count_warning_confirmed', auth.uid(), v_count.branch_id,
    'inventory_stock_count_line', v_line.id, to_jsonb(v_line),
    jsonb_build_object('warningConfirmed', true), p_reason
  );
  return jsonb_build_object('status', 'confirmed', 'lineId', v_line.id);
end;
$$;

create or replace function public.inventory_submit_stock_count(p_count_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count public.inventory_stock_counts%rowtype;
begin
  select * into v_count from public.inventory_stock_counts where id = p_count_id for update;
  if not found or not public.inventory_branch_allowed(v_count.branch_id) then
    raise exception 'Stock count submission denied' using errcode = '42501';
  end if;
  if v_count.created_by <> auth.uid() and not public.inventory_can_approve(v_count.branch_id) then
    raise exception 'Stock count submission denied' using errcode = '42501';
  end if;
  if v_count.status in ('submitted', 'reviewed', 'approved') then
    return jsonb_build_object('status', v_count.status, 'countId', p_count_id, 'idempotent', true);
  end if;
  if v_count.status not in ('draft', 'in_progress') then
    raise exception 'Stock count cannot be submitted from status %', v_count.status using errcode = '55000';
  end if;
  if not exists (select 1 from public.inventory_stock_count_lines where stock_count_id = p_count_id) then
    raise exception 'Stock count has no lines' using errcode = '23514';
  end if;

  update public.inventory_stock_counts
  set status = 'submitted', submitted_by = auth.uid(), submitted_at = now()
  where id = p_count_id;
  insert into public.inventory_audit_log (
    event_type, actor_id, branch_id, entity_type, entity_id, new_value, reason
  ) values (
    'stock_count_submitted', auth.uid(), v_count.branch_id, 'inventory_stock_count',
    v_count.id, jsonb_build_object('status', 'submitted'), 'count_submission'
  );
  return jsonb_build_object('status', 'submitted', 'countId', p_count_id, 'idempotent', false);
end;
$$;

create or replace function public.inventory_approve_stock_count(
  p_count_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count public.inventory_stock_counts%rowtype;
  v_line public.inventory_stock_count_lines%rowtype;
  v_movement_id uuid;
  v_unit_cost numeric;
begin
  select * into v_count from public.inventory_stock_counts where id = p_count_id for update;
  if not found or not public.inventory_can_approve(v_count.branch_id) then
    raise exception 'Stock count approval denied' using errcode = '42501';
  end if;
  if v_count.status = 'posted' then
    return jsonb_build_object('status', 'already_posted', 'countId', p_count_id, 'idempotent', true);
  end if;
  if v_count.status not in ('submitted', 'reviewed', 'approved') then
    raise exception 'Stock count must be submitted before posting; current status %', v_count.status using errcode = '55000';
  end if;
  if not exists (select 1 from public.inventory_stock_count_lines where stock_count_id = p_count_id) then
    raise exception 'Stock count has no lines' using errcode = '23514';
  end if;
  if exists (
    select 1 from public.inventory_stock_count_lines
    where stock_count_id = p_count_id
      and guardrail_warnings <> '[]'::jsonb
      and (
        warning_confirmed_at is null
        or nullif(trim(warning_confirmation_reason), '') is null
      )
  ) then
    raise exception 'Unusual count warnings require privileged confirmation and a reason' using errcode = '23514';
  end if;

  for v_line in
    select * from public.inventory_stock_count_lines where stock_count_id = p_count_id
  loop
    select h.weighted_average_cost into v_unit_cost
    from public.inventory_ingredient_cost_history h
    where h.branch_id = v_count.branch_id
      and h.ingredient_id = v_line.ingredient_id
      and h.effective_at <= v_count.effective_at
    order by h.effective_at desc, h.recorded_at desc
    limit 1;

    update public.inventory_stock_count_lines
    set expected_unit_cost = v_unit_cost,
        variance_value = variance_quantity * v_unit_cost
    where id = v_line.id;

    if v_line.variance_quantity <> 0 then
      insert into public.inventory_movements (
        branch_id, storage_location_id, ingredient_id, movement_type,
        signed_canonical_quantity, canonical_unit, original_quantity, original_unit,
        conversion_factor, unit_cost, total_cost, effective_at, business_date,
        recorded_at, actor_id, submitted_by, submitted_at, approved_by, approved_at,
        source_type, source_id, source_reference, idempotency_key, reason_code,
        notes, evidence_metadata, metadata
      ) values (
        v_count.branch_id, v_count.storage_location_id, v_line.ingredient_id,
        'physical_count_adjustment', v_line.variance_quantity, v_line.canonical_unit,
        v_line.source_counted_quantity, v_line.source_count_unit, v_line.conversion_factor,
        v_unit_cost, v_line.variance_quantity * v_unit_cost,
        v_count.effective_at, v_count.business_date, now(), auth.uid(),
        v_count.submitted_by, v_count.submitted_at, auth.uid(), now(),
        'stock_count', v_count.id, 'stock-count:' || v_count.id,
        p_idempotency_key || ':line:' || v_line.id, 'physical_count_variance',
        v_line.notes, v_line.evidence_metadata,
        jsonb_build_object(
          'expected', v_line.expected_quantity,
          'counted', v_line.counted_quantity,
          'guardrailWarnings', v_line.guardrail_warnings,
          'warningConfirmationReason', v_line.warning_confirmation_reason
        )
      ) returning id into v_movement_id;
      update public.inventory_stock_count_lines
      set adjustment_movement_id = v_movement_id where id = v_line.id;
    end if;
  end loop;

  update public.inventory_stock_counts
  set status = 'posted', reviewed_by = coalesce(reviewed_by, auth.uid()),
      reviewed_at = coalesce(reviewed_at, now()),
      approved_by = auth.uid(), approved_at = now()
  where id = p_count_id;

  insert into public.inventory_audit_log (
    event_type, actor_id, branch_id, entity_type, entity_id, new_value, reason
  ) values (
    'stock_count_posted', auth.uid(), v_count.branch_id, 'inventory_stock_count',
    v_count.id, jsonb_build_object('status', 'posted', 'idempotencyKey', p_idempotency_key),
    'approved_count_variance_posting'
  );
  return jsonb_build_object('status', 'posted', 'countId', p_count_id, 'idempotent', false);
end;
$$;

create or replace function public.inventory_resolve_exception(
  p_exception_id uuid,
  p_status text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exception public.inventory_exceptions%rowtype;
begin
  if p_status not in ('acknowledged', 'resolved', 'dismissed') then
    raise exception 'Invalid exception resolution status' using errcode = '22023';
  end if;
  if nullif(trim(p_reason), '') is null then
    raise exception 'A resolution reason is required' using errcode = '22023';
  end if;
  select * into v_exception from public.inventory_exceptions where id = p_exception_id for update;
  if not found or not public.inventory_can_approve(v_exception.branch_id) then
    raise exception 'Exception resolution denied' using errcode = '42501';
  end if;
  if v_exception.status <> 'open' then
    return jsonb_build_object('status', v_exception.status, 'exceptionId', v_exception.id, 'idempotent', true);
  end if;

  update public.inventory_exceptions
  set status = p_status,
      acknowledged_by = case when p_status = 'acknowledged' then auth.uid() else acknowledged_by end,
      acknowledged_at = case when p_status = 'acknowledged' then now() else acknowledged_at end,
      resolved_by = case when p_status in ('resolved', 'dismissed') then auth.uid() else resolved_by end,
      resolved_at = case when p_status in ('resolved', 'dismissed') then now() else resolved_at end,
      resolution_reason = p_reason,
      override_metadata = override_metadata || jsonb_build_object('actorId', auth.uid(), 'at', now())
  where id = p_exception_id;

  insert into public.inventory_audit_log (
    event_type, actor_id, branch_id, entity_type, entity_id,
    previous_value, new_value, reason
  ) values (
    'inventory_exception_' || p_status, auth.uid(), v_exception.branch_id,
    'inventory_exception', v_exception.id, to_jsonb(v_exception),
    jsonb_build_object('status', p_status), p_reason
  );
  return jsonb_build_object('status', p_status, 'exceptionId', v_exception.id, 'idempotent', false);
end;
$$;

alter table public.inventory_operational_events enable row level security;
alter table public.inventory_operational_event_lines enable row level security;
alter table public.inventory_exceptions enable row level security;
alter table public.inventory_related_items enable row level security;

revoke all on public.inventory_operational_events from anon, authenticated;
revoke all on public.inventory_operational_event_lines from anon, authenticated;
revoke all on public.inventory_exceptions from anon, authenticated;
revoke all on public.inventory_related_items from anon, authenticated;
grant select on public.inventory_operational_events to authenticated;
grant select on public.inventory_operational_event_lines to authenticated;
grant select on public.inventory_exceptions to authenticated;
grant select, insert, update on public.inventory_related_items to authenticated;

create policy inventory_operational_events_branch on public.inventory_operational_events
for select to authenticated using (public.inventory_branch_allowed(branch_id));
create policy inventory_operational_lines_branch on public.inventory_operational_event_lines
for select to authenticated using (exists (
  select 1 from public.inventory_operational_events e
  where e.id = event_id and public.inventory_branch_allowed(e.branch_id)
));
create policy inventory_exceptions_branch on public.inventory_exceptions
for select to authenticated using (public.inventory_branch_allowed(branch_id));
create policy inventory_related_items_select on public.inventory_related_items
for select to authenticated using (public.inventory_branch_allowed(branch_id));
create policy inventory_related_items_write on public.inventory_related_items
for all to authenticated
using (public.inventory_can_approve(branch_id))
with check (public.inventory_can_approve(branch_id));

revoke all on function public.inventory_build_count_guardrails(uuid, uuid, numeric, text, numeric, text, numeric) from public;
revoke all on function public.inventory_confirm_count_warning(uuid, text) from public;
revoke all on function public.inventory_submit_stock_count(uuid) from public;
revoke all on function public.inventory_resolve_exception(uuid, text, text) from public;
grant execute on function public.inventory_build_count_guardrails(uuid, uuid, numeric, text, numeric, text, numeric) to authenticated;
grant execute on function public.inventory_confirm_count_warning(uuid, text) to authenticated;
grant execute on function public.inventory_submit_stock_count(uuid) to authenticated;
grant execute on function public.inventory_resolve_exception(uuid, text, text) to authenticated;

comment on table public.inventory_operational_events is
  'Auditable source transactions for disposal, staff meals, production, waste, and other non-purchase stock movements. Posted lines resolve to the immutable movement ledger.';
comment on table public.inventory_exceptions is
  'Branch-scoped deterministic inventory exceptions with evidence and audited human resolution.';
comment on table public.inventory_related_items is
  'Non-destructive item relationships used for explanation; accounting history is never merged.';
