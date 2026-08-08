-- Emergency hotfix: hide Khobar seasonal six from the guest QR menu until
-- Sunday 9 Aug 2026 00:00 Asia/Riyadh using native hidden_until scheduling.
-- Preserves active=true, placements, commercial fields, allergens, and images.

do $$
declare
  v_branch constant text := 'khobar';
  v_activate_at constant timestamptz := timestamptz '2026-08-09 00:00:00+03';
  v_groups uuid[] := array[
    '991c66b8-7f5d-4617-af87-b65bd114d58b'::uuid, -- Watermelon & Cucumber
    '56d3a913-fa06-4130-aa40-273af09a29e1'::uuid, -- King Prawn Rendang
    'e14ea002-2f20-4cb4-9d41-52ec13630e33'::uuid, -- Big NAC
    'ad6e4f58-8844-4a06-852c-d60674d22fca'::uuid, -- Pan Seared Seabass
    'e494ed53-3d2f-4f74-b773-3b56c2886f9f'::uuid, -- Conchiglie
    '1a70a107-954d-4975-b1f9-5da7fd87f231'::uuid  -- Brownie, Caramel, Vanilla Ice Cream
  ];
  v_updated int;
  v_publication jsonb;
  v_pub_id uuid;
  v_row record;
begin
  perform pg_advisory_xact_lock(hashtext('nac:khobar:seasonal-hide-until-sunday:2026-08-08'));

  if now() >= v_activate_at then
    raise exception 'Activation timestamp % is not in the future; refusing hide hotfix', v_activate_at;
  end if;

  update public.menu_items mi
  set
    hidden_until = v_activate_at,
    active = true
  where mi.branch_id = v_branch
    and mi.placement_group_id = any (v_groups)
    and mi.active = true
    and (
      mi.hidden_until is distinct from v_activate_at
      or mi.active is distinct from true
    );

  get diagnostics v_updated = row_count;

  -- Idempotent re-run still requires the scheduled hide to be present.
  if not exists (
    select 1
    from public.menu_items mi
    where mi.branch_id = v_branch
      and mi.placement_group_id = any (v_groups)
      and mi.active = true
      and mi.hidden_until = v_activate_at
    having count(*) = 19
  ) then
    raise exception
      'Expected 19 active seasonal rows with hidden_until=%; updated=%',
      v_activate_at, v_updated;
  end if;

  -- Placement / Sunday shift rules must remain intact.
  for v_row in
    select mi.name_en, c.slug as category_slug, s.name_en as section_name
    from public.menu_items mi
    join public.sections s on s.id = mi.section_id
    join public.categories c on c.id = s.category_id
    where mi.branch_id = v_branch
      and mi.placement_group_id = any (v_groups)
      and mi.active = true
  loop
    if v_row.name_en = 'King Prawn Rendang' and v_row.category_slug = 'breakfast' then
      raise exception 'King Prawn unexpectedly present at Breakfast';
    end if;

    if v_row.name_en = 'King Prawn Rendang'
       and not (
         (v_row.category_slug in ('daytime', 'evening') and v_row.section_name = 'Mains')
         or (v_row.category_slug = 'brunch' and v_row.section_name = 'Plates')
       )
    then
      raise exception 'King Prawn placement drifted: % / %', v_row.category_slug, v_row.section_name;
    end if;

    if v_row.name_en in ('Big NAC', 'Pan Seared Seabass', 'Conchiglie')
       and v_row.category_slug = 'breakfast'
    then
      raise exception '% unexpectedly present at Breakfast', v_row.name_en;
    end if;

    if v_row.name_en = 'Watermelon & Cucumber'
       and not (
         (v_row.category_slug = 'breakfast' and v_row.section_name = 'Plates')
         or (v_row.category_slug in ('daytime', 'evening', 'brunch') and v_row.section_name = 'Salads')
       )
    then
      raise exception 'Watermelon placement drifted: % / %', v_row.category_slug, v_row.section_name;
    end if;

    if v_row.name_en = 'Brownie, Caramel, Vanilla Ice Cream'
       and not (
         (v_row.category_slug = 'desserts' and v_row.section_name = 'Desserts')
         or (v_row.category_slug in ('breakfast', 'brunch') and v_row.section_name = 'Sweets')
       )
    then
      raise exception 'Brownie placement drifted: % / %', v_row.category_slug, v_row.section_name;
    end if;
  end loop;

  -- Commercial Brownie guard.
  if exists (
    select 1
    from public.menu_items mi
    where mi.branch_id = v_branch
      and mi.placement_group_id = '1a70a107-954d-4975-b1f9-5da7fd87f231'::uuid
      and mi.active = true
      and (
        mi.name_en is distinct from 'Brownie, Caramel, Vanilla Ice Cream'
        or mi.price is distinct from '62 SAR'
        or mi.calories is distinct from '1070'
      )
  ) then
    raise exception 'Brownie commercial fields changed during seasonal hide hotfix';
  end if;

  -- Guest-visible now must be empty for these six (RLS uses hidden_until > now()).
  if exists (
    select 1
    from public.menu_items mi
    where mi.branch_id = v_branch
      and mi.placement_group_id = any (v_groups)
      and mi.active = true
      and (mi.hidden_until is null or mi.hidden_until <= now())
  ) then
    raise exception 'Seasonal items still guest-visible after hide hotfix';
  end if;

  perform set_config('request.jwt.claim.email', 'raffiazarian2@gmail.com', true);

  v_publication := public.publish_menu_branch(
    v_branch,
    jsonb_build_object(
      'action', 'update_item',
      'entity_type', 'menu_item',
      'entity_id', 'a6070000-0000-4000-8000-000000000001',
      'changed_fields', jsonb_build_object(
        'hidden_until', v_activate_at,
        'scope', 'khobar-seasonal-six'
      )
    ),
    'khobar-seasonal-hide-until-sunday-2026-08-09'
  );

  if v_publication is null or v_publication ->> 'id' is null then
    raise exception 'Seasonal hide hotfix publication failed';
  end if;

  v_pub_id := (v_publication ->> 'id')::uuid;
  if coalesce(v_publication ->> 'status', '') = 'publishing' then
    perform public.verify_menu_publication(v_pub_id);
  end if;
end;
$$;
