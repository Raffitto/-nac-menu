/**
 * Centralized branch identity — stable internal IDs + configurable display names.
 * Internal branch_id remains stable for RBAC, analytics, imports, and historical records.
 */

import { CANONICAL_BRANCH_IDS, normalizeBranchId } from "../utils/branchIdentity";
import { OFFICIAL_BRANCH_NAMES } from "./branchNames";

/** @typedef {'publicName'|'dashboardName'|'exportName'} BranchDisplayField */

export const BRANCH_DISPLAY_CONFIG = {
  hettin: { id: "hettin", city: "Riyadh", publicName: OFFICIAL_BRANCH_NAMES.hettin, publicNameAr: "ناك حطين", dashboardName: OFFICIAL_BRANCH_NAMES.hettin, exportName: OFFICIAL_BRANCH_NAMES.hettin, routeSlug: "hettin", legacyLabels: [] },
  khobar: {
    id: "khobar",
    city: "Khobar",
    // The guest-menu brand header remains NAC; branch-facing labels use the official name.
    publicName: "NAC",
    publicNameAr: "NAC",
    dashboardName: OFFICIAL_BRANCH_NAMES.khobar,
    exportName: OFFICIAL_BRANCH_NAMES.khobar,
    routeSlug: "khobar",
    legacyLabels: ["NAC Khobar", "Khobar", "الخبر"],
  },
  riyadh: {
    id: "riyadh",
    city: "Riyadh",
    publicName: OFFICIAL_BRANCH_NAMES.riyadh,
    publicNameAr: "ناك ليسن فالي",
    dashboardName: OFFICIAL_BRANCH_NAMES.riyadh,
    exportName: OFFICIAL_BRANCH_NAMES.riyadh,
    routeSlug: "riyadh",
    legacyLabels: ["NAC Riyadh", "Riyadh", "الرياض"],
  },
  jeddah: {
    id: "jeddah",
    city: "Jeddah",
    publicName: OFFICIAL_BRANCH_NAMES.jeddah,
    publicNameAr: "NAC جدة",
    dashboardName: OFFICIAL_BRANCH_NAMES.jeddah,
    exportName: OFFICIAL_BRANCH_NAMES.jeddah,
    routeSlug: "jeddah",
    legacyLabels: ["NAC Jeddah", "Jeddah", "جدة"],
  },
};

export const BRANCH_ROUTE_SLUGS = CANONICAL_BRANCH_IDS.map(
  (id) => BRANCH_DISPLAY_CONFIG[id].routeSlug,
);

export function getBranchDisplayConfig(branchId) {
  const id = normalizeBranchId(branchId);
  return id ? BRANCH_DISPLAY_CONFIG[id] : null;
}

export function branchPublicName(branchId, { lang = "en" } = {}) {
  const cfg = getBranchDisplayConfig(branchId);
  if (!cfg) return "NAC";
  return lang === "ar" ? cfg.publicNameAr : cfg.publicName;
}

export function branchDashboardName(branchId) {
  return getBranchDisplayConfig(branchId)?.dashboardName || "Unassigned";
}

export function branchExportName(branchId) {
  return getBranchDisplayConfig(branchId)?.exportName || branchDashboardName(branchId);
}

/** Future public link readiness — /khobar, /riyadh, /jeddah (not fully routed yet). */
export function resolvePublicBranchFromLocation(loc = typeof window !== "undefined" ? window.location : null) {
  if (!loc) return normalizeBranchId(process.env.REACT_APP_NAC_BRANCH_ID) || "khobar";
  const path = String(loc.pathname || "").replace(/\/$/, "").toLowerCase();
  for (const id of CANONICAL_BRANCH_IDS) {
    const slug = BRANCH_DISPLAY_CONFIG[id].routeSlug;
    if (path === `/${slug}` || path.endsWith(`/${slug}`)) return id;
  }
  return normalizeBranchId(process.env.REACT_APP_NAC_BRANCH_ID) || "khobar";
}

export function publicMenuPathForBranch(branchId) {
  const cfg = getBranchDisplayConfig(branchId);
  return cfg ? `/${cfg.routeSlug}` : "/";
}

export function branchDisplayOptions(field = "dashboardName") {
  return CANONICAL_BRANCH_IDS.map((id) => ({
    value: id,
    label: BRANCH_DISPLAY_CONFIG[id][field] || id,
  }));
}
