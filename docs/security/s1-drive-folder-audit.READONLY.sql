-- READ-ONLY audit (security batch S1 / F15). NOT executed by any agent.
-- Lists registered Drive folders whose connection owner has no visible authority for the folder's
-- branch according to the same tables the DB helpers read. Returns emails and branch ids only:
-- no OAuth tokens, no file contents, no business data. Run inside a transaction that is rolled back.
begin read only;

with folders as (
  select f.id, f.branch_id, f.default_branch_id, f.auto_ingest, f.schedule, f.enabled,
         lower(c.user_email) as owner_email
  from public.ask_nac_drive_sync_folders f
  join public.ask_nac_drive_connections c on c.id = f.connection_id
),
authority as (
  select fo.*,
    exists (select 1 from public.ask_nac_staff s join public.ask_nac_roles r on r.code = s.vault_role
            where lower(s.email) = fo.owner_email and r.cross_branch) as vault_cross_branch,
    exists (select 1 from public.menu_staff_scope m
            where lower(m.email) = fo.owner_email and m.branch_id is null and m.role in ('developer','ceo')) as menu_all_branches,
    exists (select 1 from public.ask_nac_user_branch_access ba
            where lower(ba.email) = fo.owner_email
              and ba.branch_id = public.nac_normalize_branch_id(coalesce(fo.branch_id, fo.default_branch_id))) as branch_access,
    exists (select 1 from public.ask_nac_staff s
            where lower(s.email) = fo.owner_email
              and s.primary_branch_id = public.nac_normalize_branch_id(coalesce(fo.branch_id, fo.default_branch_id))) as primary_branch,
    exists (select 1 from public.menu_staff_scope m
            where lower(m.email) = fo.owner_email
              and m.branch_id = public.nac_normalize_branch_id(coalesce(fo.branch_id, fo.default_branch_id))) as menu_branch
  from folders fo
)
select id, owner_email, branch_id, default_branch_id, auto_ingest, schedule, enabled,
       vault_cross_branch, menu_all_branches, branch_access, primary_branch, menu_branch
from authority
where not (vault_cross_branch or menu_all_branches or branch_access or primary_branch or menu_branch)
order by enabled desc, auto_ingest desc, owner_email;

rollback;
