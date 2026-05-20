/** Primary platform navigation — maps sidebar to views and legacy adminView keys. */

export const NAV_ITEMS = [
  { id: "overview", label: "Overview", legacyViews: ["overview", "analytics"] },
  { id: "intelligence", label: "Intelligence", legacyViews: ["ai-insights", "restaurant-intelligence", "sales-intelligence"] },
  { id: "reviews", label: "Reviews", legacyViews: ["reviews"] },
  { id: "menu", label: "Menu", legacyViews: ["menu-manager"] },
  { id: "branches", label: "Branches", legacyViews: ["branches"] },
  { id: "settings", label: "Settings", legacyViews: ["settings"] },
];

export const INTELLIGENCE_TABS = [
  { id: "ai", label: "AI Insights" },
  { id: "visual", label: "Visual OS" },
  { id: "restaurant", label: "Restaurant" },
  { id: "imports", label: "Sales Imports" },
  { id: "sales", label: "Foodics" },
  { id: "menu", label: "Menu Intelligence" },
  { id: "predictive", label: "Predictive" },
  { id: "operations", label: "Operations" },
  { id: "competitive", label: "Competitive Watch" },
];

export const REVIEWS_TABS = [
  { id: "performance", label: "Performance" },
  { id: "live", label: "Live Activity" },
  { id: "team", label: "Team" },
  { id: "branches", label: "Branch Battle" },
];

export const OVERVIEW_TABS = [
  { id: "operations", label: "Operations" },
  { id: "sessions", label: "Session Analytics" },
];

export function navIdFromLegacyView(view) {
  const v = view || "overview";
  const hit = NAV_ITEMS.find((n) => n.legacyViews.includes(v));
  return hit?.id || "overview";
}

export function isScrollableView(view) {
  return [
    "overview",
    "analytics",
    "intelligence",
    "ai-insights",
    "restaurant-intelligence",
    "sales-intelligence",
    "reviews",
    "menu-manager",
    "menu",
    "branches",
    "settings",
  ].includes(view);
}
