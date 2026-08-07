-- Phase B slice 2: transfer workflow and multi-location stock-count sessions.
-- Operational ownership remains branch-first; no brand/company inheritance is introduced.

create table if not exists public.inventory_transfers (
  id uuid primary key default gen_random_uuid(),
  source_branch_id text not null,
  source_location_id uuid not null references public.inventory_storage_locations(id),
  destination_branch_id text not null,
  destination_location_id uuid not null references public.inventory_storage_locations(id),
  business_date date not null,
  effective_at timestamptz not null,
  status text not null default 'draft' check (status in (
    'draft', 'requested', 'approved', 'dispatched', 'received', 'closed',
    'cancelled', 'rejected'
  )),
  notes text,
  requested_by uuid not null references auth.users(id),
  requested_at timestamptz,
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  dispatched_by uuid references auth.users(id),
  dispatched_at timestamptz,
  received_by uuid references auth.users(id),
  received_at timestamptz,
  closed_by uuid references auth.users(id),
  closed_at timestamptz,
  idempotency_key text not null unique,
  evidence_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (source_location_id <> destination_location_id)
);

create table if not exists public.inventory_transfer_lines (
  id uuid primary key default gen_random_uuid(),
  transfer_id uuid not null references public.inventory_transfers(id),
  line_number integer not null check (line_number > 0),
  ingredient_id uuid not null references public.inventory_ingredients(id),
  source_quantity numeric(20,8) not null check (source_quantity > 0),
  source_unit text not null,
  conversion_factor numeric(24,10) not null check (conversion_factor > 0),
  requested_quantity numeric(24,10) not null check (requested_quantity > 0),
  sent_quantity numeric(24,10),
  received_quantity numeric(24,10),
  canonical_unit text not null check (canonical_unit in ('each', 'gram', 'kilogram', 'millilitre', 'litre')),
  unit_cost_basis numeric(24,10),
  source_movement_id uuid references public.inventory_movements(id),
  destination_movement_id uuid references public.inventory_movements(id),
  notes text,
  evidence_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (transfer_id, line_number),
  unique (transfer_id, ingredient_id)
);

create index if not exists inventory_transfers_source_status_idx
  on public.inventory_transfers (source_branch_id, status, business_date desc);
create index if not exists inventory_transfers_destination_status_idx
  on public.inventory_transfers (destination_branch_id, status, business_date desc);

comment on table public.inventory_transfers is
  'Branch-to-branch or location-to-location custody workflow. Cross-brand accounting rules remain a future extension.';

create or replace function public.inventory_create_transfer_request(
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
  v_source_branch text := nullif(p_payload ->> 'sourceBranchId', '');
  v_destination_branch text := nullif(p_payload ->> 'destinationBranchId', '');
  v_source_location uuid := nullif(p_payload ->> 'sourceLocationId', '')::uuid;
  v_destination_location uuid := nullif(p_payload ->> 'destinationLocationId', '')::uuid;
  v_business_date date := nullif(p_payload ->> 'businessDate', '')::date;
  v_transfer public.inventory_transfers%rowtype;
  v_line jsonb;
  v_item public.inventory_ingredients%rowtype;
  v_line_number integer := 0;
begin
  if auth.uid() is null or not public.inventory_branch_allowed(v_source_branch) then
    raise exception 'Transfer creation denied' using errcode = '42501';
  end if;
  select * into v_transfer from public.inventory_transfers
  where idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('status', v_transfer.status, 'transferId', v_transfer.id, 'idempotent', true);
  end if;
  if v_source_location is null or v_destination_location is null
    or v_business_date is null
    or v_source_location = v_destination_location
  then
    raise exception 'Source, destination, and business date are required and must differ'
      using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.inventory_storage_locations l
    where l.id = v_source_location and l.branch_id = v_source_branch and l.active
  ) then
    raise exception 'Source location is not active for source branch' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.inventory_storage_locations l
    where l.id = v_destination_location and l.branch_id = v_destination_branch and l.active
  ) then
    raise exception 'Destination location is not active for destination branch' using errcode = '23514';
  end if;
  if coalesce(jsonb_typeof(p_lines), '') <> 'array'
    or coalesce(jsonb_array_length(p_lines), 0) = 0
  then
    raise exception 'Transfer requires at least one line' using errcode = '23514';
  end if;

  insert into public.inventory_transfers (
    source_branch_id, source_location_id, destination_branch_id,
    destination_location_id, business_date, effective_at, notes,
    requested_by, idempotency_key, evidence_metadata
  ) values (
    v_source_branch, v_source_location, v_destination_branch,
    v_destination_location, v_business_date,
    coalesce(
      nullif(p_payload ->> 'effectiveAt', '')::timestamptz,
      (v_business_date + time '12:00') at time zone 'Asia/Riyadh'
    ),
    nullif(trim(p_payload ->> 'notes'), ''), auth.uid(), p_idempotency_key,
    coalesce(p_payload -> 'evidence', '{}'::jsonb)
  ) returning * into v_transfer;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    v_line_number := v_line_number + 1;
    select * into v_item from public.inventory_ingredients
    where id = nullif(v_line ->> 'ingredientId', '')::uuid
      and active
      and (scope = 'network' or branch_id = v_source_branch);
    if not found
      or v_line ->> 'canonicalUnit' <> v_item.base_inventory_unit
      or nullif(v_line ->> 'normalizedQuantity', '')::numeric <= 0
      or nullif(v_line ->> 'sourceQuantity', '')::numeric <= 0
      or nullif(v_line ->> 'conversionFactor', '')::numeric <= 0
    then
      raise exception 'Transfer line % has invalid item, quantity, conversion, or unit', v_line_number
        using errcode = '23514';
    end if;
    insert into public.inventory_transfer_lines (
      transfer_id, line_number, ingredient_id, source_quantity, source_unit,
      conversion_factor, requested_quantity, canonical_unit, notes, evidence_metadata
    ) values (
      v_transfer.id, coalesce(nullif(v_line ->> 'lineNumber', '')::integer, v_line_number),
      v_item.id, (v_line ->> 'sourceQuantity')::numeric,
      v_line ->> 'sourceUnit', (v_line ->> 'conversionFactor')::numeric,
      (v_line ->> 'normalizedQuantity')::numeric, v_line ->> 'canonicalUnit',
      nullif(v_line ->> 'notes', ''), coalesce(v_line -> 'evidence', '{}'::jsonb)
    );
  end loop;

  insert into public.inventory_audit_log (
    event_type, actor_id, branch_id, entity_type, entity_id, new_value, reason, metadata
  ) values (
    'transfer_created', auth.uid(), v_source_branch, 'inventory_transfer', v_transfer.id,
    to_jsonb(v_transfer), 'transfer_draft_created',
    jsonb_build_object('destinationBranchId', v_destination_branch, 'lineCount', v_line_number)
  );
  return jsonb_build_object('status', 'draft', 'transferId', v_transfer.id, 'idempotent', false);
end;
$$;

create or replace function public.inventory_transition_transfer(
  p_transfer_id uuid,
  p_target_status text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_transfer public.inventory_transfers%rowtype;
  v_previous text;
  v_allowed boolean;
begin
  if nullif(trim(p_reason), '') is null then
    raise exception 'A transition reason is required' using errcode = '22023';
  end if;
  select * into v_transfer from public.inventory_transfers where id = p_transfer_id for update;
  if not found then raise exception 'Transfer not found' using errcode = '42501'; end if;
  if v_transfer.status = p_target_status then
    return jsonb_build_object('status', v_transfer.status, 'transferId', v_transfer.id, 'idempotent', true);
  end if;
  v_allowed := case
    when v_transfer.status = 'draft' and p_target_status in ('requested', 'cancelled') then true
    when v_transfer.status = 'requested' and p_target_status in ('approved', 'rejected', 'cancelled') then true
    when v_transfer.status = 'received' and p_target_status = 'closed' then true
    else false
  end;
  if not v_allowed then
    raise exception 'Transfer cannot move from % to %', v_transfer.status, p_target_status using errcode = '55000';
  end if;
  if p_target_status = 'requested' then
    if not public.inventory_branch_allowed(v_transfer.source_branch_id) then
      raise exception 'Transfer request denied' using errcode = '42501';
    end if;
  elsif p_target_status in ('approved', 'rejected', 'cancelled') then
    if not public.inventory_can_approve(v_transfer.source_branch_id) then
      raise exception 'Transfer approval denied' using errcode = '42501';
    end if;
  elsif p_target_status = 'closed' then
    if not public.inventory_can_approve(v_transfer.destination_branch_id) then
      raise exception 'Transfer close denied' using errcode = '42501';
    end if;
  end if;
  v_previous := v_transfer.status;
  update public.inventory_transfers
  set status = p_target_status,
      requested_at = case when p_target_status = 'requested' then now() else requested_at end,
      approved_by = case when p_target_status = 'approved' then auth.uid() else approved_by end,
      approved_at = case when p_target_status = 'approved' then now() else approved_at end,
      closed_by = case when p_target_status in ('closed', 'cancelled', 'rejected') then auth.uid() else closed_by end,
      closed_at = case when p_target_status in ('closed', 'cancelled', 'rejected') then now() else closed_at end
  where id = v_transfer.id returning * into v_transfer;
  insert into public.inventory_audit_log (
    event_type, actor_id, branch_id, entity_type, entity_id,
    previous_value, new_value, reason, metadata
  ) values (
    'transfer_status_changed', auth.uid(), v_transfer.source_branch_id,
    'inventory_transfer', v_transfer.id,
    jsonb_build_object('status', v_previous), jsonb_build_object('status', v_transfer.status),
    p_reason, jsonb_build_object('destinationBranchId', v_transfer.destination_branch_id)
  );
  return jsonb_build_object('status', v_transfer.status, 'transferId', v_transfer.id, 'idempotent', false);
end;
$$;

create or replace function public.inventory_dispatch_transfer(
  p_transfer_id uuid,
  p_sent_lines jsonb,
  p_reason text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_transfer public.inventory_transfers%rowtype;
  v_line public.inventory_transfer_lines%rowtype;
  v_sent numeric;
  v_unit_cost numeric;
  v_movement_id uuid;
begin
  if nullif(trim(p_reason), '') is null then
    raise exception 'A dispatch reason is required' using errcode = '22023';
  end if;
  select * into v_transfer from public.inventory_transfers where id = p_transfer_id for update;
  if not found or not public.inventory_can_approve(v_transfer.source_branch_id) then
    raise exception 'Transfer dispatch denied' using errcode = '42501';
  end if;
  if v_transfer.status = 'dispatched' then
    return jsonb_build_object('status', 'dispatched', 'transferId', v_transfer.id, 'idempotent', true);
  end if;
  if v_transfer.status <> 'approved' then
    raise exception 'Transfer must be approved before dispatch' using errcode = '55000';
  end if;
  for v_line in select * from public.inventory_transfer_lines where transfer_id = v_transfer.id order by line_number
  loop
    select nullif(value ->> 'sentQuantity', '')::numeric into v_sent
    from jsonb_array_elements(coalesce(p_sent_lines, '[]'::jsonb))
    where value ->> 'lineId' = v_line.id::text;
    v_sent := coalesce(v_sent, v_line.requested_quantity);
    if v_sent <= 0 then raise exception 'Sent quantity must be positive' using errcode = '22023'; end if;
    select h.weighted_average_cost into v_unit_cost
    from public.inventory_ingredient_cost_history h
    where h.branch_id = v_transfer.source_branch_id
      and h.ingredient_id = v_line.ingredient_id
      and h.effective_at <= v_transfer.effective_at
    order by h.effective_at desc, h.recorded_at desc limit 1;
    insert into public.inventory_movements (
      branch_id, storage_location_id, ingredient_id, movement_type,
      signed_canonical_quantity, canonical_unit, original_quantity, original_unit,
      conversion_factor, unit_cost, total_cost, effective_at, business_date,
      recorded_at, actor_id, submitted_by, submitted_at, approved_by, approved_at,
      source_type, source_id, source_reference, idempotency_key, reason_code,
      notes, evidence_metadata, metadata
    ) values (
      v_transfer.source_branch_id, v_transfer.source_location_id, v_line.ingredient_id,
      'transfer_out', -abs(v_sent), v_line.canonical_unit,
      v_line.source_quantity, v_line.source_unit, v_line.conversion_factor,
      v_unit_cost, -abs(v_sent) * v_unit_cost, v_transfer.effective_at,
      v_transfer.business_date, now(), auth.uid(), auth.uid(), now(), auth.uid(), now(),
      'transfer_line', v_line.id, 'transfer:' || v_transfer.id,
      p_idempotency_key || ':out:' || v_line.id, 'transfer_dispatch',
      p_reason, v_line.evidence_metadata,
      jsonb_build_object('transferId', v_transfer.id, 'destinationBranchId', v_transfer.destination_branch_id)
    ) returning id into v_movement_id;
    update public.inventory_transfer_lines
    set sent_quantity = v_sent, unit_cost_basis = v_unit_cost, source_movement_id = v_movement_id
    where id = v_line.id;
  end loop;
  update public.inventory_transfers
  set status = 'dispatched', dispatched_by = auth.uid(), dispatched_at = now()
  where id = v_transfer.id;
  insert into public.inventory_audit_log (
    event_type, actor_id, branch_id, entity_type, entity_id, new_value, reason
  ) values (
    'transfer_dispatched', auth.uid(), v_transfer.source_branch_id,
    'inventory_transfer', v_transfer.id, jsonb_build_object('status', 'dispatched'), p_reason
  );
  return jsonb_build_object('status', 'dispatched', 'transferId', v_transfer.id, 'idempotent', false);
end;
$$;

create or replace function public.inventory_receive_transfer(
  p_transfer_id uuid,
  p_received_lines jsonb,
  p_reason text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_transfer public.inventory_transfers%rowtype;
  v_line public.inventory_transfer_lines%rowtype;
  v_received numeric;
  v_movement_id uuid;
begin
  if nullif(trim(p_reason), '') is null then
    raise exception 'A receiving reason is required' using errcode = '22023';
  end if;
  select * into v_transfer from public.inventory_transfers where id = p_transfer_id for update;
  if not found or not public.inventory_can_approve(v_transfer.destination_branch_id) then
    raise exception 'Transfer receipt denied' using errcode = '42501';
  end if;
  if v_transfer.status = 'received' then
    return jsonb_build_object('status', 'received', 'transferId', v_transfer.id, 'idempotent', true);
  end if;
  if v_transfer.status <> 'dispatched' then
    raise exception 'Transfer must be dispatched before receipt' using errcode = '55000';
  end if;
  for v_line in select * from public.inventory_transfer_lines where transfer_id = v_transfer.id order by line_number
  loop
    select nullif(value ->> 'receivedQuantity', '')::numeric into v_received
    from jsonb_array_elements(coalesce(p_received_lines, '[]'::jsonb))
    where value ->> 'lineId' = v_line.id::text;
    if v_received is null or v_received < 0 then
      raise exception 'Received quantity is required and cannot be negative' using errcode = '22023';
    end if;
    if v_received > 0 then
      insert into public.inventory_movements (
        branch_id, storage_location_id, ingredient_id, movement_type,
        signed_canonical_quantity, canonical_unit, original_quantity, original_unit,
        conversion_factor, unit_cost, total_cost, effective_at, business_date,
        recorded_at, actor_id, submitted_by, submitted_at, approved_by, approved_at,
        source_type, source_id, source_reference, idempotency_key, reason_code,
        notes, evidence_metadata, metadata
      ) values (
        v_transfer.destination_branch_id, v_transfer.destination_location_id, v_line.ingredient_id,
        'transfer_in', v_received, v_line.canonical_unit,
        v_received, v_line.canonical_unit, 1,
        v_line.unit_cost_basis, v_received * v_line.unit_cost_basis,
        v_transfer.effective_at, v_transfer.business_date, now(), auth.uid(),
        v_transfer.dispatched_by, v_transfer.dispatched_at, auth.uid(), now(),
        'transfer_line', v_line.id, 'transfer:' || v_transfer.id,
        p_idempotency_key || ':in:' || v_line.id, 'transfer_receipt',
        p_reason, v_line.evidence_metadata,
        jsonb_build_object('transferId', v_transfer.id, 'sourceMovementId', v_line.source_movement_id)
      ) returning id into v_movement_id;
    end if;
    update public.inventory_transfer_lines
    set received_quantity = v_received, destination_movement_id = v_movement_id
    where id = v_line.id;
    if v_received is distinct from v_line.sent_quantity then
      insert into public.inventory_exceptions (
        branch_id, ingredient_id, entity_type, entity_id, exception_type,
        likely_cause, severity, title, message, evidence, confidence
      ) values (
        v_transfer.destination_branch_id, v_line.ingredient_id,
        'inventory_transfer_line', v_line.id, 'transfer_mismatch',
        'TRANSFER_MISMATCH', 'review', 'Transfer quantity discrepancy',
        'Received quantity differs from dispatched quantity.',
        jsonb_build_object(
          'transferId', v_transfer.id, 'sentQuantity', v_line.sent_quantity,
          'receivedQuantity', v_received, 'difference', v_received - v_line.sent_quantity
        ), 1
      );
    end if;
  end loop;
  update public.inventory_transfers
  set status = 'received', received_by = auth.uid(), received_at = now()
  where id = v_transfer.id;
  insert into public.inventory_audit_log (
    event_type, actor_id, branch_id, entity_type, entity_id, new_value, reason,
    metadata
  ) values (
    'transfer_received', auth.uid(), v_transfer.destination_branch_id,
    'inventory_transfer', v_transfer.id, jsonb_build_object('status', 'received'),
    p_reason, jsonb_build_object('sourceBranchId', v_transfer.source_branch_id)
  );
  return jsonb_build_object('status', 'received', 'transferId', v_transfer.id, 'idempotent', false);
end;
$$;

create table if not exists public.inventory_count_sessions (
  id uuid primary key default gen_random_uuid(),
  branch_id text not null,
  business_date date not null,
  effective_at timestamptz not null,
  status text not null default 'draft' check (status in (
    'draft', 'in_progress', 'submitted', 'reviewed', 'approved', 'posted', 'cancelled'
  )),
  notes text,
  counted_by uuid not null references auth.users(id),
  submitted_by uuid references auth.users(id),
  submitted_at timestamptz,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  idempotency_key text not null unique,
  evidence_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.inventory_stock_counts
  add column if not exists count_session_id uuid references public.inventory_count_sessions(id);
create unique index if not exists inventory_stock_counts_session_location_uidx
  on public.inventory_stock_counts (count_session_id, storage_location_id)
  where count_session_id is not null;

create or replace view public.inventory_count_session_item_totals
with (security_invoker = true)
as
select
  s.id as count_session_id,
  s.branch_id,
  s.business_date,
  s.status,
  i.id as ingredient_id,
  i.base_inventory_unit as canonical_unit,
  count(distinct c.storage_location_id) as selected_location_count,
  count(distinct c.storage_location_id) filter (where l.id is not null) as counted_location_count,
  count(distinct c.storage_location_id) filter (where l.id is not null)
    < count(distinct c.storage_location_id) as has_uncounted_location,
  sum(coalesce(l.expected_quantity, 0)) as expected_quantity,
  sum(l.counted_quantity) as counted_quantity,
  case
    when count(l.id) = count(c.id) then sum(l.variance_quantity)
    else null
  end as variance_quantity,
  case
    when count(l.id) = count(c.id)
      then sum(coalesce(l.variance_value, l.variance_quantity * l.expected_unit_cost, 0))
    else null
  end as variance_value,
  coalesce(bool_or(l.guardrail_warnings <> '[]'::jsonb), false) as has_warning,
  coalesce(bool_or(
    l.id is not null and (l.source_count_unit is null or l.conversion_factor is null)
  ), false) as has_unresolved_unit
from public.inventory_count_sessions s
join public.inventory_stock_counts c on c.count_session_id = s.id
join public.inventory_ingredients i
  on i.active and (i.scope = 'network' or i.branch_id = s.branch_id)
left join public.inventory_stock_count_lines l
  on l.stock_count_id = c.id and l.ingredient_id = i.id
group by s.id, i.id, i.base_inventory_unit;

create or replace function public.inventory_guard_session_count_posting()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.count_session_id is not null
    and new.status = 'posted'
    and old.status <> 'posted'
    and not exists (
      select 1 from public.inventory_count_sessions s
      where s.id = new.count_session_id and s.status = 'approved'
    )
  then
    raise exception 'Location count cannot post before its count session is approved'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

drop trigger if exists inventory_guard_session_count_posting
  on public.inventory_stock_counts;
create trigger inventory_guard_session_count_posting
before update of status on public.inventory_stock_counts
for each row execute function public.inventory_guard_session_count_posting();

create or replace function public.inventory_create_count_session(
  p_payload jsonb,
  p_location_ids uuid[],
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_branch text := nullif(p_payload ->> 'branchId', '');
  v_business_date date := nullif(p_payload ->> 'businessDate', '')::date;
  v_effective_at timestamptz;
  v_session public.inventory_count_sessions%rowtype;
  v_location_id uuid;
begin
  if auth.uid() is null or not public.inventory_branch_allowed(v_branch) then
    raise exception 'Count session creation denied' using errcode = '42501';
  end if;
  select * into v_session from public.inventory_count_sessions
  where idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('status', v_session.status, 'countSessionId', v_session.id, 'idempotent', true);
  end if;
  if v_business_date is null or coalesce(array_length(p_location_ids, 1), 0) = 0 then
    raise exception 'Business date and at least one location are required' using errcode = '23514';
  end if;
  v_effective_at := coalesce(
    nullif(p_payload ->> 'effectiveAt', '')::timestamptz,
    (v_business_date + time '23:59:59') at time zone 'Asia/Riyadh'
  );
  insert into public.inventory_count_sessions (
    branch_id, business_date, effective_at, notes, counted_by,
    idempotency_key, evidence_metadata
  ) values (
    v_branch, v_business_date, v_effective_at,
    nullif(trim(p_payload ->> 'notes'), ''), auth.uid(),
    p_idempotency_key, coalesce(p_payload -> 'evidence', '{}'::jsonb)
  ) returning * into v_session;
  foreach v_location_id in array p_location_ids
  loop
    if not exists (
      select 1 from public.inventory_storage_locations l
      where l.id = v_location_id and l.branch_id = v_branch and l.active
    ) then
      raise exception 'Count location is not active for branch' using errcode = '23514';
    end if;
    insert into public.inventory_stock_counts (
      branch_id, storage_location_id, effective_at, business_date, status,
      created_by, counted_by, idempotency_key, evidence_metadata,
      notes, count_session_id
    ) values (
      v_branch, v_location_id, v_effective_at, v_business_date, 'draft',
      auth.uid(), auth.uid(), p_idempotency_key || ':location:' || v_location_id,
      coalesce(p_payload -> 'evidence', '{}'::jsonb),
      'Location count for session ' || v_session.id, v_session.id
    );
  end loop;
  insert into public.inventory_audit_log (
    event_type, actor_id, branch_id, entity_type, entity_id, new_value, reason, metadata
  ) values (
    'count_session_created', auth.uid(), v_branch, 'inventory_count_session',
    v_session.id, to_jsonb(v_session), 'multi_location_count_created',
    jsonb_build_object('locationCount', array_length(p_location_ids, 1))
  );
  return jsonb_build_object('status', 'draft', 'countSessionId', v_session.id, 'idempotent', false);
end;
$$;

create or replace function public.inventory_save_count_session_line(
  p_stock_count_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count public.inventory_stock_counts%rowtype;
  v_session public.inventory_count_sessions%rowtype;
  v_item public.inventory_ingredients%rowtype;
  v_expected numeric;
  v_line public.inventory_stock_count_lines%rowtype;
  v_source_quantity numeric := nullif(p_payload ->> 'sourceQuantity', '')::numeric;
  v_conversion numeric := nullif(p_payload ->> 'conversionFactor', '')::numeric;
  v_normalized_quantity numeric := nullif(p_payload ->> 'normalizedQuantity', '')::numeric;
begin
  select * into v_count from public.inventory_stock_counts where id = p_stock_count_id for update;
  select * into v_session from public.inventory_count_sessions where id = v_count.count_session_id for update;
  if not found or not public.inventory_branch_allowed(v_count.branch_id)
    or v_count.created_by <> auth.uid()
    or v_count.status not in ('draft', 'in_progress')
    or v_session.status not in ('draft', 'in_progress')
  then
    raise exception 'Count line update denied' using errcode = '42501';
  end if;
  select * into v_item from public.inventory_ingredients
  where id = nullif(p_payload ->> 'ingredientId', '')::uuid
    and active and (scope = 'network' or branch_id = v_count.branch_id);
  if not found or p_payload ->> 'canonicalUnit' <> v_item.base_inventory_unit then
    raise exception 'Count item or canonical unit is invalid' using errcode = '23514';
  end if;
  if v_source_quantity is null or v_source_quantity < 0
    or v_conversion is null or v_conversion <= 0
    or v_normalized_quantity is null or v_normalized_quantity < 0
    or abs(v_normalized_quantity - (v_source_quantity * v_conversion)) > 0.00000001
    or nullif(trim(p_payload ->> 'sourceUnit'), '') is null
  then
    raise exception 'Count source quantity, conversion, normalized quantity, and unit are inconsistent'
      using errcode = '23514';
  end if;
  select coalesce(sum(m.signed_canonical_quantity), 0) into v_expected
  from public.inventory_movements m
  where m.branch_id = v_count.branch_id
    and m.storage_location_id = v_count.storage_location_id
    and m.ingredient_id = v_item.id
    and m.status = 'posted'
    and m.effective_at <= v_count.effective_at;
  insert into public.inventory_stock_count_lines (
    stock_count_id, ingredient_id, expected_quantity, counted_quantity,
    canonical_unit, source_counted_quantity, source_count_unit,
    conversion_factor, expected_snapshot_at, evidence_metadata, notes
  ) values (
    v_count.id, v_item.id, v_expected,
    v_normalized_quantity, v_item.base_inventory_unit,
    v_source_quantity, p_payload ->> 'sourceUnit',
    v_conversion, v_count.effective_at,
    coalesce(p_payload -> 'evidence', '{}'::jsonb), nullif(p_payload ->> 'notes', '')
  )
  on conflict (stock_count_id, ingredient_id) do update set
    expected_quantity = excluded.expected_quantity,
    counted_quantity = excluded.counted_quantity,
    canonical_unit = excluded.canonical_unit,
    source_counted_quantity = excluded.source_counted_quantity,
    source_count_unit = excluded.source_count_unit,
    conversion_factor = excluded.conversion_factor,
    expected_snapshot_at = excluded.expected_snapshot_at,
    evidence_metadata = excluded.evidence_metadata,
    notes = excluded.notes
  returning * into v_line;
  update public.inventory_stock_counts set status = 'in_progress' where id = v_count.id;
  update public.inventory_count_sessions set status = 'in_progress' where id = v_session.id;
  insert into public.inventory_audit_log (
    event_type, actor_id, branch_id, entity_type, entity_id, new_value, reason, metadata
  ) values (
    'count_session_line_saved', auth.uid(), v_count.branch_id,
    'inventory_stock_count_line', v_line.id, to_jsonb(v_line),
    'location_count_entry',
    jsonb_build_object(
      'countSessionId', v_session.id,
      'stockCountId', v_count.id,
      'storageLocationId', v_count.storage_location_id
    )
  );
  return jsonb_build_object(
    'status', 'saved', 'countSessionId', v_session.id,
    'stockCountId', v_count.id, 'countLineId', v_line.id,
    'warnings', v_line.guardrail_warnings
  );
end;
$$;

create or replace function public.inventory_transition_count_session(
  p_count_session_id uuid,
  p_target_status text,
  p_reason text,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.inventory_count_sessions%rowtype;
  v_count public.inventory_stock_counts%rowtype;
begin
  if nullif(trim(p_reason), '') is null then
    raise exception 'A count-session transition reason is required' using errcode = '22023';
  end if;
  select * into v_session from public.inventory_count_sessions where id = p_count_session_id for update;
  if not found or not public.inventory_branch_allowed(v_session.branch_id) then
    raise exception 'Count session not found or access denied' using errcode = '42501';
  end if;
  if v_session.status = p_target_status then
    return jsonb_build_object('status', v_session.status, 'countSessionId', v_session.id, 'idempotent', true);
  end if;
  if p_target_status = 'submitted' then
    if v_session.status not in ('draft', 'in_progress') then
      raise exception 'Count session cannot be submitted from %', v_session.status using errcode = '55000';
    end if;
    for v_count in select * from public.inventory_stock_counts where count_session_id = v_session.id
    loop
      perform public.inventory_submit_stock_count(v_count.id);
    end loop;
    update public.inventory_count_sessions
    set status = 'submitted', submitted_by = auth.uid(), submitted_at = now()
    where id = v_session.id;
  elsif p_target_status = 'reviewed' then
    if v_session.status <> 'submitted' or not public.inventory_can_approve(v_session.branch_id) then
      raise exception 'Count session review denied' using errcode = '42501';
    end if;
    update public.inventory_stock_counts set status = 'reviewed'
    where count_session_id = v_session.id and status = 'submitted';
    update public.inventory_count_sessions
    set status = 'reviewed', reviewed_by = auth.uid(), reviewed_at = now()
    where id = v_session.id;
  elsif p_target_status = 'approved' then
    if v_session.status <> 'reviewed' or not public.inventory_can_approve(v_session.branch_id) then
      raise exception 'Count session approval denied' using errcode = '42501';
    end if;
    update public.inventory_stock_counts set status = 'approved'
    where count_session_id = v_session.id and status = 'reviewed';
    update public.inventory_count_sessions
    set status = 'approved', approved_by = auth.uid(), approved_at = now()
    where id = v_session.id;
  elsif p_target_status = 'posted' then
    if v_session.status <> 'approved' or not public.inventory_can_approve(v_session.branch_id) then
      raise exception 'Count session posting denied' using errcode = '42501';
    end if;
    for v_count in select * from public.inventory_stock_counts where count_session_id = v_session.id
    loop
      perform public.inventory_approve_stock_count(
        v_count.id,
        coalesce(p_idempotency_key, 'count-session:' || v_session.id) || ':count:' || v_count.id
      );
    end loop;
    update public.inventory_count_sessions set status = 'posted' where id = v_session.id;
  elsif p_target_status = 'cancelled' then
    if v_session.status not in ('draft', 'in_progress', 'submitted', 'reviewed', 'approved')
      or not public.inventory_can_approve(v_session.branch_id)
    then
      raise exception 'Count session cancellation denied' using errcode = '42501';
    end if;
    update public.inventory_stock_counts set status = 'cancelled'
    where count_session_id = v_session.id and status <> 'posted';
    update public.inventory_count_sessions set status = 'cancelled' where id = v_session.id;
  else
    raise exception 'Unsupported count session transition %', p_target_status using errcode = '22023';
  end if;
  insert into public.inventory_audit_log (
    event_type, actor_id, branch_id, entity_type, entity_id, new_value, reason
  ) values (
    'count_session_status_changed', auth.uid(), v_session.branch_id,
    'inventory_count_session', v_session.id,
    jsonb_build_object('status', p_target_status), p_reason
  );
  return jsonb_build_object('status', p_target_status, 'countSessionId', v_session.id, 'idempotent', false);
end;
$$;

alter table public.inventory_transfers enable row level security;
alter table public.inventory_transfer_lines enable row level security;
alter table public.inventory_count_sessions enable row level security;
revoke all on public.inventory_transfers from anon, authenticated;
revoke all on public.inventory_transfer_lines from anon, authenticated;
revoke all on public.inventory_count_sessions from anon, authenticated;
grant select on public.inventory_transfers to authenticated;
grant select on public.inventory_transfer_lines to authenticated;
grant select on public.inventory_count_sessions to authenticated;
grant select on public.inventory_count_session_item_totals to authenticated;

create policy inventory_transfers_branch on public.inventory_transfers
for select to authenticated using (
  public.inventory_branch_allowed(source_branch_id)
  or public.inventory_branch_allowed(destination_branch_id)
);
create policy inventory_transfer_lines_branch on public.inventory_transfer_lines
for select to authenticated using (exists (
  select 1 from public.inventory_transfers t where t.id = transfer_id
    and (
      public.inventory_branch_allowed(t.source_branch_id)
      or public.inventory_branch_allowed(t.destination_branch_id)
    )
));
create policy inventory_count_sessions_branch on public.inventory_count_sessions
for select to authenticated using (public.inventory_branch_allowed(branch_id));

revoke all on function public.inventory_create_transfer_request(jsonb, jsonb, text) from public;
revoke execute on function public.inventory_create_transfer(jsonb, text) from authenticated;
revoke all on function public.inventory_transition_transfer(uuid, text, text) from public;
revoke all on function public.inventory_dispatch_transfer(uuid, jsonb, text, text) from public;
revoke all on function public.inventory_receive_transfer(uuid, jsonb, text, text) from public;
revoke all on function public.inventory_create_count_session(jsonb, uuid[], text) from public;
revoke all on function public.inventory_save_count_session_line(uuid, jsonb) from public;
revoke all on function public.inventory_transition_count_session(uuid, text, text, text) from public;
revoke all on function public.inventory_guard_session_count_posting() from public;
grant execute on function public.inventory_create_transfer_request(jsonb, jsonb, text) to authenticated;
grant execute on function public.inventory_transition_transfer(uuid, text, text) to authenticated;
grant execute on function public.inventory_dispatch_transfer(uuid, jsonb, text, text) to authenticated;
grant execute on function public.inventory_receive_transfer(uuid, jsonb, text, text) to authenticated;
grant execute on function public.inventory_create_count_session(jsonb, uuid[], text) to authenticated;
grant execute on function public.inventory_save_count_session_line(uuid, jsonb) to authenticated;
grant execute on function public.inventory_transition_count_session(uuid, text, text, text) to authenticated;
