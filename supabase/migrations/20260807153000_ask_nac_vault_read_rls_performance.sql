-- Statement-cached Ask NAC Vault read scope.
-- Preserves existing branch, department, and sensitivity semantics while
-- avoiding nested role/RLS lookups once per registry or chunk row.

create or replace function public.ask_nac_vault_read_scope_snapshot()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with identity as (
    select
      public.ask_nac_vault_auth_email() as email,
      public.ask_nac_vault_role() as vault_role
  ),
  role_scope as (
    select
      identity.email,
      identity.vault_role,
      coalesce(role.cross_branch, false) as all_branches,
      coalesce(role.default_sensitivity_ceiling, 'public') as sensitivity_ceiling,
      staff.primary_branch_id
    from identity
    left join public.ask_nac_roles role on role.code = identity.vault_role
    left join public.ask_nac_staff staff on lower(staff.email) = identity.email
  )
  select jsonb_build_object(
    'email', role_scope.email,
    'role', role_scope.vault_role,
    'allBranches', role_scope.all_branches,
    'branches', (
      select coalesce(jsonb_agg(distinct branch_id), '[]'::jsonb)
      from (
        select role_scope.primary_branch_id as branch_id
        where role_scope.primary_branch_id is not null
        union all
        select access.branch_id
        from public.ask_nac_user_branch_access access
        where lower(access.email) = role_scope.email
      ) allowed_branches
    ),
    'departments', (
      select coalesce(jsonb_agg(distinct department), '[]'::jsonb)
      from (
        select unnest(public.ask_nac_vault_role_default_departments(
          role_scope.vault_role
        )) as department
        union all
        select lower(trim(access.department))
        from public.ask_nac_user_department_access access
        where lower(access.email) = role_scope.email
      ) allowed_departments
    ),
    'sensitivities', (
      select coalesce(jsonb_agg(policy.sensitivity_level), '[]'::jsonb)
      from public.ask_nac_sensitivity_policies policy
      where policy.role_code = role_scope.vault_role
        and policy.allow_read
        and public.ask_nac_vault_sensitivity_rank(policy.sensitivity_level)
          <= public.ask_nac_vault_sensitivity_rank(role_scope.sensitivity_ceiling)
    )
  )
  from role_scope;
$$;

create or replace function public.ask_nac_vault_scope_snapshot_allows(
  p_snapshot jsonb,
  p_branch_id text,
  p_brand_wide boolean,
  p_department text,
  p_sensitivity text
)
returns boolean
language sql
immutable
parallel safe
as $$
  select
    coalesce(p_snapshot -> 'sensitivities', '[]'::jsonb)
      ? lower(trim(coalesce(p_sensitivity, '')))
    and coalesce(p_snapshot -> 'departments', '[]'::jsonb)
      ? lower(trim(coalesce(p_department, '')))
    and (
      coalesce(p_brand_wide, false)
      or coalesce((p_snapshot ->> 'allBranches')::boolean, false)
      or coalesce(p_snapshot -> 'branches', '[]'::jsonb)
        ? lower(trim(coalesce(p_branch_id, '')))
      or (
        p_branch_id is null
        and coalesce(p_snapshot ->> 'role', '') in ('ceo', 'super_admin')
      )
      or (
        lower(trim(coalesce(p_branch_id, ''))) = 'brand'
        and coalesce(p_snapshot ->> 'role', '') in ('ceo', 'super_admin', 'marketing')
      )
    );
$$;

create or replace function public.ask_nac_vault_storage_read_allowed(
  p_object_name text,
  p_snapshot jsonb
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.ask_nac_files file
    where file.storage_path = p_object_name
      and file.status = 'active'
      and public.ask_nac_vault_scope_snapshot_allows(
        p_snapshot,
        file.primary_branch_id,
        file.brand_wide,
        file.department,
        file.sensitivity_level
      )
  );
$$;

revoke all on function public.ask_nac_vault_read_scope_snapshot() from public;
revoke all on function public.ask_nac_vault_scope_snapshot_allows(
  jsonb, text, boolean, text, text
) from public;
revoke all on function public.ask_nac_vault_storage_read_allowed(text, jsonb) from public;
grant execute on function public.ask_nac_vault_read_scope_snapshot() to authenticated;
grant execute on function public.ask_nac_vault_scope_snapshot_allows(
  jsonb, text, boolean, text, text
) to authenticated;
grant execute on function public.ask_nac_vault_storage_read_allowed(text, jsonb) to authenticated;

drop policy if exists ask_nac_files_select on public.ask_nac_files;
create policy ask_nac_files_select on public.ask_nac_files
for select to authenticated
using (
  status = 'active'
  and public.ask_nac_vault_scope_snapshot_allows(
    (select public.ask_nac_vault_read_scope_snapshot()),
    primary_branch_id,
    brand_wide,
    department,
    sensitivity_level
  )
);

drop policy if exists ask_nac_chunks_select on public.ask_nac_document_chunks;
create policy ask_nac_chunks_select on public.ask_nac_document_chunks
for select to authenticated
using (
  public.ask_nac_vault_scope_snapshot_allows(
    (select public.ask_nac_vault_read_scope_snapshot()),
    branch_id,
    brand_wide,
    department,
    sensitivity_level
  )
);

do $$
begin
  if to_regclass('storage.objects') is not null then
    execute 'drop policy if exists ask_nac_vault_storage_select on storage.objects';
    execute $policy$
      create policy ask_nac_vault_storage_select on storage.objects
      for select to authenticated
      using (
        objects.bucket_id = 'ask-nac-vault-originals'
        and public.ask_nac_vault_storage_read_allowed(
          objects.name,
          (select public.ask_nac_vault_read_scope_snapshot())
        )
      )
    $policy$;
  end if;
end;
$$;

comment on function public.ask_nac_vault_read_scope_snapshot() is
  'One statement-cached Vault read scope for branch, department, and sensitivity RLS.';
