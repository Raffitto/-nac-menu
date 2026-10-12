/**
 * Service-path owner authorization for Drive ingestion (F15-b / F15-c).
 *
 * The nightly `scheduled_ingest` and `ingest_review_tracking` paths run with the service role and
 * no user JWT, so the JWT-based SQL helpers (ask_nac_vault_*, nac_menu_*) cannot be called for the
 * connection OWNER. This module evaluates the same rules for a given owner email directly from the
 * tables those helpers read (service-role reads, no writes):
 *
 *   vault authority  = ask_nac_roles.can_upload (role from ask_nac_staff, default 'staff')
 *                      AND branch via ask_nac_roles.cross_branch | ask_nac_user_branch_access |
 *                          ask_nac_staff.primary_branch_id          (= ask_nac_vault_branch_allowed)
 *                      brand-wide: cross_branch, or role in ceo/super_admin/marketing
 *   menu authority   = menu_staff_scope role developer/ceo with branch null  (all branches)
 *                      | role branch_gm with branch = target                    (NAC OS RBAC)
 *
 * Since S1.2 this is the ONLY rule: the user path (vaultDriveAuthorization.ts) calls it for the
 * authenticated caller. Same rule as the NOT_APPLIED SQL helper
 * ask_nac_drive_owner_can_ingest_branch(). FAILS CLOSED: a table read error contributes no authority.
 */
import { normalizeDriveBranchId } from "./vaultDriveAuthorization.ts";

type SupabaseLike = { from: (table: string) => any };
type Row = Record<string, any>;

const lower = (v: unknown) => String(v ?? "").trim().toLowerCase();

const PAGE_SIZE = 1000; // PostgREST default max-rows
const MAX_PAGES = 100;

/**
 * Reads a whole (small) staff table, paginated so a PostgREST row cap can never silently truncate
 * authority. Any error on any page => [] (fail closed: no authority).
 */
async function readAll(admin: SupabaseLike, table: string, columns: string, orderBy: string[]): Promise<Row[]> {
  try {
    const rows: Row[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      let q = admin.from(table).select(columns);
      if (typeof q?.range !== "function") {
        // minimal clients without range(): single read
        const { data, error } = await q;
        return error || !Array.isArray(data) ? [] : (data as Row[]);
      }
      for (const col of orderBy) if (typeof q.order === "function") q = q.order(col, { ascending: true });
      const from = page * PAGE_SIZE;
      const { data, error } = await q.range(from, from + PAGE_SIZE - 1);
      if (error || !Array.isArray(data)) return [];
      rows.push(...(data as Row[]));
      if (data.length < PAGE_SIZE) return rows;
    }
    return []; // implausibly large staff table: fail closed
  } catch {
    return [];
  }
}

export type OwnerAuthority = {
  /** May `ownerEmail` have Drive data ingested for `rawBranch` (null / 'brand' = brand-wide)? */
  canIngestBranch: (ownerEmail: unknown, rawBranch: unknown) => Promise<boolean>;
  /** Any ingestion authority at all (used to decide whether a connection is usable). */
  canIngestAny: (ownerEmail: unknown) => Promise<boolean>;
};

export function createOwnerAuthority(admin: SupabaseLike): OwnerAuthority {
  let loaded: Promise<{
    staff: Map<string, Row>;
    roles: Map<string, Row>;
    branchAccess: Map<string, Set<string>>;
    menu: Map<string, Row>;
  }> | null = null;

  const load = () => (loaded ??= (async () => {
    const [staffRows, roleRows, accessRows, menuRows] = await Promise.all([
      readAll(admin, "ask_nac_staff", "email,vault_role,primary_branch_id", ["email"]),
      readAll(admin, "ask_nac_roles", "code,cross_branch,can_upload", ["code"]),
      readAll(admin, "ask_nac_user_branch_access", "email,branch_id", ["email", "branch_id"]),
      readAll(admin, "menu_staff_scope", "email,branch_id,role", ["email"]),
    ]);
    const staff = new Map(staffRows.map((r) => [lower(r.email), r]));
    const roles = new Map(roleRows.map((r) => [lower(r.code), r]));
    const branchAccess = new Map<string, Set<string>>();
    for (const r of accessRows) {
      const b = normalizeDriveBranchId(r.branch_id);
      if (!b) continue;
      const k = lower(r.email);
      if (!branchAccess.has(k)) branchAccess.set(k, new Set());
      branchAccess.get(k)!.add(b);
    }
    const menu = new Map(menuRows.map((r) => [lower(r.email), r]));
    return { staff, roles, branchAccess, menu };
  })());

  async function vaultAuthority(email: string, branch: string | null, brandWide: boolean) {
    const { staff, roles, branchAccess } = await load();
    const s = staff.get(email);
    const roleCode = lower(s?.vault_role) || "staff";
    const role = roles.get(roleCode);
    if (role?.can_upload !== true) return false;
    if (role?.cross_branch === true) return true;
    if (brandWide) return ["ceo", "super_admin", "marketing"].includes(roleCode);
    if (!branch) return false;
    return Boolean(branchAccess.get(email)?.has(branch)) || normalizeDriveBranchId(s?.primary_branch_id) === branch;
  }

  async function menuAuthority(email: string, branch: string | null, brandWide: boolean) {
    const { menu } = await load();
    const m = menu.get(email);
    if (!m) return false;
    const role = lower(m.role);
    if ((role === "developer" || role === "ceo") && (m.branch_id == null || String(m.branch_id).trim() === "")) return true;
    if (brandWide || !branch) return false;
    return role === "branch_gm" && normalizeDriveBranchId(m.branch_id) === branch;
  }

  async function canIngestBranch(ownerEmail: unknown, rawBranch: unknown) {
    const email = lower(ownerEmail);
    if (!email) return false;
    const isBlank = rawBranch == null || String(rawBranch).trim() === "";
    const brandWide = isBlank || lower(rawBranch) === "brand";
    const branch = brandWide ? null : normalizeDriveBranchId(rawBranch);
    if (!brandWide && !branch) return false; // unknown branch token
    return (await vaultAuthority(email, branch, brandWide)) || (await menuAuthority(email, branch, brandWide));
  }

  async function canIngestAny(ownerEmail: unknown) {
    const email = lower(ownerEmail);
    if (!email) return false;
    const { staff, roles, menu } = await load();
    const role = roles.get(lower(staff.get(email)?.vault_role) || "staff");
    if (role?.can_upload === true) return true;
    const m = menu.get(email);
    return Boolean(m && ["developer", "ceo", "branch_gm"].includes(lower(m.role)));
  }

  return { canIngestBranch, canIngestAny };
}
