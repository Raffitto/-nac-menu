/**
 * Menu CMS branch scoping — query filters + RBAC enforcement for MenuManager.
 */

import { normalizeBranchId } from "../dashboard/utils/branchIdentity";
import { PERMISSIONS } from "../dashboard/config/rbac";

export function resolveMenuEditorBranch(rbacProfile, requestedBranch) {
  if (!rbacProfile?.authenticated) {
    return normalizeBranchId(requestedBranch) || "khobar";
  }
  if (rbacProfile.allBranches) {
    return normalizeBranchId(requestedBranch) || "khobar";
  }
  return rbacProfile.branchScope || normalizeBranchId(requestedBranch) || "khobar";
}

export function canEditMenuEngineering(rbacProfile) {
  if (!rbacProfile?.authenticated) return false;
  return (rbacProfile.permissions || []).includes(PERMISSIONS.MANAGE_MENU);
}

export function canViewMenuEngineering(rbacProfile) {
  if (!rbacProfile?.authenticated) return false;
  return (
    (rbacProfile.permissions || []).includes(PERMISSIONS.VIEW_MENU) ||
    (rbacProfile.permissions || []).includes(PERMISSIONS.MANAGE_MENU)
  );
}

export function assertMenuBranchAccess(rbacProfile, branchId) {
  const target = normalizeBranchId(branchId);
  if (!target) throw new Error("Invalid branch for menu operation.");
  if (!rbacProfile?.authenticated) return target;
  if (rbacProfile.allBranches) return target;
  if (rbacProfile.branchScope !== target) {
    throw new Error("You can only edit menu data for your assigned branch.");
  }
  return target;
}

export function menuBranchQueryFilter(query, branchId, column = "branch_id") {
  const id = normalizeBranchId(branchId);
  if (!id) return query;
  return query.eq(column, id);
}
