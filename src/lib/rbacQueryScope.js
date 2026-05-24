/**
 * Server-side-style query scoping for Supabase reads — filter payloads, never leak hidden branches.
 */

import { normalizeBranchId } from "../dashboard/utils/branchIdentity";

export function applyBranchScopeToSupabaseQuery(query, profile, column = "branch_id") {
  if (!profile?.authenticated || profile.allBranches) return query;
  const ids = (profile.branchScope ? [profile.branchScope] : []).filter(Boolean);
  if (ids.length === 1) return query.eq(column, ids[0]);
  if (ids.length > 1) return query.in(column, ids);
  return query.eq(column, "__rbac_denied__");
}

export function filterRowsByRbacProfile(profile, rows = [], branchKey = "branch_id") {
  if (!profile?.authenticated || profile.allBranches) return rows || [];
  const allowed = new Set(
    profile.branchScope ? [profile.branchScope] : [],
  );
  if (!allowed.size) return [];
  return (rows || []).filter((row) => {
    const id = normalizeBranchId(row?.[branchKey] ?? row?.branch);
    return id && allowed.has(id);
  });
}

export function resolveRbacQueryBranch(profile, requestedBranch) {
  if (!profile?.authenticated || profile.allBranches) {
    return normalizeBranchId(requestedBranch);
  }
  return profile.branchScope || null;
}

export function canFetchCrossBranchComparison(profile) {
  if (!profile?.authenticated) return true;
  return Boolean(profile.allBranches);
}

export function guardCrossBranchFetch(profile) {
  if (!canFetchCrossBranchComparison(profile)) {
    return { allowed: false, data: [] };
  }
  return { allowed: true, data: null };
}
