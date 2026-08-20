-- The Food Bible editor already deletes draft lines/stages before rewriting them.
-- Authenticated writers had insert/update but not delete, so save-new-version failed.
-- This does not change RLS predicates and does not grant anonymous access.

grant delete on public.inventory_recipe_version_lines to authenticated;
grant delete on public.inventory_recipe_stages to authenticated;

create unique index if not exists inventory_recipes_internal_name_uidx
  on public.inventory_recipes (internal_name)
  where internal_name is not null;
