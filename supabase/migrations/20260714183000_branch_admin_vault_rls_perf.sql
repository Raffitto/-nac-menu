-- Fast-path branch-admin Vault reads. Avoid nested per-row helper recursion on
-- ask_nac_files while retaining the existing role/sensitivity rules for others.

create or replace function public.ask_nac_vault_branch_admin_scope_allowed(
  p_branch_id text,
  p_brand_wide boolean
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.ask_nac_staff s
    where lower(s.email) = public.ask_nac_vault_auth_email()
      and s.vault_role = 'branch_admin'
      and (
        coalesce(p_brand_wide, false)
        or s.primary_branch_id = public.nac_normalize_branch_id(p_branch_id)
      )
  );
$$;

revoke all on function public.ask_nac_vault_branch_admin_scope_allowed(text, boolean) from public;
grant execute on function public.ask_nac_vault_branch_admin_scope_allowed(text, boolean) to authenticated;

drop policy if exists ask_nac_files_select on public.ask_nac_files;
create policy ask_nac_files_select on public.ask_nac_files
  for select to authenticated
  using (
    case
      when public.ask_nac_vault_role() = 'branch_admin' then
        status = 'active'
        and public.ask_nac_vault_branch_admin_scope_allowed(primary_branch_id, brand_wide)
      else public.ask_nac_vault_can_read_file(id)
    end
  );

drop policy if exists ask_nac_coverage_select on public.ask_nac_data_coverage;
create policy ask_nac_coverage_select on public.ask_nac_data_coverage
  for select to authenticated
  using (
    case
      when public.ask_nac_vault_role() = 'branch_admin'
        then public.ask_nac_vault_branch_admin_scope_allowed(branch_id, brand_wide)
      else public.ask_nac_vault_can_read_scope(branch_id, brand_wide, department, 'internal')
    end
  );

drop policy if exists ask_nac_facts_select on public.ask_nac_structured_facts;
create policy ask_nac_facts_select on public.ask_nac_structured_facts
  for select to authenticated
  using (
    case
      when public.ask_nac_vault_role() = 'branch_admin'
        then public.ask_nac_vault_branch_admin_scope_allowed(branch_id, brand_wide)
      else public.ask_nac_vault_can_read_scope(branch_id, brand_wide, department, sensitivity_level)
    end
  );

drop policy if exists ask_nac_daily_select on public.ask_nac_daily_facts;
create policy ask_nac_daily_select on public.ask_nac_daily_facts
  for select to authenticated
  using (
    case
      when public.ask_nac_vault_role() = 'branch_admin'
        then public.ask_nac_vault_branch_admin_scope_allowed(branch_id, brand_wide)
      else public.ask_nac_vault_can_read_scope(branch_id, brand_wide, department, sensitivity_level)
    end
  );

drop policy if exists ask_nac_monthly_select on public.ask_nac_monthly_facts;
create policy ask_nac_monthly_select on public.ask_nac_monthly_facts
  for select to authenticated
  using (
    case
      when public.ask_nac_vault_role() = 'branch_admin'
        then public.ask_nac_vault_branch_admin_scope_allowed(branch_id, brand_wide)
      else public.ask_nac_vault_can_read_scope(branch_id, brand_wide, department, sensitivity_level)
    end
  );

drop policy if exists ask_nac_summaries_select on public.ask_nac_document_summaries;
create policy ask_nac_summaries_select on public.ask_nac_document_summaries
  for select to authenticated
  using (
    case
      when public.ask_nac_vault_role() = 'branch_admin'
        then public.ask_nac_vault_branch_admin_scope_allowed(branch_id, brand_wide)
      else public.ask_nac_vault_can_read_scope(branch_id, brand_wide, department, sensitivity_level)
    end
  );

drop policy if exists ask_nac_chunks_select on public.ask_nac_document_chunks;
create policy ask_nac_chunks_select on public.ask_nac_document_chunks
  for select to authenticated
  using (
    case
      when public.ask_nac_vault_role() = 'branch_admin'
        then public.ask_nac_vault_branch_admin_scope_allowed(branch_id, brand_wide)
      else public.ask_nac_vault_can_read_scope(branch_id, brand_wide, department, sensitivity_level)
    end
  );

