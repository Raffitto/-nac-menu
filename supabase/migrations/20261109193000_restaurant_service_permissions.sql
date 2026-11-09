-- Dedicated restaurant permissions. Do not apply to production without approval.
-- Menu-edit access no longer grants restaurant access.
-- No staff rows, guests, or historical visits are inserted.
-- Bills can be opened and closed as unpaid. This does not capture a card payment.

create table if not exists public.restaurant_staff_grants (
  email text not null,
  branch_id text not null,
  role text not null check (role in ('host', 'waiter', 'kitchen', 'cashier', 'manager', 'administrator')),
  granted_at timestamptz not null default now(),
  primary key (email, branch_id, role),
  constraint restaurant_staff_grants_branch_check
    check (branch_id = '*' or branch_id = public.nac_normalize_branch_id(branch_id))
);

create table if not exists public.restaurant_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id text not null references public.restaurant_orders(id),
  branch_id text not null,
  item_name text not null,
  quantity integer not null check (quantity between 1 and 99),
  note text,
  allergy_alert text,
  status text not null default 'queued'
    check (status in ('queued', 'preparing', 'ready', 'served', 'cancelled')),
  created_at timestamptz not null default now(),
  constraint restaurant_order_items_branch_check
    check (branch_id = public.nac_normalize_branch_id(branch_id))
);

create table if not exists public.restaurant_bills (
  id text primary key,
  session_id text not null references public.restaurant_sessions(id),
  branch_id text not null,
  status text not null check (status in ('open', 'closed_unpaid')),
  created_at timestamptz not null default now(),
  constraint restaurant_bills_branch_check
    check (branch_id = public.nac_normalize_branch_id(branch_id))
);

alter table public.restaurant_guests add column if not exists allergies text;
alter table public.restaurant_guests add column if not exists preferences text;
alter table public.restaurant_guests add column if not exists notes text;
alter table public.restaurant_guests add column if not exists vip boolean not null default false;

alter table public.restaurant_staff_grants enable row level security;
alter table public.restaurant_order_items enable row level security;
alter table public.restaurant_bills enable row level security;
revoke all on public.restaurant_staff_grants from public, anon, authenticated;
revoke all on public.restaurant_order_items from public, anon, authenticated;
revoke all on public.restaurant_bills from public, anon, authenticated;
grant select on public.restaurant_staff_grants to authenticated;
grant select on public.restaurant_order_items to authenticated;
grant select on public.restaurant_bills to authenticated;

create or replace function public.restaurant_can(p_branch text, p_capability text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  branch text;
begin
  if lower(trim(coalesce(p_branch, ''))) ~ '(hettin|hittin|حطين)' then
    return false;
  end if;
  branch := public.nac_normalize_branch_id(p_branch);
  if branch is null or branch = 'hettin' then
    return false;
  end if;
  return exists (
    select 1
    from public.restaurant_staff_grants g
    where lower(g.email) = public.nac_auth_email()
      and (g.branch_id = branch or (g.branch_id = '*' and g.role = 'administrator'))
      and (
        (p_capability = 'guest_contact' and g.role in ('host', 'manager', 'administrator'))
        or (p_capability = 'service_write' and g.role in ('host', 'waiter', 'manager', 'administrator'))
        or (p_capability = 'kitchen_read' and g.role in ('kitchen', 'manager', 'administrator'))
        or (p_capability = 'bill_read' and g.role in ('cashier', 'manager', 'administrator'))
        or (p_capability = 'layout_write' and g.role in ('manager', 'administrator'))
      )
  );
end;
$$;

create or replace function public.restaurant_branch_allowed(p_branch text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.restaurant_can(p_branch, 'service_write')
    or public.restaurant_can(p_branch, 'kitchen_read')
    or public.restaurant_can(p_branch, 'bill_read');
$$;

revoke all on function public.restaurant_can(text, text) from public, anon;
grant execute on function public.restaurant_can(text, text) to authenticated;

drop policy if exists restaurant_guests_staff_select on public.restaurant_guests;
create policy restaurant_guests_contact_select on public.restaurant_guests
  for select to authenticated
  using (public.restaurant_can(branch_id, 'guest_contact'));

drop policy if exists restaurant_order_items_staff_select on public.restaurant_order_items;
create policy restaurant_order_items_staff_select on public.restaurant_order_items
  for select to authenticated
  using (
    public.restaurant_can(branch_id, 'service_write')
    or public.restaurant_can(branch_id, 'kitchen_read')
  );

drop policy if exists restaurant_bills_staff_select on public.restaurant_bills;
create policy restaurant_bills_staff_select on public.restaurant_bills
  for select to authenticated
  using (public.restaurant_can(branch_id, 'bill_read') or public.restaurant_can(branch_id, 'service_write'));

drop policy if exists restaurant_staff_grants_self_select on public.restaurant_staff_grants;
create policy restaurant_staff_grants_self_select on public.restaurant_staff_grants
  for select to authenticated
  using (
    lower(email) = public.nac_auth_email()
    or exists (
      select 1 from public.restaurant_staff_grants admin
      where lower(admin.email) = public.nac_auth_email()
        and admin.role = 'administrator'
    )
  );

create or replace function public.restaurant_mark_arrived(
  p_reservation_id uuid,
  p_expected_revision integer
) returns public.restaurant_reservations
language plpgsql
security definer
set search_path = public
as $$
declare
  res public.restaurant_reservations;
begin
  select * into res from public.restaurant_reservations where id = p_reservation_id for update;
  if not found then raise exception 'reservation_not_found'; end if;
  if not public.restaurant_can(res.branch_id, 'service_write') then raise exception 'branch_forbidden'; end if;
  if res.revision <> p_expected_revision then raise exception 'service_conflict'; end if;
  if res.status <> 'booked' then raise exception 'reservation_not_booked'; end if;
  update public.restaurant_reservations
    set status = 'arrived', revision = revision + 1
    where id = res.id
    returning * into res;
  perform public.restaurant_audit(res.branch_id, 'reservation_arrived', res.id::text, '{}'::jsonb);
  return res;
end;
$$;

create or replace function public.restaurant_add_item(
  p_order_id text,
  p_item_name text,
  p_quantity integer,
  p_note text default null,
  p_allergy_alert text default null
) returns public.restaurant_order_items
language plpgsql
security definer
set search_path = public
as $$
declare
  ord public.restaurant_orders;
  row public.restaurant_order_items;
begin
  select * into ord from public.restaurant_orders where id = p_order_id;
  if not found then raise exception 'order_not_found'; end if;
  if not public.restaurant_can(ord.branch_id, 'service_write') then raise exception 'branch_forbidden'; end if;
  if nullif(trim(coalesce(p_item_name, '')), '') is null then raise exception 'item_name_required'; end if;
  insert into public.restaurant_order_items (order_id, branch_id, item_name, quantity, note, allergy_alert)
  values (ord.id, ord.branch_id, trim(p_item_name), coalesce(p_quantity, 1), nullif(trim(coalesce(p_note, '')), ''), nullif(trim(coalesce(p_allergy_alert, '')), ''))
  returning * into row;
  perform public.restaurant_audit(ord.branch_id, 'item_added', row.id::text, jsonb_build_object('order_id', ord.id));
  return row;
end;
$$;

create or replace function public.restaurant_kitchen_items(p_branch text)
returns table (item_id uuid, order_id text, item_name text, quantity integer, note text, allergy_alert text, status text)
language sql
stable
security definer
set search_path = public
as $$
  select i.id, i.order_id, i.item_name, i.quantity, i.note, i.allergy_alert, i.status
  from public.restaurant_order_items i
  where public.restaurant_can(p_branch, 'kitchen_read')
    and i.branch_id = public.nac_normalize_branch_id(p_branch);
$$;

create or replace function public.restaurant_open_bill(p_bill_id text, p_session_id text)
returns public.restaurant_bills
language plpgsql
security definer
set search_path = public
as $$
declare
  session public.restaurant_sessions;
  row public.restaurant_bills;
begin
  select * into session from public.restaurant_sessions where id = p_session_id and status = 'open';
  if not found then raise exception 'session_not_open'; end if;
  if not public.restaurant_can(session.branch_id, 'bill_read')
     and not public.restaurant_can(session.branch_id, 'service_write') then
    raise exception 'branch_forbidden';
  end if;
  insert into public.restaurant_bills (id, session_id, branch_id, status)
  values (p_bill_id, session.id, session.branch_id, 'open')
  returning * into row;
  perform public.restaurant_audit(session.branch_id, 'bill_opened', row.id, jsonb_build_object('payment', 'not_captured'));
  return row;
end;
$$;

revoke all on function public.restaurant_mark_arrived(uuid, integer) from public, anon;
revoke all on function public.restaurant_add_item(text, text, integer, text, text) from public, anon;
revoke all on function public.restaurant_kitchen_items(text) from public, anon;
revoke all on function public.restaurant_open_bill(text, text) from public, anon;
grant execute on function public.restaurant_mark_arrived(uuid, integer) to authenticated;
grant execute on function public.restaurant_add_item(text, text, integer, text, text) to authenticated;
grant execute on function public.restaurant_kitchen_items(text) to authenticated;
grant execute on function public.restaurant_open_bill(text, text) to authenticated;
