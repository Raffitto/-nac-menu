\set ON_ERROR_STOP on

do $$
declare
  guest_id uuid;
  reservation_id uuid;
  seated_revision integer;
  session_revision integer;
  moved_revision integer;
  layout_id uuid;
  layout_revision integer;
  version_id uuid;
  restored jsonb;
begin
  perform set_config('request.jwt.claim.email', 'host.khobar@nac.test', false);
  perform public.restaurant_register_table('khobar:22', 'khobar', '22');
  perform public.restaurant_register_table('khobar:23', 'khobar', '23');
  perform public.restaurant_register_table('khobar:24', 'khobar', '24');

  begin
    perform public.restaurant_register_table('hettin:1', 'hettin', '1');
    raise exception 'hettin_was_accepted';
  exception when others then
    if sqlerrm <> 'branch_forbidden' then raise; end if;
  end;

  guest_id := (public.restaurant_create_guest('khobar', 'Hana', null)).id;
  reservation_id := (public.restaurant_create_reservation(guest_id, 2, current_date, '19:30')).id;
  if (public.restaurant_assign_table(reservation_id, 'khobar:22', 0)).status <> 'seated' then
    raise exception 'assign_failed';
  end if;
  select revision into seated_revision from public.restaurant_reservations where id = reservation_id;

  begin
    perform public.restaurant_assign_table(reservation_id, 'khobar:23', 0);
    raise exception 'stale_assign_succeeded';
  exception when others then
    if sqlerrm not in ('service_conflict', 'reservation_not_waiting') then raise; end if;
  end;

  perform public.restaurant_open_session('session-hana', reservation_id, seated_revision);
  perform public.restaurant_add_order('order-hana', 'session-hana');
  select revision into session_revision from public.restaurant_sessions where id = 'session-hana';
  perform public.restaurant_move_table('session-hana', 'khobar:23', session_revision);
  if (select session_id from public.restaurant_orders where id = 'order-hana') <> 'session-hana' then
    raise exception 'order_lost_during_move';
  end if;
  if (select table_id from public.restaurant_sessions where id = 'session-hana') <> 'khobar:23' then
    raise exception 'session_did_not_move';
  end if;

  select revision into moved_revision from public.restaurant_sessions where id = 'session-hana';
  perform public.restaurant_join_tables('session-hana', 'khobar:24', moved_revision);

  begin
    perform public.restaurant_cancel_reservation(
      reservation_id,
      (select revision from public.restaurant_reservations where id = reservation_id)
    );
    raise exception 'cancel_with_open_session_succeeded';
  exception when others then
    if sqlerrm <> 'session_open' then raise; end if;
  end;

  begin
    perform public.restaurant_retire_table('khobar:23');
    raise exception 'retire_occupied_table_succeeded';
  exception when others then
    if sqlerrm <> 'table_in_service' then raise; end if;
  end;

  select id, revision into layout_id, layout_revision
  from public.restaurant_save_layout('khobar', 'Weekday', '{"tables":[{"id":"khobar:22","label":"22"}]}'::jsonb);
  version_id := (public.restaurant_publish_layout(layout_id, layout_revision)).id;
  update public.restaurant_floor_layouts set document = '{"tables":[]}'::jsonb where id = layout_id;
  restored := (public.restaurant_restore_layout_version(version_id)).document;
  if restored -> 'tables' -> 0 ->> 'id' <> 'khobar:22' then
    raise exception 'layout_restore_lost_table_identity';
  end if;

  perform public.restaurant_add_waitlist('khobar', 'Nora', 3);
end $$;

set role authenticated;
select set_config('request.jwt.claim.email', 'host.riyadh@nac.test', false);
do $$
begin
  if (select count(*) from public.restaurant_reservations) <> 0 then
    raise exception 'riyadh_saw_khobar_reservations';
  end if;
  begin
    perform public.restaurant_register_table('khobar:99', 'khobar', '99');
    raise exception 'riyadh_wrote_khobar';
  exception when others then
    if sqlerrm <> 'branch_forbidden' then raise; end if;
  end;
end $$;
reset role;

set role authenticated;
select set_config('request.jwt.claim.email', 'outsider@nac.test', false);
do $$
begin
  begin
    perform public.restaurant_create_guest('jeddah', 'Stranger', null);
    raise exception 'restricted_role_was_treated_as_authorized';
  exception when others then
    if sqlerrm <> 'branch_forbidden' then raise; end if;
  end;
end $$;
reset role;

\echo restaurant_foundation_ok
