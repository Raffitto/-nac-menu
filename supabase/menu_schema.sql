-- ============================================================
-- NAC Restaurant Menu CMS — Schema
-- ============================================================

-- 1. TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS categories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        TEXT UNIQUE NOT NULL,
  name_en     TEXT NOT NULL,
  name_ar     TEXT NOT NULL,
  icon        TEXT,
  icon_ar     TEXT,
  time_en     TEXT,
  time_ar     TEXT,
  sort_order  INTEGER DEFAULT 0,
  active      BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sections (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id  UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  name_en      TEXT NOT NULL,
  name_ar      TEXT NOT NULL,
  sort_order   INTEGER DEFAULT 0,
  active       BOOLEAN DEFAULT true,
  created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS menu_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  section_id      UUID NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  slug            TEXT,
  name_en         TEXT NOT NULL,
  name_ar         TEXT NOT NULL,
  desc_en         TEXT DEFAULT '',
  desc_ar         TEXT DEFAULT '',
  calories        TEXT DEFAULT '-',
  price           TEXT NOT NULL,
  image           TEXT DEFAULT '',
  active          BOOLEAN DEFAULT true,
  sold_out        BOOLEAN DEFAULT false,
  featured        BOOLEAN DEFAULT false,
  new_item        BOOLEAN DEFAULT false,
  high_margin     BOOLEAN DEFAULT false,
  vegetarian      BOOLEAN DEFAULT false,
  vegan           BOOLEAN DEFAULT false,
  available_from  TIME,
  available_until TIME,
  hidden_until    TIMESTAMPTZ,
  sort_order      INTEGER DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS add_ons (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug           TEXT UNIQUE NOT NULL,
  name_en        TEXT NOT NULL,
  name_ar        TEXT NOT NULL,
  price          TEXT NOT NULL,
  calories       TEXT DEFAULT '-',
  preview_image  TEXT DEFAULT '',
  active         BOOLEAN DEFAULT true,
  created_at     TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS item_addons (
  item_id    UUID NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  addon_id   UUID NOT NULL REFERENCES add_ons(id) ON DELETE CASCADE,
  sort_order INTEGER DEFAULT 0,
  PRIMARY KEY (item_id, addon_id)
);

CREATE TABLE IF NOT EXISTS allergens (
  id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code    TEXT UNIQUE NOT NULL,
  name_en TEXT NOT NULL,
  name_ar TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS item_allergens (
  item_id     UUID NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  allergen_id UUID NOT NULL REFERENCES allergens(id) ON DELETE CASCADE,
  PRIMARY KEY (item_id, allergen_id)
);


-- 2. INDEXES
-- ============================================================

CREATE INDEX idx_categories_slug       ON categories (slug);
CREATE INDEX idx_categories_sort_order ON categories (sort_order);
CREATE INDEX idx_categories_active     ON categories (active);

CREATE INDEX idx_sections_category_id  ON sections (category_id);
CREATE INDEX idx_sections_sort_order   ON sections (sort_order);
CREATE INDEX idx_sections_active       ON sections (active);

CREATE INDEX idx_menu_items_section_id  ON menu_items (section_id);
CREATE INDEX idx_menu_items_slug        ON menu_items (slug);
CREATE INDEX idx_menu_items_sort_order  ON menu_items (sort_order);
CREATE INDEX idx_menu_items_active      ON menu_items (active);
CREATE INDEX idx_menu_items_sold_out    ON menu_items (sold_out);

CREATE INDEX idx_add_ons_slug          ON add_ons (slug);
CREATE INDEX idx_add_ons_active        ON add_ons (active);

CREATE INDEX idx_item_addons_item_id   ON item_addons (item_id);
CREATE INDEX idx_item_addons_addon_id  ON item_addons (addon_id);
CREATE INDEX idx_item_addons_sort      ON item_addons (sort_order);

CREATE INDEX idx_allergens_code        ON allergens (code);

CREATE INDEX idx_item_allergens_item_id    ON item_allergens (item_id);
CREATE INDEX idx_item_allergens_allergen_id ON item_allergens (allergen_id);


-- 3. ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE categories    ENABLE ROW LEVEL SECURITY;
ALTER TABLE sections      ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_items    ENABLE ROW LEVEL SECURITY;
ALTER TABLE add_ons       ENABLE ROW LEVEL SECURITY;
ALTER TABLE item_addons   ENABLE ROW LEVEL SECURITY;
ALTER TABLE allergens     ENABLE ROW LEVEL SECURITY;
ALTER TABLE item_allergens ENABLE ROW LEVEL SECURITY;

-- categories
CREATE POLICY "Public can read active categories"
  ON categories FOR SELECT TO anon
  USING (active = true);

CREATE POLICY "Authenticated full access to categories"
  ON categories FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- sections
CREATE POLICY "Public can read active sections"
  ON sections FOR SELECT TO anon
  USING (active = true);

CREATE POLICY "Authenticated full access to sections"
  ON sections FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- menu_items
CREATE POLICY "Public can read visible menu items"
  ON menu_items FOR SELECT TO anon
  USING (
    active = true
    AND (hidden_until IS NULL OR hidden_until <= now())
  );

CREATE POLICY "Authenticated full access to menu items"
  ON menu_items FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- add_ons
CREATE POLICY "Public can read active add ons"
  ON add_ons FOR SELECT TO anon
  USING (active = true);

CREATE POLICY "Authenticated full access to add ons"
  ON add_ons FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- item_addons (junction)
CREATE POLICY "Public can read item addons"
  ON item_addons FOR SELECT TO anon
  USING (true);

CREATE POLICY "Authenticated full access to item addons"
  ON item_addons FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- allergens
CREATE POLICY "Public can read allergens"
  ON allergens FOR SELECT TO anon
  USING (true);

CREATE POLICY "Authenticated full access to allergens"
  ON allergens FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- item_allergens (junction)
CREATE POLICY "Public can read item allergens"
  ON item_allergens FOR SELECT TO anon
  USING (true);

CREATE POLICY "Authenticated full access to item allergens"
  ON item_allergens FOR ALL TO authenticated
  USING (true) WITH CHECK (true);


-- 4. GRANTS
-- ============================================================

GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;
GRANT ALL    ON ALL TABLES IN SCHEMA public TO authenticated;
