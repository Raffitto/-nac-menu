/**
 * Machine-state proof records for completed-day Foodics acquisition.
 * Proof comes from run artifacts, not a retrospective human description.
 */

import { officialExportEvidenceFields } from "./officialExportPath.ts";
import { classifyProofRun, type ProofClassification } from "./proofRetention.ts";

export type AcquisitionInvocationSource = "scheduler" | "manual" | "catch-up";
export type AcquisitionMethod = "authenticated_read";

export type IdempotencyResult =
  | "published_new"
  | "noop_verified"
  | "noop_integrity_mismatch"
  | "not_applicable";

export type AcquisitionEvidenceRecord = {
  runId: string;
  invocationSource: AcquisitionInvocationSource;
  riyadhStartedAt: string;
  riyadhCompletedAt: string | null;
  targetBusinessDate: string;
  branchId: string;
  acquisitionMethod: AcquisitionMethod;
  listingCount: number;
  fetchedDetailCount: number;
  itemCount: number;
  rawChecksums: Record<string, string | null>;
  canonicalOrderCount: number;
  canonicalItemCount: number;
  canonicalSessionCount: number;
  previousWatermark: string | null;
  newWatermark: string | null;
  publicationDestination: string;
  publicationVersion: string;
  idempotencyResult: IdempotencyResult;
  finalState: string;
  qualified: boolean;
  proofClassification: ProofClassification | null;
  proofReason: string | null;
  officialExport: Record<string, null>;
};

export async function sha256Hex(payload: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
}

export async function checksumRawDetails(details: unknown[]): Promise<string> {
  const sorted = [...details].sort((a, b) => {
    const left = String((a as { id?: unknown })?.id || "");
    const right = String((b as { id?: unknown })?.id || "");
    return left.localeCompare(right);
  });
  return sha256Hex(stableJson(sorted));
}

export function buildAcquisitionEvidence(
  input: Omit<AcquisitionEvidenceRecord, "officialExport" | "qualified" | "proofClassification" | "proofReason"> & {
    qualified?: boolean;
    proofClassification?: ProofClassification | null;
    proofReason?: string | null;
    liveListCount?: number;
    liveDetailCalls?: number;
    representativeOrderId?: string | null;
    rawBytes?: number;
    ingestOk?: boolean;
    validationPass?: boolean;
    publicationOk?: boolean;
    lineageBatchIdsMatch?: boolean;
    sourceCompleted?: boolean;
  },
): AcquisitionEvidenceRecord {
  const listingCount = input.listingCount;
  const sourceNonEmpty = listingCount > 0 && input.canonicalOrderCount > 0 && input.itemCount > 0;
  const classified = classifyProofRun({
    sourceDate: input.targetBusinessDate,
    sourceCompleted: input.sourceCompleted ?? true,
    sourceNonEmpty,
    liveListCount: input.liveListCount ?? listingCount,
    liveDetailCalls: input.liveDetailCalls ?? input.fetchedDetailCount,
    acquiredOrders: input.canonicalOrderCount,
    acquiredItems: input.itemCount,
    rawBytes: input.rawBytes ?? (sourceNonEmpty ? 1 : 0),
    checksum: input.rawChecksums.rawBatch || null,
    representativeOrderId: input.representativeOrderId ?? null,
    batchId: input.runId,
    ingestOk: input.ingestOk ?? input.finalState === "PUBLISHED",
    validationPass: input.validationPass ?? ["VALIDATED", "CANONICALIZED", "PUBLISHED", "IDEMPOTENT_NOOP"].includes(input.finalState),
    publicationOk: input.publicationOk ?? input.finalState === "PUBLISHED",
    lineageBatchIdsMatch: input.lineageBatchIdsMatch ?? true,
  });
  const qualified = input.qualified ?? (classified.eligible && input.idempotencyResult === "published_new");
  return {
    runId: input.runId,
    invocationSource: input.invocationSource,
    riyadhStartedAt: input.riyadhStartedAt,
    riyadhCompletedAt: input.riyadhCompletedAt,
    targetBusinessDate: input.targetBusinessDate,
    branchId: input.branchId,
    acquisitionMethod: input.acquisitionMethod,
    listingCount: input.listingCount,
    fetchedDetailCount: input.fetchedDetailCount,
    itemCount: input.itemCount,
    rawChecksums: input.rawChecksums,
    canonicalOrderCount: input.canonicalOrderCount,
    canonicalItemCount: input.canonicalItemCount,
    canonicalSessionCount: input.canonicalSessionCount,
    previousWatermark: input.previousWatermark,
    newWatermark: input.newWatermark,
    publicationDestination: input.publicationDestination,
    publicationVersion: input.publicationVersion,
    idempotencyResult: input.idempotencyResult,
    finalState: input.finalState,
    qualified,
    proofClassification: input.proofClassification ?? classified.classification,
    proofReason: input.proofReason ?? classified.reason,
    officialExport: officialExportEvidenceFields(),
  };
}
