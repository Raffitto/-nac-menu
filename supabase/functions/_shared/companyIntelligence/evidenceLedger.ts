/**
 * Evidence ledger + claim model for causal safety.
 */

import type { CoverageReport } from "./coverageModel.ts";
import { getSourceAuthority } from "./sourceAuthority.ts";
import type {
  BranchId,
  ClaimType,
  DateRange,
  EvidenceDomain,
  SourceAuthority,
} from "./types.ts";

export type EvidenceRecord = {
  id: string;
  source: string;
  sourceAuthority: SourceAuthority;
  domain: EvidenceDomain;
  companyId?: string | null;
  brandId?: string | null;
  branchId?: BranchId | null;
  period?: DateRange | null;
  metricOrEvent: string;
  value?: number | string | null;
  textSummary: string;
  coverage?: CoverageReport | null;
  freshness?: string | null;
  confidence?: "high" | "medium" | "low";
};

export type ClaimRecord = {
  id: string;
  type: ClaimType;
  statement: string;
  evidenceIds: string[];
  metricValue?: number | null;
  branchId?: BranchId | null;
  period?: DateRange | null;
};

let evidenceSeq = 0;
let claimSeq = 0;

export function createEvidence(input: Omit<EvidenceRecord, "id" | "sourceAuthority"> & {
  id?: string;
  sourceAuthority?: SourceAuthority;
}): EvidenceRecord {
  const authority = input.sourceAuthority || getSourceAuthority(input.source).authority;
  evidenceSeq += 1;
  return {
    id: input.id || `ev_${evidenceSeq}`,
    source: input.source,
    sourceAuthority: authority,
    domain: input.domain,
    companyId: input.companyId || null,
    brandId: input.brandId || null,
    branchId: input.branchId || null,
    period: input.period || null,
    metricOrEvent: input.metricOrEvent,
    value: input.value ?? null,
    textSummary: input.textSummary,
    coverage: input.coverage || null,
    freshness: input.freshness || null,
    confidence: input.confidence || "medium",
  };
}

export function createClaim(input: Omit<ClaimRecord, "id"> & { id?: string }): ClaimRecord {
  claimSeq += 1;
  return {
    id: input.id || `cl_${claimSeq}`,
    type: input.type,
    statement: input.statement,
    evidenceIds: [...(input.evidenceIds || [])],
    metricValue: input.metricValue ?? null,
    branchId: input.branchId || null,
    period: input.period || null,
  };
}

export function claimReferencesEvidence(claim: ClaimRecord, evidence: EvidenceRecord[]): boolean {
  if (!claim.evidenceIds.length) return false;
  const ids = new Set(evidence.map((e) => e.id));
  return claim.evidenceIds.every((id) => ids.has(id));
}
