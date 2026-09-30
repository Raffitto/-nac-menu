-- First-time supplier setup from the invoice that contains the wording.
-- Does not set a receiving policy and does not post stock.

create or replace function public.inventory_supplier_candidates(p_invoice_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_invoice public.inventory_invoices%rowtype;
  v_name text;
  v_vat text;
  v_normalized text;
begin
  select * into v_invoice from public.inventory_invoices where id = p_invoice_id;
  if not found then raise exception 'Invoice not found'; end if;
  if not public.inventory_can_approve(v_invoice.branch_id) then
    raise exception 'Supplier setup is not enabled for this role' using errcode = '42501';
  end if;
  v_name := nullif(trim(v_invoice.structured_extraction ->> 'supplierName'), '');
  v_vat := nullif(regexp_replace(coalesce(v_invoice.structured_extraction ->> 'supplierVatNumber', ''), '\D', '', 'g'), '');
  v_normalized := public.inventory_normalize_text(v_name);
  return jsonb_build_object(
    'name', v_name,
    'vat', v_vat,
    'supplierId', v_invoice.supplier_id,
    'candidates', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id,
        'name', s.supplier_name,
        'vat', s.vat_number,
        'strength', case
          when v_vat is not null and regexp_replace(coalesce(s.vat_number, ''), '\D', '', 'g') = v_vat then 'vat'
          when public.inventory_normalize_text(s.supplier_name) = v_normalized
            or public.inventory_normalize_text(s.legal_name) = v_normalized then 'normalized_name'
          else 'possible_name'
        end
      ) order by s.supplier_name)
      from public.inventory_suppliers s
      where s.active
        and (
          (v_vat is not null and regexp_replace(coalesce(s.vat_number, ''), '\D', '', 'g') = v_vat)
          or public.inventory_normalize_text(s.supplier_name) = v_normalized
          or public.inventory_normalize_text(s.legal_name) = v_normalized
          or (
            v_normalized is not null
            and public.inventory_normalize_text(s.supplier_name) like '%' || split_part(v_normalized, ' ', 1) || '%'
            and length(split_part(v_normalized, ' ', 1)) >= 6
            and split_part(v_normalized, ' ', 1) not in ('company', 'industries', 'industry', 'trading', 'limited', 'establishment')
          )
        )
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.inventory_attach_supplier_to_invoice(
  p_invoice_id uuid,
  p_supplier_id uuid,
  p_create_name text default null,
  p_confirm_separate boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_invoice public.inventory_invoices%rowtype;
  v_supplier public.inventory_suppliers%rowtype;
  v_name text;
  v_vat text;
  v_existing uuid;
  v_linked boolean := false;
begin
  if v_actor is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select * into v_invoice from public.inventory_invoices where id = p_invoice_id for update;
  if not found then raise exception 'Invoice not found'; end if;
  if not public.inventory_can_approve(v_invoice.branch_id) then
    raise exception 'Supplier setup is not enabled for this role' using errcode = '42501';
  end if;
  if v_invoice.status in ('posted', 'rejected', 'cancelled') then
    raise exception 'Finalized invoice cannot be edited' using errcode = '55000';
  end if;
  if v_invoice.supplier_id is not null and p_supplier_id is null and p_create_name is null then
    select * into v_supplier from public.inventory_suppliers where id = v_invoice.supplier_id;
    return jsonb_build_object('supplier', to_jsonb(v_supplier), 'created', false, 'idempotent', true);
  end if;

  v_name := coalesce(nullif(trim(p_create_name), ''), nullif(trim(v_invoice.structured_extraction ->> 'supplierName'), ''));
  v_vat := nullif(regexp_replace(coalesce(v_invoice.structured_extraction ->> 'supplierVatNumber', ''), '\D', '', 'g'), '');

  if p_supplier_id is not null then
    select * into v_supplier from public.inventory_suppliers where id = p_supplier_id and active;
    if not found then raise exception 'Supplier not found'; end if;
  else
    if v_name is null then raise exception 'Supplier name is missing from the document' using errcode = '23514'; end if;
    select id into v_existing
    from public.inventory_suppliers
    where v_vat is not null
      and regexp_replace(coalesce(vat_number, ''), '\D', '', 'g') = v_vat
    limit 1;
    if v_existing is not null then
      raise exception 'A supplier with this VAT already exists. Use that supplier.' using errcode = '23505';
    end if;
    select id into v_existing
    from public.inventory_suppliers
    where public.inventory_normalize_text(supplier_name) = public.inventory_normalize_text(v_name)
       or public.inventory_normalize_text(legal_name) = public.inventory_normalize_text(v_name)
    limit 1;
    if v_existing is not null and not p_confirm_separate then
      raise exception 'A supplier with this name already exists. Use it, or confirm a separate supplier.' using errcode = '23505';
    end if;
    insert into public.inventory_suppliers (
      supplier_name, normalized_name, legal_name, vat_number, currency, created_by
    ) values (
      v_name, public.inventory_normalize_text(v_name), v_name, v_vat, 'SAR', v_actor
    ) returning * into v_supplier;
    insert into public.inventory_audit_log (
      event_type, actor_id, branch_id, entity_type, entity_id, new_value, reason, metadata
    ) values (
      'supplier_created', v_actor, v_invoice.branch_id, 'supplier', v_supplier.id,
      to_jsonb(v_supplier), 'created_from_invoice',
      jsonb_build_object('invoiceId', v_invoice.id)
    );
  end if;

  insert into public.inventory_supplier_branches (supplier_id, branch_id)
  values (v_supplier.id, v_invoice.branch_id)
  on conflict (supplier_id, branch_id) do nothing
  returning true into v_linked;
  if v_linked then
    insert into public.inventory_audit_log (
      event_type, actor_id, branch_id, entity_type, entity_id, new_value, reason, metadata
    ) values (
      'supplier_linked_to_branch', v_actor, v_invoice.branch_id, 'supplier', v_supplier.id,
      jsonb_build_object('branchId', v_invoice.branch_id), 'created_from_invoice',
      jsonb_build_object('invoiceId', v_invoice.id)
    );
  end if;

  update public.inventory_invoices
  set supplier_id = v_supplier.id, updated_at = now()
  where id = v_invoice.id;

  return jsonb_build_object(
    'supplier', to_jsonb(v_supplier),
    'created', p_supplier_id is null,
    'branchId', v_invoice.branch_id,
    'idempotent', false
  );
end;
$$;

create or replace function public.inventory_correct_supplier_knowledge(
  p_supplier_id uuid,
  p_knowledge_type text,
  p_subject_key text,
  p_payload jsonb,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_before public.inventory_supplier_knowledge%rowtype;
  v_after public.inventory_supplier_knowledge%rowtype;
begin
  if v_actor is null or public.ask_nac_vault_role() not in (
    'ceo', 'super_admin', 'ops_manager', 'branch_manager', 'cost_controller'
  ) then
    raise exception 'Supplier knowledge correction denied' using errcode = '42501';
  end if;
  if nullif(trim(p_reason), '') is null then
    raise exception 'A reason is required' using errcode = '22023';
  end if;
  select * into v_before
  from public.inventory_supplier_knowledge
  where supplier_id = p_supplier_id
    and knowledge_type = p_knowledge_type
    and subject_key = p_subject_key
  for update;
  if not found then raise exception 'Learned supplier knowledge not found'; end if;
  update public.inventory_supplier_knowledge
  set payload = p_payload,
      status = 'verified',
      evidence = evidence || jsonb_build_object('correctedFrom', v_before.payload, 'reason', p_reason),
      confirmed_by = v_actor,
      confirmed_at = now()
  where id = v_before.id
  returning * into v_after;
  insert into public.inventory_audit_log (
    event_type, actor_id, entity_type, entity_id, previous_value, new_value, reason
  ) values (
    'supplier_knowledge_corrected', v_actor, 'supplier_knowledge', v_after.id,
    to_jsonb(v_before), to_jsonb(v_after), p_reason
  );
  return jsonb_build_object('previous', to_jsonb(v_before), 'next', to_jsonb(v_after), 'historicalReceiptsRewritten', false);
end;
$$;

revoke all on function public.inventory_supplier_candidates(uuid) from public;
revoke all on function public.inventory_attach_supplier_to_invoice(uuid, uuid, text, boolean) from public;
revoke all on function public.inventory_correct_supplier_knowledge(uuid, text, text, jsonb, text) from public;
grant execute on function public.inventory_supplier_candidates(uuid) to authenticated;
grant execute on function public.inventory_attach_supplier_to_invoice(uuid, uuid, text, boolean) to authenticated;
grant execute on function public.inventory_correct_supplier_knowledge(uuid, text, text, jsonb, text) to authenticated;
