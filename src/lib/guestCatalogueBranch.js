/** Guest menus read one catalogue. Each branch's menu_items rows stay in place. */
export const SHARED_GUEST_CATALOGUE_BRANCH_ID = "khobar";

/**
 * Khobar is the shared guest menu until a branch maintains its own catalogue again.
 * Set REACT_APP_GUEST_CATALOGUE_MODE=branch only after branch parity approval.
 * The explicit shareKhobar option remains available for tests and controlled callers.
 */
export function guestCatalogueBranchId(requestedBranchId, {
  shareKhobar = process.env.REACT_APP_GUEST_CATALOGUE_MODE !== "branch",
} = {}) {
  if (!shareKhobar) {
    if (!["khobar", "riyadh", "jeddah"].includes(requestedBranchId)) {
      throw new Error("A valid branch is required for the independent guest catalogue.");
    }
    return requestedBranchId;
  }
  return SHARED_GUEST_CATALOGUE_BRANCH_ID;
}
