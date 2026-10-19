/** Guest menus read one catalogue. Each branch's menu_items rows stay in place. */
export const SHARED_GUEST_CATALOGUE_BRANCH_ID = "khobar";

/**
 * Khobar is the shared guest menu until a branch maintains its own catalogue again.
 * Set shareKhobar to false to restore that branch's stored menu without a schema change.
 */
export function guestCatalogueBranchId(requestedBranchId, { shareKhobar = true } = {}) {
  if (!shareKhobar) return requestedBranchId || null;
  return SHARED_GUEST_CATALOGUE_BRANCH_ID;
}
