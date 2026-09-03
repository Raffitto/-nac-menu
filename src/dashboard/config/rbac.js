/**
 * Centralized NAC OS RBAC — roles, permissions, branch scopes, and user resolution.
 * Extend RBAC_USER_DIRECTORY or REACT_APP_RBAC_USERS JSON for new staff / branches.
 */

import { CANONICAL_BRANCH_IDS, normalizeBranchId } from "../utils/branchIdentity";
import { branchDashboardName, branchExportName } from "./branchDisplayConfig";

export const RBAC_ROLES = {
  DEVELOPER: "developer",
  CEO: "ceo",
  BRANCH_GM: "branch_gm",
  RESTRICTED: "restricted",
};

export const PERMISSIONS = {
  VIEW_OVERVIEW: "view:overview",
  VIEW_INTELLIGENCE: "view:intelligence",
  VIEW_REVIEWS: "view:reviews",
  VIEW_REPORTS: "view:reports",
  VIEW_NETWORK_REVIEWS: "view:network_reviews",
  VIEW_MENU: "view:menu",
  VIEW_BRANCHES: "view:branches",
  VIEW_SETTINGS: "view:settings",
  VIEW_CROSS_BRANCH: "view:cross_branch",
  VIEW_COMMAND_CENTER: "view:command_center",
  VIEW_PREDICTIVE: "view:predictive",
  VIEW_COMPETITIVE: "view:competitive",
  VIEW_EXECUTIVE_EXPORT: "view:executive_export",
  MANAGE_IMPORTS: "manage:imports",
  MANAGE_MENU: "manage:menu",
  MANAGE_SYSTEM: "manage:system",
  EXPORT_DATA: "export:data",
};

const ALL_PERMISSIONS = Object.values(PERMISSIONS);

const CEO_PERMISSIONS = ALL_PERMISSIONS.filter(
  (p) => p !== PERMISSIONS.MANAGE_SYSTEM && p !== PERMISSIONS.MANAGE_MENU,
);

const BRANCH_GM_PERMISSIONS = [
  PERMISSIONS.VIEW_OVERVIEW,
  PERMISSIONS.VIEW_INTELLIGENCE,
  PERMISSIONS.VIEW_REVIEWS,
  PERMISSIONS.VIEW_REPORTS,
  PERMISSIONS.VIEW_MENU,
  PERMISSIONS.VIEW_SETTINGS,
  PERMISSIONS.VIEW_COMMAND_CENTER,
  PERMISSIONS.VIEW_PREDICTIVE,
  PERMISSIONS.VIEW_EXECUTIVE_EXPORT,
  PERMISSIONS.MANAGE_IMPORTS,
  PERMISSIONS.MANAGE_MENU,
  PERMISSIONS.EXPORT_DATA,
];

const RESTRICTED_PERMISSIONS = [PERMISSIONS.VIEW_SETTINGS];

export const ROLE_PERMISSIONS = {
  [RBAC_ROLES.DEVELOPER]: ALL_PERMISSIONS,
  [RBAC_ROLES.CEO]: CEO_PERMISSIONS,
  [RBAC_ROLES.BRANCH_GM]: BRANCH_GM_PERMISSIONS,
  [RBAC_ROLES.RESTRICTED]: RESTRICTED_PERMISSIONS,
};

/** Nav view → permission */
export const NAV_PERMISSIONS = {
  overview: PERMISSIONS.VIEW_OVERVIEW,
  intelligence: PERMISSIONS.VIEW_INTELLIGENCE,
  reviews: PERMISSIONS.VIEW_REVIEWS,
  reports: PERMISSIONS.VIEW_REPORTS,
  menu: PERMISSIONS.VIEW_MENU,
  "food-bible": PERMISSIONS.VIEW_MENU,
  branches: PERMISSIONS.VIEW_BRANCHES,
  settings: PERMISSIONS.VIEW_SETTINGS,
};

/** Intelligence hub tab → permission (canonical + legacy ids for alias resolution). */
export const INTELLIGENCE_TAB_PERMISSIONS = {
  ask: PERMISSIONS.VIEW_INTELLIGENCE,
  operations: PERMISSIONS.VIEW_INTELLIGENCE,
  commercial: PERMISSIONS.VIEW_INTELLIGENCE,
  market: PERMISSIONS.VIEW_INTELLIGENCE,
  knowledge: PERMISSIONS.VIEW_INTELLIGENCE,
  /** Legacy module ids — still honored via normalizeIntelligenceTabId */
  visual: PERMISSIONS.VIEW_INTELLIGENCE,
  restaurant: PERMISSIONS.VIEW_INTELLIGENCE,
  sales: PERMISSIONS.VIEW_INTELLIGENCE,
  menu: PERMISSIONS.VIEW_INTELLIGENCE,
  executive: PERMISSIONS.VIEW_COMMAND_CENTER,
  competitive: PERMISSIONS.VIEW_COMPETITIVE,
  ai: PERMISSIONS.VIEW_INTELLIGENCE,
  imports: PERMISSIONS.MANAGE_IMPORTS,
  predictive: PERMISSIONS.VIEW_PREDICTIVE,
  foodics: PERMISSIONS.VIEW_INTELLIGENCE,
};

/** Reviews hub tab → permission */
export const REVIEWS_TAB_PERMISSIONS = {
  performance: PERMISSIONS.VIEW_REVIEWS,
  live: PERMISSIONS.VIEW_REVIEWS,
  team: PERMISSIONS.VIEW_REVIEWS,
  branches: PERMISSIONS.VIEW_CROSS_BRANCH,
};

/**
 * Known NAC OS operators — match by normalized email.
 * Override / extend via REACT_APP_RBAC_USERS JSON in production.
 */
export const RBAC_USER_DIRECTORY = [
  {
    id: "raffi",
    name: "Raffi",
    role: RBAC_ROLES.DEVELOPER,
    emails: ["raffi@nac.com", "raffiazarian@gmail.com", "raffi@nac-khobar.com"],
    branchScope: null,
  },
  {
    id: "ahmad",
    name: "Ahmad",
    role: RBAC_ROLES.CEO,
    emails: ["ahmad@nac.com", "ahmad@nac-khobar.com"],
    branchScope: null,
  },
  {
    id: "fady",
    name: "Fady",
    role: RBAC_ROLES.BRANCH_GM,
    emails: ["fady@nac.com", "fady@nac-khobar.com", "fady.aly@nacriyadh.com"],
    branchScope: "khobar",
    permissions: [PERMISSIONS.VIEW_NETWORK_REVIEWS],
  },
  {
    id: "armel",
    name: "Armel",
    role: RBAC_ROLES.BRANCH_GM,
    emails: ["armel@nac.com", "armel@nac-riyadh.com"],
    branchScope: "riyadh",
  },
  {
    id: "usama",
    name: "Usama",
    role: RBAC_ROLES.BRANCH_GM,
    emails: ["usama@nac.com", "usama@nac-jeddah.com"],
    branchScope: "jeddah",
  },
];

function loadEnvUserDirectory() {
  try {
    const raw = process.env.REACT_APP_RBAC_USERS;
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeEmail(email) {
  return String(email || "")
    .trim()
    .toLowerCase();
}

function directoryEntryForEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;

  const matchesEmail = (entry) =>
    (entry?.emails || []).map(normalizeEmail).includes(normalized);
  const builtIn = RBAC_USER_DIRECTORY.find(matchesEmail) || null;
  const environment = loadEnvUserDirectory().find(matchesEmail) || null;
  if (!builtIn) return environment;
  if (!environment) return builtIn;

  return {
    ...builtIn,
    ...environment,
    emails: [...new Set([...(builtIn.emails || []), ...(environment.emails || [])])],
    permissions: [
      ...new Set([...(builtIn.permissions || []), ...(environment.permissions || [])]),
    ],
  };
}

export function permissionsForRole(role) {
  return ROLE_PERMISSIONS[role] || RESTRICTED_PERMISSIONS;
}

export function hasPermission(profile, permission) {
  if (!profile) return false;
  return (profile.permissions || []).includes(permission);
}

export function canAccessNav(profile, navId) {
  const perm = NAV_PERMISSIONS[navId];
  if (!perm) return false;
  if (!hasPermission(profile, perm)) return false;
  if (navId === "branches" && profile?.role === RBAC_ROLES.BRANCH_GM) return false;
  return true;
}

export function canAccessIntelligenceTab(profile, tabId) {
  const raw = String(tabId || "").toLowerCase();
  const normalized =
    raw === "ai" || raw === "predictive"
      ? "ask"
      : raw === "imports" || raw === "foodics" || raw === "sales" || raw === "menu"
        ? "commercial"
        : raw === "executive" || raw === "restaurant"
          ? "operations"
          : raw === "visual" || raw === "competitive"
            ? "market"
            : raw;

  if (normalized === "commercial" || raw === "sales" || raw === "imports" || raw === "foodics") {
    return (
      hasPermission(profile, PERMISSIONS.VIEW_INTELLIGENCE) ||
      hasPermission(profile, PERMISSIONS.MANAGE_IMPORTS)
    );
  }

  if (normalized === "operations" || raw === "executive") {
    return (
      hasPermission(profile, PERMISSIONS.VIEW_INTELLIGENCE) ||
      hasPermission(profile, PERMISSIONS.VIEW_COMMAND_CENTER)
    );
  }

  if (normalized === "market" || raw === "competitive" || raw === "visual") {
    // Market primary is available when any market surface is allowed; Competitors filtered separately.
    if (raw === "competitive") {
      return hasPermission(profile, PERMISSIONS.VIEW_COMPETITIVE);
    }
    return (
      hasPermission(profile, PERMISSIONS.VIEW_INTELLIGENCE) ||
      hasPermission(profile, PERMISSIONS.VIEW_COMPETITIVE)
    );
  }

  const perm = INTELLIGENCE_TAB_PERMISSIONS[normalized] || INTELLIGENCE_TAB_PERMISSIONS[raw];
  return perm ? hasPermission(profile, perm) : false;
}

/** Secondary Intelligence destinations (Overview / Sales / Competitors, etc.). */
export function canAccessIntelligenceSecondary(profile, primaryId, secondaryId) {
  const primary = String(primaryId || "").toLowerCase();
  const secondary = String(secondaryId || "").toLowerCase();
  if (!secondary) return true;

  if (primary === "operations" && secondary === "overview") {
    return (
      hasPermission(profile, PERMISSIONS.VIEW_COMMAND_CENTER) ||
      hasPermission(profile, PERMISSIONS.VIEW_INTELLIGENCE)
    );
  }
  if (primary === "market" && secondary === "competitors") {
    return hasPermission(profile, PERMISSIONS.VIEW_COMPETITIVE);
  }
  if (primary === "commercial" && secondary === "sales") {
    return (
      hasPermission(profile, PERMISSIONS.VIEW_INTELLIGENCE) ||
      hasPermission(profile, PERMISSIONS.MANAGE_IMPORTS)
    );
  }
  return canAccessIntelligenceTab(profile, primary);
}

export function canAccessReviewsTab(profile, tabId) {
  const perm = REVIEWS_TAB_PERMISSIONS[tabId];
  if (tabId === "branches" && hasPermission(profile, PERMISSIONS.VIEW_NETWORK_REVIEWS)) {
    return true;
  }
  return perm ? hasPermission(profile, perm) : false;
}

export function canAccessNetworkReviews(profile) {
  return (
    canAccessAllBranches(profile) ||
    hasPermission(profile, PERMISSIONS.VIEW_NETWORK_REVIEWS)
  );
}

export function reviewAllowedBranchIds(profile) {
  if (canAccessNetworkReviews(profile)) return [...CANONICAL_BRANCH_IDS];
  return allowedBranchIds(profile);
}

export function buildReviewBranchFilterOptions(profile) {
  const ids = reviewAllowedBranchIds(profile);
  const options = ids.map((id) => ({
    value: id,
    label: branchDashboardName(id),
  }));
  return canAccessNetworkReviews(profile)
    ? [{ value: "all", label: "All branches" }, ...options]
    : options;
}

export function canAccessAllBranches(profile) {
  if (!profile?.authenticated) return true;
  return Boolean(profile.allBranches);
}

export function allowedBranchIds(profile) {
  if (!profile?.authenticated) return [...CANONICAL_BRANCH_IDS];
  if (canAccessAllBranches(profile)) return [...CANONICAL_BRANCH_IDS];
  if (profile.branchScope) return [profile.branchScope];
  return [];
}

export function resolveEffectiveBranch(profile, requestedBranch) {
  if (!profile?.authenticated) {
    return normalizeBranchId(requestedBranch);
  }
  if (canAccessAllBranches(profile)) {
    return normalizeBranchId(requestedBranch);
  }
  return profile.branchScope || null;
}

export function isBranchAllowed(profile, branchId) {
  const id = normalizeBranchId(branchId);
  if (!id) return canAccessAllBranches(profile);
  return allowedBranchIds(profile).includes(id);
}

export function filterRowsByBranchScope(profile, rows = [], branchKey = "branch_id") {
  if (!profile?.authenticated || canAccessAllBranches(profile)) return rows || [];
  const allowed = new Set(allowedBranchIds(profile));
  return (rows || []).filter((row) => {
    const id = normalizeBranchId(row?.[branchKey] ?? row?.branch);
    return id && allowed.has(id);
  });
}

export function buildBranchFilterOptions(profile) {
  const ids = allowedBranchIds(profile);
  const options = ids.map((id) => ({
    value: id,
    label: branchDashboardName(id),
  }));
  if (canAccessAllBranches(profile)) {
    return [{ value: "all", label: "All branches" }, ...options];
  }
  return options;
}

export function buildExportBranchOptions(profile) {
  return allowedBranchIds(profile).map((id) => ({
    value: id,
    label: branchExportName(id),
  }));
}

/**
 * Resolve RBAC profile from Supabase session (or dev override).
 * @param {import('@supabase/supabase-js').Session|null} session
 */
export function resolveRbacProfile(session) {
  const devRole = process.env.REACT_APP_RBAC_DEV_ROLE;
  const devBranch = normalizeBranchId(process.env.REACT_APP_RBAC_DEV_BRANCH);
  if (devRole && process.env.NODE_ENV !== "production") {
    return buildProfileFromRole(devRole, devBranch, "dev@local");
  }

  const email = session?.user?.email || null;
  if (!email) {
    return {
      authenticated: false,
      email: null,
      name: null,
      role: RBAC_ROLES.RESTRICTED,
      permissions: [],
      branchScope: null,
      allBranches: true,
      rawEmail: null,
    };
  }

  const entry = directoryEntryForEmail(email);
  if (!entry) {
    return {
      authenticated: true,
      email,
      name: email.split("@")[0],
      role: RBAC_ROLES.RESTRICTED,
      permissions: RESTRICTED_PERMISSIONS,
      branchScope: null,
      allBranches: false,
      rawEmail: email,
      unmapped: true,
    };
  }

  const branchScope = normalizeBranchId(entry.branchScope);
  const role = entry.role || RBAC_ROLES.RESTRICTED;
  const allBranches = role === RBAC_ROLES.DEVELOPER || role === RBAC_ROLES.CEO;
  const permissions = [
    ...new Set([
      ...permissionsForRole(role),
      ...(Array.isArray(entry.permissions) ? entry.permissions : []),
    ]),
  ];

  return {
    authenticated: true,
    email,
    name: entry.name || email,
    role,
    permissions,
    branchScope: allBranches ? null : branchScope,
    allBranches,
    rawEmail: email,
    userId: entry.id,
  };
}

function buildProfileFromRole(role, branchScope, email) {
  const normalizedRole = Object.values(RBAC_ROLES).includes(role) ? role : RBAC_ROLES.RESTRICTED;
  const allBranches = normalizedRole === RBAC_ROLES.DEVELOPER || normalizedRole === RBAC_ROLES.CEO;
  const scope = allBranches ? null : branchScope;

  return {
    authenticated: true,
    email,
    name: "Dev Override",
    role: normalizedRole,
    permissions: permissionsForRole(normalizedRole),
    branchScope: scope,
    allBranches,
    rawEmail: email,
    devOverride: true,
  };
}

export function buildRbacScope(profile) {
  return {
    profile,
    branchIds: allowedBranchIds(profile),
    allBranches: canAccessAllBranches(profile),
    defaultBranch: profile?.branchScope || "khobar",
    effectiveBranch(requested) {
      return resolveEffectiveBranch(profile, requested);
    },
    filterRows(rows, branchKey) {
      return filterRowsByBranchScope(profile, rows, branchKey);
    },
    assertBranch(branchId) {
      const effective = resolveEffectiveBranch(profile, branchId);
      if (!effective && profile?.authenticated && !canAccessAllBranches(profile)) {
        throw new Error("Branch access denied");
      }
      return effective;
    },
  };
}
