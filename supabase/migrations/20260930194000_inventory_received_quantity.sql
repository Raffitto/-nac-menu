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

