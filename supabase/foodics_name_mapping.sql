-- Persistent Foodics → menu name mappings (auto-apply on future imports)
-- Run after foodics_import_schema.sql

create table if not exists public.foodics_name_mapping (
  id uuid primary key default gen_random_uuid(),
  foodics_name text not null,
  normalized_key text not null,
  menu_item_name_en text not null,
  menu_item_id text,
  match_confidence numeric not null default 1,
  match_source text default 'manual',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint foodics_name_mapping_normalized_key unique (normalized_key)
);

create index if not exists idx_foodics_name_mapping_menu
  on public.foodics_name_mapping (menu_item_name_en);

alter table public.foodics_name_mapping enable row level security;

drop policy if exists foodics_name_mapping_auth on public.foodics_name_mapping;
create policy foodics_name_mapping_auth on public.foodics_name_mapping
  for all to authenticated using (true) with check (true);

revoke all on public.foodics_name_mapping from anon;
grant all on public.foodics_name_mapping to authenticated;

-- Backfill from legacy menu_item_name_map
insert into public.foodics_name_mapping (
  foodics_name,
  normalized_key,
  menu_item_name_en,
  menu_item_id,
  match_confidence,
  match_source
)
select
  m.raw_name,
  m.normalized_name,
  m.menu_item_name_en,
  m.menu_item_id::text,
  coalesce(m.confidence, 1),
  'legacy_menu_item_name_map'
from public.menu_item_name_map m
where not exists (
  select 1
  from public.foodics_name_mapping f
  where f.normalized_key = m.normalized_name
)
on conflict (normalized_key) do nothing;
