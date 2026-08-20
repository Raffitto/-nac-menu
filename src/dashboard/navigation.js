/** Primary platform navigation — maps sidebar to views and legacy adminView keys. */

import { isUnifiedOverviewEnabled } from "./config/unifiedOverview";

export const NAV_ITEMS = [
  { id: "overview", label: "Overview", legacyViews: ["overview", "analytics"] },
  { id: "intelligence", label: "Intelligence", legacyViews: ["ai-insights", "restaurant-intelligence", "sales-intelligence"] },
  { id: "reviews", label: "Reviews", legacyViews: ["reviews"] },
  { id: "menu", label: "Menu", legacyViews: ["menu-manager"] },
  { id: "food-bible", label: "Food Bible", legacyViews: ["food-bible", "recipes"] },
  { id: "branches", label: "Branches", legacyViews: ["branches"] },
  { id: "settings", label: "Settings", legacyViews: ["settings"] },
];

/** Visible Intelligence hub tabs (Phase B — simplified navigation). */
export const INTELLIGENCE_TABS = [
  { id: "ask", label: "Ask NAC" },
  { id: "executive", label: "Command Center" },
  { id: "restaurant", label: "Restaurant Intelligence" },
  { id: "sales", label: "Sales Intelligence" },
  { id: "menu", label: "Menu Intelligence" },
  { id: "visual", label: "Visual OS" },
  { id: "competitive", label: "Competitive Watch" },
];

/**
 * Legacy tab ids → canonical hub tab (backward compatibility for bookmarks, RBAC tests, deep links).
 * Removed tabs: predictive → ask; operations → restaurant; imports → sales; ai → ask.
 */
export const INTELLIGENCE_TAB_ALIASES = {
  ai: "ask",
  imports: "sales",
  operations: "restaurant",
  predictive: "ask",
};

/** @deprecated use INTELLIGENCE_TAB_ALIASES — kept for import stability */
export const LEGACY_INTELLIGENCE_TAB_IDS = Object.keys(INTELLIGENCE_TAB_ALIASES);

export function normalizeIntelligenceTabId(tabId) {
  if (!tabId) return "ask";
  const key = String(tabId).toLowerCase();
  return INTELLIGENCE_TAB_ALIASES[key] || key;
}

export function isLegacyIntelligenceTabId(tabId) {
  return LEGACY_INTELLIGENCE_TAB_IDS.includes(String(tabId || "").toLowerCase());
}

export const REVIEWS_TABS = [
  { id: "performance", label: "Performance" },
  { id: "live", label: "Live Activity" },
  { id: "team", label: "Team" },
  { id: "branches", label: "Branch Battle" },
];

export const OVERVIEW_TABS_LEGACY = [
  { id: "operations", label: "Operations" },
  { id: "sessions", label: "Session Analytics" },
];

/** Empty when unified overview is enabled (single dashboard, no sub-tabs). */
export const OVERVIEW_TABS = isUnifiedOverviewEnabled() ? [] : OVERVIEW_TABS_LEGACY;

export function navIdFromLegacyView(view) {
  const v = view || "overview";
  const hit = NAV_ITEMS.find((n) => n.legacyViews.includes(v));
  return hit?.id || "overview";
}

/** Bottom navigation for mobile Intelligence shell (UI only). */
export const MOBILE_INTELLIGENCE_NAV = [
  { id: "ask", label: "Ask NAC" },
  { id: "dashboards", label: "Dashboards" },
  { id: "vault", label: "Vault" },
  { id: "settings", label: "Settings" },
];

/** Sections reachable from the mobile Ask NAC “More” menu. */
export const MOBILE_INTELLIGENCE_MORE_SECTIONS = MOBILE_INTELLIGENCE_NAV.filter(
  (item) => item.id !== "ask",
);

export const MOBILE_INTELLIGENCE_DASHBOARD_TAB_IDS = INTELLIGENCE_TABS.filter(
  (tab) => tab.id !== "ask",
).map((tab) => tab.id);

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
    "food-bible",
    "recipes",
    "branches",
    "settings",
  ].includes(view);
}

export function adminViewFromLocation(fallback = "overview") {
  if (typeof window === "undefined") return fallback;
  const view = new URLSearchParams(window.location.search).get("view");
  if (!view) return fallback;
  const match = NAV_ITEMS.find((item) => item.id === view || item.legacyViews.includes(view));
  return match?.id || fallback;
}

export function syncAdminViewLocation(view) {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  if (params.get("view") === view) return;
  params.set("view", view);
  const next = `${window.location.pathname}?${params.toString()}`;
  window.history.replaceState({}, "", next);
}
