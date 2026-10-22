-- PROPOSED ONLY — NOT APPLIED. Owner review required.
-- 2026-10-22 production inspection:
-- public.menu_item_visibility_stats is a postgres-owned SECURITY DEFINER view.
-- anon and authenticated currently have SELECT on the view;
-- anon has no SELECT on its underlying public.menu_events table.
-- This is a privilege boundary: do not change to security_invoker without
-- assessing whether authenticated readers require underlying event access.
--
-- Minimal containment proposal: revoke anonymous access to the aggregate view.
-- Do not execute until callers, public menu dashboards and regression tests
-- have been checked. Does not alter view definition or authenticated access.
BEGIN;
REVOKE SELECT ON TABLE public.menu_item_visibility_stats FROM anon;
COMMIT;

-- Rollback (only if explicitly authorized):
-- GRANT SELECT ON TABLE public.menu_item_visibility_stats TO anon;
