/**
 * Branch-scoped authorization for user-triggered vault-drive-sync actions (F15).
 *
 * S1.2 (Sentinel X1): the user path uses EXACTLY the same per-owner, per-branch rule as the
 * service paths (nightly scheduled_ingest, ingest_review_tracking): vaultDriveOwnerAuthorization.ts
 * evaluated for the authenticated caller's email (taken from the verified Supabase session, never
 * from the request). One rule everywhere:
 *
 *   vault: ask_nac_roles.can_upload of the caller's OWN vault role (default 'staff')
 *          AND branch via cross_branch | ask_nac_user_branch_access | primary_branch_id
 *          (brand-wide: cross_branch or role ceo/super_admin/marketing)
 *   menu (NAC OS RBAC): menu_staff_scope developer/ceo with NULL branch (all branches)
 *          | branch_gm for exactly that branch
 *
 * The widened ask_nac_vault_can_upload() RPC (20260608210000, true for ANY menu branch_gm) is no
 * longer consulted: combined with vault branch access it let a Khobar GM ingest into Riyadh (X1).
 * Branch access alone never grants ingestion. Everything FAILS CLOSED (read error = no authority).
 */
import type { OwnerAuthority } from "./vaultDriveOwnerAuthorization.ts";

export const CANONICAL_DRIVE_BRANCHES = ["khobar", "riyadh", "jeddah"] as const;
export type DriveBranchId = typeof CANONICAL_DRIVE_BRANCHES[number];

/** Mirrors public.nac_normalize_branch_id(text) (20260603160000_fix_clone_branch_menu_helpers.sql). */
export function normalizeDriveBranchId(raw: unknown): DriveBranchId | null {
  if (raw == null) return null;
  const v = String(raw).trim().toLowerCase();
  if (!v) return null;
  if (v === "khobar" || v === "riyadh" || v === "jeddah") return v;
  if (/(khobar|alkhobar|الخبر)/.test(v)) return "khobar";
  if (/(riyadh|رياض)/.test(v)) return "riyadh";
  if (/(jeddah|jedda|جدة|jiddah)/.test(v)) return "jeddah";
  return null;
}

export type DriveAuthDecision =
  | { ok: true; branchId: DriveBranchId | null }
  | { ok: false; status: 400 | 403; reason: string };

/**
 * Per-request authorizer for the authenticated caller. `owner` is createOwnerAuthority(admin)
 * (service-role table reads, memoized per request); `userEmail` comes from auth.getUser().
 */
export function createDriveBranchAuthorizer(owner: OwnerAuthority, userEmail: string) {
  const email = String(userEmail || "").trim().toLowerCase();
  const memo = new Map<string, Promise<boolean>>();
  const cached = (key: string, fn: () => Promise<boolean>) => {
    if (!memo.has(key)) memo.set(key, Promise.resolve().then(fn).then((v) => v === true, () => false));
    return memo.get(key)!;
  };

  /** Any Drive-ingestion authority at all (gate for connecting Google Drive). */
  const canIngest = () => cached("any", () => owner.canIngestAny(email));
  const canIngestBranch = (branch: DriveBranchId | null) =>
    cached(`branch:${branch ?? "brand"}`, () => owner.canIngestBranch(email, branch));

  /**
   * May the caller write Drive-ingested data attributed to `rawBranch`?
   * - a named branch must be canonical and authorized via vault OR menu authority
   * - no branch / "brand" (brand-wide, as sent by the Data Vault panel) needs brand-wide authority
   */
  async function authorizeBranch(rawBranch: unknown): Promise<DriveAuthDecision> {
    const isBrand = rawBranch != null && String(rawBranch).trim().toLowerCase() === "brand";
    const provided = !isBrand && rawBranch != null && String(rawBranch).trim() !== "";
    const branchId = normalizeDriveBranchId(rawBranch);
    if (provided && !branchId) return { ok: false, status: 400, reason: "Unknown branch." };
    if (await canIngestBranch(branchId)) return { ok: true, branchId };
    if (!(await canIngest())) {
      return { ok: false, status: 403, reason: "Your role is not allowed to manage Drive ingestion." };
    }
    return branchId
      ? { ok: false, status: 403, reason: "You are not authorized for this branch." }
      : { ok: false, status: 403, reason: "Select a branch you manage." };
  }

  /** Effective branch of a registered folder row (same precedence as ingestion). */
  function folderBranch(folder: unknown): unknown {
    const row = (folder || {}) as { branch_id?: unknown; default_branch_id?: unknown };
    return row.branch_id || row.default_branch_id || null;
  }

  async function partitionFolders<T>(folders: T[]): Promise<{ allowed: T[]; denied: T[] }> {
    const allowed: T[] = [];
    const denied: T[] = [];
    for (const folder of folders) {
      ((await authorizeBranch(folderBranch(folder))).ok ? allowed : denied).push(folder);
    }
    return { allowed, denied };
  }

  return { canIngest, authorizeBranch, folderBranch, partitionFolders };
}
