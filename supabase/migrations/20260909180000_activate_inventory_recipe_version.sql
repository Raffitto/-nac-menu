-- One active version per recipe.
-- Production already exposes public.inventory_activate_recipe_version
-- (security definer, retires the previous active, records audit, and
-- rejects UNRESOLVED_RECIPE_LINE / INVALID_SUBRECIPE_VERSION_OR_UNIT).
-- Do not replace that RPC with a weaker status-only swap.

do $$
begin
  if exists (
    select 1
    from public.inventory_recipe_versions
    where status = 'active'
    group by recipe_id
    having count(*) > 1
  ) then
    raise exception 'Cannot add unique active index: competing active versions exist';
  end if;
end $$;

create unique index if not exists inventory_recipe_versions_one_active_uidx
  on public.inventory_recipe_versions (recipe_id)
  where status = 'active';
