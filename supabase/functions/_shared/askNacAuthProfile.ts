/**
 * Server-side Ask NAC access profile from JWT-backed staff tables.
 * Merges with client profileHint without trusting client network grants alone.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  normalizeAccessProfileHint,
  normalizeBranchId,
  type AccessProfileHint,
} from "./companyIntelligence/scope.ts";

const NETWORK_VAULT_ROLES = new Set(["ceo", "super_admin"]);

function uniqBranches(values: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  for (const value of values) {
    const branch = normalizeBranchId(value);
    if (branch && !out.includes(branch)) out.push(branch);
  }
  return out;
}

/**
 * Load authorized branch access using the caller's JWT (RLS applies).
 * Does not broaden RBAC — only reads ask_nac_staff / ask_nac_user_branch_access / vault RPCs.
 */
export async function loadAskNacAuthProfileHint(
  supabase: SupabaseClient,
  clientHint: AccessProfileHint | Record<string, unknown> | null | undefined = null,
): Promise<{
  profileHint: AccessProfileHint;
  diagnostics: {
    source: string[];
    vaultRole: string | null;
    primaryBranchId: string | null;
    allowedBranchIds: string[];
    allBranches: boolean;
    clientAllBranches: boolean | null;
    clientBranchScope: string | null;
  };
}> {
  const client = normalizeAccessProfileHint((clientHint || null) as AccessProfileHint | null);
  const source: string[] = [];
  if (client) source.push("client_profile_hint");

  let vaultRole: string | null = null;
  let primaryBranchId: string | null = null;
  let allowedBranchIds: string[] = [];
  let allBranchesRpc: boolean | null = null;

  try {
    const { data: staff } = await supabase
      .from("ask_nac_staff")
      .select("vault_role, primary_branch_id")
      .maybeSingle();
    if (staff) {
      source.push("ask_nac_staff");
      vaultRole = staff.vault_role ? String(staff.vault_role) : null;
      primaryBranchId = normalizeBranchId(staff.primary_branch_id);
    }
  } catch {
    // Keep client hint if staff lookup fails.
  }

  try {
    const { data: rows } = await supabase
      .from("ask_nac_user_branch_access")
      .select("branch_id");
    if (Array.isArray(rows) && rows.length) {
      source.push("ask_nac_user_branch_access");
      allowedBranchIds = uniqBranches(rows.map((r: { branch_id?: string }) => r.branch_id));
    }
  } catch {
    // optional
  }

  try {
    const { data: hasAll } = await supabase.rpc("ask_nac_vault_has_all_branches");
    if (typeof hasAll === "boolean") {
      source.push("ask_nac_vault_has_all_branches");
      allBranchesRpc = hasAll;
    }
  } catch {
    // optional
  }

  if (primaryBranchId && !allowedBranchIds.includes(primaryBranchId)) {
    allowedBranchIds = [primaryBranchId, ...allowedBranchIds];
  }
  for (const branch of client?.allowedBranchIds || []) {
    const normalized = normalizeBranchId(branch);
    if (normalized && !allowedBranchIds.includes(normalized)) allowedBranchIds.push(normalized);
  }

  const networkFromVaultRole = vaultRole != null && NETWORK_VAULT_ROLES.has(vaultRole);
  // Prefer server vault truth when available; never let a client hint grant network if vault denies it.
  const allBranches = allBranchesRpc != null
    ? allBranchesRpc
    : (networkFromVaultRole || Boolean(client?.allBranches));

  const branchScope = allBranches
    ? null
    : (normalizeBranchId(client?.branchScope) || primaryBranchId);

  const profileHint: AccessProfileHint = {
    role: client?.role || vaultRole,
    branchScope,
    allBranches,
    allowedBranchIds: allBranches
      ? (allowedBranchIds.length ? allowedBranchIds : ["khobar", "riyadh", "jeddah"])
      : (allowedBranchIds.length ? allowedBranchIds : (branchScope ? [branchScope] : [])),
    primary_branch_id: primaryBranchId,
    primaryBranchId,
    vault_role: vaultRole,
    vaultRole,
  };

  return {
    profileHint,
    diagnostics: {
      source,
      vaultRole,
      primaryBranchId,
      allowedBranchIds: profileHint.allowedBranchIds || [],
      allBranches,
      clientAllBranches: client?.allBranches ?? null,
      clientBranchScope: normalizeBranchId(client?.branchScope),
    },
  };
}
