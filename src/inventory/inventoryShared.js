export const INVENTORY_BRANCHES = Object.freeze([
  { id: "khobar", label: "Khobar" },
  { id: "riyadh", label: "Riyadh" },
  { id: "jeddah", label: "Jeddah" },
]);

export const INVENTORY_TABS = Object.freeze([
  { id: "invoices", label: "Invoice Review" },
  { id: "ingredients", label: "Ingredients" },
]);

export function inventoryBranchFromLocation(defaultBranch = "khobar") {
  if (typeof window === "undefined") return defaultBranch;
  const requested = new URLSearchParams(window.location.search).get("branch");
  return INVENTORY_BRANCHES.some(({ id }) => id === requested) ? requested : defaultBranch;
}

export function inventoryTabFromLocation(defaultTab = "invoices") {
  if (typeof window === "undefined") return defaultTab;
  const requested = new URLSearchParams(window.location.search).get("view");
  return INVENTORY_TABS.some(({ id }) => id === requested) ? requested : defaultTab;
}

export function syncInventoryLocation({ branchId, activeTab }) {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  params.set("branch", branchId);
  params.set("view", activeTab);
  const next = `/inventory?${params.toString()}`;
  if (`${window.location.pathname}${window.location.search}` !== next) {
    window.history.replaceState({}, "", next);
  }
}
