-- Waitlist cancellation, seating, and guest updates from staff input.
-- A visit is derived from a closed session. This file does not insert visit rows.
-- Rollback: drop function public.restaurant_cancel_waitlist(uuid);
--           drop function public.restaurant_seat_waitlist(uuid, text);
--           drop function public.restaurant_update_guest(uuid, jsonb);

create or replace function public.restaurant_cancel_waitlist(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  entry public.restaurant_waitlist;
begin
  select * into entry from public.restaurant_waitlist where id = p_id for update;
  if not found then raise exception 'waitlist_not_found'; end if;
  if not public.restaurant_can(entry.branch_id, 'service_write') then raise exception 'branch_forbidden'; end if;
  if entry.status <> 'waiting' then raise exception 'waitlist_not_waiting'; end if;
  update public.restaurant_waitlist set status = 'cancelled' where id = entry.id;
  perform public.restaurant_audit(entry.branch_id, 'waitlist_cancelled', entry.id::text, '{}'::jsonb);
end;
$$;

create or replace function public.restaurant_seat_waitlist(
  p_id uuid,
  p_table_id text
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
  select * into entry from public.restaurant_waitlist where id = p_id for update;
  if not found then raise exception 'waitlist_not_found'; end if;
  if not public.restaurant_can(entry.branch_id, 'service_write') then raise exception 'branch_forbidden'; end if;
  if entry.status <> 'waiting' then raise exception 'waitlist_not_waiting'; end if;
  guest := public.restaurant_create_guest(entry.branch_id, entry.name, null);
  reservation := public.restaurant_create_reservation(guest.id, entry.party_size, current_date, to_char(now(), 'HH24:MI'));
  reservation := public.restaurant_assign_table(reservation.id, p_table_id, reservation.revision);
  update public.restaurant_waitlist
    set status = 'seated', reservation_id = reservation.id
    where id = entry.id;
  perform public.restaurant_audit(entry.branch_id, 'waitlist_seated', entry.id::text, jsonb_build_object('reservation_id', reservation.id, 'table_id', p_table_id));
  return reservation.id;
end;
$$;

create or replace function public.restaurant_update_guest(
  p_id uuid,
  p_patch jsonb
) returns public.restaurant_guests
language plpgsql
security definer
set search_path = public
as $$
declare
  guest public.restaurant_guests;
begin
  select * into guest from public.restaurant_guests where id = p_id for update;
  if not found then raise exception 'guest_not_found'; end if;
  if not public.restaurant_can(guest.branch_id, 'guest_contact') then raise exception 'branch_forbidden'; end if;
  update public.restaurant_guests
    set allergies = case when p_patch ? 'allergies' then nullif(trim(coalesce(p_patch->>'allergies', '')), '') else allergies end,
        preferences = case when p_patch ? 'preferences' then nullif(trim(coalesce(p_patch->>'preferences', '')), '') else preferences end,
        notes = case when p_patch ? 'notes' then nullif(trim(coalesce(p_patch->>'notes', '')), '') else notes end,
        vip = case when p_patch ? 'vip' then coalesce((p_patch->>'vip')::boolean, false) else vip end
    where id = guest.id
    returning * into guest;
  perform public.restaurant_audit(guest.branch_id, 'guest_updated', guest.id::text, jsonb_build_object('fields', (select jsonb_agg(key) from jsonb_object_keys(p_patch) key)));
  return guest;
end;
$$;

revoke all on function public.restaurant_cancel_waitlist(uuid) from public, anon;
revoke all on function public.restaurant_seat_waitlist(uuid, text) from public, anon;
revoke all on function public.restaurant_update_guest(uuid, jsonb) from public, anon;
grant execute on function public.restaurant_cancel_waitlist(uuid) to authenticated, nac_restaurant_api;
grant execute on function public.restaurant_seat_waitlist(uuid, text) to authenticated, nac_restaurant_api;
grant execute on function public.restaurant_update_guest(uuid, jsonb) to authenticated, nac_restaurant_api;
