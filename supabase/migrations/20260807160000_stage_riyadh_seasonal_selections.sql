-- Stage the August 2026 Riyadh Seasonal Selections in the editable catalogue.
-- These rows are deliberately inactive and unplaced. This migration does not
-- publish a menu version and does not alter the currently-live Big Nac rows.

alter table public.menu_items
  alter column section_id drop not null;

comment on column public.menu_items.section_id is
  'Guest-menu placement. NULL keeps an inactive catalogue item unplaced until a manager chooses a section.';

insert into public.allergens (code, name_en, name_ar)
values ('c', 'Celery', 'كرفس')
on conflict (code) do nothing;

do $$
declare
  v_branch constant text := 'riyadh';
  v_conflict record;
begin
  if not exists (
    select 1 from public.categories where branch_id = v_branch
  ) then
    raise exception 'Riyadh menu catalogue is missing; seasonal staging aborted';
  end if;

  perform pg_advisory_xact_lock(hashtext('nac:riyadh:seasonal-selections:2026-08'));

  select mi.id, mi.slug
  into v_conflict
  from public.menu_items mi
  where mi.branch_id = v_branch
    and mi.slug in (
      'seasonal-2026-king-prawn-rendang',
      'seasonal-2026-watermelon-cucumber',
      'seasonal-2026-conchiglie',
      'seasonal-2026-big-nac-replacement',
      'seasonal-2026-pan-seared-seabass'
    )
    and mi.id not in (
      'a6070000-0000-4000-8000-000000000001'::uuid,
      'a6070000-0000-4000-8000-000000000002'::uuid,
      'a6070000-0000-4000-8000-000000000003'::uuid,
      'a6070000-0000-4000-8000-000000000004'::uuid,
      'a6070000-0000-4000-8000-000000000005'::uuid
    )
  limit 1;

  if found then
    raise exception
      'Seasonal staging slug % already belongs to menu item %',
      v_conflict.slug,
      v_conflict.id;
  end if;

  insert into public.menu_items (
    id, section_id, slug, name_en, name_ar, desc_en, desc_ar,
    calories, price, image, active, sold_out, featured, new_item,
    vegetarian, vegan, hidden_until, sort_order, placement_group_id, branch_id
  )
  values
    (
      'a6070000-0000-4000-8000-000000000001', null,
      'seasonal-2026-king-prawn-rendang',
      'King Prawn Rendang', 'روبيان الملك برندانغ',
      'Grilled lemon.', 'ليمون مشوي',
      '472', '62',
      'https://zeyhvjuraqnlbdycgrme.supabase.co/storage/v1/object/public/menu-images/items/seasonal-2026/king-prawn-rendang.jpg',
      false, false, false, false, false, false, null, 0, null, v_branch
    ),
    (
      'a6070000-0000-4000-8000-000000000002', null,
      'seasonal-2026-watermelon-cucumber',
      'Watermelon & Cucumber', 'بطيخ وخيار',
      'Feta, pine nuts, balsamic dressing.', 'جبنة فيتا، صنوبر، صوص بلسميك',
      '341', '59',
      'https://zeyhvjuraqnlbdycgrme.supabase.co/storage/v1/object/public/menu-images/items/seasonal-2026/watermelon-cucumber.jpg',
      false, false, false, false, false, false, null, 0, null, v_branch
    ),
    (
      'a6070000-0000-4000-8000-000000000003', null,
      'seasonal-2026-conchiglie',
      'Conchiglie', 'مكرونة كونكيليه',
      'Wild morels, parmesan cream.', 'فطر الموريل البري، كريمة البارميزان',
      '800', '79',
      'https://zeyhvjuraqnlbdycgrme.supabase.co/storage/v1/object/public/menu-images/items/seasonal-2026/conchiglie-wild-morels.jpg',
      false, false, false, false, false, false, null, 0, null, v_branch
    ),
    (
      'a6070000-0000-4000-8000-000000000004', null,
      'seasonal-2026-big-nac-replacement',
      'Big NAC', 'بيغ نك',
      '', '',
      '1115', '69',
      'https://zeyhvjuraqnlbdycgrme.supabase.co/storage/v1/object/public/menu-images/items/seasonal-2026/big-nac.jpg',
      false, false, false, false, false, false, null, 0, null, v_branch
    ),
    (
      'a6070000-0000-4000-8000-000000000005', null,
      'seasonal-2026-pan-seared-seabass',
      'Pan Seared Seabass', 'سمك سي باس مشوي',
      'Creole with pepper cream sauce, watercress.', 'صوص كريول بكريمة الفلفل، جرجير',
      '430', '72',
      'https://zeyhvjuraqnlbdycgrme.supabase.co/storage/v1/object/public/menu-images/items/seasonal-2026/pan-seared-seabass.jpg',
      false, false, false, false, false, false, null, 0, null, v_branch
    )
  on conflict (id) do nothing;
end;
$$;

insert into public.item_allergens (item_id, allergen_id)
select staged.item_id, a.id
from (
  values
    ('a6070000-0000-4000-8000-000000000001'::uuid, array['s','sh','se','su','f','n','c','g']::text[]),
    ('a6070000-0000-4000-8000-000000000002'::uuid, array['m','su','n']::text[]),
    ('a6070000-0000-4000-8000-000000000003'::uuid, array['d','g']::text[]),
    ('a6070000-0000-4000-8000-000000000004'::uuid, array['g','d','e','m','su','se']::text[]),
    ('a6070000-0000-4000-8000-000000000005'::uuid, array['c','su','d','g','m','f']::text[])
) as staged(item_id, allergen_codes)
join public.allergens a on a.code = any(staged.allergen_codes)
join public.menu_items mi
  on mi.id = staged.item_id
 and mi.branch_id = 'riyadh'
on conflict (item_id, allergen_id) do nothing;
