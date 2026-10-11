-- ============================================================================================
-- NOT APPLIED — PROPOSAL ONLY (security batch S1, finding F15).
-- Deliberately stored OUTSIDE supabase/migrations so `supabase db push` cannot pick it up.
-- Preconditions before anyone applies it:
--   1. Independent review (Sentinel) + owner approval.
--   2. Read-only diff of the LIVE policies on public.ask_nac_drive_sync_folders against the repo.
--   3. Run docs/security/s1-drive-folder-audit.READONLY.sql and review existing rows.
-- Why it is needed: the Edge Function fix only covers calls that go through vault-drive-sync.
-- The current RLS policies (20260608180000 / 20260608190000) let ANY authenticated user who owns
-- a Drive connection INSERT/UPDATE ask_nac_drive_sync_folders rows directly via PostgREST with
-- any branch_id. The nightly service-role scheduled_ingest then ingests every enabled
-- auto_ingest/daily folder into the branch written on the row.
-- Reuses existing helpers only; no table or data changes.
-- ============================================================================================

create or replace function public.ask_nac_drive_folder_branch_write_allowed(p_branch_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.ask_nac_vault_can_upload(), false)
     and case
       -- brand-wide / unscoped (null, '' or 'brand'): cross-branch or brand authority
       when nullif(trim(coalesce(p_branch_id, '')), '') is null
         or lower(trim(p_branch_id)) = 'brand'
         then coalesce(public.ask_nac_vault_has_all_branches(), false)
           or coalesce(public.nac_menu_staff_all_branches(), false)
           or coalesce(public.ask_nac_vault_branch_allowed('brand'), false)
       -- unknown branch token: deny
       when public.nac_normalize_branch_id(p_branch_id) is null then false
       else coalesce(public.ask_nac_vault_branch_allowed(p_branch_id), false)
         or coalesce(public.nac_menu_can_edit_branch(p_branch_id), false)
     end;
$$;

revoke all on function public.ask_nac_drive_folder_branch_write_allowed(text) from public;
grant execute on function public.ask_nac_drive_folder_branch_write_allowed(text) to authenticated;

drop policy if exists ask_nac_drive_folders_insert on public.ask_nac_drive_sync_folders;
create policy ask_nac_drive_folders_insert on public.ask_nac_drive_sync_folders
  for insert to authenticated
  with check (
    public.ask_nac_drive_connection_owned(connection_id)
    and public.ask_nac_drive_folder_branch_write_allowed(branch_id)
    and public.ask_nac_drive_folder_branch_write_allowed(default_branch_id)
  );

drop policy if exists ask_nac_drive_folders_update on public.ask_nac_drive_sync_folders;
create policy ask_nac_drive_folders_update on public.ask_nac_drive_sync_folders
  for update to authenticated
  using (public.ask_nac_drive_connection_owned(connection_id))
  with check (
    public.ask_nac_drive_connection_owned(connection_id)
    and public.ask_nac_drive_folder_branch_write_allowed(branch_id)
    and public.ask_nac_drive_folder_branch_write_allowed(default_branch_id)
  );

-- Rollback (restores 20260608180000 / 20260608190000 behaviour):
--   drop policy if exists ask_nac_drive_folders_insert on public.ask_nac_drive_sync_folders;
--   create policy ask_nac_drive_folders_insert on public.ask_nac_drive_sync_folders
--     for insert to authenticated with check (public.ask_nac_drive_connection_owned(connection_id));
--   drop policy if exists ask_nac_drive_folders_update on public.ask_nac_drive_sync_folders;
--   create policy ask_nac_drive_folders_update on public.ask_nac_drive_sync_folders
--     for update to authenticated
--     using (public.ask_nac_drive_connection_owned(connection_id))
--     with check (public.ask_nac_drive_connection_owned(connection_id));
--   drop function if exists public.ask_nac_drive_folder_branch_write_allowed(text);
