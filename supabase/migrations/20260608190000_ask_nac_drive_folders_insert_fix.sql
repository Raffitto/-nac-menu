-- Drive folder registration: allow INSERT when connection is owned by auth user.
-- Do not require ask_nac_vault_can_upload() — OAuth connection ownership is the gate;
-- vault staff mapping may differ from NAC OS RBAC (e.g. raffiazarian2@gmail.com).

drop policy if exists ask_nac_drive_folders_insert on public.ask_nac_drive_sync_folders;
create policy ask_nac_drive_folders_insert on public.ask_nac_drive_sync_folders
  for insert to authenticated
  with check (public.ask_nac_drive_connection_owned(connection_id));
