-- Food Bible cross-user ingredient visibility consistency.
--
-- A branch-scoped manager can already read the branch recipe and its persisted
-- recipe lines, but the original ingredient SELECT policy made network-scoped
-- ingredient names depend on a separate ask_nac_staff lookup. When that lookup
-- did not resolve for an otherwise-authorized branch session, the same recipe
-- rendered quantities but lost ingredient identities ("Select…") and was
-- incorrectly downgraded from Complete to Needs attention.
--
-- Network ingredients are shared canonical references. Any authenticated user
-- with inventory access to at least one NAC branch must be able to read them.
-- This changes SELECT visibility only; existing ingredient write policy and
-- branch restrictions remain untouched.

drop policy if exists inventory_ingredients_select on public.inventory_ingredients;

create policy inventory_ingredients_select on public.inventory_ingredients
for select to authenticated
using (
  (
    scope = 'network'
    and (
      public.ask_nac_vault_has_all_branches()
      or public.inventory_branch_allowed('khobar')
      or public.inventory_branch_allowed('riyadh')
      or public.inventory_branch_allowed('jeddah')
    )
  )
  or (
    scope = 'branch'
    and public.inventory_branch_allowed(branch_id)
  )
);

comment on policy inventory_ingredients_select on public.inventory_ingredients is
  'Authenticated inventory users may read shared network ingredients plus ingredients belonging to branches they can access; writes remain separately restricted.';
