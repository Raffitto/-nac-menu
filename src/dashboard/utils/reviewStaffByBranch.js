/**
 * Load staff performance rows with correct per-branch attribution (matches coaching signals).
 */

import { fetchReviewEventsSummary } from "../../lib/intelligenceQueryApi";
import { CANONICAL_BRANCH_IDS } from "./branchIdentity";
import { staffFromReviewSummary } from "./reviewSummaryMap";

export async function fetchStaffMergedByBranch(supabase, { hours, activeBranch = null } = {}) {
  if (!supabase) return [];

  const branchFilter = activeBranch ? String(activeBranch).trim().toLowerCase() : null;

  if (branchFilter) {
    const summary = await fetchReviewEventsSummary(supabase, {
      branch: branchFilter,
      hours,
    }).catch(() => null);
    return staffFromReviewSummary(summary || {}).map((s) => ({
      ...s,
      branch: s.branch || branchFilter,
    }));
  }

  const pairs = await Promise.all(
    CANONICAL_BRANCH_IDS.map(async (branchId) => {
      const summary = await fetchReviewEventsSummary(supabase, {
        branch: branchId,
        hours,
      }).catch(() => null);
      const staff = staffFromReviewSummary(summary || {}).map((s) => ({
        ...s,
        branch: s.branch || branchId,
      }));
      return staff;
    }),
  );

  return pairs.flat().sort((a, b) => b.scans - a.scans || b.google - a.google);
}
