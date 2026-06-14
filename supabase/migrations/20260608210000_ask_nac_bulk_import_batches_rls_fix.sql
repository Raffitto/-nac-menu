-- Bulk import batches: align upload gate with menu staff + fix JWT email resolution.
-- ask_nac_bulk_batches_insert previously required ask_nac_vault_can_upload(), which is false
-- when the signed-in NAC OS user is not mapped in ask_nac_staff (defaults to vault role
-- 'staff' with can_upload = false) — same class of mismatch fixed for Drive folder INSERT.

-- Resolve auth email consistently with menu RLS (request.jwt.claim.email fallback).
create or replace function public.ask_nac_vault_auth_email()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select lower(trim(coalesce(
    nullif(current_setting('request.jwt.claim.email', true), ''),
    nullif(auth.jwt() ->> 'email', ''),
    ''
  )));
$$;

-- Upload / ingestion: vault-mapped roles OR menu CMS editors (developer, ceo, branch_gm).
create or replace function public.ask_nac_vault_can_upload()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select r.can_upload from public.ask_nac_roles r where r.code = public.ask_nac_vault_role()),
    false
  )
  or public.nac_menu_staff_all_branches()
  or exists (
    select 1
    from public.menu_staff_scope m
    where lower(m.email) = public.ask_nac_vault_auth_email()
      and m.role = 'branch_gm'
  );
$$;
