/**
 * Branch-scoped authorization for user-triggered vault-drive-sync actions (F15).
 * (Service paths without a user JWT use vaultDriveOwnerAuthorization.ts — same rules.)
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
 *   menu_staff_scope (own row, RLS-readable) — NAC OS RBAC branch_gm for one branch
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

/**
 * Per-request memoized authorizer bound to the caller's JWT-scoped client.
 *
 * Two independent authority systems (either is sufficient, each is complete on its own):
 *   vault: ask_nac_vault_can_upload() AND branch via ask_nac_vault_branch_allowed()
 *          (brand-wide: ask_nac_vault_has_all_branches() or ask_nac_vault_branch_allowed('brand'))
 *   menu (NAC OS RBAC, src/dashboard/config/rbac.js): nac_menu_staff_all_branches() (developer/ceo)
 *          OR menu_staff_scope.role = 'branch_gm' for exactly that branch.
 * Branch access alone (e.g. ask_nac_user_branch_access, or a 'restricted' menu role) never grants
 * ingestion. This mirrors 20260608190000 (menu RBAC owners need not be vault-mapped) without
 * depending on which ask_nac_vault_can_upload() version is deployed.
 */
export function createDriveBranchAuthorizer(userClient: RpcClient & { from?: (t: string) => any }, userEmail = "") {
  const memo = new Map<string, Promise<boolean>>();
  const cached = (key: string, fn: () => Promise<boolean>) => {
    if (!memo.has(key)) memo.set(key, fn());
    return memo.get(key)!;
  };
  const email = String(userEmail || "").trim().toLowerCase();

  let menuRowPromise: Promise<{ role: string; branch: DriveBranchId | null; allBranches: boolean } | null> | null = null;
  const menuRow = () => (menuRowPromise ??= (async () => {
    if (!email || typeof userClient.from !== "function") return null;
    try {
      const { data, error } = await userClient.from("menu_staff_scope").select("email,branch_id,role").eq("email", email).maybeSingle();
      if (error || !data) return null;
      const role = String(data.role || "").toLowerCase();
      const blank = data.branch_id == null || String(data.branch_id).trim() === "";
      return { role, branch: normalizeDriveBranchId(data.branch_id), allBranches: blank && (role === "developer" || role === "ceo") };
    } catch {
      return null;
    }
  })());

  const vaultCanUpload = () => cached("can_upload", () => rpcBool(userClient, "ask_nac_vault_can_upload"));
  const menuAllBranches = () =>
    cached("menu_all", async () => (await rpcBool(userClient, "nac_menu_staff_all_branches")) || Boolean((await menuRow())?.allBranches));
  const hasAllBranches = () => cached("all_branches", () => rpcBool(userClient, "ask_nac_vault_has_all_branches"));

  const vaultBranch = (branch: DriveBranchId | null) =>
    cached(`vault:${branch ?? "brand"}`, async () => {
      if (!(await vaultCanUpload())) return false;
      if (!branch) {
        return (await hasAllBranches()) || (await rpcBool(userClient, "ask_nac_vault_branch_allowed", { p_branch: "brand" }));
      }
      return rpcBool(userClient, "ask_nac_vault_branch_allowed", { p_branch: branch });
    });
  const menuBranch = (branch: DriveBranchId | null) =>
    cached(`menu:${branch ?? "brand"}`, async () => {
      if (await menuAllBranches()) return true;
      if (!branch) return false;
      const row = await menuRow();
      return Boolean(row && row.role === "branch_gm" && row.branch === branch);
    });

  /** Any Drive-ingestion authority at all (gate for connecting Google Drive). */
  const canIngest = () =>
    cached("any", async () =>
      (await vaultCanUpload())
      || (await menuAllBranches())
      || ["developer", "ceo", "branch_gm"].includes((await menuRow())?.role || ""));

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
    if ((await vaultBranch(branchId)) || (await menuBranch(branchId))) return { ok: true, branchId };
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

  return { canIngest, hasAllBranches, authorizeBranch, folderBranch, partitionFolders };
}
