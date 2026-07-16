-- Food Bible & Recipe Foundation v1
-- Extends existing inventory_recipes stack with stages, documentation, portions, and line metadata.

alter table public.inventory_recipes
  add column if not exists placement_group_id uuid,
  add column if not exists name_en text,
  add column if not exists name_ar text,
  add column if not exists internal_name text,
  add column if not exists portion_count numeric(20,8) check (portion_count is null or portion_count > 0),
  add column if not exists portion_size numeric(20,8) check (portion_size is null or portion_size > 0),
  add column if not exists portion_unit text check (
    portion_unit is null or portion_unit in ('each', 'gram', 'kilogram', 'millilitre', 'litre')
  ),
  add column if not exists updated_by uuid references auth.users(id);

alter table public.inventory_recipes drop constraint if exists inventory_recipes_recipe_type_check;
alter table public.inventory_recipes add constraint inventory_recipes_recipe_type_check
  check (recipe_type in ('menu_item', 'preparation', 'sub_recipe', 'direct_stock'));

create index if not exists inventory_recipes_placement_group_idx
  on public.inventory_recipes (placement_group_id, branch_id)
  where active and placement_group_id is not null;

alter table public.inventory_recipe_versions
  add column if not exists documentation jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists updated_by uuid references auth.users(id);

create table if not exists public.inventory_recipe_stages (
  id uuid primary key default gen_random_uuid(),
  recipe_version_id uuid not null references public.inventory_recipe_versions(id) on delete cascade,
  name text not null,
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now()
);

create index if not exists inventory_recipe_stages_version_idx
  on public.inventory_recipe_stages (recipe_version_id, sort_order);

alter table public.inventory_recipe_version_lines
  add column if not exists stage_id uuid references public.inventory_recipe_stages(id) on delete set null,
  add column if not exists preparation_note text,
  add column if not exists is_optional boolean not null default false,
  add column if not exists waste_percentage numeric(7,4) not null default 0
    check (waste_percentage >= 0 and waste_percentage <= 100),
  add column if not exists sort_order integer not null default 0 check (sort_order >= 0);

create index if not exists inventory_recipe_lines_version_sort_idx
  on public.inventory_recipe_version_lines (recipe_version_id, sort_order);

comment on column public.inventory_recipes.placement_group_id is
  'Canonical menu identity for multi-placement dishes within a branch.';
comment on column public.inventory_recipe_versions.documentation is
  'Preparation, plating, storage, shelf life, equipment, quality, and internal notes.';

alter table public.inventory_recipe_stages enable row level security;

create policy inventory_recipe_stages_select on public.inventory_recipe_stages
for select to authenticated using (exists (
  select 1 from public.inventory_recipe_versions v
  join public.inventory_recipes r on r.id = v.recipe_id
  where v.id = recipe_version_id
    and (r.branch_id is null or public.inventory_branch_allowed(r.branch_id))
));

create policy inventory_recipe_stages_write on public.inventory_recipe_stages
for all to authenticated using (exists (
  select 1 from public.inventory_recipe_versions v
  join public.inventory_recipes r on r.id = v.recipe_id
  where v.id = recipe_version_id
    and (case when r.branch_id is null then public.ask_nac_vault_has_all_branches()
      else public.inventory_can_approve(r.branch_id) end)
)) with check (exists (
  select 1 from public.inventory_recipe_versions v
  join public.inventory_recipes r on r.id = v.recipe_id
  where v.id = recipe_version_id
    and (case when r.branch_id is null then public.ask_nac_vault_has_all_branches()
      else public.inventory_can_approve(r.branch_id) end)
));

grant insert, update, delete on public.inventory_recipe_stages to authenticated;
