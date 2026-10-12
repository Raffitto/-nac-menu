// Emulation of the production SQL authorization helpers, evaluated from the fake tables for the
// caller's email (what auth.jwt() would resolve). Sources (supabase/migrations):
//   ask_nac_vault_role / has_all_branches / branch_allowed  — 20260606120000_ask_nac_data_vault_foundation.sql
//   ask_nac_vault_can_upload (widened)                      — 20260608210000_ask_nac_bulk_import_batches_rls_fix.sql
//   nac_normalize_branch_id / nac_menu_staff_all_branches / nac_menu_can_edit_branch
//                                                           — 20260603160000_fix_clone_branch_menu_helpers.sql
import { type Row, table } from "./state.ts";

const lower = (v: unknown) => String(v ?? "").trim().toLowerCase();
export function nacNormalizeBranchId(p: unknown): string | null {
  const v = lower(p);
  if (!v) return null;
  if (["khobar", "riyadh", "jeddah"].includes(v)) return v;
  if (/(khobar|alkhobar|الخبر)/.test(v)) return "khobar";
  if (/(riyadh|رياض)/.test(v)) return "riyadh";
  if (/(jeddah|jedda|جدة|jiddah)/.test(v)) return "jeddah";
  return null;
}
const staffRow = (email: string) => table("ask_nac_staff").find((s) => lower(s.email) === email);
const menuRow = (email: string) => table("menu_staff_scope").find((s) => lower(s.email) === email);
const vaultRole = (email: string) => lower(staffRow(email)?.vault_role) || "staff";
const roleRow = (code: string) => table("ask_nac_roles").find((r) => r.code === code);
const menuAll = (email: string) => {
  const m = menuRow(email);
  return Boolean(m && m.branch_id == null && ["developer", "ceo"].includes(m.role));
};
const hasAll = (email: string) => roleRow(vaultRole(email))?.cross_branch === true;

export const SQL_HELPERS: Record<string, (email: string, args: Row) => boolean> = {
  ask_nac_vault_has_all_branches: (e) => hasAll(e),
  ask_nac_vault_can_upload: (e) =>
    roleRow(vaultRole(e))?.can_upload === true || menuAll(e) || menuRow(e)?.role === "branch_gm",
  ask_nac_vault_branch_allowed: (e, a) => {
    const p = a.p_branch;
    const role = vaultRole(e);
    if (hasAll(e)) return true;
    if (p == null && ["ceo", "super_admin"].includes(role)) return true;
    if (lower(p) === "brand" && ["ceo", "super_admin", "marketing"].includes(role)) return true;
    const b = nacNormalizeBranchId(p);
    if (!b) return false;
    if (table("ask_nac_user_branch_access").some((x) => lower(x.email) === e && x.branch_id === b)) return true;
    return staffRow(e)?.primary_branch_id === b;
  },
  nac_menu_staff_all_branches: (e) => menuAll(e),
  nac_menu_can_edit_branch: (e, a) => menuAll(e) || (nacNormalizeBranchId(a.p_branch) != null && nacNormalizeBranchId(a.p_branch) === menuRow(e)?.branch_id),
};

export function seedRoles() {
  // Subset of 20260606120000 L876-884 + branch_admin (20260714180000).
  const roles: Array<[string, boolean, boolean]> = [
    ["super_admin", true, true], ["ceo", true, true], ["ops_manager", true, true],
    ["branch_manager", false, true], ["marketing", false, true], ["branch_admin", false, true], ["staff", false, false],
  ];
  for (const [code, cross_branch, can_upload] of roles) table("ask_nac_roles").push({ code, cross_branch, can_upload });
}
