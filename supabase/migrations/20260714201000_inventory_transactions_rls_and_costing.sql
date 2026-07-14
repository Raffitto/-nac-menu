-- Transactional posting, immutable ledger, historical costing, and branch RLS.

create or replace function public.inventory_branch_allowed(p_branch_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_branch_id in ('khobar', 'riyadh', 'jeddah')
    and public.ask_nac_vault_branch_allowed(p_branch_id);
$$;

create or replace function public.inventory_can_approve(p_branch_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.inventory_branch_allowed(p_branch_id)
    and public.ask_nac_vault_role() in (
      'ceo', 'super_admin', 'ops_manager', 'branch_manager', 'cost_controller'
    );
$$;

revoke all on function public.inventory_branch_allowed(text) from public;
revoke all on function public.inventory_can_approve(text) from public;
grant execute on function public.inventory_branch_allowed(text) to authenticated;
grant execute on function public.inventory_can_approve(text) to authenticated;

create or replace function public.inventory_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'inventory_ingredients', 'inventory_suppliers', 'inventory_storage_locations',
    'inventory_supplier_catalogue_items', 'inventory_invoices', 'inventory_invoice_lines',
    'inventory_purchase_receipts', 'inventory_recipes'
  ]
  loop
    execute format('drop trigger if exists %I on public.%I', v_table || '_touch_updated_at', v_table);
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.inventory_touch_updated_at()',
      v_table || '_touch_updated_at',
      v_table
    );
  end loop;
end;
$$;

create or replace function public.inventory_prevent_posted_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Posted inventory records are immutable; create a reversal or correction'
    using errcode = '55000';
end;
$$;

drop trigger if exists inventory_movements_immutable on public.inventory_movements;
create trigger inventory_movements_immutable
before update or delete on public.inventory_movements
for each row execute function public.inventory_prevent_posted_mutation();

drop trigger if exists inventory_receipt_lines_immutable on public.inventory_purchase_receipt_lines;
create trigger inventory_receipt_lines_immutable
before update or delete on public.inventory_purchase_receipt_lines
for each row execute function public.inventory_prevent_posted_mutation();

create or replace function public.inventory_stock_as_of(
  p_branch_id text,
  p_as_of timestamptz,
  p_storage_location_id uuid default null,
  p_ingredient_id uuid default null
)
returns table (
  branch_id text,
  storage_location_id uuid,
  ingredient_id uuid,
  canonical_unit text,
  canonical_quantity numeric,
  inventory_value numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.inventory_branch_allowed(p_branch_id) then
    raise exception 'Inventory branch access denied' using errcode = '42501';
  end if;

  return query
  select
    m.branch_id,
    m.storage_location_id,
    m.ingredient_id,
    m.canonical_unit,
    sum(m.signed_canonical_quantity),
    sum(m.signed_canonical_quantity) * coalesce((
      select h.weighted_average_cost
      from public.inventory_ingredient_cost_history h
      where h.branch_id = m.branch_id
        and h.ingredient_id = m.ingredient_id
        and h.effective_at <= p_as_of
      order by h.effective_at desc, h.recorded_at desc
      limit 1
    ), 0)
  from public.inventory_movements m
  where m.branch_id = p_branch_id
    and m.status = 'posted'
    and m.effective_at <= p_as_of
    and (p_storage_location_id is null or m.storage_location_id = p_storage_location_id)
    and (p_ingredient_id is null or m.ingredient_id = p_ingredient_id)
  group by m.branch_id, m.storage_location_id, m.ingredient_id, m.canonical_unit;
end;
$$;

revoke all on function public.inventory_stock_as_of(text, timestamptz, uuid, uuid) from public;
grant execute on function public.inventory_stock_as_of(text, timestamptz, uuid, uuid) to authenticated;

create or replace function public.inventory_generate_match_candidates(p_invoice_line_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_line public.inventory_invoice_lines%rowtype;
  v_supplier_id uuid;
  v_candidates jsonb;
begin
  select l.*
  into v_line
  from public.inventory_invoice_lines l
  join public.inventory_invoices i on i.id = l.invoice_id
  where l.id = p_invoice_line_id
    and public.inventory_branch_allowed(i.branch_id);

  if not found then
    raise exception 'Invoice line not found or access denied' using errcode = '42501';
  end if;
  select i.supplier_id into v_supplier_id
  from public.inventory_invoices i
  where i.id = v_line.invoice_id;

  with ranked as (
    select
      c.ingredient_id,
      c.id as supplier_catalogue_item_id,
      case
        when v_line.supplier_sku is not null
          and lower(c.supplier_sku) = lower(v_line.supplier_sku)
          then case when c.verification_state = 'verified' then 1.0 else 0.96 end
        when exists (
          select 1
          from public.inventory_supplier_item_aliases a
          where a.catalogue_item_id = c.id
            and a.verification_state = 'verified'
            and a.normalized_description = public.inventory_normalize_text(v_line.original_description)
        ) then 0.99
        else greatest(
          similarity(c.normalized_product_name, public.inventory_normalize_text(v_line.original_description)) * 0.90,
          similarity(ing.normalized_search_name, public.inventory_normalize_text(v_line.original_description)) * 0.75
        )
      end as confidence,
      case
        when v_line.supplier_sku is not null
          and lower(c.supplier_sku) = lower(v_line.supplier_sku) then 'exact_supplier_sku'
        when exists (
          select 1 from public.inventory_supplier_item_aliases a
          where a.catalogue_item_id = c.id
            and a.verification_state = 'verified'
            and a.normalized_description = public.inventory_normalize_text(v_line.original_description)
        ) then 'exact_verified_alias'
        else 'supplier_catalogue_similarity'
      end as method,
      jsonb_build_array(
        case when v_line.supplier_sku is not null and lower(c.supplier_sku) = lower(v_line.supplier_sku)
          then 'supplier_sku' else 'token_similarity' end,
        'supplier_catalogue'
      ) as signals
    from public.inventory_supplier_catalogue_items c
    join public.inventory_ingredients ing on ing.id = c.ingredient_id
    where c.supplier_id = v_supplier_id and c.active
  ),
  top_candidates as (
    select *
    from ranked
    where confidence >= 0.20
    order by confidence desc
    limit 5
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'ingredientId', ingredient_id,
    'supplierCatalogueItemId', supplier_catalogue_item_id,
    'confidence', round(confidence::numeric, 4),
    'method', method,
    'signals', signals,
    'requiresHumanReview', confidence < 0.95
  ) order by confidence desc), '[]'::jsonb)
  into v_candidates
  from top_candidates;

  update public.inventory_invoice_lines
  set match_candidates = v_candidates,
      updated_at = now()
  where id = p_invoice_line_id;

  return v_candidates;
end;
$$;

create or replace function public.inventory_verify_supplier_alias(
  p_supplier_id uuid,
  p_catalogue_item_id uuid,
  p_supplier_sku text,
  p_original_description text,
  p_reason text default 'invoice_review'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_alias_id uuid;
begin
  if v_actor is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if not exists (
    select 1
    from public.inventory_supplier_catalogue_items c
    join public.inventory_supplier_branches sb on sb.supplier_id = c.supplier_id and sb.active
    where c.id = p_catalogue_item_id
      and c.supplier_id = p_supplier_id
      and public.inventory_branch_allowed(sb.branch_id)
  ) then
    raise exception 'Supplier catalogue access denied' using errcode = '42501';
  end if;

  insert into public.inventory_supplier_item_aliases (
    supplier_id, catalogue_item_id, supplier_sku, original_description,
    normalized_description, verification_state, confidence,
    created_by, verified_by, verified_at
  ) values (
    p_supplier_id, p_catalogue_item_id, p_supplier_sku, p_original_description,
    public.inventory_normalize_text(p_original_description), 'verified', 1,
    v_actor, v_actor, now()
  )
  on conflict (supplier_id, normalized_description, (coalesce(supplier_sku, '')))
    where verification_state in ('suggested', 'verified')
  do update set
    catalogue_item_id = excluded.catalogue_item_id,
    original_description = excluded.original_description,
    verification_state = 'verified',
    confidence = 1,
    verified_by = v_actor,
    verified_at = now(),
    retired_at = null
  returning id into v_alias_id;

  insert into public.inventory_audit_log (
    event_type, actor_id, entity_type, entity_id, new_value, reason
  ) values (
    'ingredient_matched', v_actor, 'supplier_alias', v_alias_id,
    jsonb_build_object('supplierId', p_supplier_id, 'catalogueItemId', p_catalogue_item_id),
    p_reason
  );
  return v_alias_id;
end;
$$;

create or replace function public.inventory_confirm_line_mapping(
  p_invoice_line_id uuid,
  p_ingredient_id uuid,
  p_catalogue_item_id uuid,
  p_conversion_factor numeric,
  p_canonical_quantity numeric,
  p_canonical_unit text,
  p_create_verified_alias boolean default true,
  p_reason text default 'manual_review'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line public.inventory_invoice_lines%rowtype;
  v_invoice public.inventory_invoices%rowtype;
  v_actor uuid := auth.uid();
  v_previous jsonb;
begin
  select * into v_line from public.inventory_invoice_lines where id = p_invoice_line_id for update;
  select * into v_invoice from public.inventory_invoices where id = v_line.invoice_id;
  if v_actor is null or not public.inventory_branch_allowed(v_invoice.branch_id) then
    raise exception 'Invoice line access denied' using errcode = '42501';
  end if;
  if v_invoice.status in ('posted', 'rejected', 'cancelled') then
    raise exception 'Finalized invoice cannot be edited' using errcode = '55000';
  end if;
  if p_conversion_factor <= 0 or p_canonical_quantity <= 0 then
    raise exception 'Conversion factor and canonical quantity must be positive' using errcode = '22023';
  end if;
  if p_canonical_unit not in ('each', 'gram', 'kilogram', 'millilitre', 'litre') then
    raise exception 'Unsupported canonical unit' using errcode = '22023';
  end if;

  v_previous := to_jsonb(v_line);
  update public.inventory_invoice_lines
  set ingredient_id = p_ingredient_id,
      supplier_catalogue_item_id = p_catalogue_item_id,
      conversion_factor = p_conversion_factor,
      canonical_received_quantity = p_canonical_quantity,
      canonical_unit = p_canonical_unit,
      matching_confidence = 1,
      match_method = 'manual_review',
      manually_overridden = true,
      verified_by = v_actor,
      verified_at = now(),
      review_status = 'verified',
      manual_overrides = manual_overrides || jsonb_build_object(
        'mapping', jsonb_build_object('actorId', v_actor, 'reason', p_reason, 'at', now())
      )
  where id = p_invoice_line_id
  returning * into v_line;

  update public.inventory_invoice_exceptions
  set status = 'resolved', resolved_by = v_actor, resolved_at = now(), resolution_reason = p_reason
  where invoice_line_id = p_invoice_line_id
    and status = 'open'
    and exception_type in ('unknown_ingredient', 'low_match_confidence', 'unit_ambiguity', 'pack_size_ambiguity');

  if p_create_verified_alias and p_catalogue_item_id is not null and v_invoice.supplier_id is not null then
    perform public.inventory_verify_supplier_alias(
      v_invoice.supplier_id, p_catalogue_item_id, v_line.supplier_sku,
      v_line.original_description, p_reason
    );
  end if;

  insert into public.inventory_audit_log (
    event_type, actor_id, branch_id, entity_type, entity_id,
    previous_value, new_value, reason
  ) values (
    'match_overridden', v_actor, v_invoice.branch_id, 'invoice_line', v_line.id,
    v_previous, to_jsonb(v_line), p_reason
  );
  return to_jsonb(v_line);
end;
$$;

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

create or replace function public.inventory_update_invoice_review(
  p_invoice_id uuid,
  p_patch jsonb,
  p_reason text default 'review_correction'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before public.inventory_invoices%rowtype;
  v_after public.inventory_invoices%rowtype;
begin
  select * into v_before from public.inventory_invoices where id = p_invoice_id for update;
  if not public.inventory_branch_allowed(v_before.branch_id) then
    raise exception 'Invoice access denied' using errcode = '42501';
  end if;
  if v_before.status in ('posted', 'rejected', 'cancelled') then
    raise exception 'Finalized invoice cannot be edited' using errcode = '55000';
  end if;

  update public.inventory_invoices
  set supplier_id = coalesce((p_patch ->> 'supplierId')::uuid, supplier_id),
      invoice_number = coalesce(p_patch ->> 'invoiceNumber', invoice_number),
      invoice_date = coalesce((p_patch ->> 'invoiceDate')::date, invoice_date),
      delivery_date = coalesce((p_patch ->> 'deliveryDate')::date, delivery_date),
      effective_receipt_date = coalesce((p_patch ->> 'effectiveReceiptDate')::date, effective_receipt_date),
      purchase_order_reference = coalesce(p_patch ->> 'purchaseOrderReference', purchase_order_reference),
      currency = coalesce(p_patch ->> 'currency', currency),
      subtotal = coalesce((p_patch ->> 'subtotal')::numeric, subtotal),
      discount = coalesce((p_patch ->> 'discount')::numeric, discount),
      tax = coalesce((p_patch ->> 'tax')::numeric, tax),
      total = coalesce((p_patch ->> 'total')::numeric, total),
      notes = coalesce(p_patch ->> 'notes', notes),
      reviewer_id = auth.uid(),
      reviewed_at = now()
  where id = p_invoice_id
  returning * into v_after;

  insert into public.inventory_audit_log (
    event_type, actor_id, branch_id, entity_type, entity_id, previous_value, new_value, reason
  ) values (
    case when v_before.supplier_id is distinct from v_after.supplier_id then 'supplier_changed' else 'invoice_reviewed' end,
    auth.uid(), v_after.branch_id, 'invoice', p_invoice_id,
    to_jsonb(v_before), to_jsonb(v_after), p_reason
  );
  return to_jsonb(v_after);
end;
$$;

create or replace function public.inventory_reject_invoice(
  p_invoice_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice public.inventory_invoices%rowtype;
begin
  select * into v_invoice from public.inventory_invoices where id = p_invoice_id for update;
  if not public.inventory_branch_allowed(v_invoice.branch_id) then
    raise exception 'Invoice access denied' using errcode = '42501';
  end if;
  if v_invoice.status = 'posted' then
    raise exception 'Posted invoice must be reversed, not rejected' using errcode = '55000';
  end if;
  if v_invoice.status in ('rejected', 'cancelled') then
    return jsonb_build_object('status', v_invoice.status, 'invoiceId', p_invoice_id, 'idempotent', true);
  end if;
  update public.inventory_invoices
  set status = 'rejected', approval_status = 'rejected',
      reviewer_id = auth.uid(), reviewed_at = now(),
      notes = concat_ws(E'\n', notes, 'Rejected: ' || p_reason)
  where id = p_invoice_id;
  insert into public.inventory_audit_log (
    event_type, actor_id, branch_id, entity_type, entity_id, previous_value, new_value, reason
  ) values (
    'invoice_rejected', auth.uid(), v_invoice.branch_id, 'invoice', p_invoice_id,
    to_jsonb(v_invoice), jsonb_build_object('status', 'rejected'), p_reason
  );
  return jsonb_build_object('status', 'rejected', 'invoiceId', p_invoice_id, 'idempotent', false);
end;
$$;

create or replace function public.inventory_acknowledge_price_variance(
  p_alert_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_alert public.inventory_price_variance_alerts%rowtype;
begin
  select * into v_alert from public.inventory_price_variance_alerts where id = p_alert_id for update;
  if not public.inventory_can_approve(v_alert.branch_id) then
    raise exception 'Price variance acknowledgment denied' using errcode = '42501';
  end if;
  update public.inventory_price_variance_alerts
  set status = 'acknowledged', acknowledged_by = auth.uid(), acknowledged_at = now()
  where id = p_alert_id;
  insert into public.inventory_audit_log (
    event_type, actor_id, branch_id, entity_type, entity_id, previous_value, new_value, reason
  ) values (
    'price_acknowledged', auth.uid(), v_alert.branch_id, 'price_variance_alert', p_alert_id,
    to_jsonb(v_alert), jsonb_build_object('status', 'acknowledged'), p_reason
  );
  return jsonb_build_object('status', 'acknowledged', 'alertId', p_alert_id);
end;
$$;

create or replace function public.inventory_audit_invoice_upload()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.inventory_audit_log (
    event_type, actor_id, branch_id, entity_type, entity_id, new_value, source
  ) values (
    'invoice_uploaded', new.uploader_id, new.branch_id, 'invoice', new.id,
    jsonb_build_object(
      'sourceFilename', new.source_filename,
      'fileHash', new.file_hash,
      'storagePath', new.storage_path
    ),
    'inventory_upload'
  );
  return new;
end;
$$;

drop trigger if exists inventory_invoice_upload_audit on public.inventory_invoices;
create trigger inventory_invoice_upload_audit
after insert on public.inventory_invoices
for each row execute function public.inventory_audit_invoice_upload();

create or replace function public.inventory_recipe_cost_component(
  p_recipe_id uuid,
  p_branch_id text,
  p_as_of timestamptz,
  p_depth integer default 0
)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_total numeric := 0;
  v_output_quantity numeric;
  v_line record;
  v_component_cost numeric;
begin
  if p_depth > 10 then raise exception 'Recipe nesting exceeds 10 levels'; end if;
  if not public.inventory_branch_allowed(p_branch_id) then
    raise exception 'Recipe branch access denied' using errcode = '42501';
  end if;

  select r.output_quantity into v_output_quantity
  from public.inventory_recipes r where r.id = p_recipe_id and r.active;
  if not found then return null; end if;

  for v_line in
    select l.*
    from public.inventory_recipe_versions v
    join public.inventory_recipe_version_lines l on l.recipe_version_id = v.id
    where v.recipe_id = p_recipe_id
      and v.status = 'active'
      and v.effective_from <= p_as_of
      and (v.effective_to is null or v.effective_to > p_as_of)
    order by v.version_number desc
  loop
    if v_line.ingredient_id is not null then
      select h.weighted_average_cost into v_component_cost
      from public.inventory_ingredient_cost_history h
      where h.branch_id = p_branch_id
        and h.ingredient_id = v_line.ingredient_id
        and h.effective_at <= p_as_of
      order by h.effective_at desc, h.recorded_at desc
      limit 1;
      v_component_cost := coalesce(v_component_cost, 0) * v_line.canonical_quantity * v_line.yield_waste_factor;
    else
      v_component_cost := coalesce(public.inventory_recipe_cost_component(
        v_line.sub_recipe_id, p_branch_id, p_as_of, p_depth + 1
      ), 0) * v_line.canonical_quantity * v_line.yield_waste_factor;
    end if;
    v_total := v_total + v_component_cost;
  end loop;
  return v_total / nullif(v_output_quantity, 0);
end;
$$;

create or replace function public.inventory_recipe_cost_as_of(
  p_recipe_id uuid,
  p_as_of timestamptz default null
)
returns table (
  branch_id text,
  recipe_id uuid,
  effective_at timestamptz,
  output_unit_cost numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_branch text;
  v_as_of timestamptz := coalesce(p_as_of, now());
begin
  select coalesce(r.branch_id, s.primary_branch_id)
  into v_branch
  from public.inventory_recipes r
  left join public.ask_nac_staff s
    on lower(s.email) = public.ask_nac_vault_auth_email()
  where r.id = p_recipe_id;
  if v_branch is null then
    raise exception 'Branch is required for network recipe costing';
  end if;
  return query select v_branch, p_recipe_id, v_as_of,
    public.inventory_recipe_cost_component(p_recipe_id, v_branch, v_as_of, 0);
end;
$$;

create or replace function public.inventory_menu_margin_as_of(
  p_menu_item_id uuid,
  p_branch_id text,
  p_as_of timestamptz default null
)
returns table (
  menu_item_id uuid,
  branch_id text,
  selling_price numeric,
  recipe_cost numeric,
  food_cost_percentage numeric,
  gross_profit numeric,
  gross_margin_percentage numeric,
  effective_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_as_of timestamptz := coalesce(p_as_of, now());
  v_price numeric;
  v_recipe_id uuid;
  v_cost numeric;
  v_net_price numeric;
begin
  if not public.inventory_branch_allowed(p_branch_id) then
    raise exception 'Menu cost branch access denied' using errcode = '42501';
  end if;
  select nullif(regexp_replace(m.price, '[^0-9.]', '', 'g'), '')::numeric
  into v_price from public.menu_items m where m.id = p_menu_item_id;
  select r.id into v_recipe_id
  from public.inventory_recipes r
  where r.menu_item_id = p_menu_item_id
    and r.active
    and (r.branch_id is null or r.branch_id = p_branch_id)
  order by (r.branch_id is not null) desc limit 1;
  v_cost := public.inventory_recipe_cost_component(v_recipe_id, p_branch_id, v_as_of, 0);
  v_net_price := v_price / 1.15;
  return query select p_menu_item_id, p_branch_id, v_price, v_cost,
    case when v_net_price = 0 then null else v_cost / v_net_price * 100 end,
    v_net_price - v_cost,
    case when v_net_price = 0 then null else (v_net_price - v_cost) / v_net_price * 100 end,
    v_as_of;
end;
$$;

create or replace function public.inventory_recalculate_recipe_costs(
  p_branch_id text,
  p_ingredient_id uuid,
  p_effective_at timestamptz,
  p_source_key text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recipe record;
  v_cost numeric;
  v_count integer := 0;
  v_price numeric;
  v_previous numeric;
  v_net numeric;
begin
  for v_recipe in
    select distinct r.id, r.menu_item_id, r.output_quantity, v.id as version_id
    from public.inventory_recipes r
    join public.inventory_recipe_versions v on v.recipe_id = r.id and v.status = 'active'
    join public.inventory_recipe_version_lines l on l.recipe_version_id = v.id
    where r.active and (r.branch_id is null or r.branch_id = p_branch_id)
      and (l.ingredient_id = p_ingredient_id or l.sub_recipe_id is not null)
  loop
    v_cost := public.inventory_recipe_cost_component(v_recipe.id, p_branch_id, p_effective_at, 0);
    insert into public.inventory_recipe_cost_snapshots (
      branch_id, recipe_id, recipe_version_id, total_cost, output_unit_cost,
      effective_at, calculation_details, idempotency_key
    ) values (
      p_branch_id, v_recipe.id, v_recipe.version_id,
      v_cost * v_recipe.output_quantity, v_cost, p_effective_at,
      jsonb_build_object('triggerIngredientId', p_ingredient_id, 'method', 'weighted_average_as_of'),
      p_source_key || ':recipe:' || v_recipe.id
    ) on conflict (idempotency_key) do nothing;

    if v_recipe.menu_item_id is not null then
      select nullif(regexp_replace(m.price, '[^0-9.]', '', 'g'), '')::numeric
      into v_price from public.menu_items m where m.id = v_recipe.menu_item_id;
      select s.recipe_cost into v_previous
      from public.inventory_menu_item_margin_snapshots s
      where s.branch_id = p_branch_id and s.menu_item_id = v_recipe.menu_item_id
      order by s.effective_at desc limit 1;
      v_net := v_price / 1.15;
      insert into public.inventory_menu_item_margin_snapshots (
        branch_id, menu_item_id, recipe_id, selling_price, tax_rate,
        selling_price_includes_tax, recipe_cost, food_cost_percentage,
        gross_profit, gross_margin_percentage, previous_recipe_cost,
        cost_change_percentage, effective_at, idempotency_key
      ) values (
        p_branch_id, v_recipe.menu_item_id, v_recipe.id, v_price, 15, true, v_cost,
        case when v_net = 0 then null else v_cost / v_net * 100 end,
        v_net - v_cost,
        case when v_net = 0 then null else (v_net - v_cost) / v_net * 100 end,
        v_previous,
        case when coalesce(v_previous, 0) = 0 then null else (v_cost - v_previous) / v_previous * 100 end,
        p_effective_at, p_source_key || ':menu:' || v_recipe.menu_item_id
      ) on conflict (idempotency_key) do nothing;
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

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
begin
  if v_actor is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select * into v_invoice from public.inventory_invoices where id = p_invoice_id for update;
  if not found then raise exception 'Invoice not found'; end if;
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
    or v_invoice.effective_receipt_date is null or v_invoice.total is null then
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
        or l.unit_price is null or l.line_total is null
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

  select id into v_location_id
  from public.inventory_storage_locations
  where branch_id = v_invoice.branch_id and is_default_receiving and active
  limit 1;
  if v_location_id is null then
    raise exception 'No default receiving location configured for branch %', v_invoice.branch_id;
  end if;
  v_effective_at := v_invoice.effective_receipt_date::timestamptz;

  insert into public.inventory_purchase_receipts (
    branch_id, supplier_id, invoice_id, purchase_order_reference,
    storage_location_id, effective_at, received_by, approved_by,
    currency, subtotal, discount, tax, total, source_reference, idempotency_key
  ) values (
    v_invoice.branch_id, v_invoice.supplier_id, v_invoice.id,
    v_invoice.purchase_order_reference, v_location_id, v_effective_at,
    v_invoice.uploader_id, v_actor, v_invoice.currency, v_invoice.subtotal,
    v_invoice.discount, v_invoice.tax, v_invoice.total,
    'invoice:' || v_invoice.id, p_idempotency_key
  ) returning * into v_receipt;

  for v_line in
    select * from public.inventory_invoice_lines
    where invoice_id = p_invoice_id and active order by line_number
  loop
    v_unit_cost := greatest(v_line.line_total - v_line.tax_amount, 0)
      / v_line.canonical_received_quantity;

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
    if v_existing_qty <= 0 then
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
      jsonb_build_object('recordedAt', now(), 'pathologicalExistingStock', v_pathological)
    );

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
      jsonb_build_object('pathologicalExistingStock', v_pathological)
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
      last_purchase_price = excluded.last_purchase_price,
      last_purchase_at = excluded.last_purchase_at,
      updated_at = now();

    update public.inventory_supplier_catalogue_items
    set last_purchase_price = v_line.unit_price,
        last_purchase_at = v_effective_at,
        updated_at = now()
    where id = v_line.supplier_catalogue_item_id;

    if v_change is not null and abs(v_change) >= 5 then
      insert into public.inventory_price_variance_alerts (
        branch_id, ingredient_id, supplier_id, invoice_id, invoice_line_id,
        alert_type, previous_value, current_value, percentage_change,
        threshold_percentage, comparison_details
      ) values (
        v_invoice.branch_id, v_line.ingredient_id, v_invoice.supplier_id,
        v_invoice.id, v_line.id,
        case when v_change >= 0 then 'price_increase' else 'price_decrease' end,
        v_previous_price, v_unit_cost, v_change, 5,
        jsonb_build_object('canonicalUnit', v_line.canonical_unit)
      );
    end if;

    perform public.inventory_recalculate_recipe_costs(
      v_invoice.branch_id, v_line.ingredient_id, v_effective_at,
      p_idempotency_key || ':costing:' || v_line.id
    );
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
  v_type text;
  v_quantity numeric := (p_payload ->> 'canonicalQuantity')::numeric;
  v_movement public.inventory_movements%rowtype;
begin
  if not public.inventory_can_approve(v_branch) then
    raise exception 'Movement creation denied' using errcode = '42501';
  end if;
  v_type := case p_action
    when 'wastage' then 'wastage'
    when 'manual_adjustment' then 'manual_adjustment'
    when 'return_to_supplier' then 'return_to_supplier'
    when 'staff_meal' then 'staff_meal'
    when 'complimentary' then 'complimentary'
    when 'production' then case when v_quantity >= 0 then 'production_in' else 'production_out' end
    else null end;
  if v_type is null then raise exception 'Unsupported movement action'; end if;
  if p_action not in ('manual_adjustment', 'production') then v_quantity := -abs(v_quantity); end if;
  if v_quantity = 0 then raise exception 'Movement quantity cannot be zero'; end if;

  select * into v_movement from public.inventory_movements where idempotency_key = p_idempotency_key;
  if found then return jsonb_build_object('status', 'already_posted', 'movementId', v_movement.id); end if;

  insert into public.inventory_movements (
    branch_id, storage_location_id, ingredient_id, movement_type,
    signed_canonical_quantity, canonical_unit, effective_at, actor_id,
    source_type, source_id, supplier_id, idempotency_key, notes, metadata
  ) values (
    v_branch, (p_payload ->> 'locationId')::uuid, (p_payload ->> 'ingredientId')::uuid,
    v_type, v_quantity, p_payload ->> 'canonicalUnit',
    (p_payload ->> 'effectiveAt')::timestamptz, auth.uid(),
    p_action, nullif(p_payload ->> 'sourceId', '')::uuid,
    nullif(p_payload ->> 'supplierId', '')::uuid, p_idempotency_key,
    p_payload ->> 'notes', p_payload
  ) returning * into v_movement;
  insert into public.inventory_audit_log (
    event_type, actor_id, branch_id, entity_type, entity_id, new_value, reason
  ) values (
    'movement_created', auth.uid(), v_branch, 'inventory_movement',
    v_movement.id, to_jsonb(v_movement), p_payload ->> 'reason'
  );
  return jsonb_build_object('status', 'posted', 'movementId', v_movement.id);
end;
$$;

create or replace function public.inventory_create_transfer(
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
  v_quantity numeric := abs((p_payload ->> 'canonicalQuantity')::numeric);
  v_out_id uuid;
  v_in_id uuid;
begin
  if not public.inventory_can_approve(v_branch) then
    raise exception 'Transfer denied' using errcode = '42501';
  end if;
  select id into v_out_id from public.inventory_movements where idempotency_key = p_idempotency_key || ':out';
  select id into v_in_id from public.inventory_movements where idempotency_key = p_idempotency_key || ':in';
  if v_out_id is not null and v_in_id is not null then
    return jsonb_build_object('status', 'already_posted', 'transferOutId', v_out_id, 'transferInId', v_in_id);
  end if;
  insert into public.inventory_movements (
    branch_id, storage_location_id, ingredient_id, movement_type,
    signed_canonical_quantity, canonical_unit, effective_at, actor_id,
    source_type, idempotency_key, notes, metadata
  ) values (
    v_branch, (p_payload ->> 'fromLocationId')::uuid, (p_payload ->> 'ingredientId')::uuid,
    'transfer_out', -v_quantity, p_payload ->> 'canonicalUnit',
    (p_payload ->> 'effectiveAt')::timestamptz, auth.uid(),
    'transfer', p_idempotency_key || ':out', p_payload ->> 'notes', p_payload
  ) returning id into v_out_id;
  insert into public.inventory_movements (
    branch_id, storage_location_id, ingredient_id, movement_type,
    signed_canonical_quantity, canonical_unit, effective_at, actor_id,
    source_type, source_id, idempotency_key, notes, metadata
  ) values (
    v_branch, (p_payload ->> 'toLocationId')::uuid, (p_payload ->> 'ingredientId')::uuid,
    'transfer_in', v_quantity, p_payload ->> 'canonicalUnit',
    (p_payload ->> 'effectiveAt')::timestamptz, auth.uid(),
    'transfer', v_out_id, p_idempotency_key || ':in', p_payload ->> 'notes', p_payload
  ) returning id into v_in_id;
  return jsonb_build_object('status', 'posted', 'transferOutId', v_out_id, 'transferInId', v_in_id);
end;
$$;

create or replace function public.inventory_reverse_movement(
  p_movement_id uuid,
  p_corrected_quantity numeric,
  p_reason text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_original public.inventory_movements%rowtype;
  v_reversal_id uuid;
  v_correction_id uuid;
begin
  select * into v_original from public.inventory_movements where id = p_movement_id;
  if not public.inventory_can_approve(v_original.branch_id) then
    raise exception 'Movement correction denied' using errcode = '42501';
  end if;
  select id into v_reversal_id from public.inventory_movements where idempotency_key = p_idempotency_key || ':reversal';
  if v_reversal_id is not null then
    return jsonb_build_object('status', 'already_posted', 'reversalId', v_reversal_id);
  end if;
  insert into public.inventory_movements (
    branch_id, storage_location_id, ingredient_id, movement_type,
    signed_canonical_quantity, canonical_unit, original_quantity, original_unit,
    conversion_factor, unit_cost, total_cost, effective_at, actor_id,
    source_type, source_id, invoice_id, receipt_id, supplier_id,
    idempotency_key, notes, metadata, reversal_of_movement_id
  ) values (
    v_original.branch_id, v_original.storage_location_id, v_original.ingredient_id, 'correction',
    -v_original.signed_canonical_quantity, v_original.canonical_unit,
    v_original.original_quantity, v_original.original_unit, v_original.conversion_factor,
    v_original.unit_cost, -coalesce(v_original.total_cost, 0), now(), auth.uid(),
    'movement_reversal', v_original.id, v_original.invoice_id, v_original.receipt_id,
    v_original.supplier_id, p_idempotency_key || ':reversal', p_reason,
    jsonb_build_object('originalEffectiveAt', v_original.effective_at), v_original.id
  ) returning id into v_reversal_id;
  if p_corrected_quantity is not null and p_corrected_quantity <> 0 then
    insert into public.inventory_movements (
      branch_id, storage_location_id, ingredient_id, movement_type,
      signed_canonical_quantity, canonical_unit, unit_cost, total_cost,
      effective_at, actor_id, source_type, source_id, idempotency_key, notes, metadata
    ) values (
      v_original.branch_id, v_original.storage_location_id, v_original.ingredient_id, 'correction',
      p_corrected_quantity, v_original.canonical_unit, v_original.unit_cost,
      p_corrected_quantity * coalesce(v_original.unit_cost, 0), now(), auth.uid(),
      'movement_correction', v_reversal_id, p_idempotency_key || ':corrected',
      p_reason, jsonb_build_object('replacesMovementId', v_original.id)
    ) returning id into v_correction_id;
  end if;
  insert into public.inventory_audit_log (
    event_type, actor_id, branch_id, entity_type, entity_id, new_value, reason
  ) values (
    'correction_created', auth.uid(), v_original.branch_id, 'inventory_movement',
    v_reversal_id, jsonb_build_object('originalMovementId', v_original.id, 'correctionId', v_correction_id), p_reason
  );
  return jsonb_build_object('status', 'posted', 'reversalId', v_reversal_id, 'correctionId', v_correction_id);
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
begin
  select * into v_count from public.inventory_stock_counts where id = p_count_id for update;
  if not public.inventory_can_approve(v_count.branch_id) then
    raise exception 'Stock count approval denied' using errcode = '42501';
  end if;
  if v_count.status = 'posted' then
    return jsonb_build_object('status', 'already_posted', 'countId', p_count_id);
  end if;
  if v_count.status not in ('draft', 'submitted', 'approved') then
    raise exception 'Stock count cannot be approved from status %', v_count.status;
  end if;
  for v_line in select * from public.inventory_stock_count_lines where stock_count_id = p_count_id
  loop
    if v_line.variance_quantity <> 0 then
      insert into public.inventory_movements (
        branch_id, storage_location_id, ingredient_id, movement_type,
        signed_canonical_quantity, canonical_unit, effective_at, actor_id,
        source_type, source_id, idempotency_key, metadata
      ) values (
        v_count.branch_id, v_count.storage_location_id, v_line.ingredient_id,
        'physical_count_adjustment', v_line.variance_quantity, v_line.canonical_unit,
        v_count.effective_at, auth.uid(), 'stock_count', v_count.id,
        p_idempotency_key || ':line:' || v_line.id,
        jsonb_build_object('expected', v_line.expected_quantity, 'counted', v_line.counted_quantity)
      ) returning id into v_movement_id;
      update public.inventory_stock_count_lines
      set adjustment_movement_id = v_movement_id where id = v_line.id;
    end if;
  end loop;
  update public.inventory_stock_counts
  set status = 'posted', approved_by = auth.uid(), approved_at = now()
  where id = p_count_id;
  return jsonb_build_object('status', 'posted', 'countId', p_count_id);
end;
$$;

revoke all on function public.inventory_generate_match_candidates(uuid) from public;
revoke all on function public.inventory_verify_supplier_alias(uuid, uuid, text, text, text) from public;
revoke all on function public.inventory_confirm_line_mapping(uuid, uuid, uuid, numeric, numeric, text, boolean, text) from public;
revoke all on function public.inventory_update_invoice_line(uuid, uuid, jsonb, text) from public;
revoke all on function public.inventory_update_invoice_review(uuid, jsonb, text) from public;
revoke all on function public.inventory_reject_invoice(uuid, text) from public;
revoke all on function public.inventory_acknowledge_price_variance(uuid, text) from public;
revoke all on function public.inventory_recipe_cost_as_of(uuid, timestamptz) from public;
revoke all on function public.inventory_menu_margin_as_of(uuid, text, timestamptz) from public;
revoke all on function public.inventory_approve_and_post_invoice(uuid, text) from public;
revoke all on function public.inventory_create_operational_movement(text, jsonb, text) from public;
revoke all on function public.inventory_create_transfer(jsonb, text) from public;
revoke all on function public.inventory_reverse_movement(uuid, numeric, text, text) from public;
revoke all on function public.inventory_approve_stock_count(uuid, text) from public;

grant execute on function public.inventory_generate_match_candidates(uuid) to authenticated;
grant execute on function public.inventory_verify_supplier_alias(uuid, uuid, text, text, text) to authenticated;
grant execute on function public.inventory_confirm_line_mapping(uuid, uuid, uuid, numeric, numeric, text, boolean, text) to authenticated;
grant execute on function public.inventory_update_invoice_line(uuid, uuid, jsonb, text) to authenticated;
grant execute on function public.inventory_update_invoice_review(uuid, jsonb, text) to authenticated;
grant execute on function public.inventory_reject_invoice(uuid, text) to authenticated;
grant execute on function public.inventory_acknowledge_price_variance(uuid, text) to authenticated;
grant execute on function public.inventory_recipe_cost_as_of(uuid, timestamptz) to authenticated;
grant execute on function public.inventory_menu_margin_as_of(uuid, text, timestamptz) to authenticated;
grant execute on function public.inventory_approve_and_post_invoice(uuid, text) to authenticated;
grant execute on function public.inventory_create_operational_movement(text, jsonb, text) to authenticated;
grant execute on function public.inventory_create_transfer(jsonb, text) to authenticated;
grant execute on function public.inventory_reverse_movement(uuid, numeric, text, text) to authenticated;
grant execute on function public.inventory_approve_stock_count(uuid, text) to authenticated;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'inventory_ingredients', 'inventory_suppliers', 'inventory_supplier_branches',
    'inventory_storage_locations', 'inventory_supplier_catalogue_items',
    'inventory_supplier_item_aliases', 'inventory_invoices', 'inventory_ocr_requests',
    'inventory_invoice_lines', 'inventory_invoice_exceptions',
    'inventory_purchase_receipts', 'inventory_purchase_receipt_lines',
    'inventory_movements', 'inventory_ingredient_cost_history',
    'inventory_ingredient_cost_state', 'inventory_price_variance_alerts',
    'inventory_recipes', 'inventory_recipe_versions', 'inventory_recipe_version_lines',
    'inventory_recipe_cost_snapshots', 'inventory_menu_item_margin_snapshots',
    'inventory_stock_counts', 'inventory_stock_count_lines', 'inventory_audit_log'
  ]
  loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format('revoke all on public.%I from anon, authenticated', v_table);
    execute format('grant select on public.%I to authenticated', v_table);
  end loop;
end;
$$;

grant insert, update on public.inventory_ingredients to authenticated;
grant insert, update on public.inventory_suppliers to authenticated;
grant insert, update on public.inventory_supplier_branches to authenticated;
grant insert, update on public.inventory_storage_locations to authenticated;
grant insert, update on public.inventory_supplier_catalogue_items to authenticated;
grant insert, update on public.inventory_supplier_item_aliases to authenticated;
grant insert on public.inventory_invoices to authenticated;
grant insert on public.inventory_ocr_requests to authenticated;
grant insert, update on public.inventory_invoice_lines to authenticated;
grant insert, update on public.inventory_invoice_exceptions to authenticated;
grant insert, update on public.inventory_recipes to authenticated;
grant insert, update on public.inventory_recipe_versions to authenticated;
grant insert, update on public.inventory_recipe_version_lines to authenticated;
grant insert on public.inventory_stock_counts to authenticated;
grant insert, update on public.inventory_stock_count_lines to authenticated;

create policy inventory_ingredients_select on public.inventory_ingredients
for select to authenticated using (
  (scope = 'network' and public.ask_nac_vault_has_all_branches())
  or (scope = 'branch' and public.inventory_branch_allowed(branch_id))
  or (scope = 'network' and exists (
    select 1 from public.ask_nac_staff s
    where lower(s.email) = public.ask_nac_vault_auth_email()
      and s.vault_role in ('ceo', 'super_admin', 'ops_manager', 'branch_manager', 'cost_controller')
  ))
);
create policy inventory_ingredients_write on public.inventory_ingredients
for all to authenticated
using (case when branch_id is null then public.ask_nac_vault_has_all_branches() else public.inventory_can_approve(branch_id) end)
with check (case when branch_id is null then public.ask_nac_vault_has_all_branches() else public.inventory_can_approve(branch_id) end);

create policy inventory_suppliers_select on public.inventory_suppliers
for select to authenticated using (
  public.ask_nac_vault_has_all_branches() or exists (
    select 1 from public.inventory_supplier_branches sb
    where sb.supplier_id = id and sb.active and public.inventory_branch_allowed(sb.branch_id)
  )
);
create policy inventory_suppliers_write on public.inventory_suppliers
for all to authenticated using (public.ask_nac_vault_has_all_branches())
with check (public.ask_nac_vault_has_all_branches());

create policy inventory_supplier_branches_select on public.inventory_supplier_branches
for select to authenticated using (public.inventory_branch_allowed(branch_id));
create policy inventory_supplier_branches_write on public.inventory_supplier_branches
for all to authenticated using (public.inventory_can_approve(branch_id))
with check (public.inventory_can_approve(branch_id));

create policy inventory_storage_locations_branch on public.inventory_storage_locations
for select to authenticated using (public.inventory_branch_allowed(branch_id));
create policy inventory_storage_locations_write on public.inventory_storage_locations
for all to authenticated using (public.inventory_can_approve(branch_id))
with check (public.inventory_can_approve(branch_id));

create policy inventory_catalogue_select on public.inventory_supplier_catalogue_items
for select to authenticated using (exists (
  select 1 from public.inventory_supplier_branches sb
  where sb.supplier_id = supplier_id and sb.active and public.inventory_branch_allowed(sb.branch_id)
));
create policy inventory_catalogue_write on public.inventory_supplier_catalogue_items
for all to authenticated using (exists (
  select 1 from public.inventory_supplier_branches sb
  where sb.supplier_id = supplier_id and sb.active and public.inventory_can_approve(sb.branch_id)
)) with check (exists (
  select 1 from public.inventory_supplier_branches sb
  where sb.supplier_id = supplier_id and sb.active and public.inventory_can_approve(sb.branch_id)
));

create policy inventory_alias_select on public.inventory_supplier_item_aliases
for select to authenticated using (exists (
  select 1 from public.inventory_supplier_branches sb
  where sb.supplier_id = supplier_id and sb.active and public.inventory_branch_allowed(sb.branch_id)
));
create policy inventory_alias_write on public.inventory_supplier_item_aliases
for all to authenticated using (exists (
  select 1 from public.inventory_supplier_branches sb
  where sb.supplier_id = supplier_id and sb.active and public.inventory_can_approve(sb.branch_id)
)) with check (exists (
  select 1 from public.inventory_supplier_branches sb
  where sb.supplier_id = supplier_id and sb.active and public.inventory_can_approve(sb.branch_id)
));

create policy inventory_invoices_select on public.inventory_invoices
for select to authenticated using (public.inventory_branch_allowed(branch_id));
create policy inventory_invoices_insert on public.inventory_invoices
for insert to authenticated with check (
  public.inventory_branch_allowed(branch_id) and uploader_id = auth.uid()
);

create policy inventory_ocr_requests_select on public.inventory_ocr_requests
for select to authenticated using (exists (
  select 1 from public.inventory_invoices i
  where i.id = invoice_id and public.inventory_branch_allowed(i.branch_id)
));
create policy inventory_ocr_requests_insert on public.inventory_ocr_requests
for insert to authenticated with check (
  requested_by = auth.uid() and exists (
    select 1 from public.inventory_invoices i
    where i.id = invoice_id and public.inventory_branch_allowed(i.branch_id)
  )
);

create policy inventory_invoice_lines_branch on public.inventory_invoice_lines
for select to authenticated using (exists (
  select 1 from public.inventory_invoices i
  where i.id = invoice_id and public.inventory_branch_allowed(i.branch_id)
));
create policy inventory_invoice_exceptions_branch on public.inventory_invoice_exceptions
for select to authenticated using (exists (
  select 1 from public.inventory_invoices i
  where i.id = invoice_id and public.inventory_branch_allowed(i.branch_id)
));

create policy inventory_receipts_branch on public.inventory_purchase_receipts
for select to authenticated using (public.inventory_branch_allowed(branch_id));
create policy inventory_receipt_lines_branch on public.inventory_purchase_receipt_lines
for select to authenticated using (exists (
  select 1 from public.inventory_purchase_receipts r
  where r.id = receipt_id and public.inventory_branch_allowed(r.branch_id)
));
create policy inventory_movements_branch on public.inventory_movements
for select to authenticated using (public.inventory_branch_allowed(branch_id));
create policy inventory_cost_history_branch on public.inventory_ingredient_cost_history
for select to authenticated using (public.inventory_branch_allowed(branch_id));
create policy inventory_cost_state_branch on public.inventory_ingredient_cost_state
for select to authenticated using (public.inventory_branch_allowed(branch_id));
create policy inventory_variance_branch on public.inventory_price_variance_alerts
for select to authenticated using (public.inventory_branch_allowed(branch_id));

create policy inventory_recipes_branch on public.inventory_recipes
for select to authenticated using (branch_id is null or public.inventory_branch_allowed(branch_id));
create policy inventory_recipes_write on public.inventory_recipes
for all to authenticated
using (case when branch_id is null then public.ask_nac_vault_has_all_branches() else public.inventory_can_approve(branch_id) end)
with check (case when branch_id is null then public.ask_nac_vault_has_all_branches() else public.inventory_can_approve(branch_id) end);
create policy inventory_recipe_versions_select on public.inventory_recipe_versions
for select to authenticated using (exists (
  select 1 from public.inventory_recipes r
  where r.id = recipe_id and (r.branch_id is null or public.inventory_branch_allowed(r.branch_id))
));
create policy inventory_recipe_versions_write on public.inventory_recipe_versions
for all to authenticated using (exists (
  select 1 from public.inventory_recipes r
  where r.id = recipe_id
    and (case when r.branch_id is null then public.ask_nac_vault_has_all_branches()
      else public.inventory_can_approve(r.branch_id) end)
)) with check (exists (
  select 1 from public.inventory_recipes r
  where r.id = recipe_id
    and (case when r.branch_id is null then public.ask_nac_vault_has_all_branches()
      else public.inventory_can_approve(r.branch_id) end)
));
create policy inventory_recipe_lines_select on public.inventory_recipe_version_lines
for select to authenticated using (exists (
  select 1 from public.inventory_recipe_versions v
  join public.inventory_recipes r on r.id = v.recipe_id
  where v.id = recipe_version_id and (r.branch_id is null or public.inventory_branch_allowed(r.branch_id))
));
create policy inventory_recipe_lines_write on public.inventory_recipe_version_lines
for all to authenticated using (exists (
  select 1 from public.inventory_recipe_versions v
  join public.inventory_recipes r on r.id = v.recipe_id
  where v.id = recipe_version_id
    and (case when r.branch_id is null then public.ask_nac_vault_has_all_branches()
      else public.inventory_can_approve(r.branch_id) end)
)) with check (exists (
  select 1 from public.inventory_recipe_versions v
  join public.inventory_recipes r on r.id = v.recipe_id
  where v.id = recipe_version_id
    and (case when r.branch_id is null then public.ask_nac_vault_has_all_branches()
      else public.inventory_can_approve(r.branch_id) end)
));
create policy inventory_recipe_cost_branch on public.inventory_recipe_cost_snapshots
for select to authenticated using (public.inventory_branch_allowed(branch_id));
create policy inventory_menu_margin_branch on public.inventory_menu_item_margin_snapshots
for select to authenticated using (public.inventory_branch_allowed(branch_id));

create policy inventory_stock_counts_branch on public.inventory_stock_counts
for select to authenticated using (public.inventory_branch_allowed(branch_id));
create policy inventory_stock_counts_insert on public.inventory_stock_counts
for insert to authenticated with check (
  public.inventory_branch_allowed(branch_id) and created_by = auth.uid()
);
create policy inventory_stock_count_lines_branch on public.inventory_stock_count_lines
for select to authenticated using (exists (
  select 1 from public.inventory_stock_counts c
  where c.id = stock_count_id and public.inventory_branch_allowed(c.branch_id)
));
create policy inventory_stock_count_lines_write on public.inventory_stock_count_lines
for all to authenticated using (exists (
  select 1 from public.inventory_stock_counts c
  where c.id = stock_count_id and c.status = 'draft'
    and c.created_by = auth.uid() and public.inventory_branch_allowed(c.branch_id)
)) with check (exists (
  select 1 from public.inventory_stock_counts c
  where c.id = stock_count_id and c.status = 'draft'
    and c.created_by = auth.uid() and public.inventory_branch_allowed(c.branch_id)
));
create policy inventory_audit_branch on public.inventory_audit_log
for select to authenticated using (
  branch_id is not null and public.inventory_branch_allowed(branch_id)
);

grant select on public.inventory_current_stock to authenticated;

drop policy if exists inventory_invoices_storage_select on storage.objects;
create policy inventory_invoices_storage_select
on storage.objects for select to authenticated
using (
  bucket_id = 'inventory-invoices'
  and public.inventory_branch_allowed(split_part(name, '/', 1))
);
drop policy if exists inventory_invoices_storage_insert on storage.objects;
create policy inventory_invoices_storage_insert
on storage.objects for insert to authenticated
with check (
  bucket_id = 'inventory-invoices'
  and public.inventory_branch_allowed(split_part(name, '/', 1))
  and owner_id = auth.uid()::text
);

comment on function public.inventory_approve_and_post_invoice(uuid, text) is
  'Atomic, idempotent invoice approval: receipt, immutable ledger, cost history/state, supplier price, variance, recipe/menu cost snapshots, audit.';
comment on table public.inventory_movements is
  'Immutable movement ledger. effective_at is operational time; recorded_at is NAC entry time. Corrections are additive reversal movements.';
comment on table public.inventory_ingredient_cost_history is
  'Append-only cost snapshots. Initial costing method is branch+ingredient weighted average; non-positive existing stock explicitly resets to receipt cost.';
