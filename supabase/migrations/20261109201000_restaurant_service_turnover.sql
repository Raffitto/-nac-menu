-- Local development extensions for the isolated restaurant database.
-- Do not apply to production. No card payment is captured.

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
  if p_status not in ('queued', 'preparing', 'ready', 'served', 'cancelled') then
    raise exception 'status_invalid';
  end if;
  select * into ord from public.restaurant_orders where id = p_order_id;
  if not found then raise exception 'order_not_found'; end if;
  if not public.restaurant_can(ord.branch_id, 'kitchen_read')
     and not public.restaurant_can(ord.branch_id, 'service_write') then
    raise exception 'branch_forbidden';
  end if;
  update public.restaurant_order_items
    set status = p_status
    where order_id = ord.id and status <> 'cancelled';
  get diagnostics updated = row_count;
  perform public.restaurant_audit(ord.branch_id, 'order_status', ord.id, jsonb_build_object('status', p_status));
  return updated;
end;
$$;

create or replace function public.restaurant_close_unpaid(p_session_id text)
returns public.restaurant_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  session public.restaurant_sessions;
  bill public.restaurant_bills;
begin
  select * into session from public.restaurant_sessions where id = p_session_id and status = 'open' for update;
  if not found then raise exception 'session_not_open'; end if;
  if not public.restaurant_can(session.branch_id, 'bill_read')
     and not public.restaurant_can(session.branch_id, 'service_write') then
    raise exception 'branch_forbidden';
  end if;
  select * into bill from public.restaurant_bills where session_id = session.id and status = 'open' for update;
  if not found then raise exception 'bill_not_open'; end if;
  update public.restaurant_bills set status = 'closed_unpaid' where id = bill.id;
  update public.restaurant_sessions set status = 'closed', revision = revision + 1 where id = session.id returning * into session;
  update public.restaurant_reservations
    set status = 'completed', revision = revision + 1
    where id = session.reservation_id;
  update public.restaurant_tables
    set hold = 'cleaning'
    where id in (
      select table_id from public.restaurant_session_tables where session_id = session.id
    );
  perform public.restaurant_audit(session.branch_id, 'session_closed_unpaid', session.id, jsonb_build_object('payment', 'not_captured'));
  return session;
end;
$$;

revoke all on function public.restaurant_set_order_status(text, text) from public, anon;
revoke all on function public.restaurant_close_unpaid(text) from public, anon;
grant execute on function public.restaurant_set_order_status(text, text) to authenticated;
grant execute on function public.restaurant_close_unpaid(text) to authenticated;
