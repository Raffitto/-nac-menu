-- ############################################################################################
-- ##  OUTPUT OF THIS QUERY MUST NEVER BE POSTED TO GITHUB (issues, PRs, comments, gists) OR  ##
-- ##  ANY PUBLIC CHANNEL. Share results only with the owner through a private channel.      ##
-- ############################################################################################
-- READ-ONLY audit (security batch S1 / S1.1, F15-b/F15-c). NOT executed by any agent.
-- Lists Drive folder rows whose connection OWNER lacks ingestion authority for the folder's branch,
-- using the same two-system rule as the Edge Functions and the NOT_APPLIED proposal:
--   vault: role can_upload AND (cross_branch | branch access | primary branch; brand-wide: cross
--          branch or ceo/super_admin/marketing)  OR  menu: developer/ceo all-branches | branch_gm of branch
-- Default output is non-PII: aggregate counts + auth.users ids (no emails, no tokens, no file data).
-- To see emails, uncomment the marked line in section 2. Runs in a rolled-back read-only transaction.
begin read only;

-- (A temporary view is not allowed in a read-only transaction, so each query repeats the CTE.)

-- 1. Aggregate (non-PII).
with s1_drive_folder_authority as (
with folders as (
    select f.id as folder_id, f.connection_id, f.branch_id, f.default_branch_id,
           public.nac_normalize_branch_id(coalesce(f.branch_id, f.default_branch_id)) as target_branch,
           nullif(trim(coalesce(f.branch_id, f.default_branch_id, '')), '') is null as brand_wide,
           f.auto_ingest, f.schedule, f.enabled, f.report_type,
           lower(c.user_email) as owner_email
    from public.ask_nac_drive_sync_folders f
    join public.ask_nac_drive_connections c on c.id = f.connection_id
  ),
  facts as (
    select fo.*,
      coalesce(r.can_upload, false)   as vault_can_upload,
      coalesce(r.cross_branch, false) as vault_cross_branch,
      coalesce(s.vault_role, 'staff') as vault_role,
      exists (select 1 from public.ask_nac_user_branch_access ba
              where lower(ba.email) = fo.owner_email and ba.branch_id = fo.target_branch) as branch_access,
      (s.primary_branch_id is not null and s.primary_branch_id = fo.target_branch) as primary_branch,
      exists (select 1 from public.menu_staff_scope m
              where lower(m.email) = fo.owner_email and m.branch_id is null and m.role in ('developer','ceo')) as menu_all_branches,
      exists (select 1 from public.menu_staff_scope m
              where lower(m.email) = fo.owner_email and m.role = 'branch_gm' and m.branch_id = fo.target_branch) as menu_branch_gm
    from folders fo
    left join public.ask_nac_staff s on lower(s.email) = fo.owner_email
    left join public.ask_nac_roles r on r.code = coalesce(s.vault_role, 'staff')
  )
  select facts.*,
    (vault_can_upload and (vault_cross_branch
       or (brand_wide and vault_role in ('ceo','super_admin','marketing'))
       or (not brand_wide and (branch_access or primary_branch))))
    or menu_all_branches or (not brand_wide and menu_branch_gm) as authorized
  from facts
)
select enabled, auto_ingest, schedule, coalesce(target_branch, 'brand') as branch,
       count(*) as unauthorized_folders,
       count(*) filter (where branch_access and not vault_can_upload) as access_without_can_upload,
       count(distinct owner_email) as distinct_owners
from s1_drive_folder_authority
where not authorized
group by 1, 2, 3, 4
order by enabled desc, auto_ingest desc, branch;

-- 2. Detail by user id (non-PII by default).
with s1_drive_folder_authority as (
with folders as (
    select f.id as folder_id, f.connection_id, f.branch_id, f.default_branch_id,
           public.nac_normalize_branch_id(coalesce(f.branch_id, f.default_branch_id)) as target_branch,
           nullif(trim(coalesce(f.branch_id, f.default_branch_id, '')), '') is null as brand_wide,
           f.auto_ingest, f.schedule, f.enabled, f.report_type,
           lower(c.user_email) as owner_email
    from public.ask_nac_drive_sync_folders f
    join public.ask_nac_drive_connections c on c.id = f.connection_id
  ),
  facts as (
    select fo.*,
      coalesce(r.can_upload, false)   as vault_can_upload,
      coalesce(r.cross_branch, false) as vault_cross_branch,
      coalesce(s.vault_role, 'staff') as vault_role,
      exists (select 1 from public.ask_nac_user_branch_access ba
              where lower(ba.email) = fo.owner_email and ba.branch_id = fo.target_branch) as branch_access,
      (s.primary_branch_id is not null and s.primary_branch_id = fo.target_branch) as primary_branch,
      exists (select 1 from public.menu_staff_scope m
              where lower(m.email) = fo.owner_email and m.branch_id is null and m.role in ('developer','ceo')) as menu_all_branches,
      exists (select 1 from public.menu_staff_scope m
              where lower(m.email) = fo.owner_email and m.role = 'branch_gm' and m.branch_id = fo.target_branch) as menu_branch_gm
    from folders fo
    left join public.ask_nac_staff s on lower(s.email) = fo.owner_email
    left join public.ask_nac_roles r on r.code = coalesce(s.vault_role, 'staff')
  )
  select facts.*,
    (vault_can_upload and (vault_cross_branch
       or (brand_wide and vault_role in ('ceo','super_admin','marketing'))
       or (not brand_wide and (branch_access or primary_branch))))
    or menu_all_branches or (not brand_wide and menu_branch_gm) as authorized
  from facts
)
select a.folder_id, u.id as owner_user_id,
       -- a.owner_email,            -- <- uncomment ONLY for private, owner-approved review
       a.branch_id, a.default_branch_id, a.enabled, a.auto_ingest, a.schedule, a.report_type,
       a.vault_role, a.vault_can_upload, a.vault_cross_branch, a.branch_access, a.primary_branch,
       a.menu_all_branches, a.menu_branch_gm
from s1_drive_folder_authority a
left join auth.users u on lower(u.email) = a.owner_email
where not a.authorized
order by a.enabled desc, a.auto_ingest desc, owner_user_id;

-- 3. Connections that could feed review tracking (Khobar) without authority (F15-c), counts only.
select count(*) as connections_without_khobar_authority
from public.ask_nac_drive_connections c
where c.refresh_token is not null
  and not exists (
    select 1 from public.menu_staff_scope m
    where lower(m.email) = lower(c.user_email)
      and ((m.role in ('developer','ceo') and m.branch_id is null) or (m.role = 'branch_gm' and m.branch_id = 'khobar')))
  and not exists (
    select 1 from public.ask_nac_staff s join public.ask_nac_roles r on r.code = s.vault_role
    where lower(s.email) = lower(c.user_email) and r.can_upload
      and (r.cross_branch or s.primary_branch_id = 'khobar'
           or exists (select 1 from public.ask_nac_user_branch_access ba
                      where lower(ba.email) = lower(c.user_email) and ba.branch_id = 'khobar')));

rollback;
