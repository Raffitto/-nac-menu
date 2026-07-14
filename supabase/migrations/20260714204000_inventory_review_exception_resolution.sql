-- Make the internal review route practical: safe header corrections resolve
-- deterministic exceptions, while manual exception overrides remain audited.

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

  update public.inventory_invoice_exceptions
  set status = 'resolved', resolved_by = auth.uid(), resolved_at = now(),
      resolution_reason = p_reason
  where invoice_id = p_invoice_id
    and status = 'open'
    and (
      (exception_type = 'supplier_ambiguity' and v_after.supplier_id is not null)
      or (
        exception_type = 'invalid_or_missing_invoice_date'
        and v_after.invoice_date is not null
        and v_after.effective_receipt_date is not null
      )
      or (exception_type = 'unsupported_currency' and v_after.currency = 'SAR')
      or (
        exception_type = 'invoice_total_mismatch'
        and v_after.subtotal is not null
        and v_after.total is not null
        and abs((v_after.subtotal + v_after.tax - v_after.discount) - v_after.total) <= 0.05
      )
    );

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

create or replace function public.inventory_resolve_invoice_exception(
  p_exception_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exception public.inventory_invoice_exceptions%rowtype;
  v_invoice public.inventory_invoices%rowtype;
begin
  if nullif(trim(p_reason), '') is null then
    raise exception 'A resolution reason is required' using errcode = '22023';
  end if;
  select * into v_exception
  from public.inventory_invoice_exceptions
  where id = p_exception_id
  for update;
  if not found then raise exception 'Invoice exception not found'; end if;
  select * into v_invoice
  from public.inventory_invoices
  where id = v_exception.invoice_id
  for update;
  if not public.inventory_branch_allowed(v_invoice.branch_id) then
    raise exception 'Invoice access denied' using errcode = '42501';
  end if;
  if v_exception.severity = 'blocking' and not public.inventory_can_approve(v_invoice.branch_id) then
    raise exception 'Blocking exception override denied' using errcode = '42501';
  end if;
  if v_invoice.status in ('posted', 'rejected', 'cancelled') then
    raise exception 'Finalized invoice exceptions cannot be changed' using errcode = '55000';
  end if;
  if v_exception.status <> 'open' then
    return jsonb_build_object('status', v_exception.status, 'exceptionId', v_exception.id, 'idempotent', true);
  end if;

  update public.inventory_invoice_exceptions
  set status = 'resolved', resolved_by = auth.uid(), resolved_at = now(),
      resolution_reason = p_reason
  where id = p_exception_id;

  if v_exception.exception_type in ('duplicate_invoice_number', 'duplicate_file_hash', 'duplicate_invoice') then
    update public.inventory_invoices
    set duplicate_status = 'overridden',
        notes = concat_ws(E'\n', notes, 'Duplicate warning overridden: ' || p_reason)
    where id = v_invoice.id;
  end if;

  insert into public.inventory_audit_log (
    event_type, actor_id, branch_id, entity_type, entity_id,
    previous_value, new_value, reason
  ) values (
    case when v_exception.exception_type like 'duplicate%' then 'duplicate_overridden'
      else 'invoice_exception_resolved' end,
    auth.uid(), v_invoice.branch_id, 'invoice_exception', v_exception.id,
    to_jsonb(v_exception), jsonb_build_object('status', 'resolved'), p_reason
  );
  return jsonb_build_object('status', 'resolved', 'exceptionId', v_exception.id, 'idempotent', false);
end;
$$;

revoke all on function public.inventory_resolve_invoice_exception(uuid, text) from public;
grant execute on function public.inventory_resolve_invoice_exception(uuid, text) to authenticated;
