-- ============================================================
-- NAC Menu Editor — RLS fix (run in Supabase SQL Editor)
-- Safe to re-run (idempotent).
--
-- Tables (from menu_schema.sql):
--   categories, sections, menu_items, add_ons,
--   item_addons, item_allergens, allergens
--
-- Guest (anon): SELECT only, active/visible rows where applicable.
-- Staff (authenticated): full CRUD on all menu editor tables.
--
-- IMPORTANT: Menu Manager must sign in via Settings (Supabase Auth).
-- The app password gate alone does not grant database write access.
-- ============================================================

-- ── 1. Enable RLS on all menu CMS tables ─────────────────────

ALTER TABLE public.categories     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sections       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menu_items     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.add_ons        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.item_addons    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.allergens      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.item_allergens ENABLE ROW LEVEL SECURITY;

-- ── 2. Drop legacy / duplicate policies ──────────────────────

-- categories
DROP POLICY IF EXISTS "Public can read active categories" ON public.categories;
DROP POLICY IF EXISTS "Authenticated full access to categories" ON public.categories;

-- sections
DROP POLICY IF EXISTS "Public can read active sections" ON public.sections;
DROP POLICY IF EXISTS "Authenticated full access to sections" ON public.sections;

-- menu_items
DROP POLICY IF EXISTS "Public can read active menu items" ON public.menu_items;
DROP POLICY IF EXISTS "Public can read visible menu items" ON public.menu_items;
DROP POLICY IF EXISTS "Authenticated full access to menu items" ON public.menu_items;

-- add_ons
DROP POLICY IF EXISTS "Public can read active add ons" ON public.add_ons;
DROP POLICY IF EXISTS "Authenticated full access to add ons" ON public.add_ons;

-- item_addons
DROP POLICY IF EXISTS "Public can read item addons" ON public.item_addons;
DROP POLICY IF EXISTS "Authenticated full access to item addons" ON public.item_addons;

-- allergens
DROP POLICY IF EXISTS "Public can read allergens" ON public.allergens;
DROP POLICY IF EXISTS "Authenticated full access to allergens" ON public.allergens;

-- item_allergens
DROP POLICY IF EXISTS "Public can read item allergens" ON public.item_allergens;
DROP POLICY IF EXISTS "Authenticated full access to item allergens" ON public.item_allergens;

-- ── 3. Public (anon) — read-only ─────────────────────────────

CREATE POLICY "anon_select_active_categories"
  ON public.categories FOR SELECT TO anon
  USING (active = true);

CREATE POLICY "anon_select_active_sections"
  ON public.sections FOR SELECT TO anon
  USING (active = true);

CREATE POLICY "anon_select_visible_menu_items"
  ON public.menu_items FOR SELECT TO anon
  USING (
    active = true
    AND (hidden_until IS NULL OR hidden_until <= now())
  );

CREATE POLICY "anon_select_active_add_ons"
  ON public.add_ons FOR SELECT TO anon
  USING (active = true);

CREATE POLICY "anon_select_item_addons"
  ON public.item_addons FOR SELECT TO anon
  USING (true);

CREATE POLICY "anon_select_allergens"
  ON public.allergens FOR SELECT TO anon
  USING (true);

CREATE POLICY "anon_select_item_allergens"
  ON public.item_allergens FOR SELECT TO anon
  USING (true);

-- ── 4. Authenticated — admin menu editor CRUD ────────────────

-- categories
CREATE POLICY "auth_select_categories"
  ON public.categories FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "auth_insert_categories"
  ON public.categories FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "auth_update_categories"
  ON public.categories FOR UPDATE TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "auth_delete_categories"
  ON public.categories FOR DELETE TO authenticated
  USING (true);

-- sections
CREATE POLICY "auth_select_sections"
  ON public.sections FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "auth_insert_sections"
  ON public.sections FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "auth_update_sections"
  ON public.sections FOR UPDATE TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "auth_delete_sections"
  ON public.sections FOR DELETE TO authenticated
  USING (true);

-- menu_items
CREATE POLICY "auth_select_menu_items"
  ON public.menu_items FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "auth_insert_menu_items"
  ON public.menu_items FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "auth_update_menu_items"
  ON public.menu_items FOR UPDATE TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "auth_delete_menu_items"
  ON public.menu_items FOR DELETE TO authenticated
  USING (true);

-- add_ons
CREATE POLICY "auth_select_add_ons"
  ON public.add_ons FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "auth_insert_add_ons"
  ON public.add_ons FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "auth_update_add_ons"
  ON public.add_ons FOR UPDATE TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "auth_delete_add_ons"
  ON public.add_ons FOR DELETE TO authenticated
  USING (true);

-- item_addons (junction)
CREATE POLICY "auth_select_item_addons"
  ON public.item_addons FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "auth_insert_item_addons"
  ON public.item_addons FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "auth_update_item_addons"
  ON public.item_addons FOR UPDATE TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "auth_delete_item_addons"
  ON public.item_addons FOR DELETE TO authenticated
  USING (true);

-- allergens (reference)
CREATE POLICY "auth_select_allergens"
  ON public.allergens FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "auth_insert_allergens"
  ON public.allergens FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "auth_update_allergens"
  ON public.allergens FOR UPDATE TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "auth_delete_allergens"
  ON public.allergens FOR DELETE TO authenticated
  USING (true);

-- item_allergens (junction)
CREATE POLICY "auth_select_item_allergens"
  ON public.item_allergens FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "auth_insert_item_allergens"
  ON public.item_allergens FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "auth_update_item_allergens"
  ON public.item_allergens FOR UPDATE TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "auth_delete_item_allergens"
  ON public.item_allergens FOR DELETE TO authenticated
  USING (true);

-- ── 5. Table grants — anon read, authenticated write ─────────

GRANT USAGE ON SCHEMA public TO anon, authenticated;

GRANT SELECT ON public.categories     TO anon, authenticated;
GRANT SELECT ON public.sections       TO anon, authenticated;
GRANT SELECT ON public.menu_items     TO anon, authenticated;
GRANT SELECT ON public.add_ons        TO anon, authenticated;
GRANT SELECT ON public.item_addons    TO anon, authenticated;
GRANT SELECT ON public.allergens      TO anon, authenticated;
GRANT SELECT ON public.item_allergens TO anon, authenticated;

GRANT INSERT, UPDATE, DELETE ON public.categories     TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.sections       TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.menu_items     TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.add_ons        TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.item_addons    TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.allergens      TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.item_allergens TO authenticated;

-- Revoke writes from anon (defense in depth; RLS already blocks)
REVOKE INSERT, UPDATE, DELETE ON public.categories     FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.sections       FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.menu_items     FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.add_ons        FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.item_addons    FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.allergens      FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.item_allergens FROM anon;

-- ── 6. Storage: menu-images bucket (optional) ────────────────
-- Create bucket in Dashboard → Storage if missing: menu-images (public)

-- DROP POLICY IF EXISTS "anon_read_menu_images" ON storage.objects;
-- DROP POLICY IF EXISTS "auth_upload_menu_images" ON storage.objects;
-- DROP POLICY IF EXISTS "auth_update_menu_images" ON storage.objects;
-- DROP POLICY IF EXISTS "auth_delete_menu_images" ON storage.objects;

-- CREATE POLICY "anon_read_menu_images"
--   ON storage.objects FOR SELECT TO anon, authenticated
--   USING (bucket_id = 'menu-images');

-- CREATE POLICY "auth_upload_menu_images"
--   ON storage.objects FOR INSERT TO authenticated
--   WITH CHECK (bucket_id = 'menu-images');

-- CREATE POLICY "auth_update_menu_images"
--   ON storage.objects FOR UPDATE TO authenticated
--   USING (bucket_id = 'menu-images')
--   WITH CHECK (bucket_id = 'menu-images');

-- CREATE POLICY "auth_delete_menu_images"
--   ON storage.objects FOR DELETE TO authenticated
--   USING (bucket_id = 'menu-images');
