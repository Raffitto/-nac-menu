/**
 * RLS contract mirror for external context (Edge).
 */

export function mapObservationSensitivityToVault(level = "internal") {
  const normalized = String(level).toLowerCase().trim();
  if (normalized === "confidential") return "management";
  return normalized || "internal";
}

export function canReadExternalContextSignal(
  scope: {
    hasAllBranches: boolean;
    hasAnyBranchAccess: boolean;
    branchAllowed: (branchId: string | null) => boolean;
  },
  row: { branch_id?: string | null; applies_to_all_branches?: boolean } = {},
) {
  if (scope.hasAllBranches) return true;
  if (row.applies_to_all_branches && scope.hasAnyBranchAccess) return true;
  if (row.branch_id && scope.branchAllowed(row.branch_id)) return true;
  return false;
}

export function canReadCompetitor(
  scope: { hasAllBranches: boolean; branchAllowed: (branchId: string | null) => boolean },
  row: { branch_id?: string | null } = {},
) {
  if (scope.hasAllBranches) return true;
  if (row.branch_id == null) return false;
  return scope.branchAllowed(row.branch_id);
}

export function canReadCompetitorObservation(
  scope: {
    branchAllowed: (branchId: string | null) => boolean;
    canReadSensitivity?: (level: string) => boolean;
  },
  row: { branch_id?: string; sensitivity_level?: string } = {},
) {
  if (!row.branch_id || !scope.branchAllowed(row.branch_id)) return false;
  const vaultLevel = mapObservationSensitivityToVault(row.sensitivity_level);
  if (scope.canReadSensitivity) return scope.canReadSensitivity(vaultLevel);
  return vaultLevel === "public" || vaultLevel === "internal";
}
