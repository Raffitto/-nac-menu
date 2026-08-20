-- Targeted Khobar Brownie commercial correction from printed NAC menu.
-- Authoritative printed entry:
--   brownie, caramel, vanilla ice cream (d, g, e) 1070 cal 62-.
-- Does not alter placements, shifts, image, allergens, or other seasonal items.

do $$
declare
  v_branch constant text := 'khobar';
  v_brownies_id constant uuid := 'a6070000-0000-4000-8000-000000000006';
  v_group_id uuid;
  v_image constant text :=
    'https://zeyhvjuraqnlbdycgrme.supabase.co/storage/v1/object/public/menu-images/items/seasonal-2026/brownies.jpg';
  v_updated integer;
  v_publication jsonb;
  v_pub_id uuid;
  v_allergen_codes text[];
begin
  perform pg_advisory_xact_lock(hashtext('nac:khobar:brownie-correction:2026-08-08'));

  select placement_group_id
  into v_group_id
  from public.menu_items
  where id = v_brownies_id
    and branch_id = v_branch;

  if v_group_id is null then
    raise exception 'Khobar Brownie canonical row missing; correction aborted';
  end if;

  update public.menu_items
  set
    name_en = 'Brownie, Caramel, Vanilla Ice Cream',
    desc_en = coalesce(nullif(desc_en, ''), ''),
    calories = '1070',
    price = '62 SAR',
    image = v_image,
    active = true,
    sold_out = false,
    hidden_until = null
  where branch_id = v_branch
    and (
      id = v_brownies_id
      or placement_group_id = v_group_id
    );

  get diagnostics v_updated = row_count;

  if v_updated < 1 then
    raise exception 'Brownie correction updated no rows';
  end if;

  -- Keep existing canonical allergen relationships unless they drift.
  select coalesce(array_agg(a.code order by a.code), '{}'::text[])
  into v_allergen_codes
  from public.item_allergens ia
  join public.allergens a on a.id = ia.allergen_id
  where ia.item_id = v_brownies_id;

  if v_allergen_codes is distinct from array['d', 'e', 'g']::text[] then
    raise exception
      'Brownie allergens unexpectedly %, expected {d,e,g}; refusing to rewrite',
      v_allergen_codes;
  end if;

  if exists (
    select 1
    from public.menu_items mi
    where mi.branch_id = v_branch
      and mi.placement_group_id = v_group_id
      and (
        mi.name_en is distinct from 'Brownie, Caramel, Vanilla Ice Cream'
        or mi.calories is distinct from '1070'
        or mi.price is distinct from '62 SAR'
        or mi.image is distinct from v_image
        or mi.active is distinct from true
      )
  ) then
    raise exception 'Brownie placement rows did not converge after correction';
  end if;

  -- Guard: do not touch other seasonal release items.
  if exists (
    select 1
    from public.menu_items mi
    where mi.branch_id = v_branch
      and mi.id in (
        'a6070000-0000-4000-8000-000000000001'::uuid,
        'a6070000-0000-4000-8000-000000000002'::uuid,
        'a6070000-0000-4000-8000-000000000003'::uuid,
        'a6070000-0000-4000-8000-000000000005'::uuid
      )
      and mi.calories in ('1070')
      and mi.name_en = 'Brownie, Caramel, Vanilla Ice Cream'
  ) then
    raise exception 'Unexpected seasonal item contamination during Brownie correction';
  end if;

  perform set_config('request.jwt.claim.email', 'raffiazarian2@gmail.com', true);

  v_publication := public.publish_menu_branch(
    v_branch,
    jsonb_build_object(
      'action', 'update_item',
      'entity_type', 'menu_item',
      'entity_id', v_brownies_id::text,
      'changed_fields', jsonb_build_object(
        'name_en', 'Brownie, Caramel, Vanilla Ice Cream',
        'price', '62 SAR',
        'calories', '1070',
        'allergens', jsonb_build_array('d', 'g', 'e')
      )
    ),
    'khobar-brownie-commercial-correction-2026-08-08'
  );

  if v_publication is null or v_publication ->> 'id' is null then
    raise exception 'Brownie correction publication failed';
  end if;

  v_pub_id := (v_publication ->> 'id')::uuid;
  if coalesce(v_publication ->> 'status', '') = 'publishing' then
    perform public.verify_menu_publication(v_pub_id);
  end if;
end;
$$;
