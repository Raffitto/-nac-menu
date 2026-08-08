-- Finalize and publish Khobar Seasonal Selections for 9 Aug 2026 guest menu.
-- Idempotent. Activates staged Khobar catalogue rows, places them into canonical
-- sections/shifts, updates the live Big Nac placement group, adds Brownies, and
-- records a verified menu publication snapshot.
--
-- Guest visibility is driven by live catalogue rows (active + section placement).
-- Publication is the NAC ops versioning/verify pipeline.

create or replace function public._nac_ensure_seasonal_placement(
  p_source_id uuid,
  p_group_id uuid,
  p_section_id uuid,
  p_sort_order int
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing_id uuid;
  v_new_id uuid;
  v_branch text;
begin
  select branch_id into v_branch from public.menu_items where id = p_source_id;
  if v_branch is null then
    raise exception 'Source menu item % missing', p_source_id;
  end if;

  select mi.id
  into v_existing_id
  from public.menu_items mi
  where mi.branch_id = v_branch
    and mi.section_id = p_section_id
    and (
      mi.id = p_source_id
      or (p_group_id is not null and mi.placement_group_id = p_group_id)
    )
  limit 1;

  if v_existing_id is not null then
    update public.menu_items src
    set
      name_en = donor.name_en,
      name_ar = donor.name_ar,
      desc_en = donor.desc_en,
      desc_ar = donor.desc_ar,
      calories = donor.calories,
      price = donor.price,
      image = donor.image,
      active = true,
      sold_out = false,
      hidden_until = null,
      sort_order = p_sort_order,
      placement_group_id = p_group_id,
      branch_id = v_branch
    from public.menu_items donor
    where src.id = v_existing_id
      and donor.id = p_source_id;

    delete from public.item_allergens where item_id = v_existing_id;
    insert into public.item_allergens (item_id, allergen_id)
    select v_existing_id, allergen_id
    from public.item_allergens
    where item_id = p_source_id
    on conflict (item_id, allergen_id) do nothing;

    return v_existing_id;
  end if;

  insert into public.menu_items (
    section_id, slug, name_en, name_ar, desc_en, desc_ar,
    calories, price, image, active, sold_out, featured, new_item,
    vegetarian, vegan, hidden_until, sort_order, placement_group_id, branch_id
  )
  select
    p_section_id, null, name_en, name_ar, desc_en, desc_ar,
    calories, price, image, true, false, featured, new_item,
    vegetarian, vegan, null, p_sort_order, p_group_id, branch_id
  from public.menu_items
  where id = p_source_id
  returning id into v_new_id;

  insert into public.item_allergens (item_id, allergen_id)
  select v_new_id, allergen_id
  from public.item_allergens
  where item_id = p_source_id
  on conflict (item_id, allergen_id) do nothing;

  return v_new_id;
end;
$$;

do $$
declare
  v_branch constant text := 'khobar';
  v_lock_key constant text := 'nac:khobar:seasonal-menu-release:2026-08-09';

  v_prawn_id constant uuid := 'a6070000-0000-4000-8000-000000000001';
  v_watermelon_id constant uuid := 'a6070000-0000-4000-8000-000000000002';
  v_conchiglie_id constant uuid := 'a6070000-0000-4000-8000-000000000003';
  v_big_nac_staged_id constant uuid := 'a6070000-0000-4000-8000-000000000004';
  v_seabass_id constant uuid := 'a6070000-0000-4000-8000-000000000005';
  v_brownies_id constant uuid := 'a6070000-0000-4000-8000-000000000006';

  v_live_big_nac_group constant uuid := 'e14ea002-2f20-4cb4-9d41-52ec13630e33';
  v_cookies_dessert_id constant uuid := '91b6b95a-724c-44e8-9d09-b31e862bdc53';

  v_img_base constant text :=
    'https://zeyhvjuraqnlbdycgrme.supabase.co/storage/v1/object/public/menu-images/items/seasonal-2026/';

  v_sec_daytime_salads uuid;
  v_sec_evening_salads uuid;
  v_sec_brunch_salads uuid;
  v_sec_breakfast_plates uuid;
  v_sec_daytime_sides uuid;
  v_sec_evening_sides uuid;
  v_sec_brunch_sides uuid;
  v_sec_daytime_mains uuid;
  v_sec_evening_mains uuid;
  v_sec_brunch_plates uuid;
  v_sec_desserts uuid;
  v_sec_breakfast_sweets uuid;
  v_sec_brunch_sweets uuid;

  v_pg_watermelon uuid;
  v_pg_prawn uuid;
  v_pg_conchiglie uuid;
  v_pg_seabass uuid;
  v_pg_brownies uuid;

  v_cookies_price text;
  v_cookies_calories text;
  v_cookies_allergen_ids uuid[];
  v_publication jsonb;
  v_pub_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext(v_lock_key));

  if not exists (
    select 1 from public.categories where branch_id = v_branch
  ) then
    raise exception 'Khobar menu catalogue is missing; seasonal publish aborted';
  end if;

  select s.id into v_sec_daytime_salads
  from public.sections s
  join public.categories c on c.id = s.category_id
  where c.branch_id = v_branch and s.branch_id = v_branch
    and c.slug = 'daytime' and s.name_en = 'Salads' limit 1;

  select s.id into v_sec_evening_salads
  from public.sections s
  join public.categories c on c.id = s.category_id
  where c.branch_id = v_branch and s.branch_id = v_branch
    and c.slug = 'evening' and s.name_en = 'Salads' limit 1;

  select s.id into v_sec_brunch_salads
  from public.sections s
  join public.categories c on c.id = s.category_id
  where c.branch_id = v_branch and s.branch_id = v_branch
    and c.slug = 'brunch' and s.name_en = 'Salads' limit 1;

  select s.id into v_sec_breakfast_plates
  from public.sections s
  join public.categories c on c.id = s.category_id
  where c.branch_id = v_branch and s.branch_id = v_branch
    and c.slug = 'breakfast' and s.name_en = 'Plates' limit 1;

  select s.id into v_sec_daytime_sides
  from public.sections s
  join public.categories c on c.id = s.category_id
  where c.branch_id = v_branch and s.branch_id = v_branch
    and c.slug = 'daytime' and s.name_en = 'Sides' limit 1;

  select s.id into v_sec_evening_sides
  from public.sections s
  join public.categories c on c.id = s.category_id
  where c.branch_id = v_branch and s.branch_id = v_branch
    and c.slug = 'evening' and s.name_en = 'Sides' limit 1;

  select s.id into v_sec_brunch_sides
  from public.sections s
  join public.categories c on c.id = s.category_id
  where c.branch_id = v_branch and s.branch_id = v_branch
    and c.slug = 'brunch' and s.name_en = 'Sides' limit 1;

  select s.id into v_sec_daytime_mains
  from public.sections s
  join public.categories c on c.id = s.category_id
  where c.branch_id = v_branch and s.branch_id = v_branch
    and c.slug = 'daytime' and s.name_en = 'Mains' limit 1;

  select s.id into v_sec_evening_mains
  from public.sections s
  join public.categories c on c.id = s.category_id
  where c.branch_id = v_branch and s.branch_id = v_branch
    and c.slug = 'evening' and s.name_en = 'Mains' limit 1;

  select s.id into v_sec_brunch_plates
  from public.sections s
  join public.categories c on c.id = s.category_id
  where c.branch_id = v_branch and s.branch_id = v_branch
    and c.slug = 'brunch' and s.name_en = 'Plates' limit 1;

  select s.id into v_sec_desserts
  from public.sections s
  join public.categories c on c.id = s.category_id
  where c.branch_id = v_branch and s.branch_id = v_branch
    and c.slug = 'desserts' and s.name_en = 'Desserts' limit 1;

  select s.id into v_sec_breakfast_sweets
  from public.sections s
  join public.categories c on c.id = s.category_id
  where c.branch_id = v_branch and s.branch_id = v_branch
    and c.slug = 'breakfast' and s.name_en = 'Sweets' limit 1;

  select s.id into v_sec_brunch_sweets
  from public.sections s
  join public.categories c on c.id = s.category_id
  where c.branch_id = v_branch and s.branch_id = v_branch
    and c.slug = 'brunch' and s.name_en = 'Sweets' limit 1;

  if v_sec_daytime_salads is null
     or v_sec_evening_salads is null
     or v_sec_brunch_salads is null
     or v_sec_breakfast_plates is null
     or v_sec_daytime_sides is null
     or v_sec_evening_sides is null
     or v_sec_brunch_sides is null
     or v_sec_daytime_mains is null
     or v_sec_evening_mains is null
     or v_sec_brunch_plates is null
     or v_sec_desserts is null
     or v_sec_breakfast_sweets is null
     or v_sec_brunch_sweets is null
  then
    raise exception 'One or more required Khobar sections are missing; seasonal publish aborted';
  end if;

  if not exists (
    select 1 from public.menu_items
    where id = v_prawn_id and branch_id = v_branch
  ) then
    raise exception 'Staged King Prawn Rendang row missing on Khobar';
  end if;

  -- Cookies with Ice Cream = Crushed Milk Chocolate Cookies (Frosties soft serve).
  select mi.price, mi.calories
  into v_cookies_price, v_cookies_calories
  from public.menu_items mi
  where mi.id = v_cookies_dessert_id
    and mi.branch_id = v_branch
    and mi.name_en = 'Crushed Milk Chocolate Cookies';

  if v_cookies_price is null then
    raise exception 'Cookies with Ice Cream source item (Crushed Milk Chocolate Cookies) not found';
  end if;

  select coalesce(array_agg(ia.allergen_id order by ia.allergen_id), '{}'::uuid[])
  into v_cookies_allergen_ids
  from public.item_allergens ia
  where ia.item_id = v_cookies_dessert_id;

  if coalesce(array_length(v_cookies_allergen_ids, 1), 0) = 0 then
    raise exception 'Cookies with Ice Cream has no allergen relationships to copy';
  end if;

  update public.menu_items
  set
    name_en = 'Watermelon & Cucumber',
    name_ar = 'بطيخ وخيار',
    desc_en = 'Feta, pine nuts, balsamic dressing.',
    desc_ar = 'جبنة فيتا، صنوبر، صوص بلسميك',
    calories = '341',
    price = '59 SAR',
    image = v_img_base || 'watermelon-cucumber.jpg',
    active = true,
    sold_out = false,
    hidden_until = null,
    section_id = v_sec_daytime_salads,
    sort_order = 10,
    placement_group_id = coalesce(placement_group_id, gen_random_uuid()),
    branch_id = v_branch
  where id = v_watermelon_id
  returning placement_group_id into v_pg_watermelon;

  delete from public.item_allergens where item_id = v_watermelon_id;
  insert into public.item_allergens (item_id, allergen_id)
  select v_watermelon_id, a.id
  from public.allergens a
  where a.code = any(array['m', 'su', 'n']::text[])
  on conflict (item_id, allergen_id) do nothing;

  update public.menu_items
  set
    name_en = 'King Prawn Rendang',
    name_ar = 'روبيان الملك برندانغ',
    desc_en = 'Grilled lemon.',
    desc_ar = 'ليمون مشوي',
    calories = '472',
    price = '62 SAR',
    image = v_img_base || 'king-prawn-rendang.jpg',
    active = true,
    sold_out = false,
    hidden_until = null,
    section_id = v_sec_daytime_sides,
    sort_order = 10,
    placement_group_id = coalesce(placement_group_id, gen_random_uuid()),
    branch_id = v_branch
  where id = v_prawn_id
  returning placement_group_id into v_pg_prawn;

  delete from public.item_allergens where item_id = v_prawn_id;
  insert into public.item_allergens (item_id, allergen_id)
  select v_prawn_id, a.id
  from public.allergens a
  where a.code = any(array['s', 'sh', 'se', 'su', 'f', 'n', 'c', 'g']::text[])
  on conflict (item_id, allergen_id) do nothing;

  update public.menu_items
  set
    name_en = 'Conchiglie',
    name_ar = 'مكرونة كونكيليه',
    desc_en = 'Wild morels, parmesan cream.',
    desc_ar = 'فطر الموريل البري، كريمة البارميزان',
    calories = '800',
    price = '79 SAR',
    image = v_img_base || 'conchiglie-wild-morels.jpg',
    active = true,
    sold_out = false,
    hidden_until = null,
    section_id = v_sec_daytime_mains,
    sort_order = 10,
    placement_group_id = coalesce(placement_group_id, gen_random_uuid()),
    branch_id = v_branch
  where id = v_conchiglie_id
  returning placement_group_id into v_pg_conchiglie;

  delete from public.item_allergens where item_id = v_conchiglie_id;
  insert into public.item_allergens (item_id, allergen_id)
  select v_conchiglie_id, a.id
  from public.allergens a
  where a.code = any(array['d', 'g']::text[])
  on conflict (item_id, allergen_id) do nothing;

  update public.menu_items
  set
    name_en = 'Pan Seared Seabass',
    name_ar = 'سمك سي باس مشوي',
    desc_en = 'Creole with pepper cream sauce, watercress.',
    desc_ar = 'صوص كريول بكريمة الفلفل، جرجير',
    calories = '430',
    price = '72 SAR',
    image = v_img_base || 'pan-seared-seabass.jpg',
    active = true,
    sold_out = false,
    hidden_until = null,
    section_id = v_sec_daytime_mains,
    sort_order = 11,
    placement_group_id = coalesce(placement_group_id, gen_random_uuid()),
    branch_id = v_branch
  where id = v_seabass_id
  returning placement_group_id into v_pg_seabass;

  delete from public.item_allergens where item_id = v_seabass_id;
  insert into public.item_allergens (item_id, allergen_id)
  select v_seabass_id, a.id
  from public.allergens a
  where a.code = any(array['c', 'su', 'd', 'g', 'm', 'f']::text[])
  on conflict (item_id, allergen_id) do nothing;

  perform public._nac_ensure_seasonal_placement(
    v_watermelon_id, v_pg_watermelon, v_sec_evening_salads, 10
  );
  perform public._nac_ensure_seasonal_placement(
    v_watermelon_id, v_pg_watermelon, v_sec_brunch_salads, 10
  );
  perform public._nac_ensure_seasonal_placement(
    v_watermelon_id, v_pg_watermelon, v_sec_breakfast_plates, 10
  );

  perform public._nac_ensure_seasonal_placement(
    v_prawn_id, v_pg_prawn, v_sec_evening_sides, 10
  );
  perform public._nac_ensure_seasonal_placement(
    v_prawn_id, v_pg_prawn, v_sec_brunch_sides, 10
  );

  perform public._nac_ensure_seasonal_placement(
    v_conchiglie_id, v_pg_conchiglie, v_sec_evening_mains, 10
  );
  perform public._nac_ensure_seasonal_placement(
    v_conchiglie_id, v_pg_conchiglie, v_sec_brunch_plates, 10
  );

  perform public._nac_ensure_seasonal_placement(
    v_seabass_id, v_pg_seabass, v_sec_evening_mains, 11
  );
  perform public._nac_ensure_seasonal_placement(
    v_seabass_id, v_pg_seabass, v_sec_brunch_plates, 11
  );

  -- Update existing live Big Nac group in place (preserves placement history).
  update public.menu_items
  set
    name_en = 'Big NAC',
    name_ar = 'بيغ نك',
    desc_en = '',
    desc_ar = '',
    calories = '1115',
    price = '69 SAR',
    image = v_img_base || 'big-nac.jpg',
    active = true,
    sold_out = false,
    hidden_until = null
  where placement_group_id = v_live_big_nac_group
    and branch_id = v_branch;

  delete from public.item_allergens ia
  using public.menu_items mi
  where ia.item_id = mi.id
    and mi.placement_group_id = v_live_big_nac_group
    and mi.branch_id = v_branch;

  insert into public.item_allergens (item_id, allergen_id)
  select mi.id, a.id
  from public.menu_items mi
  cross join public.allergens a
  where mi.placement_group_id = v_live_big_nac_group
    and mi.branch_id = v_branch
    and a.code = any(array['g', 'd', 'e', 'm', 'su', 'se']::text[])
  on conflict (item_id, allergen_id) do nothing;

  -- Retire staged Big NAC replacement so guests never see two Big NAC cards.
  update public.menu_items
  set
    active = false,
    section_id = null,
    placement_group_id = null,
    hidden_until = null,
    name_en = 'Big NAC (staged archive)',
    slug = 'seasonal-2026-big-nac-replacement'
  where id = v_big_nac_staged_id
    and branch_id = v_branch;

  delete from public.item_allergens where item_id = v_big_nac_staged_id;

  -- Brownies commercial values: no Brownies sheet/catalogue source exists.
  -- Use Crushed Milk Chocolate Cookies (Cookies with Ice Cream) price/calories
  -- as the only approved ice-cream dessert catalogue twin, not invented numbers.
  insert into public.menu_items (
    id, section_id, slug, name_en, name_ar, desc_en, desc_ar,
    calories, price, image, active, sold_out, featured, new_item,
    vegetarian, vegan, hidden_until, sort_order, placement_group_id, branch_id
  )
  values (
    v_brownies_id,
    v_sec_desserts,
    'seasonal-2026-brownies',
    'Brownies',
    'براونيز',
    '',
    '',
    v_cookies_calories,
    v_cookies_price,
    v_img_base || 'brownies.jpg',
    true,
    false,
    false,
    false,
    false,
    false,
    null,
    7,
    gen_random_uuid(),
    v_branch
  )
  on conflict (id) do update
  set
    section_id = excluded.section_id,
    slug = excluded.slug,
    name_en = excluded.name_en,
    name_ar = excluded.name_ar,
    desc_en = excluded.desc_en,
    desc_ar = excluded.desc_ar,
    calories = excluded.calories,
    price = excluded.price,
    image = excluded.image,
    active = true,
    sold_out = false,
    hidden_until = null,
    sort_order = excluded.sort_order,
    placement_group_id = coalesce(public.menu_items.placement_group_id, excluded.placement_group_id),
    branch_id = v_branch;

  select placement_group_id into v_pg_brownies
  from public.menu_items
  where id = v_brownies_id;

  delete from public.item_allergens where item_id = v_brownies_id;
  insert into public.item_allergens (item_id, allergen_id)
  select v_brownies_id, allergen_id
  from unnest(v_cookies_allergen_ids) as allergen_id
  on conflict (item_id, allergen_id) do nothing;

  perform public._nac_ensure_seasonal_placement(
    v_brownies_id, v_pg_brownies, v_sec_breakfast_sweets, 7
  );
  perform public._nac_ensure_seasonal_placement(
    v_brownies_id, v_pg_brownies, v_sec_brunch_sweets, 7
  );

  if exists (
    select 1
    from public.menu_items
    where branch_id = v_branch
      and active = true
      and section_id is not null
      and (
        name_en ilike 'big nac%'
        or slug = 'seasonal-2026-big-nac-replacement'
      )
      and placement_group_id is distinct from v_live_big_nac_group
  ) then
    raise exception 'Duplicate live Big NAC detected after seasonal publish';
  end if;

  if (
    select count(*)
    from public.menu_items
    where placement_group_id = v_live_big_nac_group
      and branch_id = v_branch
      and active = true
  ) <> 3 then
    raise exception 'Expected exactly 3 active live Big NAC placements';
  end if;

  -- Ensure breakfast excludes the four non-breakfast seasonal dishes.
  if exists (
    select 1
    from public.menu_items mi
    join public.sections s on s.id = mi.section_id
    join public.categories c on c.id = s.category_id
    where mi.branch_id = v_branch
      and mi.active = true
      and c.slug = 'breakfast'
      and mi.placement_group_id in (v_pg_prawn, v_pg_conchiglie, v_pg_seabass, v_live_big_nac_group)
  ) then
    raise exception 'Non-breakfast seasonal items incorrectly placed under Breakfast';
  end if;

  perform set_config('request.jwt.claim.email', 'raffiazarian2@gmail.com', true);

  v_publication := public.publish_menu_branch(
    v_branch,
    jsonb_build_object(
      'action', 'publish',
      'entity_type', 'seasonal_menu_release',
      'entity_id', '2026-08-09',
      'changed_fields', jsonb_build_array(
        'King Prawn Rendang',
        'Watermelon & Cucumber',
        'Conchiglie',
        'Big NAC',
        'Pan Seared Seabass',
        'Brownies'
      )
    ),
    'khobar-seasonal-menu-release-2026-08-09'
  );

  if v_publication is null or v_publication ->> 'id' is null then
    raise exception 'Menu publication failed';
  end if;

  v_pub_id := (v_publication ->> 'id')::uuid;

  if coalesce(v_publication ->> 'status', '') <> 'live'
     or coalesce(v_publication ->> 'already_live', '') = 'true'
  then
    -- Mark publishing rows live when needed; already_live is a no-op success.
    if coalesce(v_publication ->> 'status', '') = 'publishing' then
      perform public.verify_menu_publication(v_pub_id);
    end if;
  end if;
end;
$$;

drop function public._nac_ensure_seasonal_placement(uuid, uuid, uuid, int);
