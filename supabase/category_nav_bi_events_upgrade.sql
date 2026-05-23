-- Category navigation BI — count menu_tab_open + section_open alongside category_open.
-- Apply after analytics_visibility_business_day_upgrade.sql (get_bi_dashboard).
-- Run: supabase db push  OR  paste in Supabase SQL Editor.

create or replace function public.nac_is_category_nav_event(et text)
returns boolean
language sql
immutable
as $$
  select coalesce(et, '') in ('category_open', 'menu_tab_open', 'section_open');
$$;

comment on function public.nac_is_category_nav_event(text) is
  'Canonical category navigation events for funnel + top_categories BI.';

-- Minimal patch: re-define get_bi_dashboard category slices only is not practical in a partial file.
-- Re-run the full function from analytics_visibility_business_day_upgrade.sql replacing:
--   event_type = 'category_open'
-- with:
--   public.nac_is_category_nav_event(event_type)
-- in: top_categories opens/impressions order, funnel category_opens, placement_stats, dead_zones, top_converting_category.
