-- Correct the staged Seasonal Selections branch scope.
-- The QR menu currently operates from Khobar. The schema has no shared
-- network-level catalogue: menu_items and their placements are branch-scoped.

do $$
declare
  v_expected_ids constant uuid[] := array[
    'a6070000-0000-4000-8000-000000000001'::uuid,
    'a6070000-0000-4000-8000-000000000002'::uuid,
    'a6070000-0000-4000-8000-000000000003'::uuid,
    'a6070000-0000-4000-8000-000000000004'::uuid,
    'a6070000-0000-4000-8000-000000000005'::uuid
  ];
  v_conflict record;
  v_count integer;
begin
  perform pg_advisory_xact_lock(hashtext('nac:seasonal-selections:2026-08:branch-correction'));

  if not exists (
    select 1 from public.categories where branch_id = 'khobar'
  ) then
    raise exception 'Khobar menu catalogue is missing; seasonal correction aborted';
  end if;

  select mi.id, mi.slug
  into v_conflict
  from public.menu_items mi
  where mi.branch_id = 'khobar'
    and mi.slug in (
      'seasonal-2026-king-prawn-rendang',
      'seasonal-2026-watermelon-cucumber',
      'seasonal-2026-conchiglie',
      'seasonal-2026-big-nac-replacement',
      'seasonal-2026-pan-seared-seabass'
    )
    and mi.id <> all(v_expected_ids)
  limit 1;

  if found then
    raise exception
      'Khobar seasonal slug % already belongs to menu item %',
      v_conflict.slug,
      v_conflict.id;
  end if;

  update public.menu_items
  set branch_id = 'khobar'
  where id = any(v_expected_ids)
    and branch_id = 'riyadh'
    and active = false
    and section_id is null;

  select count(*)
  into v_count
  from public.menu_items
  where id = any(v_expected_ids)
    and branch_id = 'khobar';

  if v_count <> 5 then
    raise exception
      'Expected five Khobar seasonal records after correction, found %',
      v_count;
  end if;
end;
$$;
