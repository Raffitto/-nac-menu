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

export const VAULT_BRAND_WIDE_UPLOAD_ROLES = new Set(["ceo", "super_admin", "marketing"]);

/** Mirrors ask_nac_vault_role_default_departments() after permission hardening migration. */
export const VAULT_ROLE_DEFAULT_DEPARTMENTS = {
  super_admin: ["admin", "operations", "sales", "reception", "cost_control", "purchasing", "inventory", "hr", "marketing", "design", "foh", "kitchen", "brand"],
  ceo: ["admin", "operations", "sales", "reception", "cost_control", "purchasing", "inventory", "hr", "marketing", "design", "foh", "kitchen", "brand"],
  ops_manager: ["operations", "sales", "reception", "inventory", "foh", "kitchen", "admin", "brand"],
  branch_manager: ["operations", "sales", "reception", "foh", "kitchen", "admin", "brand"],
  reception_manager: ["reception", "sales"],
  cost_controller: ["cost_control", "purchasing", "inventory", "ffe"],
  marketing: ["marketing", "design", "brand"],
  hr: ["hr"],
  staff: ["brand", "operations"],
};

export function vaultSensitivityRank(level) {
  return VAULT_SENSITIVITY_RANK[level] || 0;
}

export function vaultCanReadSensitivity(vaultRole, sensitivityLevel) {
  const ceiling = VAULT_ROLE_CEILING[vaultRole] || "public";
  return vaultSensitivityRank(sensitivityLevel) <= vaultSensitivityRank(ceiling);
}

export function vaultDepartmentAllowed(vaultRole, department, extraDepartments = []) {
  if (!department) return false;
  const dept = String(department).toLowerCase().trim();
  const defaults = VAULT_ROLE_DEFAULT_DEPARTMENTS[vaultRole] || ["brand"];
  if (defaults.includes(dept)) return true;
  return extraDepartments.map((d) => String(d).toLowerCase()).includes(dept);
}

export function vaultCanAccessBranch(vaultRole, primaryBranchId, brandWide, userBranchId, assignedBranches = []) {
  if (brandWide) return true;
  if (VAULT_CROSS_BRANCH_ROLES.has(vaultRole)) return true;
  if (vaultRole === "ops_manager") return true;
  if (assignedBranches.length) {
    return assignedBranches.includes(normalizeBranchId(primaryBranchId));
  }
  return normalizeBranchId(primaryBranchId) === normalizeBranchId(userBranchId);
}

/** Mirrors ask_nac_vault_can_read_scope(). */
export function vaultCanReadScope({
  vaultRole,
  primaryBranchId,
  brandWide = false,
  department,
  sensitivityLevel,
  userBranchId,
  assignedBranches = [],
  extraDepartments = [],
}) {
  return (
    vaultCanReadSensitivity(vaultRole, sensitivityLevel) &&
    vaultDepartmentAllowed(vaultRole, department, extraDepartments) &&
    vaultCanAccessBranch(vaultRole, primaryBranchId, brandWide, userBranchId, assignedBranches)
  );
}

export function vaultCanReadFileMetadata({
  vaultRole,
  primaryBranchId,
  brandWide,
  department,
  sensitivityLevel,
  userBranchId,
  assignedBranches = [],
  extraDepartments = [],
}) {
  return vaultCanReadScope({
    vaultRole,
    primaryBranchId,
    brandWide,
    department,
    sensitivityLevel,
    userBranchId,
    assignedBranches,
    extraDepartments,
  });
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
      extraDepartments: accessContext.extraDepartments,
    }),
  );
}

export function vaultCanUploadBrandWide(vaultRole) {
  return VAULT_BRAND_WIDE_UPLOAD_ROLES.has(vaultRole);
}

export function vaultCanUploadToBranch(vaultRole, branchValue, primaryBranchId, assignedBranches = []) {
  if (!vaultRole || vaultRole === "staff") return false;
  if (branchValue === "brand") return vaultCanUploadBrandWide(vaultRole);
  if (VAULT_CROSS_BRANCH_ROLES.has(vaultRole)) return true;
  if (vaultRole === "ops_manager") return true;
  if (assignedBranches.length) return assignedBranches.includes(normalizeBranchId(branchValue));
  return normalizeBranchId(branchValue) === normalizeBranchId(primaryBranchId);
}

/** Facts inherit file scope — verify row matches readable file metadata. */
export function vaultFactMatchesFileScope(fact, file) {
  if (!fact || !file) return false;
  return (
    fact.file_id === file.id &&
    Boolean(fact.brand_wide) === Boolean(file.brand_wide) &&
    normalizeBranchId(fact.branch_id) === normalizeBranchId(file.primary_branch_id) &&
    fact.department === file.department &&
    fact.sensitivity_level === file.sensitivity_level
  );
}

export function filterFactsForVaultRole(facts, files, accessContext) {
  const readableFiles = new Map(
    filterFilesForVaultRole(files, accessContext).map((file) => [file.id, file]),
  );
  return (facts || []).filter((fact) => {
    const file = readableFiles.get(fact.file_id);
    if (!file) return false;
    return vaultCanReadScope({
      vaultRole: accessContext.vaultRole,
      primaryBranchId: fact.branch_id,
      brandWide: fact.brand_wide,
      department: fact.department,
      sensitivityLevel: fact.sensitivity_level,
      userBranchId: accessContext.primaryBranchId,
      assignedBranches: accessContext.assignedBranches,
      extraDepartments: accessContext.extraDepartments,
    });
  });
}
