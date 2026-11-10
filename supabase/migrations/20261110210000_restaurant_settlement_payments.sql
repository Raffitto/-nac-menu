-- A split check is not a payment. Settlement requires recorded payments.
-- Unpaid checks stay open. Do not apply this file to production.
-- Rollback: restore the previous restaurant_record_simulated_payment and restaurant_finalize_simulated_bill bodies from 20261110200000.

create or replace function public.restaurant_record_simulated_payment(
  p_bill_id text,
  p_method text,
  p_amount_minor integer,
  p_key text
) returns public.restaurant_payments
language plpgsql
security definer
set search_path = public
as $$
declare
  bill public.restaurant_bills;
  actor text := public.nac_auth_email();
  row public.restaurant_payments;
  paid integer;
  allocated integer;
  due integer;
begin
  if p_method not in ('cash', 'card', 'other') then raise exception 'tender_not_configured'; end if;
  if p_amount_minor is null or p_amount_minor <= 0 then raise exception 'amount_invalid'; end if;
  select * into bill from public.restaurant_bills where id = p_bill_id for update;
  if not found or bill.status <> 'open' or bill.finalized_at is not null then raise exception 'bill_not_open'; end if;
  if not public.restaurant_can(bill.branch_id, 'bill_read') then raise exception 'branch_forbidden'; end if;
  if p_key is not null then
    select * into row from public.restaurant_payments where bill_id = bill.id and idempotency_key = p_key;
    if found then return row; end if;
  end if;
  select a.amount_minor into allocated
  from public.restaurant_adjustments a
  where a.check_bill_id = bill.id and a.kind = 'split' and a.amount_minor is not null
  limit 1;
  if found then
    due := allocated;
  else
    select coalesce(sum(amount_minor), 0) into allocated
    from public.restaurant_adjustments
    where bill_id = bill.id and kind = 'split' and check_bill_id is not null and amount_minor is not null;
    due := public.restaurant_bill_gross(bill.id) - allocated;
  end if;
  select coalesce(sum(amount_minor), 0) into paid from public.restaurant_payments where bill_id = bill.id;
  if due < 0 or paid + p_amount_minor > due then raise exception 'overpayment'; end if;
  insert into public.restaurant_payments (branch_id, bill_id, method, amount_minor, idempotency_key, actor_email, test_mode)
  values (bill.branch_id, bill.id, p_method, p_amount_minor, nullif(trim(coalesce(p_key, '')), ''), actor, true)
  returning * into row;
  perform public.restaurant_audit(bill.branch_id, 'simulated_payment', row.id::text, jsonb_build_object(
    'bill_id', bill.id, 'method', p_method, 'amount_minor', p_amount_minor, 'test_mode', true, 'payment_captured', false
  ));
  return row;
end;
$$;

create or replace function public.restaurant_finalize_simulated_bill(p_bill_id text)
returns public.restaurant_bills
language plpgsql
security definer
set search_path = public
as $$
declare
  bill public.restaurant_bills;
  due integer;
  paid integer;
  allocated integer;
  check_paid integer;
  check_row record;
  tax public.restaurant_tax_settings;
  vat integer;
begin
  select * into bill from public.restaurant_bills where id = p_bill_id for update;
  if not found or bill.status <> 'open' then raise exception 'bill_not_open'; end if;
  if not public.restaurant_can(bill.branch_id, 'bill_read') then raise exception 'branch_forbidden'; end if;
  if bill.finalized_at is not null then return bill; end if;
  select a.amount_minor into allocated
  from public.restaurant_adjustments a
  where a.check_bill_id = bill.id and a.kind = 'split' and a.amount_minor is not null
  limit 1;
  if found then
    select coalesce(sum(amount_minor), 0) into paid from public.restaurant_payments where bill_id = bill.id;
    if paid <> allocated then raise exception 'balance_unexplained'; end if;
    update public.restaurant_bills set finalized_at = now() where id = bill.id returning * into bill;
    perform public.restaurant_audit(bill.branch_id, 'check_finalized', bill.id, jsonb_build_object(
      'amount_minor', allocated, 'paid_minor', paid, 'test_mode', true
    ));
    return bill;
  end if;
  due := public.restaurant_bill_gross(bill.id);
  for check_row in
    select check_bill_id, amount_minor
    from public.restaurant_adjustments
    where bill_id = bill.id and kind = 'split' and check_bill_id is not null and amount_minor is not null
  loop
    select coalesce(sum(amount_minor), 0) into check_paid
    from public.restaurant_payments where bill_id = check_row.check_bill_id;
    if check_paid <> check_row.amount_minor then raise exception 'balance_unexplained'; end if;
  end loop;
  select coalesce(sum(p.amount_minor), 0) into paid
  from public.restaurant_payments p
  where p.bill_id = bill.id
     or p.bill_id in (
       select check_bill_id from public.restaurant_adjustments
       where bill_id = bill.id and kind = 'split' and check_bill_id is not null
     );
  if paid <> due then raise exception 'balance_unexplained'; end if;
  update public.restaurant_bills
    set finalized_at = now()
    where id in (
      select check_bill_id from public.restaurant_adjustments
      where bill_id = bill.id and kind = 'split' and check_bill_id is not null
    ) and finalized_at is null;
  select * into tax from public.restaurant_tax_settings where branch_id = bill.branch_id;
  vat := null;
  if tax.treatment = 'inclusive' then
    vat := ((due * tax.rate_numerator) + ((tax.rate_denominator + tax.rate_numerator) / 2))
      / (tax.rate_denominator + tax.rate_numerator);
  end if;
  update public.restaurant_bills
    set gross_minor = due,
        tax_treatment = coalesce(tax.treatment, 'unconfigured'),
        tax_rate_numerator = tax.rate_numerator,
        tax_rate_denominator = tax.rate_denominator,
        vat_minor = vat,
        taxable_minor = case when vat is null then null else due - vat end,
        finalized_at = now()
    where id = bill.id
    returning * into bill;
  perform public.restaurant_audit(bill.branch_id, 'bill_finalized', bill.id, jsonb_build_object(
    'gross_minor', bill.gross_minor, 'vat_minor', bill.vat_minor, 'tax_treatment', bill.tax_treatment, 'paid_minor', paid, 'test_mode', true
  ));
  return bill;
end;
$$;
