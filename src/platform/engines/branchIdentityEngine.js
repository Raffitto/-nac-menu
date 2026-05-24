/**
 * Branch identity — canonical IDs, RPC filters, and UI options.
 */

import {
  CANONICAL_BRANCH_IDS,
  normalizeBranchId,
  normalizeBranchForRpc,
  branchDisplayName,
  defaultBranchId,
  aggregateByCanonicalBranch,
  buildCanonicalBranchComparison,
  operationalBrandDisplay,
  normalizeOperationalBrandLabel,
} from "../../dashboard/utils/branchIdentity";

export {
  CANONICAL_BRANCH_IDS,
  normalizeBranchId,
  normalizeBranchForRpc,
  branchDisplayName,
  defaultBranchId,
  aggregateByCanonicalBranch,
  buildCanonicalBranchComparison,
  operationalBrandDisplay,
  normalizeOperationalBrandLabel,
};

/** Selectors / filters across intelligence modules */
export const BRANCH_OPTIONS = CANONICAL_BRANCH_IDS.map((id) => ({
  id,
  label: operationalBrandDisplay(id),
}));

/** Tracking default when branch is unknown (never use for aggregation buckets). */
export function defaultBranchForTracking() {
  return normalizeBranchId(process.env.REACT_APP_NAC_BRANCH_ID) || "khobar";
}
