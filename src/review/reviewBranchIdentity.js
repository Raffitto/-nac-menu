/** Reviews use the existing branch identities, independent of guest-menu activation. */
import {
  CANONICAL_BRANCH_IDS,
  buildCanonicalBranchComparison,
  normalizeBranchId,
} from '../dashboard/utils/branchIdentity';
import { branchDashboardName, branchPublicName } from '../dashboard/config/branchDisplayConfig';

export function normalizeReviewBranchId(raw) {
  if (raw != null && /hettin|hittin|حطين/i.test(String(raw))) return 'hettin';
  return normalizeBranchId(raw);
}

export function reviewBranchDisplayName(raw) {
  const id = normalizeReviewBranchId(raw);
  return id ? branchDashboardName(id) : 'Unassigned';
}

export const REVIEW_BRANCH_IDS = [...CANONICAL_BRANCH_IDS];
export const REVIEW_BRANCH_OPTIONS = REVIEW_BRANCH_IDS.map(id => ({
  id, label: branchPublicName(id),
}));

export function buildReviewBranchComparison(rows = [], defaults = {}) {
  return buildCanonicalBranchComparison(rows, defaults);
}
