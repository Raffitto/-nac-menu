-- Cornflakes add-on linked to Cookies menu items (idempotent).

INSERT INTO add_ons (slug, name_en, name_ar, price, calories, preview_image, active)
VALUES ('cornflakes', 'Cornflakes', 'كورن فليكس', '6 SAR', '-', '', true)
ON CONFLICT (slug) DO UPDATE SET
  name_en = EXCLUDED.name_en,
  name_ar = EXCLUDED.name_ar,
  price = EXCLUDED.price,
  active = true;

INSERT INTO item_addons (item_id, addon_id, sort_order)
SELECT
  mi.id,
  ao.id,
  COALESCE(
    (SELECT MAX(ia.sort_order) FROM item_addons ia WHERE ia.item_id = mi.id),
    -1
  ) + 1
FROM menu_items mi
CROSS JOIN add_ons ao
WHERE ao.slug = 'cornflakes'
  AND mi.name_en ILIKE '%Crushed Milk Chocolate Cookies%'
ON CONFLICT (item_id, addon_id) DO NOTHING;
