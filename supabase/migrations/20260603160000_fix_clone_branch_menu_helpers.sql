-- Patch: deploy menu clone helpers + fixed clone_branch_menu (SQL Editor safe).
-- Run when 20260603140000 failed partway or only 20260603150000 was applied.
-- Idempotent: skips already-cloned rows via cloned_from_id.

-- ── Prerequisites (no-op if already applied) ─────────────────────────────

alter table public.categories add column if not exists cloned_from_id uuid;
alter table public.sections add column if not exists cloned_from_id uuid;
alter table public.menu_items add column if not exists cloned_from_id uuid;

create unique index if not exists idx_categories_branch_cloned_from
  on public.categories (branch_id, cloned_from_id)
  where cloned_from_id is not null;

create unique index if not exists idx_sections_branch_cloned_from
  on public.sections (branch_id, cloned_from_id)
  where cloned_from_id is not null;

create unique index if not exists idx_menu_items_branch_cloned_from
  on public.menu_items (branch_id, cloned_from_id)
  where cloned_from_id is not null;

alter table public.categories drop constraint if exists categories_slug_key;
drop index if exists categories_slug_key;
create unique index if not exists idx_categories_branch_slug
  on public.categories (branch_id, slug);

create table if not exists public.menu_staff_scope (
  email text primary key,
  branch_id text check (branch_id is null or branch_id in ('khobar', 'riyadh', 'jeddah')),
  role text not null default 'branch_gm' check (role in ('developer', 'ceo', 'branch_gm', 'restricted')),
  updated_at timestamptz not null default now()
);

insert into public.menu_staff_scope (email, branch_id, role) values
  ('raffi@nac.com', null, 'developer'),
  ('raffiazarian@gmail.com', null, 'developer'),
  ('raffi@nac-khobar.com', null, 'developer'),
  ('ahmad@nac.com', null, 'ceo'),
  ('ahmad@nac-khobar.com', null, 'ceo'),
  ('fady@nac.com', 'khobar', 'branch_gm'),
  ('fady@nac-khobar.com', 'khobar', 'branch_gm'),
  ('armel@nac.com', 'riyadh', 'branch_gm'),
  ('armel@nac-riyadh.com', 'riyadh', 'branch_gm'),
  ('usama@nac.com', 'jeddah', 'branch_gm'),
  ('usama@nac-jeddah.com', 'jeddah', 'branch_gm')
on conflict (email) do update set
  branch_id = excluded.branch_id,
  role = excluded.role,
  updated_at = now();

-- branch normalizer (required by nac_menu_can_edit_branch; safe to replace)
create or replace function public.nac_normalize_branch_id(p text)
returns text
language sql
immutable
as $$
  select case
    when p is null or trim(p) = '' then null
    when lower(trim(p)) in ('khobar', 'riyadh', 'jeddah') then lower(trim(p))
    when lower(trim(p)) ~ '(khobar|alkhobar|الخبر)' then 'khobar'
    when lower(trim(p)) ~ '(riyadh|رياض)' then 'riyadh'
    when lower(trim(p)) ~ '(jeddah|jedda|جدة|jiddah)' then 'jeddah'
    else null
  end;
$$;

-- ── Auth helpers (never renamed; may be missing if 20260603140000 failed early) ──

create or replace function public.nac_auth_email()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select lower(trim(coalesce(
    nullif(current_setting('request.jwt.claim.email', true), ''),
    nullif(auth.jwt() ->> 'email', ''),
    ''
  )));
$$;

create or replace function public.nac_menu_staff_all_branches()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select exists (
      select 1
      from public.menu_staff_scope s
      where lower(s.email) = public.nac_auth_email()
        and s.branch_id is null
        and s.role in ('developer', 'ceo')
    )
  ), false);
$$;

create or replace function public.nac_menu_staff_branch()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select s.branch_id
  from public.menu_staff_scope s
  where lower(s.email) = public.nac_auth_email()
  limit 1;
$$;

create or replace function public.nac_menu_can_edit_branch(p_branch text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when coalesce(public.nac_auth_email(), '') = '' then false
    when public.nac_menu_staff_all_branches() then true
    when public.nac_normalize_branch_id(p_branch) = public.nac_menu_staff_branch() then true
    else false
  end;
$$;

create or replace function public.nac_menu_item_branch(p_item_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select mi.branch_id
  from public.menu_items mi
  where mi.id = p_item_id;
$$;

-- ── clone_branch_menu: pg_map GROUP BY fix + SQL Editor bypass ───────────────
-- No JWT / empty email → allowed (postgres SQL Editor, migrations).
-- JWT present → network admin only (developer/ceo in menu_staff_scope).

create or replace function public.clone_branch_menu(
  p_source_branch text default 'khobar',
  p_target_branch text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source text := lower(trim(coalesce(p_source_branch, 'khobar')));
  v_target text;
  v_targets text[] := array[]::text[];
  v_caller_email text := coalesce(public.nac_auth_email(), '');
begin
  if v_caller_email <> '' and not public.nac_menu_staff_all_branches() then
    raise exception 'Only network admins can clone branch menus (caller: %)', v_caller_email;
  end if;

  if p_target_branch is null or trim(p_target_branch) = '' then
    v_targets := array(
      select b from unnest(array['khobar', 'riyadh', 'jeddah']) as b
      where b <> v_source
    );
  else
    v_target := lower(trim(p_target_branch));
    if v_target = v_source then
      raise exception 'Target branch must differ from source';
    end if;
    v_targets := array[v_target];
  end if;

  foreach v_target in array v_targets loop
    insert into public.categories (
      slug, name_en, name_ar, icon, icon_ar, time_en, time_ar,
      sort_order, active, branch_id, cloned_from_id
    )
    select
      c.slug, c.name_en, c.name_ar, c.icon, c.icon_ar, c.time_en, c.time_ar,
      c.sort_order, c.active, v_target, c.id
    from public.categories c
    where c.branch_id = v_source
      and not exists (
        select 1 from public.categories t
        where t.branch_id = v_target and t.cloned_from_id = c.id
      );

    insert into public.sections (
      category_id, name_en, name_ar, sort_order, active, branch_id, cloned_from_id
    )
    select
      tc.id, s.name_en, s.name_ar, s.sort_order, s.active, v_target, s.id
    from public.sections s
    join public.categories sc on sc.id = s.category_id and sc.branch_id = v_source
    join public.categories tc on tc.branch_id = v_target and tc.cloned_from_id = sc.id
    where s.branch_id = v_source
      and not exists (
        select 1 from public.sections ts
        where ts.branch_id = v_target and ts.cloned_from_id = s.id
      );

    drop table if exists _pg_map;
    create temp table _pg_map (
      old_id uuid primary key,
      new_id uuid not null
    ) on commit drop;

    insert into _pg_map (old_id, new_id)
    select pg_id, gen_random_uuid()
    from (
      select mi.placement_group_id as pg_id
      from public.menu_items mi
      where mi.branch_id = v_source
        and mi.placement_group_id is not null
      group by mi.placement_group_id
    ) distinct_groups;

    insert into public.menu_items (
      section_id, slug, name_en, name_ar, desc_en, desc_ar, calories, price, image,
      active, sold_out, featured, new_item, high_margin, vegetarian, vegan,
      available_from, available_until, hidden_until, sort_order,
      placement_group_id, branch_id, cloned_from_id
    )
    select
      ts.id, mi.slug, mi.name_en, mi.name_ar, mi.desc_en, mi.desc_ar, mi.calories, mi.price, mi.image,
      mi.active, mi.sold_out, mi.featured, mi.new_item, mi.high_margin, mi.vegetarian, mi.vegan,
      mi.available_from, mi.available_until, mi.hidden_until, mi.sort_order,
      pg.new_id, v_target, mi.id
    from public.menu_items mi
    join public.sections ss on ss.id = mi.section_id and ss.branch_id = v_source
    join public.sections ts on ts.branch_id = v_target and ts.cloned_from_id = ss.id
    left join _pg_map pg on pg.old_id = mi.placement_group_id
    where mi.branch_id = v_source
      and not exists (
        select 1 from public.menu_items ti
        where ti.branch_id = v_target and ti.cloned_from_id = mi.id
      );

    drop table if exists _pg_map;

    insert into public.item_addons (item_id, addon_id, sort_order)
    select ti.id, ia.addon_id, ia.sort_order
    from public.item_addons ia
    join public.menu_items si on si.id = ia.item_id and si.branch_id = v_source
    join public.menu_items ti on ti.branch_id = v_target and ti.cloned_from_id = si.id
    on conflict (item_id, addon_id) do nothing;

    insert into public.item_allergens (item_id, allergen_id)
    select ti.id, ial.allergen_id
    from public.item_allergens ial
    join public.menu_items si on si.id = ial.item_id and si.branch_id = v_source
    join public.menu_items ti on ti.branch_id = v_target and ti.cloned_from_id = si.id
    on conflict (item_id, allergen_id) do nothing;
  end loop;

  return jsonb_build_object(
    'source_branch', v_source,
    'targets', to_jsonb(v_targets),
    'caller_email', nullif(v_caller_email, ''),
    'note', 'Idempotent clone — re-run safe; existing clones skipped via cloned_from_id'
  );
end;
$$;

revoke all on function public.clone_branch_menu(text, text) from public;
grant execute on function public.clone_branch_menu(text, text) to authenticated;

-- Resume clone (skips rows already cloned)
select public.clone_branch_menu('khobar', null);
