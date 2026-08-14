/**
 * Complexity / research budget controller.
 */

import type { CapabilityId } from "./capabilityRegistry.ts";
import { CAPABILITY_REGISTRY } from "./capabilityRegistry.ts";
import type { ResearchBudgetTier } from "./types.ts";

export type BudgetDecision = {
  tier: ResearchBudgetTier;
  label: "lookup" | "interpretation" | "investigation" | "deep_research";
  allowPaidModel: boolean;
  maxInternalTools: number;
  maxResearchPasses: number;
  reasons: string[];
};

const TIER_LABEL: Record<ResearchBudgetTier, BudgetDecision["label"]> = {
  0: "lookup",
  1: "interpretation",
  2: "investigation",
  3: "deep_research",
};

export function decideResearchBudget(input: {
  question?: string;
  capabilities?: CapabilityId[];
  requiresComparison?: boolean;
  requiresExternalResearch?: boolean;
  feasibilityStatus?: string;
  deterministicRouteHighConfidence?: boolean;
}): BudgetDecision {
  const q = String(input.question || "").toLowerCase();
  const reasons: string[] = [];

  if (input.deterministicRouteHighConfidence && !input.requiresExternalResearch) {
    reasons.push("high_confidence_deterministic_route");
    return {
      tier: 0,
      label: "lookup",
      allowPaidModel: false,
      maxInternalTools: 2,
      maxResearchPasses: 0,
      reasons,
    };
  }

  if (input.requiresExternalResearch || /\b(why|explain|research|weather|news|political|economic)\b/.test(q)) {
    reasons.push("external_or_causal_investigation");
    return {
      tier: 3,
      label: "deep_research",
      allowPaidModel: true,
      maxInternalTools: 6,
      maxResearchPasses: 1,
      reasons,
    };
  }

  const caps = input.capabilities || [];
  let maxFromCaps: ResearchBudgetTier = 0;
  for (const id of caps) {
    const tier = CAPABILITY_REGISTRY[id]?.defaultBudgetTier ?? 0;
    if (tier > maxFromCaps) maxFromCaps = tier;
  }

  if (input.requiresComparison || caps.includes("commercial.compare") || caps.includes("analytics.safe_compute")) {
    maxFromCaps = Math.max(maxFromCaps, 2) as ResearchBudgetTier;
    reasons.push("multi_tool_investigation");
  } else if (caps.length <= 1 && maxFromCaps <= 0) {
    reasons.push("simple_lookup_capability");
  } else {
    reasons.push("interpretation_capabilities");
  }

  if (
    /\b(ramadan|eid|founding day|foundation day|compare last year|deep dive|root cause)\b/.test(q)
    || input.feasibilityStatus === "REQUIRES_RESEARCH"
    || (input.capabilities || []).includes("commercial.forecast")
  ) {
    maxFromCaps = Math.max(maxFromCaps, 2) as ResearchBudgetTier;
    if (/\b(ramadan|eid|compare last year|deep dive|root cause)\b/.test(q)
      || input.feasibilityStatus === "REQUIRES_RESEARCH") {
      maxFromCaps = 3;
    }
    reasons.push("complex_calendar_or_research_request");
  }

  const tier = maxFromCaps;
  return {
    tier,
    label: TIER_LABEL[tier],
    allowPaidModel: tier >= 2,
    maxInternalTools: tier === 0 ? 2 : tier === 1 ? 3 : 6,
    maxResearchPasses: tier >= 3 ? 1 : 0,
    reasons,
  };
}
