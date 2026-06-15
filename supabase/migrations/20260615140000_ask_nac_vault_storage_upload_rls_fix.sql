-- Repair ask-nac-vault-originals storage upload RLS.
-- ask_nac_vault_can_upload() was extended for menu developer/ceo/branch_gm (08210000)
-- but storage INSERT still relied only on ask_nac_vault_branch_allowed(path prefix).

create or replace function public.ask_nac_vault_storage_path_upload_allowed(p_object_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when coalesce(trim(p_object_name), '') = '' then false
    when lower(split_part(p_object_name, '/', 1)) = 'brand' then
      public.ask_nac_vault_is_admin()
      or public.ask_nac_vault_role() = 'marketing'
    when public.ask_nac_vault_has_all_branches() then true
    when public.ask_nac_vault_branch_allowed(split_part(p_object_name, '/', 1)) then true
    when public.nac_menu_staff_all_branches() then true
    when public.nac_normalize_branch_id(split_part(p_object_name, '/', 1))
         = public.nac_menu_staff_branch() then true
    else false
  end;
$$;

comment on function public.ask_nac_vault_storage_path_upload_allowed(text) is
  'Storage upload path gate for ask-nac-vault-originals. Aligns with ask_nac_vault_can_upload() + branch/brand scope.';

grant execute on function public.ask_nac_vault_storage_path_upload_allowed(text) to authenticated;

-- INSERT: authenticated uploaders into branch/department/uuid/filename paths
drop policy if exists ask_nac_vault_storage_insert on storage.objects;
create policy ask_nac_vault_storage_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'ask-nac-vault-originals'
    and public.ask_nac_vault_can_upload()
    and public.ask_nac_vault_storage_path_upload_allowed(name)
  );

-- UPDATE: upsert / new-version overwrite for same path rules
drop policy if exists ask_nac_vault_storage_update on storage.objects;
create policy ask_nac_vault_storage_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'ask-nac-vault-originals'
    and public.ask_nac_vault_can_upload()
    and public.ask_nac_vault_storage_path_upload_allowed(name)
  )
  with check (
    bucket_id = 'ask-nac-vault-originals'
    and public.ask_nac_vault_can_upload()
    and public.ask_nac_vault_storage_path_upload_allowed(name)
  );

-- DELETE: allow upload rollback cleanup for same scoped uploaders/paths
drop policy if exists ask_nac_vault_storage_delete on storage.objects;
create policy ask_nac_vault_storage_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'ask-nac-vault-originals'
    and public.ask_nac_vault_can_upload()
    and public.ask_nac_vault_storage_path_upload_allowed(name)
  );

-- SELECT unchanged: registry-scoped read via ask_nac_vault_can_read_file (06200000 hardening)
