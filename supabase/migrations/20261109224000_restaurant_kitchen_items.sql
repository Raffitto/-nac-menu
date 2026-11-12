-- Item preparation status and duplicate-send protection.
-- Accepted is a staff action, not a preparation-time standard.
-- Rollback: drop function public.restaurant_set_item_status(uuid, text);
--           drop function public.restaurant_add_keyed_item(text, text, integer, text, text, text);
--           alter table public.restaurant_order_items drop column if exists status_at;
--           alter table public.restaurant_order_items drop column if exists client_key;

alter table public.restaurant_order_items
  add column if not exists status_at timestamptz not null default now(),
  add column if not exists client_key text;

alter table public.restaurant_order_items drop constraint if exists restaurant_order_items_status_check;
alter table public.restaurant_order_items add constraint restaurant_order_items_status_check
  check (status in ('queued', 'accepted', 'preparing', 'ready', 'served', 'cancelled'));

create unique index if not exists restaurant_order_items_client_key
  on public.restaurant_order_items (order_id, client_key)
  where client_key is not null;

create or replace function public.restaurant_set_order_status(
  p_order_id text,
  p_status text
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  ord public.restaurant_orders;
  updated integer;
begin
  if p_status not in ('queued', 'accepted', 'preparing', 'ready', 'served', 'cancelled') then
    raise exception 'status_invalid';
  end if;
  select * into ord from public.restaurant_orders where id = p_order_id;
  if not found then raise exception 'order_not_found'; end if;
  if p_status = 'cancelled' then
    if not exists (
      select 1 from public.restaurant_staff_grants g
      where lower(g.email) = lower(public.nac_auth_email())
        and g.branch_id = ord.branch_id
        and g.role in ('manager', 'administrator')
    ) then
      raise exception 'role_forbidden';
    end if;
  elsif not public.restaurant_can(ord.branch_id, 'kitchen_read')
     and not public.restaurant_can(ord.branch_id, 'service_write') then
    raise exception 'branch_forbidden';
  end if;
  update public.restaurant_order_items
    set status = p_status, status_at = now()
    where order_id = ord.id and status <> 'cancelled';
  get diagnostics updated = row_count;
  perform public.restaurant_audit(ord.branch_id, 'order_status', ord.id, jsonb_build_object('status', p_status));
  return updated;
end;
$$;

create or replace function public.restaurant_set_item_status(
  p_item_id uuid,
  p_status text
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  item public.restaurant_order_items;
begin
  if p_status not in ('accepted', 'preparing', 'ready', 'served', 'cancelled') then
    raise exception 'status_invalid';
  end if;
  select * into item from public.restaurant_order_items where id = p_item_id for update;
  if not found then raise exception 'item_not_found'; end if;
  if item.status = 'cancelled' then raise exception 'item_not_found'; end if;
  if p_status = 'cancelled' then
    if not exists (
      select 1 from public.restaurant_staff_grants g
      where lower(g.email) = lower(public.nac_auth_email())
        and g.branch_id = item.branch_id
        and g.role in ('manager', 'administrator')
    ) then
      raise exception 'role_forbidden';
    end if;
  elsif not public.restaurant_can(item.branch_id, 'kitchen_read')
     and not public.restaurant_can(item.branch_id, 'service_write') then
    raise exception 'branch_forbidden';
  end if;
  update public.restaurant_order_items
    set status = p_status, status_at = now()
    where id = item.id;
  perform public.restaurant_audit(item.branch_id, 'item_status', item.id::text, jsonb_build_object('status', p_status));
  return p_status;
end;
$$;

create or replace function public.restaurant_add_keyed_item(
  p_order_id text,
  p_item_name text,
  p_quantity integer,
  p_note text,
  p_allergy_alert text,
  p_client_key text
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
  if nullif(trim(coalesce(p_client_key, '')), '') is null then raise exception 'client_key_required'; end if;
  select * into row from public.restaurant_order_items
    where order_id = ord.id and client_key = trim(p_client_key);
  if found then return row; end if;
  begin
    insert into public.restaurant_order_items (order_id, branch_id, item_name, quantity, note, allergy_alert, client_key)
    values (
      ord.id, ord.branch_id, trim(p_item_name), coalesce(p_quantity, 1),
      nullif(trim(coalesce(p_note, '')), ''), nullif(trim(coalesce(p_allergy_alert, '')), ''), trim(p_client_key)
    )
    returning * into row;
  exception when unique_violation then
    select * into row from public.restaurant_order_items
      where order_id = ord.id and client_key = trim(p_client_key);
    return row;
  end;
  perform public.restaurant_audit(ord.branch_id, 'item_added', row.id::text, jsonb_build_object('order_id', ord.id, 'client_key', trim(p_client_key)));
  return row;
end;
$$;

revoke all on function public.restaurant_set_item_status(uuid, text) from public, anon;
revoke all on function public.restaurant_add_keyed_item(text, text, integer, text, text, text) from public, anon;
grant execute on function public.restaurant_set_item_status(uuid, text) to authenticated, nac_restaurant_api;
grant execute on function public.restaurant_add_keyed_item(text, text, integer, text, text, text) to authenticated, nac_restaurant_api;
