/**
 * Branch gate for operational sales queries (Foodics and Cash Up).
 * Review-tracking permissions are not decided here.
 * Company-wide access stays allowed. A scoped user cannot read another branch.
 */

const BRANCH_ORDER = ["khobar", "riyadh", "jeddah"];

export function normalizeSalesBranch(value: unknown): string | null {
  const raw = String(value || "").toLowerCase();
  if (!raw || raw === "all" || raw === "network" || raw === "brand") return null;
  if (raw.includes("khobar")) return "khobar";
  if (raw.includes("riyadh")) return "riyadh";
  if (raw.includes("jeddah") || raw.includes("jedda")) return "jeddah";
  return null;
}

function sortBranches(ids: string[]) {
  return BRANCH_ORDER.filter((id) => ids.includes(id));
}

export type SalesBranchDecision = {
  ok: boolean;
  deniedBranch: string | null;
  allowedBranches: string[];
  branches: string[];
  unrestricted: boolean;
  companyWide: boolean;
};

export function authorizeSalesBranches(
  profile: { allBranches?: boolean | null; branchScope?: string | null; allowedBranchIds?: Array<string | null> | null; authenticated?: boolean | null } | null | undefined,
  { mentionedBranch, filterBranch }: { mentionedBranch?: unknown; filterBranch?: unknown } = {},
): SalesBranchDecision {
  const mentioned = normalizeSalesBranch(mentionedBranch);
  const filter = normalizeSalesBranch(filterBranch);
  const requested = mentioned || filter;

  if (!profile) {
    return {
      ok: true,
      deniedBranch: null,
      allowedBranches: [],
      branches: requested ? [requested] : [],
      unrestricted: true,
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

  const allowed: string[] = [];
  const scope = normalizeSalesBranch(profile.branchScope);
  if (scope && !allowed.includes(scope)) allowed.push(scope);
  for (const id of profile.allowedBranchIds || []) {
    const normalized = normalizeSalesBranch(id);
    if (normalized && !allowed.includes(normalized)) allowed.push(normalized);
  }
  const allowedBranches = sortBranches(allowed);
  const scoped = Boolean(
    profile.authenticated
    || profile.branchScope
    || (Array.isArray(profile.allowedBranchIds) && profile.allowedBranchIds.length),
  );

  if (!scoped) {
    return {
      ok: true,
      deniedBranch: null,
      allowedBranches,
      branches: requested ? [requested] : allowedBranches,
      unrestricted: true,
      companyWide: false,
    };
  }

  if (mentioned && filter && mentioned !== filter) {
    return { ok: false, deniedBranch: mentioned, allowedBranches, branches: [], unrestricted: false, companyWide: false };
  }

  if (!allowedBranches.length || (requested && !allowedBranches.includes(requested))) {
    return { ok: false, deniedBranch: requested, allowedBranches, branches: [], unrestricted: false, companyWide: false };
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

export function salesQueryDenied(
  profile: { allBranches?: boolean | null; branchScope?: string | null; allowedBranchIds?: Array<string | null> | null; authenticated?: boolean | null } | null | undefined,
  scope: { mentionedBranch?: unknown; filterBranch?: unknown } = {},
) {
  if (!profile) return null;
  const decision = authorizeSalesBranches(profile, scope);
  return decision.ok ? null : decision;
}
