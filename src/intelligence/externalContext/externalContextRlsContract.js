/**
 * Mirrors SQL RLS helper semantics for tests and app-side documentation.
 * Keep in sync with supabase/migrations/20260621180000_external_context_and_whatsapp_foundation.sql
 */

export const KNOWN_BRANCH_IDS = Object.freeze(["khobar", "riyadh", "jeddah"]);

export const COMPETITOR_OBSERVATION_SENSITIVITY = Object.freeze({
  PUBLIC: "public",
  INTERNAL: "internal",
  MANAGEMENT: "management",
  CONFIDENTIAL: "confidential",
});

/**
 * @typedef {Object} VaultAccessScope
 * @property {boolean} hasAllBranches
 * @property {boolean} hasAnyBranchAccess
 * @property {(branchId: string|null) => boolean} branchAllowed
 * @property {(level: string) => boolean} [canReadSensitivity]
 */

/**
 * Maps observation sensitivity to vault matrix level (confidential → management).
 * @param {string} level
 */
export function mapObservationSensitivityToVault(level = "internal") {
  const normalized = String(level).toLowerCase().trim();
  if (normalized === COMPETITOR_OBSERVATION_SENSITIVITY.CONFIDENTIAL) return "management";
  if (KNOWN_BRANCH_IDS.includes(normalized)) return "internal";
  return normalized || "internal";
}

/**
 * SQL: ask_nac_external_context_branch_allowed
 * @param {VaultAccessScope} scope
 * @param {{ branch_id?: string|null, applies_to_all_branches?: boolean }} row
 */
export function canReadExternalContextSignal(scope, row = {}) {
  if (scope.hasAllBranches) return true;
  if (row.applies_to_all_branches && scope.hasAnyBranchAccess) return true;
  if (row.branch_id && scope.branchAllowed(row.branch_id)) return true;
  return false;
}

/**
 * SQL: ask_nac_external_context_can_write
 * @param {VaultAccessScope} scope
 * @param {{ branch_id?: string|null, applies_to_all_branches?: boolean }} row
 */
export function canWriteExternalContextSignal(scope, row = {}) {
  if (scope.hasAllBranches) return true;
  if (row.applies_to_all_branches) return false;
  if (!row.branch_id) return false;
  return scope.branchAllowed(row.branch_id);
}

/**
 * SQL: ask_nac_competitors_can_read
 * @param {VaultAccessScope} scope
 * @param {{ branch_id?: string|null }} row
 */
export function canReadCompetitor(scope, row = {}) {
  if (scope.hasAllBranches) return true;
  if (row.branch_id == null) return false;
  return scope.branchAllowed(row.branch_id);
}

/**
 * SQL: ask_nac_competitor_observation_can_read
 * @param {VaultAccessScope} scope
 * @param {{ branch_id?: string, sensitivity_level?: string }} row
 */
export function canReadCompetitorObservation(scope, row = {}) {
  if (!row.branch_id || !scope.branchAllowed(row.branch_id)) return false;
  const vaultLevel = mapObservationSensitivityToVault(row.sensitivity_level);
  if (scope.canReadSensitivity) return scope.canReadSensitivity(vaultLevel);
  return vaultLevel === "public" || vaultLevel === "internal";
}

/**
 * Validates external_context_signals row matches CHECK scope constraint.
 * @param {Record<string, unknown>} row
 */
export function validateExternalContextSignalScope(row = {}) {
  const allBranch = row.applies_to_all_branches === true;
  const branchId = row.branch_id ?? null;
  if (allBranch && branchId == null) return { valid: true };
  if (!allBranch && branchId != null) return { valid: true };
  return {
    valid: false,
    errors: [
      "Invalid scope: network signals require applies_to_all_branches=true and branch_id=null; "
      + "branch signals require branch_id set and applies_to_all_branches=false.",
    ],
  };
}

/**
 * @param {string[]} allowedBranchIds
 */
export function validateWhatsAppAllowedBranchIds(allowedBranchIds = []) {
  const invalid = allowedBranchIds.filter((id) => !KNOWN_BRANCH_IDS.includes(id));
  return { valid: invalid.length === 0, invalid };
}
