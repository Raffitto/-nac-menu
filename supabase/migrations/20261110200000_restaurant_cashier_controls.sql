-- Simulated cashier controls. No card numbers and no payment capture.
-- Guest-menu prices are documented as including 15% VAT. Catalogue rows have no tax column.
-- Foodics Sales by Creator net sales are documented as tax-inclusive at 15%.
-- Legacy rows are not backfilled. Do not apply this file to production.
-- Rollback: drop function public.restaurant_close_shift(uuid, integer, text);
--           drop function public.restaurant_open_shift(text, integer);
--           drop function public.restaurant_finalize_simulated_bill(text);
--           drop function public.restaurant_record_simulated_payment(text, text, integer, text);
--           drop table public.restaurant_shifts;
--           drop table public.restaurant_payments;
--           drop table public.restaurant_tax_settings;

create table if not exists public.restaurant_tax_settings (
  branch_id text primary key,
  treatment text not null check (treatment in ('inclusive', 'exclusive', 'unconfigured')),
  rate_numerator integer not null check (rate_numerator >= 0),
  rate_denominator integer not null check (rate_denominator > 0),
  currency text not null default 'SAR',
  source_note text not null,
  constraint restaurant_tax_settings_branch_check
    check (branch_id = public.nac_normalize_branch_id(branch_id))
);

insert into public.restaurant_tax_settings (branch_id, treatment, rate_numerator, rate_denominator, source_note)
values
  ('khobar', 'inclusive', 15, 100, 'Guest menu footer: all prices include 15% VAT. Foodics Sales by Creator net sales are documented as tax-inclusive at 15%.'),
  ('riyadh', 'inclusive', 15, 100, 'Guest menu footer: all prices include 15% VAT. Foodics Sales by Creator net sales are documented as tax-inclusive at 15%.'),
  ('jeddah', 'inclusive', 15, 100, 'Guest menu footer: all prices include 15% VAT. Foodics Sales by Creator net sales are documented as tax-inclusive at 15%.')
on conflict (branch_id) do nothing;

alter table public.restaurant_bills
  add column if not exists tax_treatment text,
  add column if not exists tax_rate_numerator integer,
  add column if not exists tax_rate_denominator integer,
  add column if not exists taxable_minor integer,
  add column if not exists vat_minor integer,
  add column if not exists gross_minor integer,
  add column if not exists finalized_at timestamptz;

create table if not exists public.restaurant_payments (
  id uuid primary key default gen_random_uuid(),
  branch_id text not null,
  bill_id text not null references public.restaurant_bills(id),
  method text not null check (method in ('cash', 'card', 'other')),
  amount_minor integer not null check (amount_minor > 0),
  idempotency_key text,
  actor_email text not null,
  test_mode boolean not null default true,
  created_at timestamptz not null default now(),
  constraint restaurant_payments_branch_check
    check (branch_id = public.nac_normalize_branch_id(branch_id))
);

create unique index if not exists restaurant_payments_idempotency
  on public.restaurant_payments (bill_id, idempotency_key)
  where idempotency_key is not null;

create table if not exists public.restaurant_shifts (
  id uuid primary key default gen_random_uuid(),
  branch_id text not null,
  status text not null check (status in ('open', 'closed')),
  opening_float_minor integer not null check (opening_float_minor >= 0),
  opened_by text not null,
  opened_at timestamptz not null default now(),
  counted_cash_minor integer,
  expected_cash_minor integer,
  variance_minor integer,
  close_note text,
  closed_by text,
  closed_at timestamptz,
  detail jsonb not null default '{}'::jsonb,
  constraint restaurant_shifts_branch_check
    check (branch_id = public.nac_normalize_branch_id(branch_id))
);

create unique index if not exists restaurant_shifts_one_open
  on public.restaurant_shifts (branch_id)
  where status = 'open';

alter table public.restaurant_tax_settings enable row level security;
alter table public.restaurant_payments enable row level security;
alter table public.restaurant_shifts enable row level security;
revoke all on public.restaurant_tax_settings from public, anon, authenticated;
revoke all on public.restaurant_payments from public, anon, authenticated;
revoke all on public.restaurant_shifts from public, anon, authenticated;
grant select on public.restaurant_tax_settings to authenticated, nac_restaurant_api;
grant select on public.restaurant_payments to authenticated, nac_restaurant_api;
grant select on public.restaurant_shifts to authenticated, nac_restaurant_api;

drop policy if exists restaurant_api_read on public.restaurant_tax_settings;
create policy restaurant_api_read on public.restaurant_tax_settings
  for select to nac_restaurant_api
  using (branch_id = current_setting('nac.branch', true));
drop policy if exists restaurant_api_read on public.restaurant_payments;
create policy restaurant_api_read on public.restaurant_payments
  for select to nac_restaurant_api
  using (branch_id = current_setting('nac.branch', true));
drop policy if exists restaurant_api_read on public.restaurant_shifts;
create policy restaurant_api_read on public.restaurant_shifts
  for select to nac_restaurant_api
  using (branch_id = current_setting('nac.branch', true));

create or replace function public.restaurant_bill_gross(p_bill_id text)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  bill public.restaurant_bills;
  gross integer;
  missing integer;
  discounts integer;
begin
  select * into bill from public.restaurant_bills where id = p_bill_id;
  if not found then raise exception 'bill_not_found'; end if;
  select count(*) filter (where i.line_minor is null), coalesce(sum(i.line_minor), 0)
    into missing, gross
  from public.restaurant_order_items i
  join public.restaurant_orders o on o.id = i.order_id
  where o.session_id = bill.session_id and i.status <> 'cancelled';
  if missing > 0 then raise exception 'price_snapshot_required'; end if;
  select coalesce(sum(amount_minor), 0) into discounts
  from public.restaurant_adjustments
  where bill_id = bill.id and kind = 'discount' and amount_minor is not null and check_bill_id is null;
  if discounts > gross then raise exception 'discount_exceeds_total'; end if;
  return gross - discounts;
end;
$$;

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
  if not found or bill.status <> 'open' then raise exception 'bill_not_open'; end if;
  if not public.restaurant_can(bill.branch_id, 'bill_read') then raise exception 'branch_forbidden'; end if;
  if p_key is not null then
    select * into row from public.restaurant_payments where bill_id = bill.id and idempotency_key = p_key;
    if found then return row; end if;
  end if;
  due := public.restaurant_bill_gross(bill.id);
  select coalesce(sum(amount_minor), 0) into paid from public.restaurant_payments where bill_id = bill.id;
  select coalesce(sum(amount_minor), 0) into allocated
  from public.restaurant_adjustments
  where bill_id = bill.id and kind = 'split' and check_bill_id is not null and amount_minor is not null;
  if paid + allocated + p_amount_minor > due then raise exception 'overpayment'; end if;
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
  tax public.restaurant_tax_settings;
  vat integer;
begin
  select * into bill from public.restaurant_bills where id = p_bill_id for update;
  if not found or bill.status <> 'open' then raise exception 'bill_not_open'; end if;
  if not public.restaurant_can(bill.branch_id, 'bill_read') then raise exception 'branch_forbidden'; end if;
  if bill.finalized_at is not null then return bill; end if;
  due := public.restaurant_bill_gross(bill.id);
  select coalesce(sum(amount_minor), 0) into paid from public.restaurant_payments where bill_id = bill.id;
  select coalesce(sum(amount_minor), 0) into allocated
  from public.restaurant_adjustments
  where bill_id = bill.id and kind = 'split' and check_bill_id is not null and amount_minor is not null;
  if paid + allocated <> due then raise exception 'balance_unexplained'; end if;
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
    'gross_minor', bill.gross_minor, 'vat_minor', bill.vat_minor, 'tax_treatment', bill.tax_treatment, 'test_mode', true
  ));
  return bill;
end;
$$;

create or replace function public.restaurant_open_shift(p_branch text, p_opening_minor integer)
returns public.restaurant_shifts
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized text;
  row public.restaurant_shifts;
begin
  if not public.restaurant_can(p_branch, 'bill_read') then raise exception 'branch_forbidden'; end if;
  normalized := public.nac_normalize_branch_id(p_branch);
  if p_opening_minor is null or p_opening_minor < 0 then raise exception 'amount_invalid'; end if;
  if exists (select 1 from public.restaurant_shifts where branch_id = normalized and status = 'open') then
    raise exception 'shift_already_open';
  end if;
  insert into public.restaurant_shifts (branch_id, status, opening_float_minor, opened_by)
  values (normalized, 'open', p_opening_minor, public.nac_auth_email())
  returning * into row;
  perform public.restaurant_audit(normalized, 'shift_opened', row.id::text, jsonb_build_object('opening_float_minor', p_opening_minor, 'test_mode', true));
  return row;
end;
$$;

create or replace function public.restaurant_close_shift(
  p_shift_id uuid,
  p_counted_minor integer,
  p_note text
) returns public.restaurant_shifts
language plpgsql
security definer
set search_path = public
as $$
declare
  shift public.restaurant_shifts;
  cash_minor integer;
  card_minor integer;
  other_minor integer;
  discount_minor integer;
  voided integer;
  unsettled integer;
  expected integer;
begin
  if nullif(trim(coalesce(p_note, '')), '') is null then raise exception 'reason_required'; end if;
  if p_counted_minor is null or p_counted_minor < 0 then raise exception 'amount_invalid'; end if;
  select * into shift from public.restaurant_shifts where id = p_shift_id for update;
  if not found or shift.status <> 'open' then raise exception 'shift_not_open'; end if;
  if not public.restaurant_can(shift.branch_id, 'bill_read') then raise exception 'branch_forbidden'; end if;
  select
    coalesce(sum(amount_minor) filter (where method = 'cash'), 0),
    coalesce(sum(amount_minor) filter (where method = 'card'), 0),
    coalesce(sum(amount_minor) filter (where method = 'other'), 0)
    into cash_minor, card_minor, other_minor
  from public.restaurant_payments
  where branch_id = shift.branch_id and created_at >= shift.opened_at;
  select coalesce(sum(amount_minor), 0) into discount_minor
  from public.restaurant_adjustments
  where branch_id = shift.branch_id and kind = 'discount' and created_at >= shift.opened_at;
  select count(*) into voided
  from public.restaurant_adjustments
  where branch_id = shift.branch_id and kind = 'void' and created_at >= shift.opened_at;
  select count(*) into unsettled
  from public.restaurant_bills
  where branch_id = shift.branch_id and status = 'open' and finalized_at is null;
  expected := shift.opening_float_minor + cash_minor;
  update public.restaurant_shifts
    set status = 'closed',
        counted_cash_minor = p_counted_minor,
        expected_cash_minor = expected,
        variance_minor = p_counted_minor - expected,
        close_note = trim(p_note),
        closed_by = public.nac_auth_email(),
        closed_at = now(),
        detail = jsonb_build_object(
          'cash_minor', cash_minor,
          'card_minor', card_minor,
          'other_minor', other_minor,
          'discount_minor', discount_minor,
          'voids', voided,
          'unsettled_bills', unsettled,
          'test_mode', true
        )
    where id = shift.id
    returning * into shift;
  perform public.restaurant_audit(shift.branch_id, 'shift_closed', shift.id::text, shift.detail || jsonb_build_object(
    'expected_cash_minor', shift.expected_cash_minor,
    'counted_cash_minor', shift.counted_cash_minor,
    'variance_minor', shift.variance_minor
  ));
  return shift;
end;
$$;

revoke all on function public.restaurant_bill_gross(text) from public, anon;
revoke all on function public.restaurant_record_simulated_payment(text, text, integer, text) from public, anon;
revoke all on function public.restaurant_finalize_simulated_bill(text) from public, anon;
revoke all on function public.restaurant_open_shift(text, integer) from public, anon;
revoke all on function public.restaurant_close_shift(uuid, integer, text) from public, anon;
grant execute on function public.restaurant_bill_gross(text) to authenticated, nac_restaurant_api;
grant execute on function public.restaurant_record_simulated_payment(text, text, integer, text) to authenticated, nac_restaurant_api;
grant execute on function public.restaurant_finalize_simulated_bill(text) to authenticated, nac_restaurant_api;
grant execute on function public.restaurant_open_shift(text, integer) to authenticated, nac_restaurant_api;
grant execute on function public.restaurant_close_shift(uuid, integer, text) to authenticated, nac_restaurant_api;
