// Shared table-driven identities. Authority comes ONLY from the fake staff tables, evaluated by the
// SQL-helper emulation (stubs/sqlHelpers.ts) on the user path and by the real
// vaultDriveOwnerAuthorization.ts on service paths.
import { resetState, state } from "./harness.ts";
import { table } from "./stubs/state.ts";
import { seedRoles } from "./stubs/sqlHelpers.ts";

export const U = {
  ceo: { token: "tok-ceo", email: "ceo@test.local" },
  khobarGm: { token: "tok-khobar-gm", email: "khobar-gm@test.local" },
  riyadhGm: { token: "tok-riyadh-gm", email: "riyadh-gm@test.local" },
  menuOnlyGm: { token: "tok-menu-gm", email: "menu-gm@test.local" },
  staff: { token: "tok-staff", email: "staff@test.local" },
  branchNoUpload: { token: "tok-branch-no-upload", email: "branch-no-upload@test.local" },
  restrictedMenu: { token: "tok-restricted", email: "restricted@test.local" },
  unmapped: { token: "tok-unmapped", email: "unmapped@test.local" },
  developer: { token: "tok-developer", email: "developer@test.local" },
  // X1 profiles: NAC OS branch_gm for KHOBAR whose vault role ('staff', no can_upload) has RIYADH
  // access. The widened ask_nac_vault_can_upload() RPC is true for any branch_gm, so the old user
  // path combined it with ask_nac_vault_branch_allowed('riyadh') and allowed Riyadh ingestion.
  x1Primary: { token: "tok-x1-primary", email: "x1-primary@test.local" },
  x1Access: { token: "tok-x1-access", email: "x1-access@test.local" },
  // X2: menu_staff_scope email stored with upper-case letters (SQL helpers lower() both sides)
  upperGm: { token: "tok-upper-gm", email: "upper-gm@test.local" },
};
export type TestUser = { token: string; email: string };
export const bearer = (u: TestUser) => `Bearer ${u.token}`;
export const connId = (u: TestUser) => `conn-${u.token}`;
export const refreshToken = (u: TestUser) => `rt-${u.token}`;
export const accessToken = (u: TestUser) => `access:${refreshToken(u)}`;

export function seedIdentities() {
  resetState();
  seedRoles();
  for (const u of Object.values(U)) state.users[u.token] = u.email;
  table("ask_nac_staff").push(
    { email: U.ceo.email, vault_role: "ceo", primary_branch_id: null },
    { email: U.khobarGm.email, vault_role: "branch_manager", primary_branch_id: "khobar" },
    { email: U.riyadhGm.email, vault_role: "branch_manager", primary_branch_id: "riyadh" },
    { email: U.staff.email, vault_role: "staff", primary_branch_id: "jeddah" },
    // Has explicit branch ACCESS to Khobar but a role WITHOUT can_upload (mutation-gap case).
    { email: U.branchNoUpload.email, vault_role: "staff", primary_branch_id: null },
    { email: U.x1Primary.email, vault_role: "staff", primary_branch_id: "riyadh" },
    { email: U.x1Access.email, vault_role: "staff", primary_branch_id: null },
  );
  table("ask_nac_user_branch_access").push({ email: U.x1Access.email, branch_id: "riyadh", access_level: "write" });
  table("ask_nac_user_branch_access").push({ email: U.branchNoUpload.email, branch_id: "khobar", access_level: "read" });
  table("menu_staff_scope").push(
    { email: U.menuOnlyGm.email, branch_id: "khobar", role: "branch_gm" }, // NAC OS RBAC only, not vault-mapped
    { email: U.restrictedMenu.email, branch_id: "khobar", role: "restricted" },
    { email: U.developer.email, branch_id: null, role: "developer" },
    { email: U.x1Primary.email, branch_id: "khobar", role: "branch_gm" },
    { email: U.x1Access.email, branch_id: "khobar", role: "branch_gm" },
    { email: "Upper-GM@Test.Local", branch_id: "khobar", role: "branch_gm" },
  );
  // U.unmapped: present in no staff table (and its user-client reads/RPCs error) => no authority.
  state.rpcErrors.add(U.unmapped.email);
  for (const u of Object.values(U)) {
    table("ask_nac_drive_connections").push({ id: connId(u), user_email: u.email, refresh_token: refreshToken(u), status: "active" });
  }
}

export function seedFolder(id: string, owner: TestUser, branch: string | null, extra: Record<string, unknown> = {}) {
  table("ask_nac_drive_sync_folders").push({
    id, connection_id: connId(owner), drive_folder_id: `drive-${id}`, folder_name: id, label: id,
    branch_id: branch, default_branch_id: branch, department: "operations", report_type: "cash_up",
    auto_ingest: true, enabled: true, is_discovery_root: false, schedule: "daily", ...extra,
  });
}

export function giveReviewTrackingFile(owner: TestUser, fileId: string, parentId: string) {
  (state.driveFiles[accessToken(owner)] ??= []).push({
    id: fileId, name: "2026 Review Tracking", mimeType: "application/vnd.google-apps.spreadsheet", parents: [parentId],
  });
}
