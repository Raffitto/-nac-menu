-- Immutable submitted prices and explicit preparation stations.
-- Does not backfill historical prices and does not seed station assignments.
-- Do not apply this file to production.
-- Rollback: drop function public.restaurant_set_station_status(text, text, text);
--           drop function public.restaurant_assign_item_station(text, text, uuid);
--           drop function public.restaurant_create_station(text, text, text);
--           drop function public.restaurant_submit_priced_item(text, text, text, integer, text, text, text, integer, jsonb, integer, integer, text, integer, uuid);
--           drop table public.restaurant_item_stations;
--           drop table public.restaurant_stations;
--           alter table public.restaurant_order_items drop column if exists station_name;
--           alter table public.restaurant_order_items drop column if exists station_code;
--           alter table public.restaurant_order_items drop column if exists station_id;
--           alter table public.restaurant_order_items drop column if exists priced_at;
--           alter table public.restaurant_order_items drop column if exists tax_minor;
--           alter table public.restaurant_order_items drop column if exists currency;
--           alter table public.restaurant_order_items drop column if exists line_minor;
--           alter table public.restaurant_order_items drop column if exists unit_minor;
--           alter table public.restaurant_order_items drop column if exists modifier_snapshot;
--           alter table public.restaurant_order_items drop column if exists base_unit_minor;
--           alter table public.restaurant_order_items drop column if exists catalogue_item_id;

create table if not exists public.restaurant_stations (
  id uuid primary key default gen_random_uuid(),
  branch_id text not null,
  code text not null,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint restaurant_stations_branch_check
    check (branch_id = public.nac_normalize_branch_id(branch_id)),
  constraint restaurant_stations_code_check
    check (code ~ '^[a-z0-9][a-z0-9-]{0,31}$'),
  constraint restaurant_stations_branch_code unique (branch_id, code)
);

create table if not exists public.restaurant_item_stations (
  branch_id text not null,
  catalogue_item_id text not null,
  station_id uuid not null references public.restaurant_stations(id),
  created_at timestamptz not null default now(),
  primary key (branch_id, catalogue_item_id),
  constraint restaurant_item_stations_branch_check
    check (branch_id = public.nac_normalize_branch_id(branch_id))
);

alter table public.restaurant_order_items
  add column if not exists catalogue_item_id text,
  add column if not exists base_unit_minor integer,
  add column if not exists modifier_snapshot jsonb,
  add column if not exists unit_minor integer,
  add column if not exists line_minor integer,
  add column if not exists currency text,
  add column if not exists tax_minor integer,
  add column if not exists priced_at timestamptz,
  add column if not exists station_id uuid references public.restaurant_stations(id) on delete set null,
  add column if not exists station_code text,
  add column if not exists station_name text;

alter table public.restaurant_order_items drop constraint if exists restaurant_order_items_price_snapshot_check;
alter table public.restaurant_order_items
  add constraint restaurant_order_items_price_snapshot_check
  check (
    line_minor is null
    or (
      base_unit_minor is not null
      and unit_minor is not null
      and base_unit_minor >= 0
      and unit_minor >= 0
      and line_minor >= 0
      and currency = 'SAR'
      and priced_at is not null
      and line_minor = unit_minor * quantity
      and (tax_minor is null or tax_minor >= 0)
    )
  );

comment on column public.restaurant_order_items.line_minor is
  'Immutable line total in halalas, written at submission. Null means this row has no price snapshot and must not be backfilled.';

alter table public.restaurant_stations enable row level security;
alter table public.restaurant_item_stations enable row level security;
revoke all on public.restaurant_stations from public, anon, authenticated;
revoke all on public.restaurant_item_stations from public, anon, authenticated;
grant select on public.restaurant_stations to authenticated, nac_restaurant_api;
grant select on public.restaurant_item_stations to authenticated, nac_restaurant_api;

drop policy if exists restaurant_stations_staff_select on public.restaurant_stations;
create policy restaurant_stations_staff_select on public.restaurant_stations
  for select to authenticated
  using (public.restaurant_branch_allowed(branch_id) or public.restaurant_can(branch_id, 'layout_write'));

drop policy if exists restaurant_item_stations_staff_select on public.restaurant_item_stations;
create policy restaurant_item_stations_staff_select on public.restaurant_item_stations
  for select to authenticated
  using (public.restaurant_branch_allowed(branch_id) or public.restaurant_can(branch_id, 'layout_write'));

drop policy if exists restaurant_api_read on public.restaurant_stations;
create policy restaurant_api_read on public.restaurant_stations
  for select to nac_restaurant_api
  using (branch_id = current_setting('nac.branch', true));

drop policy if exists restaurant_api_read on public.restaurant_item_stations;
create policy restaurant_api_read on public.restaurant_item_stations
  for select to nac_restaurant_api
  using (branch_id = current_setting('nac.branch', true));

create or replace function public.restaurant_create_station(
  p_branch text,
  p_code text,
  p_name text
) returns public.restaurant_stations
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized text;
  station_code text;
  row public.restaurant_stations;
begin
  if not public.restaurant_can(p_branch, 'layout_write') then raise exception 'role_forbidden'; end if;
  normalized := public.nac_normalize_branch_id(p_branch);
  if normalized is null then raise exception 'branch_forbidden'; end if;
  station_code := lower(trim(coalesce(p_code, '')));
  if station_code !~ '^[a-z0-9][a-z0-9-]{0,31}$' then raise exception 'station_code_invalid'; end if;
  if nullif(trim(coalesce(p_name, '')), '') is null then raise exception 'station_name_required'; end if;
  select * into row from public.restaurant_stations where branch_id = normalized and restaurant_stations.code = station_code;
  if found then return row; end if;
  insert into public.restaurant_stations (branch_id, code, name)
  values (normalized, station_code, trim(p_name))
  returning * into row;
  perform public.restaurant_audit(normalized, 'station_created', row.id::text, jsonb_build_object('code', station_code));
  return row;
end;
$$;

create or replace function public.restaurant_assign_item_station(
  p_branch text,
  p_item_id text,
  p_station_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized text;
  station public.restaurant_stations;
begin
  if not public.restaurant_can(p_branch, 'layout_write') then raise exception 'role_forbidden'; end if;
  normalized := public.nac_normalize_branch_id(p_branch);
  if normalized is null or nullif(trim(coalesce(p_item_id, '')), '') is null then raise exception 'branch_forbidden'; end if;
  select * into station from public.restaurant_stations where id = p_station_id and active = true;
  if not found or station.branch_id <> normalized then raise exception 'station_not_configured'; end if;
  insert into public.restaurant_item_stations (branch_id, catalogue_item_id, station_id)
  values (normalized, trim(p_item_id), station.id)
  on conflict (branch_id, catalogue_item_id) do update
    set station_id = excluded.station_id, created_at = now();
  perform public.restaurant_audit(normalized, 'item_station_assigned', trim(p_item_id), jsonb_build_object('station_id', station.id, 'code', station.code));
  return station.id;
end;
$$;

create or replace function public.restaurant_submit_priced_item(
  p_order_id text,
  p_catalogue_item_id text,
  p_item_name text,
  p_quantity integer,
  p_note text,
  p_allergy_alert text,
  p_client_key text,
  p_base_unit_minor integer,
  p_modifier_snapshot jsonb,
  p_unit_minor integer,
  p_line_minor integer,
  p_currency text,
  p_tax_minor integer,
  p_station_id uuid
) returns public.restaurant_order_items
language plpgsql
security definer
set search_path = public
as $$
declare
  ord public.restaurant_orders;
  row public.restaurant_order_items;
  station public.restaurant_stations;
  saved_station uuid;
  saved_code text;
  saved_name text;
  extra integer;
  modifier_count integer;
begin
  select * into ord from public.restaurant_orders where id = p_order_id;
  if not found then raise exception 'order_not_found'; end if;
  if not public.restaurant_can(ord.branch_id, 'service_write') then raise exception 'branch_forbidden'; end if;
  if nullif(trim(coalesce(p_client_key, '')), '') is null then raise exception 'client_key_required'; end if;
  select * into row from public.restaurant_order_items
    where order_id = ord.id and client_key = trim(p_client_key);
  if found then return row; end if;
  if nullif(trim(coalesce(p_item_name, '')), '') is null then raise exception 'item_name_required'; end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > 99 then raise exception 'quantity_invalid'; end if;
  if p_currency <> 'SAR' then raise exception 'currency_invalid'; end if;
  if p_base_unit_minor is null or p_base_unit_minor < 0
     or p_unit_minor is null or p_unit_minor < 0
     or p_line_minor is null or p_line_minor < 0
     or p_tax_minor is not null and p_tax_minor < 0 then
    raise exception 'price_unavailable';
  end if;
  if p_line_minor <> p_unit_minor * p_quantity then raise exception 'price_unavailable'; end if;
  if p_modifier_snapshot is null or jsonb_typeof(p_modifier_snapshot) <> 'array' then raise exception 'price_unavailable'; end if;
  select count(*), coalesce(sum((elem->>'unitMinor')::integer), 0)
    into modifier_count, extra
  from jsonb_array_elements(p_modifier_snapshot) elem
  where coalesce(elem->>'id', '') <> ''
    and coalesce(elem->>'name', '') <> ''
    and (elem->>'unitMinor') ~ '^[0-9]+$';
  if modifier_count <> jsonb_array_length(p_modifier_snapshot) then raise exception 'price_unavailable'; end if;
  if p_unit_minor <> p_base_unit_minor + extra then raise exception 'price_unavailable'; end if;
  saved_station := null;
  saved_code := null;
  saved_name := null;
  if p_station_id is not null then
    select * into station from public.restaurant_stations where id = p_station_id and active = true;
    if not found or station.branch_id <> ord.branch_id then raise exception 'station_not_configured'; end if;
    saved_station := station.id;
    saved_code := station.code;
    saved_name := station.name;
  end if;
  begin
    insert into public.restaurant_order_items (
      order_id, branch_id, item_name, quantity, note, allergy_alert, client_key,
      catalogue_item_id, base_unit_minor, modifier_snapshot, modifier_ids,
      unit_minor, line_minor, currency, tax_minor, priced_at,
      station_id, station_code, station_name
    ) values (
      ord.id, ord.branch_id, trim(p_item_name), p_quantity,
      nullif(trim(coalesce(p_note, '')), ''),
      nullif(trim(coalesce(p_allergy_alert, '')), ''),
      trim(p_client_key),
      nullif(trim(coalesce(p_catalogue_item_id, '')), ''),
      p_base_unit_minor, p_modifier_snapshot,
      (select coalesce(jsonb_agg(elem->>'id'), '[]'::jsonb) from jsonb_array_elements(p_modifier_snapshot) elem),
      p_unit_minor, p_line_minor, 'SAR', p_tax_minor, now(),
      saved_station, saved_code, saved_name
    )
    returning * into row;
  exception when unique_violation then
    select * into row from public.restaurant_order_items
      where order_id = ord.id and client_key = trim(p_client_key);
    return row;
  end;
  perform public.restaurant_audit(ord.branch_id, 'item_priced', row.id::text, jsonb_build_object(
    'order_id', ord.id,
    'line_minor', row.line_minor,
    'currency', row.currency,
    'station_code', row.station_code
  ));
  return row;
end;
$$;

create or replace function public.restaurant_set_station_status(
  p_order_id text,
  p_station_code text,
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
  if p_status not in ('accepted', 'preparing', 'ready', 'served') then raise exception 'status_invalid'; end if;
  select * into ord from public.restaurant_orders where id = p_order_id;
  if not found then raise exception 'order_not_found'; end if;
  if not public.restaurant_can(ord.branch_id, 'kitchen_read')
     and not public.restaurant_can(ord.branch_id, 'service_write') then
    raise exception 'branch_forbidden';
  end if;
  update public.restaurant_order_items
    set status = p_status, status_at = now()
    where order_id = ord.id
      and station_code = p_station_code
      and status <> 'cancelled';
  get diagnostics updated = row_count;
  perform public.restaurant_audit(ord.branch_id, 'station_status', ord.id, jsonb_build_object('station_code', p_station_code, 'status', p_status));
  return updated;
end;
$$;

revoke all on function public.restaurant_create_station(text, text, text) from public, anon;
revoke all on function public.restaurant_assign_item_station(text, text, uuid) from public, anon;
revoke all on function public.restaurant_submit_priced_item(text, text, text, integer, text, text, text, integer, jsonb, integer, integer, text, integer, uuid) from public, anon;
revoke all on function public.restaurant_set_station_status(text, text, text) from public, anon;
grant execute on function public.restaurant_create_station(text, text, text) to authenticated, nac_restaurant_api;
grant execute on function public.restaurant_assign_item_station(text, text, uuid) to authenticated, nac_restaurant_api;
grant execute on function public.restaurant_submit_priced_item(text, text, text, integer, text, text, text, integer, jsonb, integer, integer, text, integer, uuid) to authenticated, nac_restaurant_api;
grant execute on function public.restaurant_set_station_status(text, text, text) to authenticated, nac_restaurant_api;
