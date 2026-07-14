-- Branch-admin Vault role: full data/ingestion capability inside one assigned branch.
-- Does not grant cross-branch, RBAC, system, prompt, or global configuration access.

insert into public.ask_nac_roles (
  code, label, priority, default_sensitivity_ceiling, cross_branch, can_upload, capabilities
) values (
  'branch_admin',
  'Branch Administrator',
  35,
  'hr_restricted',
  false,
  true,
  '{"assigned_branch_admin":true,"approve_ingestion":true,"retry_ingestion":true}'::jsonb
)
on conflict (code) do update set
  label = excluded.label,
  priority = excluded.priority,
  default_sensitivity_ceiling = excluded.default_sensitivity_ceiling,
  cross_branch = excluded.cross_branch,
  can_upload = excluded.can_upload,
  capabilities = excluded.capabilities;

insert into public.ask_nac_sensitivity_policies (
  role_code, sensitivity_level, allow_read, allow_aggregate, redact_fields
) values
  ('branch_admin', 'public', true, true, '{}'),
  ('branch_admin', 'internal', true, true, '{}'),
  ('branch_admin', 'management', true, true, '{}'),
  ('branch_admin', 'finance', true, true, '{}'),
  ('branch_admin', 'hr_restricted', true, true, '{}')
on conflict (role_code, sensitivity_level) do update set
  allow_read = excluded.allow_read,
  allow_aggregate = excluded.allow_aggregate,
  redact_fields = excluded.redact_fields;

create or replace function public.ask_nac_vault_role_default_departments(p_role text)
returns text[]
language sql
immutable
as $$
  select case lower(trim(p_role))
    when 'ceo' then array['admin','operations','sales','reception','cost_control','purchasing','inventory','hr','marketing','design','foh','kitchen','brand']
    when 'super_admin' then array['admin','operations','sales','reception','cost_control','purchasing','inventory','hr','marketing','design','foh','kitchen','brand']
    when 'branch_admin' then array['admin','operations','sales','reception','cost_control','purchasing','inventory','ffe','hr','marketing','design','foh','kitchen','brand']
    when 'ops_manager' then array['operations','sales','reception','inventory','foh','kitchen','admin']
    when 'branch_manager' then array['operations','sales','reception','foh','kitchen','admin']
    when 'reception_manager' then array['reception','sales']
    when 'cost_controller' then array['cost_control','purchasing','inventory','ffe']
    when 'marketing' then array['marketing','design','brand']
    when 'hr' then array['hr']
    when 'staff' then array['brand','operations']
    else array['brand']
  end;
$$;

update public.ask_nac_staff
set vault_role = 'branch_admin',
    primary_branch_id = 'khobar',
    menu_role_legacy = 'branch_gm',
    updated_at = now()
where lower(email) = 'fady.aly@nacriyadh.com';

-- Discovery approval is branch-scoped; global rules remain network-admin only.
drop policy if exists ask_nac_drive_discovery_rules_select on public.ask_nac_drive_discovery_rules;
create policy ask_nac_drive_discovery_rules_select on public.ask_nac_drive_discovery_rules
  for select to authenticated
  using (
    branch_id is null
    or public.ask_nac_vault_branch_allowed(branch_id)
  );

drop policy if exists ask_nac_drive_discovery_rules_write on public.ask_nac_drive_discovery_rules;
create policy ask_nac_drive_discovery_rules_write on public.ask_nac_drive_discovery_rules
  for all to authenticated
  using (
    public.ask_nac_vault_can_upload()
    and (
      (branch_id is null and public.ask_nac_vault_is_admin())
      or public.ask_nac_vault_branch_allowed(branch_id)
    )
  )
  with check (
    public.ask_nac_vault_can_upload()
    and (
      (branch_id is null and public.ask_nac_vault_is_admin())
      or public.ask_nac_vault_branch_allowed(branch_id)
    )
  );

drop policy if exists ask_nac_drive_discovery_candidates_select on public.ask_nac_drive_discovery_candidates;
create policy ask_nac_drive_discovery_candidates_select on public.ask_nac_drive_discovery_candidates
  for select to authenticated
  using (public.ask_nac_vault_branch_allowed(branch_id));

drop policy if exists ask_nac_drive_discovery_candidates_write on public.ask_nac_drive_discovery_candidates;
create policy ask_nac_drive_discovery_candidates_write on public.ask_nac_drive_discovery_candidates
  for all to authenticated
  using (
    public.ask_nac_vault_can_upload()
    and public.ask_nac_vault_branch_allowed(branch_id)
  )
  with check (
    public.ask_nac_vault_can_upload()
    and public.ask_nac_vault_branch_allowed(branch_id)
  );

