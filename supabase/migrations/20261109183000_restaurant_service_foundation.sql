-- Restaurant service foundation. Do not apply to production without explicit approval.
-- No guest, reservation, table, or layout rows are inserted.
-- Branch checks reuse nac_menu_can_edit_branch and nac_normalize_branch_id.
-- On production main those helpers only recognize khobar, riyadh, and jeddah.
-- Hettin stays rejected here even if a later identity migration recognizes the name.
-- Laysen Valley is not given a new id. It remains the historical riyadh id once that
-- identity migration is approved. This file does not perform that rename.
-- Rollback for an unused isolated database is at the bottom. Do not run it on production.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon;
  end if;
end $$;

grant usage on schema public to authenticated, anon;

create or replace function public.restaurant_branch_allowed(p_branch text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_branch is null or public.nac_normalize_branch_id(p_branch) is null then
    return false;
  end if;
  if lower(trim(p_branch)) ~ '(hettin|hittin|حطين)' then
    return false;
  end if;
  if public.nac_normalize_branch_id(p_branch) = 'hettin' then
    return false;
  end if;
  if exists (
    select 1
    from public.menu_staff_scope s
    where lower(s.email) = public.nac_auth_email()
      and s.role = 'restricted'
      and not public.nac_menu_staff_all_branches()
  ) then
    return false;
  end if;
  return public.nac_menu_can_edit_branch(p_branch);
end;
$$;

revoke all on function public.restaurant_branch_allowed(text) from public, anon;
grant execute on function public.restaurant_branch_allowed(text) to authenticated;

create table if not exists public.restaurant_floor_layouts (
  id uuid primary key default gen_random_uuid(),
  branch_id text not null,
  name text not null,
  status text not null default 'draft' check (status in ('draft', 'published')),
  document jsonb not null default '{}'::jsonb,
  revision integer not null default 0,
  created_by text,
  created_at timestamptz not null default now(),
  constraint restaurant_floor_layouts_branch_check
    check (branch_id = public.nac_normalize_branch_id(branch_id))
);

create table if not exists public.restaurant_layout_versions (
  id uuid primary key default gen_random_uuid(),
  layout_id uuid not null references public.restaurant_floor_layouts(id),
  branch_id text not null,
  snapshot jsonb not null,
  created_by text,
  created_at timestamptz not null default now(),
  constraint restaurant_layout_versions_branch_check
    check (branch_id = public.nac_normalize_branch_id(branch_id))
);

create table if not exists public.restaurant_tables (
  id text primary key,
  branch_id text not null,
  label text not null,
  active boolean not null default true,
  removed_at timestamptz,
  hold text check (hold is null or hold in ('blocked', 'cleaning')),
  created_at timestamptz not null default now(),
  constraint restaurant_tables_branch_check
    check (branch_id = public.nac_normalize_branch_id(branch_id))
);

create table if not exists public.restaurant_guests (
  id uuid primary key default gen_random_uuid(),
  branch_id text not null,
  name text not null,
  phone text,
  created_at timestamptz not null default now(),
  constraint restaurant_guests_branch_check
    check (branch_id = public.nac_normalize_branch_id(branch_id)),
  constraint restaurant_guests_name_check check (length(trim(name)) > 0)
);

create table if not exists public.restaurant_reservations (
  id uuid primary key default gen_random_uuid(),
  branch_id text not null,
  guest_id uuid not null references public.restaurant_guests(id),
  party_size integer not null check (party_size >= 1),
  service_date date,
  service_time text,
  status text not null default 'booked'
    check (status in ('booked', 'arrived', 'seated', 'completed', 'cancelled', 'no_show')),
  table_id text references public.restaurant_tables(id),
  revision integer not null default 0,
  created_at timestamptz not null default now(),
  constraint restaurant_reservations_branch_check
    check (branch_id = public.nac_normalize_branch_id(branch_id))
);

create unique index if not exists restaurant_one_seated_reservation_per_table
  on public.restaurant_reservations (table_id)
  where status = 'seated' and table_id is not null;

create table if not exists public.restaurant_waitlist (
  id uuid primary key default gen_random_uuid(),
  branch_id text not null,
  name text not null,
  party_size integer not null check (party_size >= 1),
  status text not null default 'waiting'
    check (status in ('waiting', 'seated', 'cancelled', 'no_show')),
  reservation_id uuid references public.restaurant_reservations(id),
  estimate_note text,
  created_at timestamptz not null default now(),
  constraint restaurant_waitlist_branch_check
    check (branch_id = public.nac_normalize_branch_id(branch_id))
);

create table if not exists public.restaurant_sessions (
  id text primary key,
  branch_id text not null,
  reservation_id uuid references public.restaurant_reservations(id),
  table_id text not null references public.restaurant_tables(id),
  status text not null check (status in ('open', 'closed')),
  revision integer not null default 0,
  created_at timestamptz not null default now(),
  constraint restaurant_sessions_branch_check
    check (branch_id = public.nac_normalize_branch_id(branch_id))
);

create unique index if not exists restaurant_one_open_session_per_table
  on public.restaurant_sessions (table_id)
  where status = 'open';

create unique index if not exists restaurant_one_open_session_per_reservation
  on public.restaurant_sessions (reservation_id)
  where status = 'open' and reservation_id is not null;

create table if not exists public.restaurant_orders (
  id text primary key,
  session_id text not null references public.restaurant_sessions(id),
  branch_id text not null,
  status text not null,
  revision integer not null default 0,
  created_at timestamptz not null default now(),
  constraint restaurant_orders_branch_check
    check (branch_id = public.nac_normalize_branch_id(branch_id))
);

create table if not exists public.restaurant_session_tables (
  session_id text not null references public.restaurant_sessions(id),
  table_id text not null references public.restaurant_tables(id),
  relationship text not null check (relationship in ('primary', 'joined')),
  primary key (session_id, table_id)
);

create table if not exists public.restaurant_audit_events (
  id uuid primary key default gen_random_uuid(),
  branch_id text not null,
  action text not null,
  entity_id text not null,
  actor_email text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.restaurant_audit(
  p_branch text,
  p_action text,
  p_entity text,
  p_detail jsonb default '{}'::jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.restaurant_audit_events (branch_id, action, entity_id, actor_email, detail)
  values (p_branch, p_action, p_entity, public.nac_auth_email(), coalesce(p_detail, '{}'::jsonb));
end;
$$;

revoke all on function public.restaurant_audit(text, text, text, jsonb) from public, anon;

create or replace function public.restaurant_register_table(
  p_id text,
  p_branch text,
  p_label text
) returns public.restaurant_tables
language plpgsql
security definer
set search_path = public
as $$
declare
  row public.restaurant_tables;
  branch text;
begin
  if not public.restaurant_branch_allowed(p_branch) then
    raise exception 'branch_forbidden';
  end if;
  branch := public.nac_normalize_branch_id(p_branch);
  if p_id is null or position(branch || ':' in p_id) <> 1 then
    raise exception 'table_identity_required';
  end if;
  if exists (select 1 from public.restaurant_tables where id = p_id) then
    raise exception 'table_identity_exists';
  end if;
  insert into public.restaurant_tables (id, branch_id, label)
  values (p_id, branch, trim(p_label))
  returning * into row;
  perform public.restaurant_audit(branch, 'table_registered', p_id, jsonb_build_object('label', trim(p_label)));
  return row;
end;
$$;

create or replace function public.restaurant_rename_table(
  p_id text,
  p_label text
) returns public.restaurant_tables
language plpgsql
security definer
set search_path = public
as $$
declare
  row public.restaurant_tables;
begin
  select * into row from public.restaurant_tables where id = p_id for update;
  if not found then raise exception 'table_not_found'; end if;
  if not public.restaurant_branch_allowed(row.branch_id) then raise exception 'branch_forbidden'; end if;
  if exists (
    select 1 from public.restaurant_sessions s
    where s.table_id = row.id and s.status = 'open'
  ) or exists (
    select 1 from public.restaurant_reservations r
    where r.table_id = row.id and r.status in ('booked', 'arrived', 'seated')
  ) then
    raise exception 'table_in_service';
  end if;
  update public.restaurant_tables set label = trim(p_label) where id = row.id returning * into row;
  perform public.restaurant_audit(row.branch_id, 'table_renamed', row.id, jsonb_build_object('label', row.label));
  return row;
end;
$$;

create or replace function public.restaurant_retire_table(p_id text)
returns public.restaurant_tables
language plpgsql
security definer
set search_path = public
as $$
declare
  row public.restaurant_tables;
begin
  select * into row from public.restaurant_tables where id = p_id for update;
  if not found then raise exception 'table_not_found'; end if;
  if not public.restaurant_branch_allowed(row.branch_id) then raise exception 'branch_forbidden'; end if;
  if exists (select 1 from public.restaurant_sessions s where s.table_id = row.id and s.status = 'open')
     or exists (
       select 1 from public.restaurant_reservations r
       where r.table_id = row.id and r.status in ('booked', 'arrived', 'seated')
     ) then
    raise exception 'table_in_service';
  end if;
  update public.restaurant_tables
    set active = false, removed_at = coalesce(removed_at, now())
    where id = row.id
    returning * into row;
  perform public.restaurant_audit(row.branch_id, 'table_retired', row.id, '{}'::jsonb);
  return row;
end;
$$;

create or replace function public.restaurant_set_table_hold(p_id text, p_hold text)
returns public.restaurant_tables
language plpgsql
security definer
set search_path = public
as $$
declare
  row public.restaurant_tables;
begin
  if p_hold is not null and p_hold not in ('blocked', 'cleaning') then
    raise exception 'hold_invalid';
  end if;
  select * into row from public.restaurant_tables where id = p_id for update;
  if not found then raise exception 'table_not_found'; end if;
  if not public.restaurant_branch_allowed(row.branch_id) then raise exception 'branch_forbidden'; end if;
  if p_hold is not null and exists (
    select 1 from public.restaurant_sessions s where s.table_id = row.id and s.status = 'open'
  ) then
    raise exception 'table_in_service';
  end if;
  update public.restaurant_tables set hold = p_hold where id = row.id returning * into row;
  perform public.restaurant_audit(row.branch_id, 'table_hold', row.id, jsonb_build_object('hold', p_hold));
  return row;
end;
$$;

create or replace function public.restaurant_save_layout(
  p_branch text,
  p_name text,
  p_document jsonb
) returns public.restaurant_floor_layouts
language plpgsql
security definer
set search_path = public
as $$
declare
  row public.restaurant_floor_layouts;
  branch text;
begin
  if not public.restaurant_branch_allowed(p_branch) then raise exception 'branch_forbidden'; end if;
  branch := public.nac_normalize_branch_id(p_branch);
  insert into public.restaurant_floor_layouts (branch_id, name, status, document, created_by)
  values (branch, trim(p_name), 'draft', coalesce(p_document, '{}'::jsonb), public.nac_auth_email())
  returning * into row;
  perform public.restaurant_audit(branch, 'layout_draft_saved', row.id::text, '{}'::jsonb);
  return row;
end;
$$;

create or replace function public.restaurant_publish_layout(p_layout_id uuid, p_expected_revision integer)
returns public.restaurant_layout_versions
language plpgsql
security definer
set search_path = public
as $$
declare
  layout public.restaurant_floor_layouts;
  version public.restaurant_layout_versions;
begin
  select * into layout from public.restaurant_floor_layouts where id = p_layout_id for update;
  if not found then raise exception 'layout_not_found'; end if;
  if not public.restaurant_branch_allowed(layout.branch_id) then raise exception 'branch_forbidden'; end if;
  if layout.revision <> p_expected_revision then raise exception 'service_conflict'; end if;
  insert into public.restaurant_layout_versions (layout_id, branch_id, snapshot, created_by)
  values (
    layout.id,
    layout.branch_id,
    jsonb_build_object('name', layout.name, 'document', layout.document, 'revision', layout.revision),
    public.nac_auth_email()
  )
  returning * into version;
  update public.restaurant_floor_layouts
    set status = 'published', revision = revision + 1
    where id = layout.id;
  perform public.restaurant_audit(layout.branch_id, 'layout_published', version.id::text, '{}'::jsonb);
  return version;
end;
$$;

create or replace function public.restaurant_restore_layout_version(p_version_id uuid)
returns public.restaurant_floor_layouts
language plpgsql
security definer
set search_path = public
as $$
declare
  version public.restaurant_layout_versions;
  layout public.restaurant_floor_layouts;
begin
  select * into version from public.restaurant_layout_versions where id = p_version_id;
  if not found then raise exception 'version_not_found'; end if;
  if not public.restaurant_branch_allowed(version.branch_id) then raise exception 'branch_forbidden'; end if;
  update public.restaurant_floor_layouts
    set document = version.snapshot -> 'document',
        name = coalesce(version.snapshot ->> 'name', name),
        status = 'draft',
        revision = revision + 1
    where id = version.layout_id
    returning * into layout;
  perform public.restaurant_audit(version.branch_id, 'layout_restored', p_version_id::text, '{}'::jsonb);
  return layout;
end;
$$;

create or replace function public.restaurant_create_guest(p_branch text, p_name text, p_phone text default null)
returns public.restaurant_guests
language plpgsql
security definer
set search_path = public
as $$
declare
  row public.restaurant_guests;
  branch text;
begin
  if not public.restaurant_branch_allowed(p_branch) then raise exception 'branch_forbidden'; end if;
  if nullif(trim(coalesce(p_name, '')), '') is null then raise exception 'guest_name_required'; end if;
  branch := public.nac_normalize_branch_id(p_branch);
  insert into public.restaurant_guests (branch_id, name, phone)
  values (branch, trim(p_name), nullif(trim(coalesce(p_phone, '')), ''))
  returning * into row;
  perform public.restaurant_audit(branch, 'guest_created', row.id::text, '{}'::jsonb);
  return row;
end;
$$;

create or replace function public.restaurant_create_reservation(
  p_guest_id uuid,
  p_party_size integer,
  p_service_date date,
  p_service_time text
) returns public.restaurant_reservations
language plpgsql
security definer
set search_path = public
as $$
declare
  guest public.restaurant_guests;
  row public.restaurant_reservations;
begin
  select * into guest from public.restaurant_guests where id = p_guest_id;
  if not found then raise exception 'guest_not_found'; end if;
  if not public.restaurant_branch_allowed(guest.branch_id) then raise exception 'branch_forbidden'; end if;
  if p_party_size is null or p_party_size < 1 then raise exception 'party_size_required'; end if;
  insert into public.restaurant_reservations (branch_id, guest_id, party_size, service_date, service_time)
  values (guest.branch_id, guest.id, p_party_size, p_service_date, p_service_time)
  returning * into row;
  perform public.restaurant_audit(guest.branch_id, 'reservation_created', row.id::text, '{}'::jsonb);
  return row;
end;
$$;

create or replace function public.restaurant_assign_table(
  p_reservation_id uuid,
  p_table_id text,
  p_expected_revision integer
) returns public.restaurant_reservations
language plpgsql
security definer
set search_path = public
as $$
declare
  res public.restaurant_reservations;
  seat public.restaurant_tables;
begin
  select * into res from public.restaurant_reservations where id = p_reservation_id for update;
  if not found then raise exception 'reservation_not_found'; end if;
  if not public.restaurant_branch_allowed(res.branch_id) then raise exception 'branch_forbidden'; end if;
  if res.revision <> p_expected_revision then raise exception 'service_conflict'; end if;
  if res.status not in ('booked', 'arrived') then raise exception 'reservation_not_waiting'; end if;
  select * into seat from public.restaurant_tables where id = p_table_id for update;
  if not found or seat.branch_id <> res.branch_id or seat.active = false or seat.removed_at is not null or seat.hold is not null then
    raise exception 'table_unavailable';
  end if;
  if exists (
    select 1 from public.restaurant_reservations other
    where other.table_id = seat.id and other.id <> res.id and other.status in ('booked', 'arrived', 'seated')
  ) or exists (
    select 1 from public.restaurant_sessions s where s.table_id = seat.id and s.status = 'open'
  ) then
    raise exception 'table_unavailable';
  end if;
  update public.restaurant_reservations
    set table_id = seat.id, status = 'seated', revision = revision + 1
    where id = res.id
    returning * into res;
  perform public.restaurant_audit(res.branch_id, 'table_assigned', res.id::text, jsonb_build_object('table_id', seat.id));
  return res;
end;
$$;

create or replace function public.restaurant_cancel_reservation(
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
  if exists (
    select 1 from public.restaurant_sessions s
    where s.reservation_id = res.id and s.status = 'open'
  ) then
    raise exception 'session_open';
  end if;
  if res.status in ('completed', 'cancelled', 'no_show') then raise exception 'reservation_closed'; end if;
  update public.restaurant_reservations
    set status = 'cancelled', table_id = null, revision = revision + 1
    where id = res.id
    returning * into res;
  perform public.restaurant_audit(res.branch_id, 'reservation_cancelled', res.id::text, '{}'::jsonb);
  return res;
end;
$$;

create or replace function public.restaurant_open_session(
  p_session_id text,
  p_reservation_id uuid,
  p_expected_revision integer
) returns public.restaurant_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  res public.restaurant_reservations;
  session public.restaurant_sessions;
begin
  select * into res from public.restaurant_reservations where id = p_reservation_id for update;
  if not found then raise exception 'reservation_not_found'; end if;
  if not public.restaurant_branch_allowed(res.branch_id) then raise exception 'branch_forbidden'; end if;
  if res.revision <> p_expected_revision then raise exception 'service_conflict'; end if;
  if res.status <> 'seated' or res.table_id is null then raise exception 'reservation_not_seated'; end if;
  insert into public.restaurant_sessions (id, branch_id, reservation_id, table_id, status)
  values (p_session_id, res.branch_id, res.id, res.table_id, 'open')
  returning * into session;
  insert into public.restaurant_session_tables (session_id, table_id, relationship)
  values (session.id, session.table_id, 'primary');
  update public.restaurant_reservations set revision = revision + 1 where id = res.id;
  perform public.restaurant_audit(res.branch_id, 'session_opened', session.id, jsonb_build_object('table_id', session.table_id));
  return session;
end;
$$;

create or replace function public.restaurant_add_order(
  p_order_id text,
  p_session_id text
) returns public.restaurant_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  session public.restaurant_sessions;
  row public.restaurant_orders;
begin
  select * into session from public.restaurant_sessions where id = p_session_id and status = 'open';
  if not found then raise exception 'session_not_open'; end if;
  if not public.restaurant_branch_allowed(session.branch_id) then raise exception 'branch_forbidden'; end if;
  insert into public.restaurant_orders (id, session_id, branch_id, status)
  values (p_order_id, session.id, session.branch_id, 'open')
  returning * into row;
  perform public.restaurant_audit(session.branch_id, 'order_added', row.id, jsonb_build_object('session_id', session.id));
  return row;
end;
$$;

create or replace function public.restaurant_move_table(
  p_session_id text,
  p_to_table text,
  p_expected_revision integer
) returns public.restaurant_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  session public.restaurant_sessions;
  destination public.restaurant_tables;
begin
  select * into session from public.restaurant_sessions where id = p_session_id and status = 'open' for update;
  if not found then raise exception 'session_not_open'; end if;
  if not public.restaurant_branch_allowed(session.branch_id) then raise exception 'branch_forbidden'; end if;
  if session.revision <> p_expected_revision then raise exception 'service_conflict'; end if;
  if exists (
    select 1 from public.restaurant_session_tables link
    where link.session_id = session.id and link.relationship = 'joined'
  ) then
    raise exception 'release_combination_first';
  end if;
  select * into destination from public.restaurant_tables where id = p_to_table for update;
  if not found or destination.branch_id <> session.branch_id or destination.id = session.table_id
     or destination.active = false or destination.removed_at is not null or destination.hold is not null then
    raise exception 'table_unavailable';
  end if;
  if exists (select 1 from public.restaurant_sessions s where s.table_id = destination.id and s.status = 'open')
     or exists (
       select 1 from public.restaurant_reservations r
       where r.table_id = destination.id and r.status in ('booked', 'arrived', 'seated')
         and r.id is distinct from session.reservation_id
     ) then
    raise exception 'table_unavailable';
  end if;
  update public.restaurant_session_tables
    set table_id = destination.id
    where session_id = session.id and relationship = 'primary';
  update public.restaurant_sessions
    set table_id = destination.id, revision = revision + 1
    where id = session.id
    returning * into session;
  update public.restaurant_reservations
    set table_id = destination.id, revision = revision + 1
    where id = session.reservation_id;
  perform public.restaurant_audit(session.branch_id, 'table_moved', session.id, jsonb_build_object('table_id', destination.id));
  return session;
end;
$$;

create or replace function public.restaurant_join_tables(
  p_session_id text,
  p_table_id text,
  p_expected_revision integer
) returns public.restaurant_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  session public.restaurant_sessions;
  extra public.restaurant_tables;
begin
  select * into session from public.restaurant_sessions where id = p_session_id and status = 'open' for update;
  if not found then raise exception 'session_not_open'; end if;
  if not public.restaurant_branch_allowed(session.branch_id) then raise exception 'branch_forbidden'; end if;
  if session.revision <> p_expected_revision then raise exception 'service_conflict'; end if;
  select * into extra from public.restaurant_tables where id = p_table_id for update;
  if not found or extra.branch_id <> session.branch_id or extra.id = session.table_id
     or extra.active = false or extra.removed_at is not null or extra.hold is not null then
    raise exception 'table_unavailable';
  end if;
  if exists (select 1 from public.restaurant_sessions s where s.table_id = extra.id and s.status = 'open')
     or exists (
       select 1 from public.restaurant_reservations r
       where r.table_id = extra.id and r.status in ('booked', 'arrived', 'seated')
     ) then
    raise exception 'table_unavailable';
  end if;
  insert into public.restaurant_session_tables (session_id, table_id, relationship)
  values (session.id, extra.id, 'joined');
  update public.restaurant_sessions set revision = revision + 1 where id = session.id returning * into session;
  perform public.restaurant_audit(session.branch_id, 'tables_joined', session.id, jsonb_build_object('table_id', extra.id));
  return session;
end;
$$;

create or replace function public.restaurant_add_waitlist(
  p_branch text,
  p_name text,
  p_party_size integer
) returns public.restaurant_waitlist
language plpgsql
security definer
set search_path = public
as $$
declare
  row public.restaurant_waitlist;
  branch text;
begin
  if not public.restaurant_branch_allowed(p_branch) then raise exception 'branch_forbidden'; end if;
  if nullif(trim(coalesce(p_name, '')), '') is null then raise exception 'guest_name_required'; end if;
  if p_party_size is null or p_party_size < 1 then raise exception 'party_size_required'; end if;
  branch := public.nac_normalize_branch_id(p_branch);
  insert into public.restaurant_waitlist (branch_id, name, party_size, estimate_note)
  values (branch, trim(p_name), p_party_size, 'Estimate only. Not a guaranteed wait or table release.')
  returning * into row;
  perform public.restaurant_audit(branch, 'waitlist_added', row.id::text, '{}'::jsonb);
  return row;
end;
$$;

revoke all on function public.restaurant_register_table(text, text, text) from public, anon;
revoke all on function public.restaurant_rename_table(text, text) from public, anon;
revoke all on function public.restaurant_retire_table(text) from public, anon;
revoke all on function public.restaurant_set_table_hold(text, text) from public, anon;
revoke all on function public.restaurant_save_layout(text, text, jsonb) from public, anon;
revoke all on function public.restaurant_publish_layout(uuid, integer) from public, anon;
revoke all on function public.restaurant_restore_layout_version(uuid) from public, anon;
revoke all on function public.restaurant_create_guest(text, text, text) from public, anon;
revoke all on function public.restaurant_create_reservation(uuid, integer, date, text) from public, anon;
revoke all on function public.restaurant_assign_table(uuid, text, integer) from public, anon;
revoke all on function public.restaurant_cancel_reservation(uuid, integer) from public, anon;
revoke all on function public.restaurant_open_session(text, uuid, integer) from public, anon;
revoke all on function public.restaurant_add_order(text, text) from public, anon;
revoke all on function public.restaurant_move_table(text, text, integer) from public, anon;
revoke all on function public.restaurant_join_tables(text, text, integer) from public, anon;
revoke all on function public.restaurant_add_waitlist(text, text, integer) from public, anon;

grant execute on function public.restaurant_register_table(text, text, text) to authenticated;
grant execute on function public.restaurant_rename_table(text, text) to authenticated;
grant execute on function public.restaurant_retire_table(text) to authenticated;
grant execute on function public.restaurant_set_table_hold(text, text) to authenticated;
grant execute on function public.restaurant_save_layout(text, text, jsonb) to authenticated;
grant execute on function public.restaurant_publish_layout(uuid, integer) to authenticated;
grant execute on function public.restaurant_restore_layout_version(uuid) to authenticated;
grant execute on function public.restaurant_create_guest(text, text, text) to authenticated;
grant execute on function public.restaurant_create_reservation(uuid, integer, date, text) to authenticated;
grant execute on function public.restaurant_assign_table(uuid, text, integer) to authenticated;
grant execute on function public.restaurant_cancel_reservation(uuid, integer) to authenticated;
grant execute on function public.restaurant_open_session(text, uuid, integer) to authenticated;
grant execute on function public.restaurant_add_order(text, text) to authenticated;
grant execute on function public.restaurant_move_table(text, text, integer) to authenticated;
grant execute on function public.restaurant_join_tables(text, text, integer) to authenticated;
grant execute on function public.restaurant_add_waitlist(text, text, integer) to authenticated;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'restaurant_floor_layouts',
    'restaurant_layout_versions',
    'restaurant_tables',
    'restaurant_guests',
    'restaurant_reservations',
    'restaurant_waitlist',
    'restaurant_sessions',
    'restaurant_orders',
    'restaurant_session_tables',
    'restaurant_audit_events'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on public.%I from public, anon, authenticated', table_name);
    execute format('grant select on public.%I to authenticated', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_staff_select', table_name);
  end loop;
end $$;

create policy restaurant_floor_layouts_staff_select on public.restaurant_floor_layouts
  for select to authenticated using (public.restaurant_branch_allowed(branch_id));
create policy restaurant_layout_versions_staff_select on public.restaurant_layout_versions
  for select to authenticated using (public.restaurant_branch_allowed(branch_id));
create policy restaurant_tables_staff_select on public.restaurant_tables
  for select to authenticated using (public.restaurant_branch_allowed(branch_id));
create policy restaurant_guests_staff_select on public.restaurant_guests
  for select to authenticated using (public.restaurant_branch_allowed(branch_id));
create policy restaurant_reservations_staff_select on public.restaurant_reservations
  for select to authenticated using (public.restaurant_branch_allowed(branch_id));
create policy restaurant_waitlist_staff_select on public.restaurant_waitlist
  for select to authenticated using (public.restaurant_branch_allowed(branch_id));
create policy restaurant_sessions_staff_select on public.restaurant_sessions
  for select to authenticated using (public.restaurant_branch_allowed(branch_id));
create policy restaurant_orders_staff_select on public.restaurant_orders
  for select to authenticated using (public.restaurant_branch_allowed(branch_id));
create policy restaurant_session_tables_staff_select on public.restaurant_session_tables
  for select to authenticated using (
    exists (
      select 1 from public.restaurant_sessions s
      where s.id = session_id and public.restaurant_branch_allowed(s.branch_id)
    )
  );
create policy restaurant_audit_events_staff_select on public.restaurant_audit_events
  for select to authenticated using (public.restaurant_branch_allowed(branch_id));

-- Isolated rollback only. Do not execute against production.
-- drop table if exists public.restaurant_audit_events, public.restaurant_session_tables,
--   public.restaurant_orders, public.restaurant_sessions, public.restaurant_waitlist,
--   public.restaurant_reservations, public.restaurant_guests, public.restaurant_tables,
--   public.restaurant_layout_versions, public.restaurant_floor_layouts cascade;
