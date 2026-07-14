-- Qualify outer supplier references inside catalogue/alias RLS subqueries.
-- Unqualified supplier_id can bind to the inner supplier-branch relation.

drop policy if exists inventory_catalogue_select on public.inventory_supplier_catalogue_items;
create policy inventory_catalogue_select on public.inventory_supplier_catalogue_items
for select to authenticated using (exists (
  select 1
  from public.inventory_supplier_branches sb
  where sb.supplier_id = inventory_supplier_catalogue_items.supplier_id
    and sb.active
    and public.inventory_branch_allowed(sb.branch_id)
));

drop policy if exists inventory_catalogue_write on public.inventory_supplier_catalogue_items;
create policy inventory_catalogue_write on public.inventory_supplier_catalogue_items
for all to authenticated using (exists (
  select 1
  from public.inventory_supplier_branches sb
  where sb.supplier_id = inventory_supplier_catalogue_items.supplier_id
    and sb.active
    and public.inventory_can_approve(sb.branch_id)
)) with check (exists (
  select 1
  from public.inventory_supplier_branches sb
  where sb.supplier_id = inventory_supplier_catalogue_items.supplier_id
    and sb.active
    and public.inventory_can_approve(sb.branch_id)
));

drop policy if exists inventory_alias_select on public.inventory_supplier_item_aliases;
create policy inventory_alias_select on public.inventory_supplier_item_aliases
for select to authenticated using (exists (
  select 1
  from public.inventory_supplier_branches sb
  where sb.supplier_id = inventory_supplier_item_aliases.supplier_id
    and sb.active
    and public.inventory_branch_allowed(sb.branch_id)
));

drop policy if exists inventory_alias_write on public.inventory_supplier_item_aliases;
create policy inventory_alias_write on public.inventory_supplier_item_aliases
for all to authenticated using (exists (
  select 1
  from public.inventory_supplier_branches sb
  where sb.supplier_id = inventory_supplier_item_aliases.supplier_id
    and sb.active
    and public.inventory_can_approve(sb.branch_id)
)) with check (exists (
  select 1
  from public.inventory_supplier_branches sb
  where sb.supplier_id = inventory_supplier_item_aliases.supplier_id
    and sb.active
    and public.inventory_can_approve(sb.branch_id)
));
