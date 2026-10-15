/**
 * Branch gate for operational sales queries (Foodics and Cash Up).
 * Review-tracking permissions are not decided here.
 * Missing profile, staff, or branch permissions are denied.
 * Company-wide access is allowed only when authenticated and allBranches is exactly true.
 */

const BRANCH_ORDER = ["khobar", "riyadh", "jeddah"];

export function normalizeSalesBranch(value) {
  const raw = String(value || "").toLowerCase();
  if (!raw || raw === "all" || raw === "network" || raw === "brand") return null;
  if (raw.includes("khobar")) return "khobar";
  if (raw.includes("riyadh")) return "riyadh";
  if (raw.includes("jeddah") || raw.includes("jedda")) return "jeddah";
  return null;
}

function sortBranches(ids) {
  return BRANCH_ORDER.filter((id) => ids.includes(id));
}

/**
 * @returns {{
 *   ok: boolean,
 *   deniedBranch: string | null,
 *   allowedBranches: string[],
 *   branches: string[],
 *   unrestricted: boolean,
 *   companyWide: boolean,
 * }}
 */
export function authorizeSalesBranches(profile, { mentionedBranch, filterBranch } = {}) {
  const mentioned = normalizeSalesBranch(mentionedBranch);
  const filter = normalizeSalesBranch(filterBranch);
  const requested = mentioned || filter;

  if (!profile || profile.authenticated !== true) {
    return {
      ok: false,
      deniedBranch: requested,
      allowedBranches: [],
      branches: [],
      unrestricted: false,
      companyWide: false,
    };
  }

  if (profile.allBranches === true) {
    if (requested && !BRANCH_ORDER.includes(requested)) {
      return {
        ok: false,
        deniedBranch: requested,
        allowedBranches: [...BRANCH_ORDER],
        branches: [],
        unrestricted: false,
        companyWide: false,
      };
    }
    return {
      ok: true,
      deniedBranch: null,
      allowedBranches: [...BRANCH_ORDER],
      branches: requested ? [requested] : [...BRANCH_ORDER],
      unrestricted: false,
      companyWide: !requested,
    };
  }

  const allowed = [];
  const scope = normalizeSalesBranch(profile.branchScope);
  if (scope && !allowed.includes(scope)) allowed.push(scope);
  for (const id of profile.allowedBranchIds || []) {
    const normalized = normalizeSalesBranch(id);
    if (normalized && !allowed.includes(normalized)) allowed.push(normalized);
  }
  const allowedBranches = sortBranches(allowed);

  if (mentioned && filter && mentioned !== filter) {
    return {
      ok: false,
      deniedBranch: mentioned,
      allowedBranches,
      branches: [],
      unrestricted: false,
      companyWide: false,
    };
  }

  if (!allowedBranches.length || (requested && !allowedBranches.includes(requested))) {
    return {
      ok: false,
      deniedBranch: requested,
      allowedBranches,
      branches: [],
      unrestricted: false,
      companyWide: false,
    };
  }

  return {
    ok: true,
    deniedBranch: null,
    allowedBranches,
    branches: requested ? [requested] : allowedBranches,
    unrestricted: false,
    companyWide: !requested && allowedBranches.length > 1,
  };
}

export function salesQueryDenied(profile, scope = {}) {
  const decision = authorizeSalesBranches(profile, scope);
  return decision.ok ? null : decision;
}
