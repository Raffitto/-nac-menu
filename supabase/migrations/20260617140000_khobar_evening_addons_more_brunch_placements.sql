-- Khobar only: link Brunch Add Ons → Evening Add Ons (linked placements).
-- Items: Halloumi, Beef Bacon, Avocado, Mushrooms, Grilled Halloumi
-- Excludes Spicy Fried Egg. Does not touch riyadh or jeddah.

create or replace function public._nac_link_khobar_evening_addon_from_brunch(
  p_item_name_en text,
  p_sort_order int
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_branch text := 'khobar';
  src record;
  evening_addons_section_id uuid;
  new_item_id uuid;
  pg_id uuid;
begin
  select s.id
  into evening_addons_section_id
  from public.sections s
  join public.categories c on c.id = s.category_id
  where c.slug = 'evening'
    and s.name_en = 'Add Ons'
    and s.branch_id = v_branch
    and c.branch_id = v_branch
  limit 1;

  if evening_addons_section_id is null then
    raise notice 'Evening Add Ons not found for khobar (%).', p_item_name_en;
    return;
  end if;

  for src in
    select mi.*
    from public.menu_items mi
    join public.sections src_sec on src_sec.id = mi.section_id
    join public.categories src_cat on src_cat.id = src_sec.category_id
    where src_cat.slug = 'brunch'
      and src_sec.name_en = 'Add Ons'
      and mi.name_en = p_item_name_en
      and mi.branch_id = v_branch
      and src_sec.branch_id = v_branch
      and src_cat.branch_id = v_branch
  loop
    if exists (
      select 1
      from public.menu_items em
      where em.section_id = evening_addons_section_id
        and em.branch_id = v_branch
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
      hidden_until, p_sort_order, pg_id, v_branch
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

select public._nac_link_khobar_evening_addon_from_brunch('Halloumi', 2);
select public._nac_link_khobar_evening_addon_from_brunch('Beef Bacon', 5);
select public._nac_link_khobar_evening_addon_from_brunch('Avocado', 6);
select public._nac_link_khobar_evening_addon_from_brunch('Mushrooms', 7);
select public._nac_link_khobar_evening_addon_from_brunch('Grilled Halloumi', 8);

drop function public._nac_link_khobar_evening_addon_from_brunch(text, int);
