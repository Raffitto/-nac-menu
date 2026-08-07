-- Evaluate the caller's branch scope once per Foodics sales statement.
-- The prior row-correlated policy was correct but caused exact-count timeouts.

create or replace function public.inventory_sales_allowed_branches()
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(branch_id order by branch_id), '{}'::text[])
  from unnest(array['khobar', 'riyadh', 'jeddah']::text[]) branch_id
  where public.ask_nac_vault_branch_allowed(branch_id);
$$;

revoke all on function public.inventory_sales_allowed_branches() from public;
grant execute on function public.inventory_sales_allowed_branches() to authenticated;

drop policy if exists foodics_batches_branch_select on public.foodics_import_batches;
drop policy if exists foodics_batches_branch_insert on public.foodics_import_batches;
drop policy if exists foodics_batches_branch_update on public.foodics_import_batches;
drop policy if exists foodics_batches_branch_delete on public.foodics_import_batches;

create policy foodics_batches_branch_select
on public.foodics_import_batches for select to authenticated
using (branch_id in (
  select allowed_branch
  from unnest(public.inventory_sales_allowed_branches()) allowed_branch
));
create policy foodics_batches_branch_insert
on public.foodics_import_batches for insert to authenticated
with check (branch_id in (
  select allowed_branch
  from unnest(public.inventory_sales_allowed_branches()) allowed_branch
));
create policy foodics_batches_branch_update
on public.foodics_import_batches for update to authenticated
using (branch_id in (
  select allowed_branch
  from unnest(public.inventory_sales_allowed_branches()) allowed_branch
))
with check (branch_id in (
  select allowed_branch
  from unnest(public.inventory_sales_allowed_branches()) allowed_branch
));
create policy foodics_batches_branch_delete
on public.foodics_import_batches for delete to authenticated
using (branch_id in (
  select allowed_branch
  from unnest(public.inventory_sales_allowed_branches()) allowed_branch
));

drop policy if exists foodics_sales_branch_select on public.foodics_sales_items;
drop policy if exists foodics_sales_branch_insert on public.foodics_sales_items;
drop policy if exists foodics_sales_branch_update on public.foodics_sales_items;
drop policy if exists foodics_sales_branch_delete on public.foodics_sales_items;

create policy foodics_sales_branch_select
on public.foodics_sales_items for select to authenticated
using (branch_id in (
  select allowed_branch
  from unnest(public.inventory_sales_allowed_branches()) allowed_branch
));
create policy foodics_sales_branch_insert
on public.foodics_sales_items for insert to authenticated
with check (branch_id in (
  select allowed_branch
  from unnest(public.inventory_sales_allowed_branches()) allowed_branch
));
create policy foodics_sales_branch_update
on public.foodics_sales_items for update to authenticated
using (branch_id in (
  select allowed_branch
  from unnest(public.inventory_sales_allowed_branches()) allowed_branch
))
with check (branch_id in (
  select allowed_branch
  from unnest(public.inventory_sales_allowed_branches()) allowed_branch
));
create policy foodics_sales_branch_delete
on public.foodics_sales_items for delete to authenticated
using (branch_id in (
  select allowed_branch
  from unnest(public.inventory_sales_allowed_branches()) allowed_branch
));

comment on function public.inventory_sales_allowed_branches() is
  'Statement-stable Foodics import scope used by RLS to avoid per-row Vault authorization lookups.';
