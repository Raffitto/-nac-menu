-- No-shows and reservation changes. Does not enable guest ordering or payments.
-- Rollback: drop function public.restaurant_mark_no_show(uuid, integer);
--           drop function public.restaurant_update_reservation(uuid, integer, integer, date, text);

create or replace function public.restaurant_mark_no_show(
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
  if not public.restaurant_branch_allowed(res.branch_id) then raise exception 'branch_forbidden'; end if;
  if res.revision <> p_expected_revision then raise exception 'service_conflict'; end if;
  if res.status not in ('booked', 'arrived') then raise exception 'reservation_closed'; end if;
  if exists (
    select 1 from public.restaurant_sessions s
    where s.reservation_id = res.id and s.status = 'open'
  ) then
    raise exception 'session_open';
  end if;
  update public.restaurant_reservations
    set status = 'no_show', table_id = null, revision = revision + 1
    where id = res.id
    returning * into res;
  perform public.restaurant_audit(res.branch_id, 'reservation_no_show', res.id::text, '{}'::jsonb);
  return res;
end;
$$;

create or replace function public.restaurant_update_reservation(
  p_reservation_id uuid,
  p_expected_revision integer,
  p_party_size integer,
  p_date date,
  p_time text
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
  if not public.restaurant_branch_allowed(res.branch_id) then raise exception 'branch_forbidden'; end if;
  if res.revision <> p_expected_revision then raise exception 'service_conflict'; end if;
  if res.status not in ('booked', 'arrived') then raise exception 'reservation_closed'; end if;
  if p_party_size is null or p_party_size < 1 or p_party_size > 99 then raise exception 'party_size_invalid'; end if;
  update public.restaurant_reservations
    set party_size = p_party_size,
        service_date = coalesce(p_date, service_date),
        service_time = coalesce(nullif(trim(p_time), ''), service_time),
        revision = revision + 1
    where id = res.id
    returning * into res;
  perform public.restaurant_audit(res.branch_id, 'reservation_updated', res.id::text, jsonb_build_object(
    'party_size', res.party_size,
    'service_date', res.service_date,
    'service_time', res.service_time
  ));
  return res;
end;
$$;

revoke all on function public.restaurant_mark_no_show(uuid, integer) from public, anon;
revoke all on function public.restaurant_update_reservation(uuid, integer, integer, date, text) from public, anon;
grant execute on function public.restaurant_mark_no_show(uuid, integer) to authenticated, nac_restaurant_api;
grant execute on function public.restaurant_update_reservation(uuid, integer, integer, date, text) to authenticated, nac_restaurant_api;
