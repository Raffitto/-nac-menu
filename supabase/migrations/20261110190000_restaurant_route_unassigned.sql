-- Route a saved unassigned item and edit station configuration.
-- Does not change stored prices or historical station text.
-- Does not seed station assignments. Do not apply this file to production.
-- Rollback: drop function public.restaurant_route_unassigned_item(uuid, uuid);
--           drop function public.restaurant_update_station(uuid, text, boolean);

create or replace function public.restaurant_update_station(
  p_station_id uuid,
  p_name text,
  p_active boolean
) returns public.restaurant_stations
language plpgsql
security definer
set search_path = public
as $$
declare
  station public.restaurant_stations;
  next_name text;
begin
  select * into station from public.restaurant_stations where id = p_station_id for update;
  if not found then raise exception 'station_not_configured'; end if;
  if not public.restaurant_can(station.branch_id, 'layout_write') then raise exception 'role_forbidden'; end if;
  next_name := trim(coalesce(p_name, ''));
  if next_name = '' then raise exception 'station_name_required'; end if;
  update public.restaurant_stations
    set name = next_name, active = coalesce(p_active, station.active)
    where id = station.id
    returning * into station;
  perform public.restaurant_audit(station.branch_id, 'station_updated', station.id::text, jsonb_build_object(
    'code', station.code, 'name', station.name, 'active', station.active
  ));
  return station;
end;
$$;

create or replace function public.restaurant_route_unassigned_item(
  p_item_id uuid,
  p_station_id uuid
) returns public.restaurant_order_items
language plpgsql
security definer
set search_path = public
as $$
declare
  item public.restaurant_order_items;
  station public.restaurant_stations;
begin
  select * into item from public.restaurant_order_items where id = p_item_id for update;
  if not found then raise exception 'item_not_found'; end if;
  if not public.restaurant_can(item.branch_id, 'layout_write') then raise exception 'role_forbidden'; end if;
  if item.line_minor is null then raise exception 'price_snapshot_required'; end if;
  select * into station from public.restaurant_stations where id = p_station_id and active = true;
  if not found or station.branch_id <> item.branch_id then raise exception 'station_not_configured'; end if;
  if item.station_code is not null then
    if item.station_code = station.code then return item; end if;
    raise exception 'station_already_recorded';
  end if;
  update public.restaurant_order_items
    set station_id = station.id, station_code = station.code, station_name = station.name
    where id = item.id
    returning * into item;
  perform public.restaurant_audit(item.branch_id, 'item_routed', item.id::text, jsonb_build_object(
    'station_code', station.code,
    'line_minor', item.line_minor
  ));
  return item;
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
  if item.line_minor is not null and item.station_code is null then
    raise exception 'station_not_configured';
  end if;
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

revoke all on function public.restaurant_update_station(uuid, text, boolean) from public, anon;
revoke all on function public.restaurant_route_unassigned_item(uuid, uuid) from public, anon;
grant execute on function public.restaurant_update_station(uuid, text, boolean) to authenticated, nac_restaurant_api;
grant execute on function public.restaurant_route_unassigned_item(uuid, uuid) to authenticated, nac_restaurant_api;
grant execute on function public.restaurant_set_item_status(uuid, text) to authenticated, nac_restaurant_api;
