-- NOT APPLIED. Do not run against production until the owner approves it.
--
-- Live finding, 2026-10-14, project zeyhvjuraqnlbdycgrme:
-- public.inventory_code_counters has RLS off and no policies.
-- anon and authenticated have SELECT, INSERT, UPDATE, DELETE, TRUNCATE,
-- REFERENCES, and TRIGGER. The public Data API exposes the table.
-- The seven rows are the next human-code number for F, B, C, CL, P, E, and M.
--
-- allocate_inventory_human_code(text) is security definer, owned by postgres,
-- with search_path = public. The owner bypasses RLS, so enabling RLS does not
-- stop the function and does not change the next number. Do not FORCE RLS.
-- The numbering body is unchanged: lock the family row, then add one.
--
-- anon has EXECUTE even though the creating migration granted only authenticated.
-- Any authenticated user can also call it, because the body does not check a role.
-- This revision refuses anonymous and non-inventory roles before it reads the counter.

begin;

alter table public.inventory_code_counters enable row level security;

revoke all on table public.inventory_code_counters from anon, authenticated;

create or replace function public.allocate_inventory_human_code(p_family text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_number integer;
  v_code text;
  v_role text;
begin
  if auth.uid() is null then
    raise exception 'inventory code allocation requires a signed-in staff user';
  end if;

  v_role := public.ask_nac_vault_role();
  if v_role not in ('ceo', 'super_admin', 'ops_manager', 'branch_manager', 'cost_controller') then
    raise exception 'inventory code allocation is not allowed for role %', v_role;
  end if;

  if p_family not in ('F', 'B', 'C', 'CL', 'P', 'E', 'M') then
    raise exception 'unknown inventory family %', p_family;
  end if;

  insert into public.inventory_code_counters (family, next_number)
  values (p_family, 1)
  on conflict (family) do nothing;

  select next_number into v_number
  from public.inventory_code_counters
  where family = p_family
  for update;

  v_code := p_family || v_number::text;

  update public.inventory_code_counters
  set next_number = v_number + 1
  where family = p_family;

  return v_code;
end;
$$;

revoke all on function public.allocate_inventory_human_code(text) from public, anon;
grant execute on function public.allocate_inventory_human_code(text) to authenticated, service_role;

commit;

-- Rollback
-- begin;
-- create or replace function public.allocate_inventory_human_code(p_family text)
-- returns text
-- language plpgsql
-- security definer
-- set search_path = public
-- as $$
-- declare
--   v_number integer;
--   v_code text;
-- begin
--   if p_family not in ('F', 'B', 'C', 'CL', 'P', 'E', 'M') then
--     raise exception 'unknown inventory family %', p_family;
--   end if;
--   insert into public.inventory_code_counters (family, next_number)
--   values (p_family, 1)
--   on conflict (family) do nothing;
--   select next_number into v_number
--   from public.inventory_code_counters
--   where family = p_family
--   for update;
--   v_code := p_family || v_number::text;
--   update public.inventory_code_counters
--   set next_number = v_number + 1
--   where family = p_family;
--   return v_code;
-- end;
-- $$;
-- grant select, insert, update, delete, truncate, references, trigger
--   on table public.inventory_code_counters to anon, authenticated;
-- grant execute on function public.allocate_inventory_human_code(text) to anon, authenticated, service_role;
-- alter table public.inventory_code_counters disable row level security;
-- commit;
