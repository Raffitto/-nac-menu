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

/** Visible Intelligence hub primary tabs (manager-facing taxonomy). */
export const INTELLIGENCE_TABS = [
  { id: "ask", label: "Ask NAC" },
  { id: "operations", label: "Operations" },
  { id: "commercial", label: "Commercial" },
  { id: "market", label: "Market" },
  { id: "knowledge", label: "Knowledge" },
];

/** Secondary tabs under each primary area (only where real views map). */
export const INTELLIGENCE_SECONDARY_TABS = {
  operations: [
    { id: "overview", label: "Overview" },
    { id: "staff", label: "Staff & Reviews" },
    { id: "diagnostics", label: "Diagnostics" },
  ],
  commercial: [
    { id: "sales", label: "Sales" },
    { id: "menu", label: "Menu" },
  ],
  market: [
    { id: "visual", label: "Visual" },
    { id: "competitors", label: "Competitors" },
  ],
};

export const INTELLIGENCE_SECONDARY_DEFAULTS = {
  operations: "overview",
  commercial: "sales",
  market: "visual",
};

/**
 * Legacy / deep-link tab ids → new primary tab.
 * Old module names remain as aliases so bookmarks keep working.
 */
export const INTELLIGENCE_TAB_ALIASES = {
  ai: "ask",
  predictive: "ask",
  executive: "operations",
  restaurant: "operations",
  sales: "commercial",
  imports: "commercial",
  foodics: "commercial",
  menu: "commercial",
  visual: "market",
  competitive: "market",
  vault: "knowledge",
  "company-knowledge": "knowledge",
  "data-vault": "knowledge",
};

/** Legacy raw id → secondary destination under the mapped primary. */
export const INTELLIGENCE_SECONDARY_ALIASES = {
  executive: "overview",
  restaurant: "staff",
  sales: "sales",
  imports: "sales",
  foodics: "sales",
  menu: "menu",
  visual: "visual",
  competitive: "competitors",
};

/** @deprecated use INTELLIGENCE_TAB_ALIASES — kept for import stability */
export const LEGACY_INTELLIGENCE_TAB_IDS = Object.keys(INTELLIGENCE_TAB_ALIASES);

export function normalizeIntelligenceTabId(tabId) {
  if (!tabId) return "ask";
  const key = String(tabId).toLowerCase();
  if (INTELLIGENCE_TABS.some((tab) => tab.id === key)) return key;
  return INTELLIGENCE_TAB_ALIASES[key] || key;
}

export function isLegacyIntelligenceTabId(tabId) {
  return LEGACY_INTELLIGENCE_TAB_IDS.includes(String(tabId || "").toLowerCase());
}

export function getIntelligenceSecondaryTabs(primaryId) {
  return INTELLIGENCE_SECONDARY_TABS[primaryId] || [];
}

/**
 * Resolve primary + secondary destination from a tab id (canonical or legacy).
 */
export function resolveIntelligenceDestination(tabId) {
  const raw = String(tabId || "ask").toLowerCase();
  const primary = normalizeIntelligenceTabId(raw);
  const secondaryTabs = getIntelligenceSecondaryTabs(primary);
  if (!secondaryTabs.length) {
    return { primary, secondary: null };
  }

  const hinted = INTELLIGENCE_SECONDARY_ALIASES[raw];
  if (hinted && secondaryTabs.some((tab) => tab.id === hinted)) {
    return { primary, secondary: hinted };
  }

  return {
    primary,
    secondary: INTELLIGENCE_SECONDARY_DEFAULTS[primary] || secondaryTabs[0].id,
  };
}

/** Cmd/Ctrl+K destinations for the Intelligence hub. */
export const INTELLIGENCE_NAV_COMMANDS = [
  { id: "ask", label: "Go to Ask NAC", primary: "ask", secondary: null },
  { id: "operations", label: "Go to Operations", primary: "operations", secondary: null },
  { id: "commercial", label: "Go to Commercial", primary: "commercial", secondary: null },
  { id: "market", label: "Go to Market", primary: "market", secondary: null },
  { id: "knowledge", label: "Go to Knowledge", primary: "knowledge", secondary: null },
  { id: "sales", label: "Go to Sales", primary: "commercial", secondary: "sales" },
  { id: "menu", label: "Go to Menu", primary: "commercial", secondary: "menu" },
  { id: "competitors", label: "Go to Competitors", primary: "market", secondary: "competitors" },
];

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
  window.history.replaceState({}, "", `${window.location.pathname}?${params.toString()}`);
}
