-- Production-intended order modifiers. No credentials.
-- Adds the modifier list used to recompute a line from the published menu.
-- Rollback: drop function public.restaurant_set_item_modifiers(uuid, jsonb);
--           alter table public.restaurant_order_items drop column if exists modifier_ids;

alter table public.restaurant_order_items
  add column if not exists modifier_ids jsonb;

create or replace function public.restaurant_set_item_modifiers(p_item_id uuid, p_ids jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  row public.restaurant_order_items;
begin
  select * into row from public.restaurant_order_items where id = p_item_id;
  if not found then raise exception 'item_not_found'; end if;
  if not public.restaurant_can(row.branch_id, 'service_write') then raise exception 'branch_forbidden'; end if;
  update public.restaurant_order_items
    set modifier_ids = coalesce(p_ids, '[]'::jsonb)
    where id = p_item_id;
end;
$$;

revoke all on function public.restaurant_set_item_modifiers(uuid, jsonb) from public, anon;
grant execute on function public.restaurant_set_item_modifiers(uuid, jsonb) to authenticated;

-- Waitlist becomes a reservation. The waitlist row keeps its reservation id.
alter table public.restaurant_waitlist drop constraint if exists restaurant_waitlist_status_check;
alter table public.restaurant_waitlist
  add constraint restaurant_waitlist_status_check
  check (status in ('waiting', 'booked', 'seated', 'cancelled', 'no_show'));

create or replace function public.restaurant_book_waitlist(
  p_waitlist_id uuid,
  p_service_date date,
  p_service_time text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  entry public.restaurant_waitlist;
  guest public.restaurant_guests;
  reservation public.restaurant_reservations;
begin
  select * into entry from public.restaurant_waitlist where id = p_waitlist_id for update;
  if not found then raise exception 'waitlist_not_found'; end if;
  if entry.status <> 'waiting' then raise exception 'waitlist_not_waiting'; end if;
  if not public.restaurant_can(entry.branch_id, 'service_write') then raise exception 'branch_forbidden'; end if;
  if entry.reservation_id is not null then return entry.reservation_id; end if;
  select * into guest from public.restaurant_create_guest(entry.branch_id, entry.name, null);
  select * into reservation from public.restaurant_create_reservation(guest.id, entry.party_size, p_service_date, p_service_time);
  update public.restaurant_waitlist
    set status = 'booked', reservation_id = reservation.id
    where id = entry.id;
  perform public.restaurant_audit(entry.branch_id, 'waitlist_booked', entry.id::text, jsonb_build_object('reservation_id', reservation.id));
  return reservation.id;
end;
$$;

revoke all on function public.restaurant_book_waitlist(uuid, date, text) from public, anon;
grant execute on function public.restaurant_book_waitlist(uuid, date, text) to authenticated;
