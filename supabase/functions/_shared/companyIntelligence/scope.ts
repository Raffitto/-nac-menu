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

export function createIntelligenceScope(input: {
  companyId?: CompanyId | null;
  brandId?: BrandId | null;
  branchIds?: Array<BranchId | null | undefined>;
  primaryBranchId?: BranchId | null;
  role?: string | null;
  allowedBranchIds?: BranchId[];
  canSeeNetwork?: boolean;
} = {}): IntelligenceScope {
  const normalized = (input.branchIds || [])
    .map((b) => normalizeBranchId(b))
    .filter(Boolean) as BranchId[];
  const primary = normalizeBranchId(input.primaryBranchId)
    || (normalized.length === 1 ? normalized[0] : null);

  const branchIds = primary && !normalized.includes(primary)
    ? [primary, ...normalized]
    : normalized.length
      ? normalized
      : (primary ? [primary] : []);

  return {
    companyId: String(input.companyId || DEFAULT_COMPANY_ID),
    brandId: String(input.brandId || DEFAULT_BRAND_ID),
    branchIds,
    primaryBranchId: primary,
    access: {
      role: input.role || null,
      allowedBranchIds: input.allowedBranchIds || ["khobar", "riyadh", "jeddah"],
      canSeeNetwork: Boolean(input.canSeeNetwork),
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
