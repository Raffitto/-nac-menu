-- Human inventory codes (F1, B1, CL1, ...). UUID remains the identity.
-- Issued numbers are never recycled. Allocation locks the family row.

alter table public.inventory_ingredients
  add column if not exists inventory_family text
    check (inventory_family is null or inventory_family in ('F', 'B', 'C', 'CL', 'P', 'E', 'M')),
  add column if not exists human_code text,
  add column if not exists retired_at timestamptz;

create unique index if not exists inventory_ingredients_human_code_uidx
  on public.inventory_ingredients (human_code)
  where human_code is not null;

create table if not exists public.inventory_code_counters (
  family text primary key check (family in ('F', 'B', 'C', 'CL', 'P', 'E', 'M')),
  next_number integer not null check (next_number > 0)
);

insert into public.inventory_code_counters (family, next_number)
values ('F', 1), ('B', 1), ('C', 1), ('CL', 1), ('P', 1), ('E', 1), ('M', 1)
on conflict (family) do nothing;

create or replace function public.allocate_inventory_human_code(p_family text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_number integer;
  v_code text;
begin
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

revoke all on function public.allocate_inventory_human_code(text) from public;
grant execute on function public.allocate_inventory_human_code(text) to authenticated;
