/**
 * Physical inventory location for a branch.
 * Kitchen and bar roles are responsibility scopes, not separate docks.
 * This precedence matches inventory_resolve_receiving_location in Postgres.
 */

export function isOperationalReceivingLocation(location) {
  if (!location || location.active === false) return false;
  return !/\b(e2e test|inv-ocr-verify|verification receiving)\b/i.test(String(location.name || ""));
}

export function resolveReceivingLocation({
  explicitLocationId = null,
  locations = [],
  branchId = null,
} = {}) {
  const inBranch = (locations || []).filter((location) => (
    !branchId || !location.branch_id || location.branch_id === branchId
  ));
  const operational = inBranch.filter(isOperationalReceivingLocation);
  const explicit = operational.find((location) => location.id === explicitLocationId);
  if (explicit) return { location: explicit, source: "explicit", requiresChoice: false };
  const defaults = operational.filter((location) => location.is_default_receiving);
  if (defaults.length === 1) return { location: defaults[0], source: "default", requiresChoice: false };
  if (operational.length === 1) return { location: operational[0], source: "only", requiresChoice: false };
  if (!operational.length) return { location: null, source: "missing", requiresChoice: false };
  return { location: null, source: "choice", requiresChoice: true };
}
