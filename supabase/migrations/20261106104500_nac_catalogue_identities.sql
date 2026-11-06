-- NAC catalogue codes. Additive and empty.
-- UUIDs remain the internal identity. NAC-P / NAC-I / NAC-PR / NAC-S / NAC-R
-- are human-readable codes. Inventory family labels (F1, B1) are unchanged.
-- Foodics SKUs are external attributes and are not unique.
-- This migration does not update menu_items, prices, or any Foodics table.

create table if not exists public.nac_code_counters (
  entity_type text primary key check (entity_type in (
    'finished_product', 'ingredient', 'preparation', 'inventory_supply', 'recipe'
  )),
  next_number integer not null check (next_number > 0)
);

insert into public.nac_code_counters (entity_type, next_number)
values
  ('finished_product', 1),
  ('ingredient', 1),
  ('preparation', 1),
  ('inventory_supply', 1),
  ('recipe', 1)
on conflict (entity_type) do nothing;

create table if not exists public.nac_identities (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in (
    'finished_product', 'ingredient', 'preparation', 'inventory_supply', 'recipe'
  )),
  nac_code text not null,
  label text,
  retired_at timestamptz,
  created_at timestamptz not null default now(),
  constraint nac_identities_code_unique unique (nac_code)
);

create table if not exists public.nac_identity_links (
  id uuid primary key default gen_random_uuid(),
  identity_id uuid not null references public.nac_identities (id) on delete restrict,
  target_kind text not null check (target_kind in (
    'menu_item', 'ingredient', 'recipe', 'preparation', 'inventory_supply'
  )),
  target_id uuid not null,
  created_at timestamptz not null default now(),
  constraint nac_identity_links_target_unique unique (target_kind, target_id)
);

create table if not exists public.nac_foodics_refs (
  id uuid primary key default gen_random_uuid(),
  identity_id uuid references public.nac_identities (id) on delete restrict,
  foodics_entity_type text not null,
  foodics_record_id text not null,
  foodics_sku text,
  verified boolean not null default false,
  created_at timestamptz not null default now(),
  constraint nac_foodics_refs_record_unique unique (foodics_entity_type, foodics_record_id)
);

comment on table public.nac_identities is
  'Shared NAC catalogue codes. One code is not branch-specific. Retired codes are never reused.';

comment on column public.nac_foodics_refs.foodics_sku is
  'External Foodics SKU. The same text may belong to a product and an ingredient. Identity is entity type plus Foodics record id.';

create or replace function public.allocate_nac_identity(p_entity_type text, p_label text default null)
returns table (id uuid, nac_code text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_number integer;
  v_prefix text;
  v_code text;
  v_id uuid;
begin
  v_prefix := case p_entity_type
    when 'finished_product' then 'NAC-P'
    when 'ingredient' then 'NAC-I'
    when 'preparation' then 'NAC-PR'
    when 'inventory_supply' then 'NAC-S'
    when 'recipe' then 'NAC-R'
    else null
  end;
  if v_prefix is null then
    raise exception 'unknown NAC entity type %', p_entity_type;
  end if;

  insert into public.nac_code_counters (entity_type, next_number)
  values (p_entity_type, 1)
  on conflict (entity_type) do nothing;

  select next_number into v_number
  from public.nac_code_counters
  where entity_type = p_entity_type
  for update;

  v_code := v_prefix || '-' || lpad(v_number::text, 4, '0');

  update public.nac_code_counters
  set next_number = v_number + 1
  where entity_type = p_entity_type;

  insert into public.nac_identities (entity_type, nac_code, label)
  values (p_entity_type, v_code, nullif(btrim(p_label), ''))
  returning nac_identities.id into v_id;

  return query select v_id, v_code;
end;
$$;

create or replace function public.link_nac_identity(
  p_identity_id uuid,
  p_target_kind text,
  p_target_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_target_kind not in ('menu_item', 'ingredient', 'recipe', 'preparation', 'inventory_supply') then
    raise exception 'unknown NAC link target %', p_target_kind;
  end if;
  if exists (
    select 1 from public.nac_identities
    where id = p_identity_id and retired_at is not null
  ) then
    raise exception 'retired NAC codes cannot be linked';
  end if;

  insert into public.nac_identity_links (identity_id, target_kind, target_id)
  values (p_identity_id, p_target_kind, p_target_id)
  on conflict (target_kind, target_id) do nothing
  returning id into v_id;

  if v_id is null then
    raise exception 'target % % already has a NAC identity', p_target_kind, p_target_id;
  end if;
  return v_id;
end;
$$;

revoke all on function public.allocate_nac_identity(text, text) from public;
grant execute on function public.allocate_nac_identity(text, text) to authenticated;

revoke all on function public.link_nac_identity(uuid, text, uuid) from public;
grant execute on function public.link_nac_identity(uuid, text, uuid) to authenticated;

alter table public.nac_code_counters enable row level security;
alter table public.nac_identities enable row level security;
alter table public.nac_identity_links enable row level security;
alter table public.nac_foodics_refs enable row level security;

revoke all on public.nac_code_counters from anon;
revoke all on public.nac_identities from anon;
revoke all on public.nac_identity_links from anon;
revoke all on public.nac_foodics_refs from anon;

drop policy if exists nac_identities_read on public.nac_identities;
create policy nac_identities_read on public.nac_identities
  for select to authenticated using (true);

drop policy if exists nac_identity_links_read on public.nac_identity_links;
create policy nac_identity_links_read on public.nac_identity_links
  for select to authenticated using (true);

drop policy if exists nac_foodics_refs_read on public.nac_foodics_refs;
create policy nac_foodics_refs_read on public.nac_foodics_refs
  for select to authenticated using (true);
