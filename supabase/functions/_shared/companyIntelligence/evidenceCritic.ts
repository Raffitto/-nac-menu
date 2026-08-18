/**
 * Evidence critic / gap detector — at most one additional bounded research pass.
 */

import type { ComparabilityResult } from "./comparabilityEngine.ts";
import type { EvidenceRecord } from "./evidenceLedger.ts";
import type { FeasibilityResult } from "./feasibilityGate.ts";
import type { ResearchBudgetTier } from "./types.ts";

export type CriticDecision = {
  enoughEvidence: boolean;
  gaps: string[];
  recommendAdditionalPass: boolean;
  additionalCapabilities: string[];
  reason: string;
};

export function critiqueEvidence(input: {
  question: string;
  evidence: EvidenceRecord[];
  feasibility?: FeasibilityResult | null;
  comparability?: ComparabilityResult | null;
  budgetTier?: ResearchBudgetTier;
  researchPassesUsed?: number;
}): CriticDecision {
  const gaps: string[] = [];
  const q = String(input.question || "").toLowerCase();
  const evidence = input.evidence || [];
  const passesUsed = input.researchPassesUsed || 0;

  if (!evidence.length) gaps.push("no_evidence");

  if (input.feasibility?.status === "NOT_ANSWERABLE_AS_REQUESTED") {
    return {
      enoughEvidence: true,
      gaps: input.feasibility.reasons,
      recommendAdditionalPass: false,
      additionalCapabilities: [],
      reason: "feasibility_blocked_before_research",
    };
  }

  if (input.comparability?.status === "not_comparable") {
    gaps.push("not_comparable");
  }

  const hasCommercial = evidence.some((e) => e.source === "cash_up" || e.domain === "INTERNAL_STRUCTURED");
  const hasOps = evidence.some((e) => e.source === "logbook" || e.domain === "INTERNAL_QUALITATIVE");
  const hasExternal = evidence.some((e) => e.domain === "EXTERNAL");
  const causalAsk = /\b(why|cause|caused|explain)\b/.test(q);

  if (causalAsk && hasCommercial && !hasOps && !hasExternal) {
    gaps.push("causal_question_without_explanatory_evidence");
  }

  if (input.comparability?.status === "partially_comparable") {
    gaps.push("partial_coverage");
  }

  const canPass = passesUsed < 1 && (input.budgetTier || 0) >= 2;
  const recommend = canPass && (
    gaps.includes("causal_question_without_explanatory_evidence")
    || gaps.includes("no_evidence")
  );

  return {
    enoughEvidence: gaps.length === 0 || (hasCommercial && !causalAsk),
    gaps,
    recommendAdditionalPass: recommend,
    additionalCapabilities: recommend
      ? (gaps.includes("causal_question_without_explanatory_evidence")
        ? ["operations.review"]
        : ["commercial.performance"])
      : [],
    reason: recommend ? "one_bounded_additional_pass" : "stop",
  };
}
