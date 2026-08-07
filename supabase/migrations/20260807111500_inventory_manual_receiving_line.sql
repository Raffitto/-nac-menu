-- Phase B follow-up: audited manual receiving line registration.
-- Supports source-backed manual entry without requiring OCR or bypassing review.

create or replace function public.inventory_add_manual_invoice_line(
  p_invoice_id uuid,
  p_payload jsonb,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice public.inventory_invoices%rowtype;
  v_ingredient public.inventory_ingredients%rowtype;
  v_catalogue public.inventory_supplier_catalogue_items%rowtype;
  v_line public.inventory_invoice_lines%rowtype;
  v_quantity numeric := nullif(p_payload ->> 'canonicalQuantity', '')::numeric;
  v_source_quantity numeric := nullif(p_payload ->> 'sourceQuantity', '')::numeric;
  v_conversion numeric := nullif(p_payload ->> 'conversionFactor', '')::numeric;
  v_unit_price numeric := nullif(p_payload ->> 'unitPrice', '')::numeric;
  v_line_total numeric := nullif(p_payload ->> 'lineTotal', '')::numeric;
  v_tax numeric := coalesce(nullif(p_payload ->> 'taxAmount', '')::numeric, 0);
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if nullif(trim(p_reason), '') is null then
    raise exception 'A manual-entry reason is required' using errcode = '22023';
  end if;
  select * into v_invoice from public.inventory_invoices
  where id = p_invoice_id for update;
  if not found or not public.inventory_branch_allowed(v_invoice.branch_id) then
    raise exception 'Invoice not found or access denied' using errcode = '42501';
  end if;
  if v_invoice.status in ('posted', 'rejected', 'duplicate', 'cancelled') then
    raise exception 'Finalized invoice cannot receive manual lines' using errcode = '55000';
  end if;
  if v_invoice.uploader_id <> auth.uid()
    and not public.inventory_can_approve(v_invoice.branch_id)
  then
    raise exception 'Manual invoice line creation denied' using errcode = '42501';
  end if;

  select * into v_ingredient from public.inventory_ingredients
  where id = nullif(p_payload ->> 'ingredientId', '')::uuid
    and active
    and (scope = 'network' or branch_id = v_invoice.branch_id);
  if not found then
    raise exception 'Canonical inventory item is unavailable for branch' using errcode = '23514';
  end if;
  if nullif(trim(p_payload ->> 'sourceDescription'), '') is null
    or v_source_quantity is null or v_source_quantity <= 0
    or nullif(trim(p_payload ->> 'sourceUnit'), '') is null
    or v_quantity is null or v_quantity <= 0
    or v_conversion is null or v_conversion <= 0
    or p_payload ->> 'canonicalUnit' <> v_ingredient.base_inventory_unit
    or v_unit_price is null or v_unit_price < 0
    or v_line_total is null or v_line_total < 0
  then
    raise exception 'Manual invoice line evidence, quantity, conversion, unit, and cost are required'
      using errcode = '23514';
  end if;
  if abs(v_line_total - v_tax - (v_quantity * v_unit_price)) > 0.000001 then
    raise exception 'Manual line quantity multiplied by unit cost does not match tax-exclusive total'
      using errcode = '23514';
  end if;

  if nullif(p_payload ->> 'supplierCatalogueItemId', '') is not null then
    select * into v_catalogue from public.inventory_supplier_catalogue_items
    where id = (p_payload ->> 'supplierCatalogueItemId')::uuid;
    if not found
      or v_catalogue.supplier_id <> v_invoice.supplier_id
      or v_catalogue.ingredient_id <> v_ingredient.id
    then
      raise exception 'Supplier catalogue mapping does not match invoice supplier and item'
        using errcode = '23514';
    end if;
  end if;

  insert into public.inventory_invoice_lines (
    invoice_id, line_number, page_number, original_description,
    normalized_description, supplier_sku, original_quantity, original_unit,
    pack_quantity, pack_size, pack_unit, conversion_factor,
    canonical_received_quantity, canonical_unit, unit_price, line_discount,
    tax_rate, tax_amount, line_total, ingredient_id, supplier_catalogue_item_id,
    matching_confidence, match_method, manually_overridden,
    verified_by, verified_at, ocr_confidence, evidence, manual_overrides,
    active, review_status
  ) values (
    v_invoice.id,
    coalesce(nullif(p_payload ->> 'lineNumber', '')::integer, (
      select coalesce(max(line_number), 0) + 1
      from public.inventory_invoice_lines where invoice_id = v_invoice.id
    )),
    nullif(p_payload ->> 'pageNumber', '')::integer,
    trim(p_payload ->> 'sourceDescription'),
    public.inventory_normalize_text(p_payload ->> 'sourceDescription'),
    nullif(p_payload ->> 'supplierSku', ''),
    v_source_quantity, p_payload ->> 'sourceUnit',
    coalesce(nullif(p_payload ->> 'packQuantity', '')::numeric, 1),
    coalesce(nullif(p_payload ->> 'packSize', '')::numeric, v_source_quantity),
    coalesce(nullif(p_payload ->> 'packUnit', ''), p_payload ->> 'sourceUnit'),
    v_conversion, v_quantity, p_payload ->> 'canonicalUnit',
    v_unit_price, coalesce(nullif(p_payload ->> 'lineDiscount', '')::numeric, 0),
    nullif(p_payload ->> 'taxRate', '')::numeric, v_tax, v_line_total,
    v_ingredient.id, v_catalogue.id, 1, 'manual_review', true,
    auth.uid(), now(), null,
    coalesce(p_payload -> 'evidence', '{}'::jsonb),
    jsonb_build_object('reason', p_reason, 'entryMethod', 'manual_receiving'),
    true, 'verified'
  ) returning * into v_line;

  insert into public.inventory_audit_log (
    event_type, actor_id, branch_id, entity_type, entity_id,
    new_value, reason, metadata
  ) values (
    'manual_invoice_line_created', auth.uid(), v_invoice.branch_id,
    'inventory_invoice_line', v_line.id, to_jsonb(v_line), p_reason,
    jsonb_build_object('invoiceId', v_invoice.id, 'sourceEvidencePreserved', true)
  );
  return jsonb_build_object(
    'status', 'verified', 'invoiceId', v_invoice.id, 'invoiceLineId', v_line.id
  );
end;
$$;

revoke all on function public.inventory_add_manual_invoice_line(uuid, jsonb, text) from public;
grant execute on function public.inventory_add_manual_invoice_line(uuid, jsonb, text) to authenticated;
