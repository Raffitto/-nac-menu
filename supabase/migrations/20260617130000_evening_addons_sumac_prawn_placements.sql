-- Move Sumac Chicken & Smoked Paprika Prawn from Evening Mains → Evening Add Ons.
-- Creates Add Ons section (sort 5) between Mains and Sides (bumped to 6).
-- Linked placements only; idempotent per branch.

create or replace function public._nac_evening_addons_section_id(p_branch_id text)
returns uuid
language sql
stable
as $$
  select s.id
  from public.sections s
  join public.categories c on c.id = s.category_id
  where c.slug = 'evening'
    and s.name_en = 'Add Ons'
    and s.branch_id = p_branch_id
    and c.branch_id = p_branch_id
  limit 1;
$$;

create or replace function public._nac_ensure_evening_addons_section(p_branch_id text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cat_id uuid;
  v_sec_id uuid;
begin
  select c.id into v_cat_id
  from public.categories c
  where c.slug = 'evening' and c.branch_id = p_branch_id
  limit 1;

  if v_cat_id is null then
    return null;
  end if;

  v_sec_id := public._nac_evening_addons_section_id(p_branch_id);

  if v_sec_id is null then
    insert into public.sections (category_id, name_en, name_ar, sort_order, branch_id)
    values (v_cat_id, 'Add Ons', 'الإضافات', 5, p_branch_id)
    returning id into v_sec_id;
  end if;

  update public.sections s
  set sort_order = 6
  from public.categories c
  where s.category_id = c.id
    and c.slug = 'evening'
    and c.branch_id = p_branch_id
    and s.branch_id = p_branch_id
    and s.name_en = 'Sides'
    and s.sort_order < 6;

  return v_sec_id;
end;
$$;

create or replace function public._nac_link_evening_addon_from_brunch(
  p_item_name_en text,
  p_sort_order int
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  src record;
  evening_addons_section_id uuid;
  evening_mains_section_id uuid;
  new_item_id uuid;
  pg_id uuid;
begin
  for src in
    select mi.*
    from public.menu_items mi
    join public.sections src_sec on src_sec.id = mi.section_id
    join public.categories src_cat on src_cat.id = src_sec.category_id
    where src_cat.slug = 'brunch'
      and src_sec.name_en = 'Add Ons'
      and mi.name_en = p_item_name_en
      and mi.branch_id = src_sec.branch_id
      and mi.branch_id = src_cat.branch_id
  loop
    evening_addons_section_id := public._nac_ensure_evening_addons_section(src.branch_id);

    if evening_addons_section_id is null then
      raise notice 'Evening category not found for branch % (%).', src.branch_id, p_item_name_en;
      continue;
    end if;

    select s.id into evening_mains_section_id
    from public.sections s
    join public.categories c on c.id = s.category_id
    where c.slug = 'evening'
      and s.name_en = 'Mains'
      and s.branch_id = src.branch_id
      and c.branch_id = src.branch_id
    limit 1;

    -- Move misplaced linked rows out of Mains.
    if evening_mains_section_id is not null then
      update public.menu_items
      set section_id = evening_addons_section_id,
          sort_order = p_sort_order
      where section_id = evening_mains_section_id
        and branch_id = src.branch_id
        and name_en = p_item_name_en
        and (
          placement_group_id is not distinct from src.placement_group_id
          or placement_group_id is null
        );
    end if;

    if exists (
      select 1
      from public.menu_items em
      where em.section_id = evening_addons_section_id
        and em.branch_id = src.branch_id
        and (
          (src.placement_group_id is not null and em.placement_group_id = src.placement_group_id)
          or em.name_en = src.name_en
        )
    ) then
      continue;
    end if;

    pg_id := coalesce(src.placement_group_id, gen_random_uuid());

    if src.placement_group_id is null then
      update public.menu_items
      set placement_group_id = pg_id
      where id = src.id;
    end if;

    insert into public.menu_items (
      section_id, slug, name_en, name_ar, desc_en, desc_ar,
      calories, price, image, active, sold_out, featured, new_item,
      high_margin, vegetarian, vegan, available_from, available_until,
      hidden_until, sort_order, placement_group_id, branch_id
    )
    select
      evening_addons_section_id, slug, name_en, name_ar, desc_en, desc_ar,
      calories, price, image, active, sold_out, featured, new_item,
      high_margin, vegetarian, vegan, available_from, available_until,
      hidden_until, p_sort_order, pg_id, branch_id
    from public.menu_items
    where id = src.id
    returning id into new_item_id;

    insert into public.item_allergens (item_id, allergen_id)
    select new_item_id, allergen_id
    from public.item_allergens
    where item_id = src.id
    on conflict do nothing;

    insert into public.item_addons (item_id, addon_id, sort_order)
    select new_item_id, addon_id, sort_order
    from public.item_addons
    where item_id = src.id
    on conflict do nothing;
  end loop;
end;
$$;

-- Ensure section ordering for all evening branches (even if items already linked).
do $$
declare
  b text;
begin
  for b in
    select distinct c.branch_id
    from public.categories c
    where c.slug = 'evening'
  loop
    perform public._nac_ensure_evening_addons_section(b);
  end loop;
end;
$$;

select public._nac_link_evening_addon_from_brunch('Sumac Chicken', 3);
select public._nac_link_evening_addon_from_brunch('Smoked Paprika Prawn', 4);

drop function public._nac_link_evening_addon_from_brunch(text, int);
drop function public._nac_ensure_evening_addons_section(text);
drop function public._nac_evening_addons_section_id(text);
