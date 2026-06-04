-- Fix clone_branch_menu: DISTINCT + gen_random_uuid() did not dedupe placement_group_id
-- (each row got a new uuid, so DISTINCT kept all rows). Safe to re-run; skips existing clones.

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
begin
  if coalesce(public.nac_auth_email(), '') <> ''
     and not public.nac_menu_staff_all_branches() then
    raise exception 'Only network admins can clone branch menus';
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

    -- One map row per distinct source placement_group_id (GROUP BY, not DISTINCT + uuid).
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
    'note', 'Idempotent clone — re-run safe; existing clones skipped via cloned_from_id'
  );
end;
$$;

-- Resume clone (skips categories/sections/items already cloned)
select public.clone_branch_menu('khobar', null);
