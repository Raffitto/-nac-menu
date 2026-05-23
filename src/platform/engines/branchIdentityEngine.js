/**
 * Branch identity — canonical IDs, RPC filters, and UI options.
 */

export {
  CANONICAL_BRANCH_IDS,
  normalizeBranchId,
  normalizeBranchForRpc,
  branchDisplayName,
  defaultBranchId,
  aggregateByCanonicalBranch,
  buildCanonicalBranchComparison,
} from "../../dashboard/utils/branchIdentity";

import {
  CANONICAL_BRANCH_IDS,
  branchDisplayName,
  normalizeBranchId,
} from "../../dashboard/utils/branchIdentity";

/** Selectors / filters across intelligence modules */
export const BRANCH_OPTIONS = CANONICAL_BRANCH_IDS.map((id) => ({
  id,
  label: branchDisplayName(id),
}));

/** Tracking default when branch is unknown (never use for aggregation buckets). */
export function defaultBranchForTracking() {
  return normalizeBranchId(process.env.REACT_APP_NAC_BRANCH_ID) || "khobar";
}
