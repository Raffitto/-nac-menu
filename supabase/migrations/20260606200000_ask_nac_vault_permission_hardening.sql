-- Ask NAC Data Vault — permission hardening (coverage sensitivity, brand-wide upload, storage read)
-- Safe to re-run.

-- Coverage rows must inherit source file scope (not hardcoded internal sensitivity).
drop policy if exists ask_nac_coverage_select on public.ask_nac_data_coverage;
create policy ask_nac_coverage_select on public.ask_nac_data_coverage
  for select to authenticated
  using (
    source_file_id is not null
    and public.ask_nac_vault_can_read_file(source_file_id)
  );

-- Brand-wide registry rows: network roles only (CEO / super_admin / marketing).
drop policy if exists ask_nac_files_insert on public.ask_nac_files;
create policy ask_nac_files_insert on public.ask_nac_files
  for insert to authenticated
  with check (
    public.ask_nac_vault_can_upload()
    and lower(coalesce(uploader_email, '')) = public.ask_nac_vault_auth_email()
    and (
      coalesce(brand_wide, false) = false
      or public.ask_nac_vault_is_admin()
      or public.ask_nac_vault_role() = 'marketing'
    )
    and (
      coalesce(brand_wide, false) = true
      or public.ask_nac_vault_branch_allowed(primary_branch_id)
    )
    and public.ask_nac_vault_can_read_scope(
      primary_branch_id,
      brand_wide,
      department,
      sensitivity_level
    )
  );

drop policy if exists ask_nac_files_update on public.ask_nac_files;
create policy ask_nac_files_update on public.ask_nac_files
  for update to authenticated
  using (public.ask_nac_vault_can_read_file(id) and public.ask_nac_vault_can_upload())
  with check (
    (
      coalesce(brand_wide, false) = false
      or public.ask_nac_vault_is_admin()
      or public.ask_nac_vault_role() = 'marketing'
    )
    and (
      coalesce(brand_wide, false) = true
      or public.ask_nac_vault_branch_allowed(primary_branch_id)
    )
    and public.ask_nac_vault_can_read_scope(primary_branch_id, brand_wide, department, sensitivity_level)
  );

-- Storage download follows registry read scope (supports brand-wide originals for authorized roles).
drop policy if exists ask_nac_vault_storage_select on storage.objects;
create policy ask_nac_vault_storage_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'ask-nac-vault-originals'
    and exists (
      select 1
      from public.ask_nac_files f
      where f.storage_path = name
        and f.status = 'active'
        and public.ask_nac_vault_can_read_file(f.id)
    )
  );

drop policy if exists ask_nac_vault_storage_insert on storage.objects;
create policy ask_nac_vault_storage_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'ask-nac-vault-originals'
    and public.ask_nac_vault_can_upload()
    and (
      split_part(name, '/', 1) <> 'brand'
      or public.ask_nac_vault_is_admin()
      or public.ask_nac_vault_role() = 'marketing'
    )
    and public.ask_nac_vault_branch_allowed(split_part(name, '/', 1))
  );

-- Branch managers may read brand-wide internal SOPs (department = brand).
create or replace function public.ask_nac_vault_role_default_departments(p_role text)
returns text[]
language sql
immutable
as $$
  select case lower(trim(p_role))
    when 'ceo' then array['admin','operations','sales','reception','cost_control','purchasing','inventory','hr','marketing','design','foh','kitchen','brand']
    when 'super_admin' then array['admin','operations','sales','reception','cost_control','purchasing','inventory','hr','marketing','design','foh','kitchen','brand']
    when 'ops_manager' then array['operations','sales','reception','inventory','foh','kitchen','admin','brand']
    when 'branch_manager' then array['operations','sales','reception','foh','kitchen','admin','brand']
    when 'reception_manager' then array['reception','sales']
    when 'cost_controller' then array['cost_control','purchasing','inventory','ffe']
    when 'marketing' then array['marketing','design','brand']
    when 'hr' then array['hr']
    when 'staff' then array['brand','operations']
    else array['brand']
  end;
$$;
