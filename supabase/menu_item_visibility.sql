-- Timed menu item visibility (hide until / auto-reopen)
-- Run in Supabase SQL editor after menu_schema.sql

ALTER TABLE menu_items
  ADD COLUMN IF NOT EXISTS hidden_until TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_menu_items_hidden_until
  ON menu_items (hidden_until)
  WHERE hidden_until IS NOT NULL;

COMMENT ON COLUMN menu_items.hidden_until IS
  'When set and in the future, item is hidden on the guest menu until this time (active may stay true).';

-- Replace anon read policy so timed hides are enforced at the database layer
DROP POLICY IF EXISTS "Public can read active menu items" ON menu_items;

CREATE POLICY "Public can read visible menu items"
  ON menu_items FOR SELECT TO anon
  USING (
    active = true
    AND (hidden_until IS NULL OR hidden_until <= now())
  );
