-- Auditable bill adjustments. They do not capture a payment or mark a bill paid.
-- Rollback: drop function public.restaurant_record_adjustment(text, text, uuid, text, integer, integer, text);
--           drop table public.restaurant_adjustments;

create table if not exists public.restaurant_adjustments (
  id uuid primary key default gen_random_uuid(),
  branch_id text not null,
  bill_id text not null references public.restaurant_bills(id),
  session_id text not null,
  kind text not null check (kind in ('discount', 'void', 'split')),
  item_id uuid,
  basis text not null,
  amount_minor integer,
  parts integer,
  reason text not null,
  actor_email text not null,
  created_at timestamptz not null default now(),
  constraint restaurant_adjustments_branch_check
    check (branch_id = public.nac_normalize_branch_id(branch_id))
);

alter table public.restaurant_adjustments enable row level security;

drop policy if exists restaurant_adjustments_staff_select on public.restaurant_adjustments;
create policy restaurant_adjustments_staff_select on public.restaurant_adjustments
  for select to authenticated
  using (public.restaurant_branch_allowed(branch_id));

grant select on public.restaurant_adjustments to authenticated;

create or replace function public.restaurant_record_adjustment(
  p_bill_id text,
  p_kind text,
  p_item_id uuid,
  p_basis text,
  p_amount_minor integer,
  p_parts integer,
  p_reason text
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
      where id = p_item_id and branch_id = bill.branch_id
    ) then
      raise exception 'item_not_found';
    end if;
    update public.restaurant_order_items
      set status = 'cancelled'
      where id = p_item_id and branch_id = bill.branch_id;
  end if;
  insert into public.restaurant_adjustments (
    branch_id, bill_id, session_id, kind, item_id, basis, amount_minor, parts, reason, actor_email
  ) values (
    bill.branch_id, bill.id, bill.session_id, p_kind, p_item_id, p_basis, p_amount_minor, p_parts, trim(p_reason), actor
  ) returning * into row;
  perform public.restaurant_audit(bill.branch_id, 'bill_adjusted', row.id::text, jsonb_build_object(
    'kind', p_kind, 'bill_id', bill.id, 'basis', p_basis, 'amount_minor', p_amount_minor, 'payment', 'not_captured'
  ));
  return row;
end;
$$;

revoke all on function public.restaurant_record_adjustment(text, text, uuid, text, integer, integer, text) from public, anon;
grant execute on function public.restaurant_record_adjustment(text, text, uuid, text, integer, integer, text) to authenticated;
grant execute on function public.restaurant_record_adjustment(text, text, uuid, text, integer, integer, text) to nac_restaurant_api;
grant select on public.restaurant_adjustments to nac_restaurant_api;
drop policy if exists restaurant_api_read on public.restaurant_adjustments;
create policy restaurant_api_read on public.restaurant_adjustments
  for select to nac_restaurant_api
  using (branch_id = current_setting('nac.branch', true));
