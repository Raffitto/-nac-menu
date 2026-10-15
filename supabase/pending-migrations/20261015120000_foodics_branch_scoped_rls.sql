-- PENDING OWNER APPROVAL. Do not apply with the application change.
-- Branch-scoped read/write for Foodics sales tables.
-- Review QR tables and policies are not modified.
-- foodics_name_mapping and menu_item_name_map have no branch_id;
-- they stay shared dictionaries and are not rewritten here.
-- Khobar-only staff keep Khobar rows. ask_nac_vault_has_all_branches()
-- still grants the existing company-wide sales read.

drop policy if exists foodics_batches_auth on public.foodics_import_batches;
drop policy if exists foodics_batches_branch on public.foodics_import_batches;
create policy foodics_batches_branch on public.foodics_import_batches
  for all to authenticated
  using (public.ask_nac_vault_branch_allowed(branch_id))
  with check (public.ask_nac_vault_branch_allowed(branch_id));

drop policy if exists foodics_sales_auth on public.foodics_sales_items;
drop policy if exists foodics_sales_branch on public.foodics_sales_items;
create policy foodics_sales_branch on public.foodics_sales_items
  for all to authenticated
  using (public.ask_nac_vault_branch_allowed(branch_id))
  with check (public.ask_nac_vault_branch_allowed(branch_id));
