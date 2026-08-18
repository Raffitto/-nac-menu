/**
 * Founder-mode cost classes for external evidence.
 * 0 cached/local · 1 free API · 2 bounded research · 3 paid (blocked).
 */

export type ExternalCostClass = 0 | 1 | 2 | 3;

export const FOUNDER_COST_POLICY = Object.freeze({
  prefer: [0, 1] as ExternalCostClass[],
  allowClass2WhenMaterial: true,
  blockPaid: true,
});

export type CostDecision = {
  allowed: boolean;
  costClass: ExternalCostClass;
  reason: string;
  paid: boolean;
};

export function allowExternalCost(costClass: ExternalCostClass, opts: {
  materiallyUseful?: boolean;
  alreadyCached?: boolean;
} = {}): CostDecision {
  if (opts.alreadyCached) {
    return { allowed: true, costClass: 0, reason: "cache_hit", paid: false };
  }
  if (costClass === 3) {
    return { allowed: false, costClass: 3, reason: "paid_source_blocked_founder_mode", paid: true };
  }
  if (costClass === 2) {
    if (!FOUNDER_COST_POLICY.allowClass2WhenMaterial || opts.materiallyUseful === false) {
      return { allowed: false, costClass: 2, reason: "class2_not_material", paid: false };
    }
    return { allowed: true, costClass: 2, reason: "bounded_web_research", paid: false };
  }
  return {
    allowed: true,
    costClass,
    reason: costClass === 0 ? "local_or_cached" : "free_external_api",
    paid: false,
  };
}
