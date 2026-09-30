-- Kitchen and bar inventory roles may capture and review.
-- They cannot approve, and they cannot receive into the other department's locations.
-- Existing approver roles are unchanged.

insert into public.ask_nac_roles (code, label, priority, default_sensitivity_ceiling, cross_branch, can_upload, capabilities)
values
  ('kitchen_inventory_manager', 'Kitchen inventory manager', 40, 'internal', false, true, '{"inventory_capture":true,"inventory_review":true,"inventory_receive":true}'::jsonb),
  ('bar_inventory_manager', 'Bar inventory manager', 40, 'internal', false, true, '{"inventory_capture":true,"inventory_review":true,"inventory_receive":true}'::jsonb)
on conflict (code) do update set
  label = excluded.label,
  capabilities = excluded.capabilities;

create or replace function public.inventory_receiving_location_allowed(p_location_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text := public.ask_nac_vault_role();
  v_type text;
begin
  select location_type into v_type
  from public.inventory_storage_locations
  where id = p_location_id;
  if v_role = 'kitchen_inventory_manager' and v_type = 'bar' then
    return false;
  end if;
  if v_role = 'bar_inventory_manager' and v_type in ('kitchen', 'pastry') then
    return false;
  end if;
  return true;
end;
$$;

create or replace function public.inventory_enforce_receiving_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.inventory_receiving_location_allowed(new.storage_location_id) then
    raise exception 'This inventory role cannot receive into that location' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists inventory_receipts_enforce_location on public.inventory_purchase_receipts;
create trigger inventory_receipts_enforce_location
  before insert on public.inventory_purchase_receipts
  for each row execute function public.inventory_enforce_receiving_scope();

revoke all on function public.inventory_receiving_location_allowed(uuid) from public;
grant execute on function public.inventory_receiving_location_allowed(uuid) to authenticated;
