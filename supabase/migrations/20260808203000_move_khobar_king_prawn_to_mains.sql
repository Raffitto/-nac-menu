-- Targeted Khobar placement correction:
-- Move King Prawn Rendang from Sides to Mains (brunch Plates).
-- Preserves commercial fields, allergens, image, and non-Breakfast availability.

do $$
declare
  v_branch constant text := 'khobar';
  v_prawn_id constant uuid := 'a6070000-0000-4000-8000-000000000001';
  v_group_id uuid;
  v_sec_daytime_mains uuid;
  v_sec_evening_mains uuid;
  v_sec_brunch_plates uuid;
  v_row record;
  v_target uuid;
  v_publication jsonb;
  v_pub_id uuid;
  v_allergens text[];
begin
  perform pg_advisory_xact_lock(hashtext('nac:khobar:king-prawn-mains:2026-08-08'));

  select placement_group_id
  into v_group_id
  from public.menu_items
  where id = v_prawn_id
    and branch_id = v_branch;

  if v_group_id is null then
    raise exception 'Khobar King Prawn Rendang placement group missing; correction aborted';
  end if;

  select s.id into v_sec_daytime_mains
  from public.sections s
  join public.categories c on c.id = s.category_id
  where c.branch_id = v_branch and s.branch_id = v_branch
    and c.slug = 'daytime' and s.name_en = 'Mains'
  limit 1;

  select s.id into v_sec_evening_mains
  from public.sections s
  join public.categories c on c.id = s.category_id
  where c.branch_id = v_branch and s.branch_id = v_branch
    and c.slug = 'evening' and s.name_en = 'Mains'
  limit 1;

  select s.id into v_sec_brunch_plates
  from public.sections s
  join public.categories c on c.id = s.category_id
  where c.branch_id = v_branch and s.branch_id = v_branch
    and c.slug = 'brunch' and s.name_en = 'Plates'
  limit 1;

  if v_sec_daytime_mains is null
     or v_sec_evening_mains is null
     or v_sec_brunch_plates is null
  then
    raise exception 'Canonical Khobar Mains/Plates sections missing; correction aborted';
  end if;

  for v_row in
    select mi.id, mi.section_id, c.slug as category_slug, s.name_en as section_name
    from public.menu_items mi
    join public.sections s on s.id = mi.section_id
    join public.categories c on c.id = s.category_id
    where mi.branch_id = v_branch
      and mi.placement_group_id = v_group_id
      and mi.active = true
  loop
    if v_row.category_slug = 'breakfast' then
      raise exception 'King Prawn unexpectedly placed under Breakfast; refusing correction';
    end if;

    v_target := case
      when v_row.category_slug = 'daytime' then v_sec_daytime_mains
      when v_row.category_slug = 'evening' then v_sec_evening_mains
      when v_row.category_slug = 'brunch' then v_sec_brunch_plates
      else null
    end;

    if v_target is null then
      raise exception
        'Unsupported King Prawn host category % for placement %',
        v_row.category_slug,
        v_row.id;
    end if;

    -- Avoid duplicate active cards if a stray row already occupies the target section.
    if exists (
      select 1
      from public.menu_items mi
      where mi.branch_id = v_branch
        and mi.section_id = v_target
        and mi.active = true
        and mi.name_en = 'King Prawn Rendang'
        and mi.id <> v_row.id
        and mi.placement_group_id is distinct from v_group_id
    ) then
      raise exception
        'Conflicting active King Prawn already exists in target section %',
        v_target;
    end if;

    update public.menu_items
    set section_id = v_target
    where id = v_row.id
      and branch_id = v_branch
      and section_id is distinct from v_target;
  end loop;

  if (
    select count(*)
    from public.menu_items mi
    join public.sections s on s.id = mi.section_id
    join public.categories c on c.id = s.category_id
    where mi.branch_id = v_branch
      and mi.placement_group_id = v_group_id
      and mi.active = true
      and (
        (c.slug = 'daytime' and s.name_en = 'Mains')
        or (c.slug = 'evening' and s.name_en = 'Mains')
        or (c.slug = 'brunch' and s.name_en = 'Plates')
      )
  ) <> 3 then
    raise exception 'Expected exactly 3 active King Prawn Mains/Plates placements after correction';
  end if;

  if exists (
    select 1
    from public.menu_items mi
    join public.sections s on s.id = mi.section_id
    join public.categories c on c.id = s.category_id
    where mi.branch_id = v_branch
      and mi.placement_group_id = v_group_id
      and mi.active = true
      and s.name_en = 'Sides'
  ) then
    raise exception 'King Prawn still appears under Sides after correction';
  end if;

  if exists (
    select 1
    from public.menu_items mi
    join public.sections s on s.id = mi.section_id
    join public.categories c on c.id = s.category_id
    where mi.branch_id = v_branch
      and mi.placement_group_id = v_group_id
      and mi.active = true
      and c.slug = 'breakfast'
  ) then
    raise exception 'King Prawn must remain unavailable at Breakfast';
  end if;

  -- Commercial / allergen / image guardrails (must remain unchanged).
  if exists (
    select 1
    from public.menu_items mi
    where mi.branch_id = v_branch
      and mi.placement_group_id = v_group_id
      and mi.active = true
      and (
        mi.name_en is distinct from 'King Prawn Rendang'
        or mi.desc_en is distinct from 'Grilled lemon.'
        or mi.price is distinct from '62 SAR'
        or mi.calories is distinct from '472'
        or mi.image is distinct from
          'https://zeyhvjuraqnlbdycgrme.supabase.co/storage/v1/object/public/menu-images/items/seasonal-2026/king-prawn-rendang.jpg'
      )
  ) then
    raise exception 'King Prawn commercial fields or image unexpectedly changed';
  end if;

  select coalesce(array_agg(a.code order by a.code), '{}'::text[])
  into v_allergens
  from public.item_allergens ia
  join public.allergens a on a.id = ia.allergen_id
  where ia.item_id = v_prawn_id;

  if v_allergens is distinct from array['c', 'f', 'g', 'n', 's', 'se', 'sh', 'su']::text[] then
    raise exception 'King Prawn allergens unexpectedly %, refusing publish', v_allergens;
  end if;

  -- Brownie remains untouched by this correction.
  if exists (
    select 1
    from public.menu_items mi
    where mi.branch_id = v_branch
      and mi.id = 'a6070000-0000-4000-8000-000000000006'::uuid
      and (
        mi.name_en is distinct from 'Brownie, Caramel, Vanilla Ice Cream'
        or mi.calories is distinct from '1070'
        or mi.price is distinct from '62 SAR'
      )
  ) then
    raise exception 'Brownie commercial state drifted during King Prawn correction';
  end if;

  perform set_config('request.jwt.claim.email', 'raffiazarian2@gmail.com', true);

  v_publication := public.publish_menu_branch(
    v_branch,
    jsonb_build_object(
      'action', 'update_item',
      'entity_type', 'menu_item',
      'entity_id', v_prawn_id::text,
      'changed_fields', jsonb_build_object(
        'section', 'Mains',
        'name_en', 'King Prawn Rendang'
      )
    ),
    'khobar-king-prawn-move-to-mains-2026-08-08'
  );

  if v_publication is null or v_publication ->> 'id' is null then
    raise exception 'King Prawn section correction publication failed';
  end if;

  v_pub_id := (v_publication ->> 'id')::uuid;
  if coalesce(v_publication ->> 'status', '') = 'publishing' then
    perform public.verify_menu_publication(v_pub_id);
  end if;
end;
$$;
