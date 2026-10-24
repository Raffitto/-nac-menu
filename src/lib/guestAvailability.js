/** Explicit branch-scoped availability policy. Never infer stock from a route or source catalogue. */
export function applyGuestAvailability(item, requestedBranchId, overrides = []) {
  if (!item || !requestedBranchId) return item;
  const matches = overrides.filter((rule) =>
    rule.itemId === item.id && rule.branchId === requestedBranchId
    && (!rule.sourceBranchId || !item.branch_id || item.branch_id === rule.sourceBranchId),
  );
  // Missing or contradictory decisions leave stored state authoritative.
  if (matches.length !== 1 || typeof matches[0].soldOut !== "boolean") return item;
  if (item.soldOut === matches[0].soldOut) return item;
  return { ...item, soldOut: matches[0].soldOut };
}
