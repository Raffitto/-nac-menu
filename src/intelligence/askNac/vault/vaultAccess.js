/**
 * Client-side mirror of vault scope rules for QA/tests (authoritative enforcement is Supabase RLS).
 */

import { normalizeBranchId } from "../../../dashboard/utils/branchIdentity";

export const VAULT_SENSITIVITY_RANK = {
  public: 1,
  internal: 2,
  management: 3,
  finance: 4,
  hr_restricted: 5,
};

export const VAULT_ROLE_CEILING = {
  super_admin: "hr_restricted",
  ceo: "hr_restricted",
  ops_manager: "finance",
  branch_manager: "management",
  reception_manager: "internal",
  cost_controller: "finance",
  marketing: "internal",
  hr: "hr_restricted",
  staff: "public",
};

export const VAULT_CROSS_BRANCH_ROLES = new Set(["ceo", "super_admin"]);

export function vaultSensitivityRank(level) {
  return VAULT_SENSITIVITY_RANK[level] || 0;
}

export function vaultCanReadSensitivity(vaultRole, sensitivityLevel) {
  const ceiling = VAULT_ROLE_CEILING[vaultRole] || "public";
  return vaultSensitivityRank(sensitivityLevel) <= vaultSensitivityRank(ceiling);
}

export function vaultCanAccessBranch(vaultRole, primaryBranchId, brandWide, userBranchId, assignedBranches = []) {
  if (brandWide) return true;
  if (VAULT_CROSS_BRANCH_ROLES.has(vaultRole)) return true;
  if (assignedBranches.length) {
    return assignedBranches.includes(normalizeBranchId(primaryBranchId));
  }
  return normalizeBranchId(primaryBranchId) === normalizeBranchId(userBranchId);
}

export function vaultCanReadFileMetadata({
  vaultRole,
  primaryBranchId,
  brandWide,
  department,
  sensitivityLevel,
  userBranchId,
  assignedBranches = [],
}) {
  if (!vaultRole || vaultRole === "staff") {
    return vaultCanReadSensitivity(vaultRole, sensitivityLevel) && vaultCanAccessBranch(
      vaultRole,
      primaryBranchId,
      brandWide,
      userBranchId,
      assignedBranches,
    );
  }
  return (
    vaultCanReadSensitivity(vaultRole, sensitivityLevel) &&
    vaultCanAccessBranch(vaultRole, primaryBranchId, brandWide, userBranchId, assignedBranches)
  );
}

export function filterFilesForVaultRole(files, accessContext) {
  return (files || []).filter((file) =>
    vaultCanReadFileMetadata({
      vaultRole: accessContext.vaultRole,
      primaryBranchId: file.primary_branch_id,
      brandWide: file.brand_wide,
      department: file.department,
      sensitivityLevel: file.sensitivity_level,
      userBranchId: accessContext.primaryBranchId,
      assignedBranches: accessContext.assignedBranches,
    }),
  );
}

export function vaultCanUploadToBranch(vaultRole, branchValue, primaryBranchId, assignedBranches = []) {
  if (!vaultRole || vaultRole === "staff") return false;
  if (branchValue === "brand") return VAULT_CROSS_BRANCH_ROLES.has(vaultRole);
  if (VAULT_CROSS_BRANCH_ROLES.has(vaultRole)) return true;
  if (assignedBranches.length) return assignedBranches.includes(normalizeBranchId(branchValue));
  return normalizeBranchId(branchValue) === normalizeBranchId(primaryBranchId);
}
