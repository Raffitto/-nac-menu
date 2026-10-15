/**
 * Server-side Ask NAC access profile from JWT-backed staff tables.
 * Client profile hints are recorded for diagnostics and never grant access.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  normalizeAccessProfileHint,
  normalizeBranchId,
  type AccessProfileHint,
} from "./companyIntelligence/scope.ts";

const CANONICAL_BRANCHES = ["khobar", "riyadh", "jeddah"];

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
 * Permissions come only from ask_nac_staff, ask_nac_user_branch_access,
 * and ask_nac_vault_has_all_branches(). A missing staff row or branch
 * grant denies. Company-wide access stays only when that RPC returns true.
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

  let vaultRole: string | null = null;
  let primaryBranchId: string | null = null;
  let allowedBranchIds: string[] = [];
  let allBranchesRpc: boolean | null = null;
  let staffFound = false;

  try {
    const { data: staff, error } = await supabase
      .from("ask_nac_staff")
      .select("vault_role, primary_branch_id")
      .maybeSingle();
    if (!error && staff) {
      staffFound = true;
      source.push("ask_nac_staff");
      vaultRole = staff.vault_role ? String(staff.vault_role) : null;
      primaryBranchId = normalizeBranchId(staff.primary_branch_id);
    }
  } catch {
    staffFound = false;
  }

  try {
    const { data: rows, error } = await supabase
      .from("ask_nac_user_branch_access")
      .select("branch_id");
    if (!error && Array.isArray(rows) && rows.length) {
      source.push("ask_nac_user_branch_access");
      allowedBranchIds = uniqBranches(rows.map((r: { branch_id?: string }) => r.branch_id));
    }
  } catch {
    allowedBranchIds = [];
  }

  try {
    const { data: hasAll, error } = await supabase.rpc("ask_nac_vault_has_all_branches");
    if (!error && typeof hasAll === "boolean") {
      source.push("ask_nac_vault_has_all_branches");
      allBranchesRpc = hasAll;
    }
  } catch {
    allBranchesRpc = null;
  }

  if (primaryBranchId && !allowedBranchIds.includes(primaryBranchId)) {
    allowedBranchIds = [primaryBranchId, ...allowedBranchIds];
  }

  const allBranches = allBranchesRpc === true;
  const trusted = allBranches || staffFound || allowedBranchIds.length > 0;
  const branchScope = allBranches
    ? null
    : (primaryBranchId && allowedBranchIds.includes(primaryBranchId)
      ? primaryBranchId
      : (allowedBranchIds.length === 1 ? allowedBranchIds[0] : null));

  const profileHint: AccessProfileHint = {
    role: vaultRole,
    branchScope,
    allBranches,
    authenticated: trusted,
    allowedBranchIds: allBranches
      ? (allowedBranchIds.length ? allowedBranchIds : [...CANONICAL_BRANCHES])
      : allowedBranchIds,
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
