-- ============================================================================================
-- NOT APPLIED. PROPOSAL ONLY (security batch S1 / S1.1 / S1.2, finding F15-b).
-- S1.2: label / folder_name changes count as escalations (Sentinel S1.1 note, L06).
-- Stored OUTSIDE supabase/migrations so `supabase db push` cannot pick it up.
-- Preconditions before anyone applies it:
--   1. Sentinel review + owner approval.
--   2. Read-only diff of the LIVE policies/triggers on public.ask_nac_drive_sync_folders vs the repo.
--   3. Run docs/security/s1-drive-folder-audit.READONLY.sql (output stays out of GitHub) and decide
--      what to do with existing rows it lists BEFORE applying (this file changes no data).
--
-- Problem: RLS on ask_nac_drive_sync_folders (20260608180000 / 20260608190000) only checks that the
-- caller owns the Drive connection, so any connected user can INSERT/UPDATE rows via PostgREST with
-- any branch_id; service-role writers are not checked at all. The nightly scheduled_ingest then
-- ingests enabled auto_ingest/daily rows into the branch written on the row.
-- (S1.1 already makes those rows inert at the Edge layer: runScheduledDriveIngestion skips folders
-- whose owner is not authorized for the folder branch. This proposal closes it at the DB layer.)
--
-- Design (S1.1 revision):
--   * ONE owner-parameterised rule, ask_nac_drive_owner_can_ingest_branch(email, branch), identical
--     to the Edge rule (vaultDriveOwnerAuthorization.ts / vaultDriveAuthorization.ts):
--       vault: ask_nac_roles.can_upload for the owner's vault role (default 'staff')
--              AND (cross_branch | ask_nac_user_branch_access | primary_branch_id; brand-wide:
--                   cross_branch or role ceo/super_admin/marketing)          [= ask_nac_vault_branch_allowed]
--       OR menu (NAC OS RBAC): menu_staff_scope developer/ceo with NULL branch (all branches)
--                              | branch_gm for exactly that branch
--     Branch ACCESS alone never grants ingestion (mutation-gap case).
--   * Alignment with 20260608190000: that migration dropped ask_nac_vault_can_upload() from the
--     INSERT policy because a NAC OS user without a vault mapping was refused. This proposal does
--     NOT put ask_nac_vault_can_upload() back into RLS. RLS stays "connection owned" as in 0190000.
--     Authority is enforced by a trigger using the rule above, whose menu_staff_scope branch is the
--     path 0190000 wanted to keep open, and it is now branch-exact: 0210000's can_upload accepts a
--     branch_gm of ANY branch. The account cited in 0190000 is seeded as menu developer (all branches)
--     by 20260615150000, so it stays authorized. The rule reads the tables directly, so it does not
--     depend on which ask_nac_vault_can_upload() version is live.
--   * A trigger (not only RLS) is used so the SAME rule also covers service-role writers: the
--     nightly review-tracking host-folder upsert (ensureReviewTrackingHostFolder) and the
--     register/discover paths in vault-drive-sync.
--   * Branch values are normalised and stored canonically (nac_normalize_branch_id): 'Khobar' and
--     'AlKhobar' are stored as 'khobar'. A non-blank value that does not normalise is rejected, not
--     silently stored as NULL (NULL means brand-wide and needs more authority, not less).
--   * Owners can always DISABLE their own rows (enabled=false, auto_ingest=false, schedule='manual')
--     and can DELETE them (new owner-scoped DELETE policy + grant), including legacy foreign-branch
--     rows. DELETE cascades to ask_nac_drive_sync_runs, ask_nac_drive_sync_run_files and
--     ask_nac_drive_discovery_candidates for that folder, so prefer disabling when that history matters.
--   * Run-status/bookkeeping updates (last_sync_*, etc.) on existing rows are not re-checked,
--     so the nightly writer's status updates never fail on legacy rows.
-- No table/data changes; the column CHECKs (khobar/riyadh/jeddah) already exist.
-- ============================================================================================

begin;

-- 1. Owner-parameterised rule. NOT granted to authenticated (it would let users probe other people's
--    authority); used by the SECURITY DEFINER trigger and callable by service_role for audits.
create or replace function public.ask_nac_drive_owner_can_ingest_branch(p_email text, p_branch text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with who as (
    select lower(trim(coalesce(p_email, ''))) as email,
           (nullif(trim(coalesce(p_branch, '')), '') is null or lower(trim(p_branch)) = 'brand') as brand_wide,
           public.nac_normalize_branch_id(p_branch) as branch
  ),
  vault as (
    select coalesce((select s.vault_role from public.ask_nac_staff s, who where lower(s.email) = who.email), 'staff') as role_code,
           (select s.primary_branch_id from public.ask_nac_staff s, who where lower(s.email) = who.email) as primary_branch_id
  ),
  vault_role as (
    select v.role_code, v.primary_branch_id,
           coalesce(r.can_upload, false) as can_upload,
           coalesce(r.cross_branch, false) as cross_branch
    from vault v left join public.ask_nac_roles r on r.code = v.role_code
  )
  select coalesce((
    select who.email <> ''
      and (who.brand_wide or who.branch is not null)            -- unknown branch token: deny
      and (
        -- vault system
        (vr.can_upload and (
          vr.cross_branch
          or (who.brand_wide and vr.role_code in ('ceo', 'super_admin', 'marketing'))
          or (not who.brand_wide and (
                public.nac_normalize_branch_id(vr.primary_branch_id) = who.branch
                or exists (select 1 from public.ask_nac_user_branch_access ba
                           where lower(ba.email) = who.email
                             and public.nac_normalize_branch_id(ba.branch_id) = who.branch)))
        ))
        -- NAC OS menu RBAC
        or exists (select 1 from public.menu_staff_scope m
                   where lower(m.email) = who.email
                     and ((m.role in ('developer', 'ceo') and nullif(trim(coalesce(m.branch_id, '')), '') is null)
                          or (not who.brand_wide and m.role = 'branch_gm'
                              and public.nac_normalize_branch_id(m.branch_id) = who.branch)))
      )
    from who, vault_role vr
  ), false);
$$;

revoke all on function public.ask_nac_drive_owner_can_ingest_branch(text, text) from public, anon, authenticated;
grant execute on function public.ask_nac_drive_owner_can_ingest_branch(text, text) to service_role;

-- 2. Normalise + enforce on every writer (authenticated via PostgREST AND service_role).
create or replace function public.ask_nac_drive_folder_branch_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner text;
  v_raw_branch text := new.branch_id;
  v_raw_default text := new.default_branch_id;
  v_escalates boolean;
begin
  -- canonical storage; reject non-blank values that do not normalise
  new.branch_id := public.nac_normalize_branch_id(new.branch_id);
  new.default_branch_id := public.nac_normalize_branch_id(new.default_branch_id);
  if (nullif(trim(coalesce(v_raw_branch, '')), '') is not null and new.branch_id is null)
     or (nullif(trim(coalesce(v_raw_default, '')), '') is not null and new.default_branch_id is null) then
    raise exception 'Unknown branch for Drive folder' using errcode = '22023';
  end if;

  if tg_op = 'INSERT' then
    v_escalates := true;
  else
    v_escalates :=
         new.branch_id is distinct from old.branch_id
      or new.default_branch_id is distinct from old.default_branch_id
      or new.connection_id is distinct from old.connection_id
      or new.drive_folder_id is distinct from old.drive_folder_id
      or new.report_type is distinct from old.report_type
      -- ingestion derives the report type from the label/folder name (vaultDriveIngestion.ts)
      or new.label is distinct from old.label
      or new.folder_name is distinct from old.folder_name
      or (new.enabled and not coalesce(old.enabled, false))
      or (new.auto_ingest and not coalesce(old.auto_ingest, false))
      or (new.schedule = 'daily' and old.schedule is distinct from 'daily')
      or (new.is_discovery_root and not coalesce(old.is_discovery_root, false));
  end if;

  -- disable-only / bookkeeping updates (incl. on legacy foreign-branch rows) are always allowed
  if not v_escalates then
    return new;
  end if;

  select lower(c.user_email) into v_owner
  from public.ask_nac_drive_connections c where c.id = new.connection_id;

  -- effective branch = branch_id, else default_branch_id (as the Edge ingest uses it); NULL = brand-wide
  if v_owner is null
     or not public.ask_nac_drive_owner_can_ingest_branch(v_owner, coalesce(new.branch_id, new.default_branch_id))
     or (new.default_branch_id is not null and new.default_branch_id is distinct from new.branch_id
         and not public.ask_nac_drive_owner_can_ingest_branch(v_owner, new.default_branch_id)) then
    raise exception 'Drive connection owner is not authorized to ingest for this branch'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.ask_nac_drive_folder_branch_guard() from public, anon, authenticated;

drop trigger if exists ask_nac_drive_folder_branch_guard on public.ask_nac_drive_sync_folders;
create trigger ask_nac_drive_folder_branch_guard
  before insert or update on public.ask_nac_drive_sync_folders
  for each row execute function public.ask_nac_drive_folder_branch_guard();

-- 3. Owners may delete their own rows (legacy cleanup). INSERT/UPDATE/SELECT policies unchanged
--    (connection ownership, exactly as 20260608180000 / 20260608190000).
drop policy if exists ask_nac_drive_folders_delete on public.ask_nac_drive_sync_folders;
create policy ask_nac_drive_folders_delete on public.ask_nac_drive_sync_folders
  for delete to authenticated
  using (public.ask_nac_drive_connection_owned(connection_id));
grant delete on public.ask_nac_drive_sync_folders to authenticated;

commit;

-- Optional, separately approved remediation after reviewing the audit (NOT part of this proposal):
--   update public.ask_nac_drive_sync_folders set enabled = false, auto_ingest = false
--   where id in (<ids from the audit>);   -- allowed by the trigger (disable-only)

-- Rollback (restores pre-proposal behaviour; stored normalised values stay canonical, which the
-- existing CHECKs already require):
--   begin;
--   drop trigger if exists ask_nac_drive_folder_branch_guard on public.ask_nac_drive_sync_folders;
--   drop function if exists public.ask_nac_drive_folder_branch_guard();
--   drop policy if exists ask_nac_drive_folders_delete on public.ask_nac_drive_sync_folders;
--   revoke delete on public.ask_nac_drive_sync_folders from authenticated;
--   drop function if exists public.ask_nac_drive_owner_can_ingest_branch(text, text);
--   commit;
