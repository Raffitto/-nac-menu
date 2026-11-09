-- Idempotent unpaid adjustments and separate unpaid checks.
-- A check is still status open. Nothing here captures a payment.
-- Rollback: drop function public.restaurant_open_unpaid_check(text, text);
--           drop function public.restaurant_record_adjustment(text, text, uuid, text, integer, integer, text, text, text);
--           alter table public.restaurant_adjustments drop column if exists idempotency_key;
--           alter table public.restaurant_adjustments drop column if exists check_bill_id;

alter table public.restaurant_adjustments
  add column if not exists idempotency_key text,
  add column if not exists check_bill_id text;

create unique index if not exists restaurant_adjustments_idempotency
  on public.restaurant_adjustments (bill_id, idempotency_key)
  where idempotency_key is not null;

create or replace function public.restaurant_open_unpaid_check(
  p_session_id text,
  p_bill_id text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  sess public.restaurant_sessions;
begin
  select * into sess from public.restaurant_sessions where id = p_session_id;
  if not found then raise exception 'session_not_found'; end if;
  if not public.restaurant_can(sess.branch_id, 'bill_read') then
    raise exception 'branch_forbidden';
  end if;
  insert into public.restaurant_bills (id, session_id, branch_id, status)
  values (p_bill_id, sess.id, sess.branch_id, 'open')
  on conflict (id) do nothing;
end;
$$;

revoke all on function public.restaurant_open_unpaid_check(text, text) from public, anon;
grant execute on function public.restaurant_open_unpaid_check(text, text) to authenticated;
grant execute on function public.restaurant_open_unpaid_check(text, text) to nac_restaurant_api;

drop function if exists public.restaurant_record_adjustment(text, text, uuid, text, integer, integer, text);

create function public.restaurant_record_adjustment(
  p_bill_id text,
  p_kind text,
  p_item_id uuid,
  p_basis text,
  p_amount_minor integer,
  p_parts integer,
  p_reason text,
  p_key text default null,
  p_check_bill_id text default null
) returns public.restaurant_adjustments
language plpgsql
security definer
set search_path = public
as $$
declare
  bill public.restaurant_bills;
  actor text := public.nac_auth_email();
  allowed boolean;
  row public.restaurant_adjustments;
begin
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'reason_required';
  end if;
  select * into bill from public.restaurant_bills where id = p_bill_id for update;
  if not found then raise exception 'bill_not_found'; end if;
  if bill.status <> 'open' then raise exception 'bill_not_open'; end if;
  if p_key is not null then
    select * into row from public.restaurant_adjustments
      where bill_id = bill.id and idempotency_key = p_key;
    if found then return row; end if;
  end if;
  if p_kind in ('discount', 'void') then
    select exists (
      select 1 from public.restaurant_staff_grants g
      where lower(g.email) = lower(actor)
        and g.branch_id = bill.branch_id
        and g.role in ('manager', 'administrator')
    ) into allowed;
    if not allowed then raise exception 'role_forbidden'; end if;
  elsif p_kind = 'split' then
    if not public.restaurant_can(bill.branch_id, 'bill_read') then
      raise exception 'branch_forbidden';
    end if;
  else
    raise exception 'adjustment_not_supported';
  end if;
  if p_kind = 'void' then
    if p_item_id is null or not exists (
      select 1 from public.restaurant_order_items
      where id = p_item_id and branch_id = bill.branch_id and status <> 'cancelled'
    ) then
      raise exception 'item_not_found';
    end if;
    update public.restaurant_order_items
      set status = 'cancelled'
      where id = p_item_id and branch_id = bill.branch_id;
  end if;
  insert into public.restaurant_adjustments (
    branch_id, bill_id, session_id, kind, item_id, basis, amount_minor, parts, reason, actor_email, idempotency_key, check_bill_id
  ) values (
    bill.branch_id, bill.id, bill.session_id, p_kind, p_item_id, p_basis, p_amount_minor, p_parts, trim(p_reason), actor, p_key, p_check_bill_id
  ) returning * into row;
  perform public.restaurant_audit(bill.branch_id, 'bill_adjusted', row.id::text, jsonb_build_object(
    'kind', p_kind, 'bill_id', bill.id, 'basis', p_basis, 'amount_minor', p_amount_minor, 'payment', 'not_captured'
  ));
  return row;
end;
$$;

revoke all on function public.restaurant_record_adjustment(text, text, uuid, text, integer, integer, text, text, text) from public, anon;
grant execute on function public.restaurant_record_adjustment(text, text, uuid, text, integer, integer, text, text, text) to authenticated;
grant execute on function public.restaurant_record_adjustment(text, text, uuid, text, integer, integer, text, text, text) to nac_restaurant_api;
