-- Storage upload RLS v2: resolve JWT email in Storage context, qualify objects.name,
-- align menu branch checks with ask_nac_vault_auth_email(), seed known prod operator.

-- ── Unified auth email (JWT claims + auth.users fallback for Storage API) ─────

create or replace function public.nac_os_auth_email()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select lower(trim(coalesce(
    nullif(current_setting('request.jwt.claim.email', true), ''),
    nullif(auth.jwt() ->> 'email', ''),
    (
      select lower(trim(u.email))
      from auth.users u
      where u.id = auth.uid()
    ),
    ''
  )));
$$;

comment on function public.nac_os_auth_email() is
  'NAC OS signed-in email: JWT claims first, then auth.users via auth.uid() (Storage-safe).';

grant execute on function public.nac_os_auth_email() to authenticated;

create or replace function public.ask_nac_vault_auth_email()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select public.nac_os_auth_email();
$$;

create or replace function public.nac_auth_email()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select public.nac_os_auth_email();
$$;

-- ── Path gate: same email source as ask_nac_vault_can_upload() ──────────────

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
    when exists (
      select 1
      from public.menu_staff_scope s
      where lower(s.email) = public.ask_nac_vault_auth_email()
        and s.branch_id is null
        and s.role in ('developer', 'ceo')
    ) then true
    when exists (
      select 1
      from public.menu_staff_scope s
      where lower(s.email) = public.ask_nac_vault_auth_email()
        and s.role = 'branch_gm'
        and public.nac_normalize_branch_id(split_part(p_object_name, '/', 1)) = s.branch_id
    ) then true
    else false
  end;
$$;

-- Single write gate for storage.objects policies (bucket + upload permission + path).
create or replace function public.ask_nac_vault_storage_object_write_allowed(
  p_bucket_id text,
  p_object_name text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_bucket_id = 'ask-nac-vault-originals'
    and public.ask_nac_vault_can_upload()
    and public.ask_nac_vault_storage_path_upload_allowed(p_object_name);
$$;

comment on function public.ask_nac_vault_storage_object_write_allowed(text, text) is
  'INSERT/UPDATE/DELETE gate for ask-nac-vault-originals; explicit bucket + path args.';

grant execute on function public.ask_nac_vault_storage_object_write_allowed(text, text) to authenticated;

-- SQL Editor diagnostics (pass email + object path; no JWT required).
create or replace function public.ask_nac_vault_storage_upload_debug(
  p_email text,
  p_object_name text default 'khobar/operations/00000000-0000-0000-0000-000000000001/sample.pdf'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_branch text := split_part(coalesce(p_object_name, ''), '/', 1);
  v_menu_dev boolean;
  v_menu_gm_branch text;
  v_vault_role text;
  v_vault_can_upload boolean;
  v_path_allowed boolean;
begin
  select exists (
    select 1 from public.menu_staff_scope s
    where lower(s.email) = v_email
      and s.branch_id is null
      and s.role in ('developer', 'ceo')
  ) into v_menu_dev;

  select s.branch_id
  into v_menu_gm_branch
  from public.menu_staff_scope s
  where lower(s.email) = v_email
    and s.role = 'branch_gm'
  order by s.branch_id nulls last
  limit 1;

  select coalesce(s.vault_role, 'staff')
  into v_vault_role
  from public.ask_nac_staff s
  where lower(s.email) = v_email;

  if not found then
    v_vault_role := 'staff';
  end if;

  select coalesce(r.can_upload, false)
  into v_vault_can_upload
  from public.ask_nac_roles r
  where r.code = v_vault_role;

  v_vault_can_upload := coalesce(v_vault_can_upload, false)
    or v_menu_dev
    or v_menu_gm_branch is not null;

  v_path_allowed := case
    when coalesce(trim(p_object_name), '') = '' then false
    when lower(v_branch) = 'brand' then
      v_vault_role in ('ceo', 'super_admin', 'marketing')
    when v_vault_role in ('ceo', 'super_admin') then true
    when exists (
      select 1 from public.ask_nac_roles r
      where r.code = v_vault_role and coalesce(r.cross_branch, false)
    ) then true
    when exists (
      select 1 from public.ask_nac_user_branch_access ba
      where lower(ba.email) = v_email
        and ba.branch_id = public.nac_normalize_branch_id(v_branch)
    ) then true
    when public.nac_normalize_branch_id(v_branch) = (
      select s.primary_branch_id from public.ask_nac_staff s where lower(s.email) = v_email
    ) then true
    when v_menu_dev then true
    when v_menu_gm_branch is not null
      and public.nac_normalize_branch_id(v_branch) = v_menu_gm_branch then true
    else false
  end;

  return jsonb_build_object(
    'email', v_email,
    'object_name', p_object_name,
    'path_branch', v_branch,
    'menu_staff_developer_or_ceo', v_menu_dev,
    'menu_staff_branch_gm_branch', v_menu_gm_branch,
    'ask_nac_staff_vault_role', v_vault_role,
    'ask_nac_vault_can_upload', v_vault_can_upload,
    'ask_nac_vault_storage_path_upload_allowed', v_path_allowed,
    'storage_write_would_pass', v_vault_can_upload and v_path_allowed,
    'bucket_id_expected', 'ask-nac-vault-originals'
  );
end;
$$;

grant execute on function public.ask_nac_vault_storage_upload_debug(text, text) to authenticated;

-- Known prod operator (client RBAC via REACT_APP_RBAC_USERS; missing from foundation seeds).
insert into public.menu_staff_scope (email, branch_id, role) values
  ('raffiazarian2@gmail.com', null, 'developer')
on conflict (email) do update set
  branch_id = excluded.branch_id,
  role = excluded.role,
  updated_at = now();

insert into public.ask_nac_staff (email, vault_role, primary_branch_id, menu_role_legacy) values
  ('raffiazarian2@gmail.com', 'super_admin', null, 'developer')
on conflict (email) do update set
  vault_role = excluded.vault_role,
  primary_branch_id = excluded.primary_branch_id,
  menu_role_legacy = excluded.menu_role_legacy,
  updated_at = now();

-- ── storage.objects policies (qualify name/bucket_id — avoid ambiguous name) ─

drop policy if exists ask_nac_vault_storage_insert on storage.objects;
create policy ask_nac_vault_storage_insert on storage.objects
  for insert to authenticated
  with check (
    public.ask_nac_vault_storage_object_write_allowed(objects.bucket_id, objects.name)
  );

drop policy if exists ask_nac_vault_storage_update on storage.objects;
create policy ask_nac_vault_storage_update on storage.objects
  for update to authenticated
  using (
    public.ask_nac_vault_storage_object_write_allowed(objects.bucket_id, objects.name)
  )
  with check (
    public.ask_nac_vault_storage_object_write_allowed(objects.bucket_id, objects.name)
  );

drop policy if exists ask_nac_vault_storage_delete on storage.objects;
create policy ask_nac_vault_storage_delete on storage.objects
  for delete to authenticated
  using (
    public.ask_nac_vault_storage_object_write_allowed(objects.bucket_id, objects.name)
  );

-- Repair SELECT path binding (registry join); read scope unchanged.
drop policy if exists ask_nac_vault_storage_select on storage.objects;
create policy ask_nac_vault_storage_select on storage.objects
  for select to authenticated
  using (
    objects.bucket_id = 'ask-nac-vault-originals'
    and exists (
      select 1
      from public.ask_nac_files f
      where f.storage_path = objects.name
        and f.status = 'active'
        and public.ask_nac_vault_can_read_file(f.id)
    )
  );
