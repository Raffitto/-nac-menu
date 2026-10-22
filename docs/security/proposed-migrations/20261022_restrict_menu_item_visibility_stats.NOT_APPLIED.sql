-- PROPOSED ONLY — NOT APPLIED. Owner review and caller testing required.
-- Live production inspection, 2026-10-22:
-- menu_item_visibility_stats is a postgres-owned SECURITY DEFINER view
-- over menu_events. anon has no SELECT on menu_events but currently has
-- ALL table privileges on the view (not just SELECT).
-- Existing ACL: postgres=arwdDxtm, anon=arwdDxtm,
-- authenticated=arwdDxtm, service_role=arwdDxtm.
-- No dependent views found via pg_depend. Source search found no literal
-- references, but cannot prove there are no indirect callers.
--
-- Restrict ALL anonymous privileges. Preserve authenticated and service
-- role access pending separately tested least-privilege review.
BEGIN;
REVOKE ALL PRIVILEGES ON TABLE public.menu_item_visibility_stats FROM anon;
COMMIT;

-- Post-change verification (read-only):
-- SELECT has_table_privilege('anon','public.menu_item_visibility_stats','SELECT');
-- SELECT has_table_privilege('anon','public.menu_item_visibility_stats','UPDATE');
-- SELECT has_table_privilege('authenticated','public.menu_item_visibility_stats','SELECT');

-- Rollback only if explicitly authorized:
-- GRANT ALL PRIVILEGES ON TABLE public.menu_item_visibility_stats TO anon;
