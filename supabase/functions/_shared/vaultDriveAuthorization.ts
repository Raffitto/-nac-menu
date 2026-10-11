/**
 * Branch-scoped authorization for user-triggered vault-drive-sync actions (F15).
 *
 * vault-drive-sync performs folder registration and ingestion with a service-role client,
 * which bypasses RLS. These checks re-impose the existing NAC authorization model before any
 * privileged write, using the CALLER's JWT-scoped client so that the database helpers below
 * evaluate auth.jwt() for the real caller (no client-supplied role/branch is trusted):
 *
 *   ask_nac_vault_can_upload()            — vault roles with can_upload, menu developer/ceo, branch_gm
 *   ask_nac_vault_has_all_branches()      — vault roles with cross_branch
 *   ask_nac_vault_branch_allowed(text)    — vault role / ask_nac_user_branch_access / primary branch
 *   nac_menu_staff_all_branches()         — NAC OS RBAC developer/ceo (menu_staff_scope, branch null)
 *   nac_menu_can_edit_branch(text)        — NAC OS RBAC branch scope (menu_staff_scope)
 *
 * All helpers already exist in supabase/migrations (no schema change). Every check FAILS CLOSED:
 * an RPC error or a non-boolean result is treated as "not authorized".
 */

export type RpcClient = {
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
};

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

async function rpcBool(client: RpcClient, fn: string, args?: Record<string, unknown>): Promise<boolean> {
  try {
    const { data, error } = await client.rpc(fn, args);
    if (error) return false;
    return data === true;
  } catch {
    return false;
  }
}

/** Per-request memoized authorizer bound to the caller's JWT-scoped client. */
export function createDriveBranchAuthorizer(userClient: RpcClient) {
  const memo = new Map<string, Promise<boolean>>();
  const cached = (key: string, fn: () => Promise<boolean>) => {
    if (!memo.has(key)) memo.set(key, fn());
    return memo.get(key)!;
  };

  const canIngest = () => cached("can_upload", () => rpcBool(userClient, "ask_nac_vault_can_upload"));
  const hasAllBranches = () =>
    cached("all_branches", async () =>
      (await rpcBool(userClient, "ask_nac_vault_has_all_branches"))
      || (await rpcBool(userClient, "nac_menu_staff_all_branches")));
  // Brand-wide (no branch) uses the existing vault semantics for 'brand' (ceo/super_admin/marketing)
  // plus cross-branch authority.
  const brandWideAllowed = () =>
    cached("brand", async () =>
      (await hasAllBranches())
      || (await rpcBool(userClient, "ask_nac_vault_branch_allowed", { p_branch: "brand" })));
  const branchAllowed = (branch: DriveBranchId) =>
    cached(`branch:${branch}`, async () =>
      (await rpcBool(userClient, "ask_nac_vault_branch_allowed", { p_branch: branch }))
      || (await rpcBool(userClient, "nac_menu_can_edit_branch", { p_branch: branch })));

  /**
   * May the caller write Drive-ingested data attributed to `rawBranch`?
   * - caller must hold ingestion rights (ask_nac_vault_can_upload)
   * - a named branch must be a canonical branch the caller is authorized for
   * - no branch / "brand" (brand-wide, as sent by the Data Vault panel) requires cross-branch or
   *   brand authority
   */
  async function authorizeBranch(rawBranch: unknown): Promise<DriveAuthDecision> {
    const isBrand = rawBranch != null && String(rawBranch).trim().toLowerCase() === "brand";
    const provided = !isBrand && rawBranch != null && String(rawBranch).trim() !== "";
    const branchId = normalizeDriveBranchId(rawBranch);
    if (provided && !branchId) return { ok: false, status: 400, reason: "Unknown branch." };
    if (!(await canIngest())) {
      return { ok: false, status: 403, reason: "Your role is not allowed to manage Drive ingestion." };
    }
    if (!branchId) {
      return (await brandWideAllowed())
        ? { ok: true, branchId: null }
        : { ok: false, status: 403, reason: "Select a branch you manage." };
    }
    return (await branchAllowed(branchId))
      ? { ok: true, branchId }
      : { ok: false, status: 403, reason: "You are not authorized for this branch." };
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

  return { canIngest, hasAllBranches, brandWideAllowed, branchAllowed, authorizeBranch, folderBranch, partitionFolders };
}
