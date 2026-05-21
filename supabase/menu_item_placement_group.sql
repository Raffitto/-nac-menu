-- Multi-placement linked menu items (Option A clones sharing placement_group_id)
-- Run in Supabase SQL Editor after menu_schema.sql
-- Safe to re-run.

ALTER TABLE public.menu_items
  ADD COLUMN IF NOT EXISTS placement_group_id UUID;

CREATE INDEX IF NOT EXISTS idx_menu_items_placement_group_id
  ON public.menu_items (placement_group_id)
  WHERE placement_group_id IS NOT NULL;

COMMENT ON COLUMN public.menu_items.placement_group_id IS
  'Shared UUID across duplicate rows placed in different sections/categories. NULL = single placement.';
