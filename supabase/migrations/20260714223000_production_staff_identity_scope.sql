-- Map the verified production identities to the same server-side scopes as
-- their established NAC staff aliases. This does not broaden any role.

insert into public.menu_staff_scope (email, branch_id, role)
values
  ('a.zaki@aseel-holding.com', null, 'ceo'),
  ('a.bisiau@nacriyadh.com', 'riyadh', 'branch_gm')
on conflict (email) do update
set branch_id = excluded.branch_id,
    role = excluded.role;

insert into public.ask_nac_staff (
  email,
  vault_role,
  primary_branch_id,
  menu_role_legacy
)
values
  ('a.zaki@aseel-holding.com', 'ceo', null, 'ceo'),
  ('a.bisiau@nacriyadh.com', 'branch_manager', 'riyadh', 'branch_gm')
on conflict (email) do update
set vault_role = excluded.vault_role,
    primary_branch_id = excluded.primary_branch_id,
    menu_role_legacy = excluded.menu_role_legacy;

insert into public.ask_nac_user_branch_access (email, branch_id, access_level)
values ('a.bisiau@nacriyadh.com', 'riyadh', 'admin')
on conflict (email, branch_id) do update
set access_level = excluded.access_level;
