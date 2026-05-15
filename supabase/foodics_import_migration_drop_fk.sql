-- Migration: remove strict FK on foodics_sales_items.matched_menu_item_id
-- Run in Supabase SQL Editor on existing databases that already applied foodics_import_schema.sql

-- 1) Drop foreign key if it exists
ALTER TABLE public.foodics_sales_items
  DROP CONSTRAINT IF EXISTS foodics_sales_items_matched_menu_item_id_fkey;

-- 2) Allow nullable analytical ID (menu item UUID, add-on UUID, or legacy reference as text)
ALTER TABLE public.foodics_sales_items
  ALTER COLUMN matched_menu_item_id DROP NOT NULL;

-- 3) Store ID as text — no relational enforcement (snapshots must not fail on deleted/mismatched rows)
ALTER TABLE public.foodics_sales_items
  ALTER COLUMN matched_menu_item_id TYPE text USING matched_menu_item_id::text;
