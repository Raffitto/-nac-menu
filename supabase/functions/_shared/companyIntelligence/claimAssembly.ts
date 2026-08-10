/**
 * Assemble claim candidates from normalized evidence before synthesis.
 */

import { createClaim, type ClaimRecord, type EvidenceRecord } from "./evidenceLedger.ts";
import type { ComparabilityResult } from "./comparabilityEngine.ts";
import type { BranchId, DateRange } from "./types.ts";

export function assembleClaimsFromEvidence(input: {
  evidence: EvidenceRecord[];
  branchId?: BranchId | null;
  period?: DateRange | null;
  comparability?: ComparabilityResult | null;
}): ClaimRecord[] {
  const claims: ClaimRecord[] = [];
  const evidence = input.evidence || [];

  for (const ev of evidence) {
    if (typeof ev.value === "number" && Number.isFinite(ev.value)) {
      if (ev.metricOrEvent === "delta_pct") {
        if (input.comparability?.status === "not_comparable") continue;
        claims.push(createClaim({
          type: "DERIVED_METRIC",
          statement: `Sales changed ${ev.value}% on a ${input.comparability?.recommendedMethod || "period"} basis`,
          evidenceIds: [ev.id],
          metricValue: ev.value,
          branchId: input.branchId || ev.branchId || null,
          period: input.period || ev.period || null,
        }));
      } else {
        claims.push(createClaim({
          type: "VERIFIED_FACT",
          statement: `${ev.metricOrEvent} was ${ev.value}`,
          evidenceIds: [ev.id],
          metricValue: ev.value,
          branchId: input.branchId || ev.branchId || null,
          period: input.period || ev.period || null,
        }));
      }
    } else if (ev.source === "logbook" && ev.textSummary) {
      claims.push(createClaim({
        type: "VERIFIED_FACT",
        statement: ev.textSummary,
        evidenceIds: [ev.id],
        branchId: input.branchId || ev.branchId || null,
        period: input.period || ev.period || null,
      }));
    } else if (ev.metricOrEvent === "cost.margin_analysis") {
      claims.push(createClaim({
        type: "UNSUPPORTED",
        statement: "Canonical margin/cost evidence is unavailable",
        evidenceIds: [ev.id],
        branchId: input.branchId || null,
        period: input.period || null,
      }));
    }
  }

  const hasSalesDelta = claims.some((c) => c.type === "DERIVED_METRIC");
  const hasOps = claims.some((c) =>
    evidence.find((e) => e.id === c.evidenceIds[0] && e.source === "logbook")
  );
  if (hasSalesDelta && hasOps) {
    const ids = claims.flatMap((c) => c.evidenceIds).slice(0, 4);
    claims.push(createClaim({
      type: "SUPPORTED_ASSOCIATION",
      statement: "Operational issues may have contributed to the sales change",
      evidenceIds: ids,
      branchId: input.branchId || null,
      period: input.period || null,
    }));
  }

  return claims;
}
