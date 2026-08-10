/**
 * Deterministic templated synthesis for simple answers + offline degradation.
 */

import type { ClaimRecord, EvidenceRecord } from "./evidenceLedger.ts";
import type { ComparabilityResult } from "./comparabilityEngine.ts";
import type { CoverageReport } from "./coverageModel.ts";
import type { DateRange } from "./types.ts";
import { allowedInferenceWording } from "./causalPolicy.ts";

function branchLabel(branchId: string | null | undefined) {
  if (!branchId) return "the branch";
  return ({ khobar: "Khobar", riyadh: "Riyadh", jeddah: "Jeddah" } as Record<string, string>)[branchId]
    || branchId;
}

function periodLabel(period: DateRange | null | undefined) {
  if (!period) return "the requested period";
  return period.label || `${period.startDate}–${period.endDate}`;
}

export function synthesizeDeterministicAnswer(input: {
  question: string;
  branchId: string | null;
  period: DateRange | null;
  comparisonPeriod?: DateRange | null;
  evidence: EvidenceRecord[];
  claims: ClaimRecord[];
  coverage: CoverageReport[];
  comparability?: ComparabilityResult | null;
  offlineAnalysis?: boolean;
  infeasibleText?: string | null;
}): string {
  if (input.infeasibleText) return input.infeasibleText;

  const sales = input.evidence.find((e) => e.metricOrEvent === "net_sales" && typeof e.value === "number");
  const covers = input.evidence.find((e) => e.metricOrEvent === "covers" && typeof e.value === "number");
  const delta = input.evidence.find((e) => e.metricOrEvent === "delta_pct" && typeof e.value === "number");
  const costMissing = input.claims.some((c) => c.type === "UNSUPPORTED" && /margin|cost/i.test(c.statement));
  const ops = input.evidence.filter((e) => e.source === "logbook").map((e) => e.textSummary).filter(Boolean);

  const branch = branchLabel(input.branchId);
  const period = periodLabel(input.period);
  const parts: string[] = [];

  if (costMissing && /\b(margin|losing money|food cost)\b/i.test(input.question)) {
    parts.push(
      `Canonical cost/margin data is unavailable for ${branch}, so I cannot determine where margin is being lost from sales alone.`,
    );
  }

  if (sales) {
    parts.push(`For ${branch} in ${period}, net sales were ${sales.value} SAR.`);
  }
  if (covers) {
    parts.push(`Covers were ${covers.value}.`);
  }

  if (delta && input.comparability?.status !== "not_comparable") {
    const method = input.comparability?.recommendedMethod || "matched_days";
    const direction = Number(delta.value) < 0 ? "down" : Number(delta.value) > 0 ? "up" : "flat";
    if (input.comparability?.status === "partially_comparable" || method === "matched_days") {
      parts.push(
        `On a like-for-like (${method}) basis, sales were ${direction} ${Math.abs(Number(delta.value))}%.`,
      );
    } else {
      parts.push(`Compared with the prior period, sales were ${direction} ${Math.abs(Number(delta.value))}%.`);
    }
  } else if (input.comparability?.status === "not_comparable") {
    parts.push("A percentage comparison is not valid for these periods.");
  }

  for (const cov of input.coverage) {
    if (cov.coverageRatio != null && cov.coverageRatio < 1 && cov.expectedRecords != null && cov.availableRecords != null) {
      parts.push(
        `I can use ${cov.domain} evidence for ${cov.availableRecords} of the requested ${cov.expectedRecords} records; coverage is incomplete.`,
      );
    }
  }

  if (ops.length) {
    parts.push(`In-period logbooks mention: ${ops[0]}`);
    if (/\bwhy|cause|shit|wrong\b/i.test(input.question)) {
      parts.push(allowedInferenceWording());
    }
  }

  if (!parts.length) {
    parts.push(
      `Verified structured evidence for ${branch} in ${period} is limited or unavailable for this question.`,
    );
  }

  if (input.offlineAnalysis) {
    parts.push(
      "Natural-language analysis is unavailable in offline mode; showing verified retrieved data only.",
    );
  }

  return parts.join(" ");
}
