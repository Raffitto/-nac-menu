/**
 * Company → Brand → Branch scope model (brand-agnostic contracts).
 * Current default preserves NAC Hospitality behavior.
 */

import type { BranchId, BrandId, CompanyId } from "./types.ts";

export type RoleAccessScope = {
  role: string | null;
  allowedBranchIds: BranchId[];
  canSeeNetwork: boolean;
};

export type IntelligenceScope = {
  companyId: CompanyId;
  brandId: BrandId;
  branchIds: BranchId[];
  /** Explicit single-branch focus when present; never silently widen to Network. */
  primaryBranchId: BranchId | null;
  access: RoleAccessScope;
};

export const DEFAULT_COMPANY_ID: CompanyId = "nac_hospitality";
export const DEFAULT_BRAND_ID: BrandId = "nac";

const KNOWN_BRANCHES = new Set(["khobar", "riyadh", "jeddah"]);

export function normalizeBranchId(raw: unknown): BranchId | null {
  if (raw == null) return null;
  const v = String(raw).toLowerCase().trim();
  if (!v || v === "all" || v === "network") return null;
  // Only accept explicit branch tokens — never treat a full question as a branch id.
  if (/\b(khobar|al khobar)\b/.test(v) || v === "khobar") return "khobar";
  if (/\briyadh\b/.test(v) || v === "riyadh") return "riyadh";
  if (/\bjeddah\b/.test(v) || v === "jeddah") return "jeddah";
  if (KNOWN_BRANCHES.has(v)) return v;
  return null;
}

type ScopeInput = {
  companyId?: CompanyId | null;
  brandId?: BrandId | null;
  branchIds?: Array<BranchId | null | undefined>;
  primaryBranchId?: BranchId | null;
  role?: string | null;
  allowedBranchIds?: BranchId[];
  canSeeNetwork?: boolean;
  /** Already-built scope (nested access) — must not drop canSeeNetwork on re-wrap. */
  access?: Partial<RoleAccessScope> | null;
};

/** Accept flat builder fields or an already-built IntelligenceScope. */
export function coerceScopeBuilderInput(input: ScopeInput | IntelligenceScope | null | undefined = {}): ScopeInput {
  const raw = (input || {}) as ScopeInput & Partial<IntelligenceScope>;
  const nested = raw.access && typeof raw.access === "object" ? raw.access : null;
  return {
    companyId: raw.companyId,
    brandId: raw.brandId,
    branchIds: raw.branchIds,
    primaryBranchId: raw.primaryBranchId,
    role: nested?.role ?? raw.role,
    allowedBranchIds: nested?.allowedBranchIds ?? raw.allowedBranchIds,
    canSeeNetwork: nested?.canSeeNetwork ?? raw.canSeeNetwork,
  };
}

export function createIntelligenceScope(input: ScopeInput | IntelligenceScope = {}): IntelligenceScope {
  const flat = coerceScopeBuilderInput(input);
  const normalized = (flat.branchIds || [])
    .map((b) => normalizeBranchId(b))
    .filter(Boolean) as BranchId[];
  const primary = normalizeBranchId(flat.primaryBranchId)
    || (normalized.length === 1 ? normalized[0] : null);

  const branchIds = primary && !normalized.includes(primary)
    ? [primary, ...normalized]
    : normalized.length
      ? normalized
      : (primary ? [primary] : []);

  return {
    companyId: String(flat.companyId || DEFAULT_COMPANY_ID),
    brandId: String(flat.brandId || DEFAULT_BRAND_ID),
    branchIds,
    primaryBranchId: primary,
    access: {
      role: flat.role || null,
      allowedBranchIds: flat.allowedBranchIds || ["khobar", "riyadh", "jeddah"],
      canSeeNetwork: Boolean(flat.canSeeNetwork),
    },
  };
}

/** Never silently replace a requested branch with Network. */
export function assertBranchScopePreserved(
  scope: IntelligenceScope,
  requestedBranch: BranchId | null,
): { ok: boolean; reason?: string } {
  if (!requestedBranch) return { ok: true };
  if (scope.primaryBranchId !== requestedBranch) {
    return {
      ok: false,
      reason: `primaryBranchId=${scope.primaryBranchId} !== requested=${requestedBranch}`,
    };
  }
  if (!scope.branchIds.includes(requestedBranch)) {
    return { ok: false, reason: "requested branch missing from branchIds" };
  }
  return { ok: true };
}

export type AccessProfileHint = {
  role?: string | null;
  branchScope?: string | null;
  allBranches?: boolean | null;
  allowedBranchIds?: Array<string | null | undefined> | null;
  /** Runtime aliases observed from staff tables / older clients. */
  primary_branch_id?: string | null;
  primaryBranchId?: string | null;
  branch_id?: string | null;
  branch_scope?: string | null;
  all_branches?: boolean | null;
  vault_role?: string | null;
  vaultRole?: string | null;
};

/** Normalize client profileHint + server staff row field-name variants. */
export function normalizeAccessProfileHint(profile?: AccessProfileHint | null): AccessProfileHint | null {
  if (!profile || typeof profile !== "object") return null;
  const role = profile.role || profile.vaultRole || profile.vault_role || null;
  const branchScope = profile.branchScope
    ?? profile.branch_scope
    ?? profile.primaryBranchId
    ?? profile.primary_branch_id
    ?? profile.branch_id
    ?? null;
  const allBranches = profile.allBranches ?? profile.all_branches ?? null;
  return {
    role,
    branchScope: branchScope == null ? null : String(branchScope),
    allBranches: allBranches == null ? null : Boolean(allBranches),
    allowedBranchIds: profile.allowedBranchIds || null,
    primary_branch_id: profile.primary_branch_id ?? null,
    primaryBranchId: profile.primaryBranchId ?? null,
    vault_role: profile.vault_role ?? null,
    vaultRole: profile.vaultRole ?? null,
  };
}

/**
 * Resolve Fabric/Ask NAC branch scope from authenticated access + optional explicit mention.
 * Does NOT invent a global Khobar default. Does NOT grant network unless profile allows it.
 */
export function resolveAuthorizedIntelligenceScope(input: {
  mentionedBranch?: string | null;
  filterBranch?: string | null;
  profile?: AccessProfileHint | null;
} = {}): {
  scope: IntelligenceScope;
  unauthorizedBranch: BranchId | null;
} {
  const profile = normalizeAccessProfileHint(input.profile);
  const canSeeNetwork = Boolean(profile?.allBranches);
  const profilePrimary = normalizeBranchId(profile?.branchScope);
  const allowedFromProfile = (profile?.allowedBranchIds || [])
    .map((b) => normalizeBranchId(b))
    .filter(Boolean) as BranchId[];

  let allowedBranchIds: BranchId[];
  if (canSeeNetwork) {
    allowedBranchIds = allowedFromProfile.length
      ? allowedFromProfile
      : ["khobar", "riyadh", "jeddah"];
  } else if (allowedFromProfile.length) {
    allowedBranchIds = allowedFromProfile;
  } else if (profilePrimary) {
    allowedBranchIds = [profilePrimary];
  } else {
    allowedBranchIds = [];
  }

  const isAllowed = (branch: BranchId | null): boolean => {
    if (!branch) return false;
    if (canSeeNetwork) return true;
    return allowedBranchIds.includes(branch);
  };

  const mentioned = normalizeBranchId(input.mentionedBranch);
  if (mentioned) {
    if (!isAllowed(mentioned)) {
      return {
        scope: createIntelligenceScope({
          primaryBranchId: null,
          branchIds: [],
          allowedBranchIds,
          canSeeNetwork,
          role: profile?.role || null,
        }),
        unauthorizedBranch: mentioned,
      };
    }
    return {
      scope: createIntelligenceScope({
        primaryBranchId: mentioned,
        branchIds: [mentioned],
        allowedBranchIds,
        canSeeNetwork,
        role: profile?.role || null,
      }),
      unauthorizedBranch: null,
    };
  }

  const filter = normalizeBranchId(input.filterBranch);
  // Prefer authorized filter branch, else authenticated primary for single-branch users.
  const candidate = (filter && isAllowed(filter) ? filter : null)
    || (!canSeeNetwork && profilePrimary && isAllowed(profilePrimary) ? profilePrimary : null)
    || (canSeeNetwork && filter ? filter : null);

  return {
    scope: createIntelligenceScope({
      primaryBranchId: candidate,
      branchIds: candidate ? [candidate] : [],
      allowedBranchIds,
      canSeeNetwork,
      role: profile?.role || null,
    }),
    unauthorizedBranch: null,
  };
}
