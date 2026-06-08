-- Fix Drive sync RLS: folder/run policies must verify connection ownership without
-- granting SELECT on OAuth token columns. Edge Function still writes tokens via service role.

revoke all on public.ask_nac_drive_connections from authenticated;
revoke all on public.ask_nac_drive_connections from anon;
revoke all on public.ask_nac_drive_connections from public;

-- Ownership check (security definer — reads connections internally, no token exposure to clients).
create or replace function public.ask_nac_drive_connection_owned(p_connection_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.ask_nac_drive_connections c
    where c.id = p_connection_id
      and lower(c.user_email) = public.ask_nac_vault_auth_email()
  );
$$;

grant execute on function public.ask_nac_drive_connection_owned(uuid) to authenticated;

-- Safe metadata read for the authenticated user's own row (token columns not granted).
grant select (
  id,
  user_email,
  google_account_email,
  status,
  connected_at,
  updated_at,
  last_error,
  token_expires_at,
  scopes
) on public.ask_nac_drive_connections to authenticated;

drop policy if exists ask_nac_drive_connections_select on public.ask_nac_drive_connections;
create policy ask_nac_drive_connections_select on public.ask_nac_drive_connections
  for select to authenticated
  using (lower(user_email) = public.ask_nac_vault_auth_email());

-- Folder policies: use ownership helper instead of direct subquery on connections.
drop policy if exists ask_nac_drive_folders_select on public.ask_nac_drive_sync_folders;
create policy ask_nac_drive_folders_select on public.ask_nac_drive_sync_folders
  for select to authenticated
  using (public.ask_nac_drive_connection_owned(connection_id));

drop policy if exists ask_nac_drive_folders_insert on public.ask_nac_drive_sync_folders;
create policy ask_nac_drive_folders_insert on public.ask_nac_drive_sync_folders
  for insert to authenticated
  with check (public.ask_nac_drive_connection_owned(connection_id));

drop policy if exists ask_nac_drive_folders_update on public.ask_nac_drive_sync_folders;
create policy ask_nac_drive_folders_update on public.ask_nac_drive_sync_folders
  for update to authenticated
  using (public.ask_nac_drive_connection_owned(connection_id))
  with check (public.ask_nac_drive_connection_owned(connection_id));

-- Sync run read: owned folder only.
drop policy if exists ask_nac_drive_runs_select on public.ask_nac_drive_sync_runs;
create policy ask_nac_drive_runs_select on public.ask_nac_drive_sync_runs
  for select to authenticated
  using (
    exists (
      select 1
      from public.ask_nac_drive_sync_folders f
      where f.id = folder_id
        and public.ask_nac_drive_connection_owned(f.connection_id)
    )
  );
