export const PROOF_SUCCESS_TARGET = 5;

export type ProofForce = "on" | "off" | "next-run" | null;

export type ProofClassification =
  | "FULL_CHAIN_PROOF_SUCCESS"
  | "INCOMPLETE_SOURCE_PERIOD"
  | "EMPTY_ACQUISITION"
  | "ACQUISITION_NOT_PROVEN"
  | "VALIDATION_FAILED"
  | "PUBLICATION_FAILED"
  | "DEGRADED_PUBLICATION_BLOCKED"
  | "LINEAGE_UNCORRELATED"
  | "CANONICAL_INGEST_FAILED";

export type ProofState = {
  visualEnabled: boolean;
  consecutiveSuccesses: number;
  genuineFullChainSuccesses: number;
  force: ProofForce;
  lastSourceMode: string | null;
  lastSchemaFingerprint: string | null;
  qualifiedBusinessDates: string[];
};

export function defaultProofState(): ProofState {
  return {
    visualEnabled: true,
    consecutiveSuccesses: 0,
    genuineFullChainSuccesses: 0,
    force: null,
    lastSourceMode: "authenticated_read_fallback",
    lastSchemaFingerprint: null,
    qualifiedBusinessDates: [],
  };
}

export function shouldRecordVisuals(state: ProofState): boolean {
  if (state.force === "off") return false;
  if (state.force === "on" || state.force === "next-run") return true;
  if (!state.visualEnabled) return false;
  const n = state.genuineFullChainSuccesses ?? state.consecutiveSuccesses;
  return n < PROOF_SUCCESS_TARGET;
}

export type ProofQualificationInput = {
  sourceDate: string;
  forbiddenDates?: string[];
  sourceCompleted: boolean;
  sourceNonEmpty: boolean;
  liveListCount: number;
  liveDetailCalls: number;
  acquiredOrders: number;
  acquiredItems: number;
  rawBytes: number;
  checksum: string | null;
  representativeOrderId: string | null;
  batchId: string | null;
  ingestOk: boolean;
  validationPass: boolean;
  publicationOk: boolean;
  degradedPublicationBlocked?: boolean;
  lineageBatchIdsMatch: boolean;
};

export function classifyProofRun(input: ProofQualificationInput): {
  classification: ProofClassification;
  eligible: boolean;
  reason: string;
} {
  if (input.forbiddenDates?.includes(input.sourceDate)) {
    return {
      classification: "INCOMPLETE_SOURCE_PERIOD",
      eligible: false,
      reason: `${input.sourceDate} is excluded from the trust counter (incomplete/empty prior proof).`,
    };
  }
  if (!input.sourceCompleted) {
    return { classification: "INCOMPLETE_SOURCE_PERIOD", eligible: false, reason: "Source period is not a completed Foodics day." };
  }
  if (!input.sourceNonEmpty || input.acquiredOrders <= 0 || input.acquiredItems <= 0 || input.rawBytes <= 0 || !input.checksum) {
    return { classification: "EMPTY_ACQUISITION", eligible: false, reason: "Acquisition did not return a non-empty raw batch with orders and items." };
  }
  if (input.liveListCount <= 0 || input.liveDetailCalls <= 0 || !input.representativeOrderId) {
    return {
      classification: "ACQUISITION_NOT_PROVEN",
      eligible: false,
      reason: "Live listing/detail calls were not proven; checkpoint replay is not a full-chain proof.",
    };
  }
  if (!input.batchId || !input.lineageBatchIdsMatch) {
    return { classification: "LINEAGE_UNCORRELATED", eligible: false, reason: "Batch ID did not correlate acquisition, ingest, validation, and publication." };
  }
  if (!input.ingestOk) {
    return { classification: "CANONICAL_INGEST_FAILED", eligible: false, reason: "Canonical upsert was not proven." };
  }
  if (!input.validationPass) {
    return { classification: "VALIDATION_FAILED", eligible: false, reason: "Validation did not pass." };
  }
  if (input.degradedPublicationBlocked) {
    return {
      classification: "DEGRADED_PUBLICATION_BLOCKED",
      eligible: false,
      reason: "Publication correctly refused to replace a healthier snapshot.",
    };
  }
  if (!input.publicationOk) {
    return { classification: "PUBLICATION_FAILED", eligible: false, reason: "Publication failed." };
  }
  return {
    classification: "FULL_CHAIN_PROOF_SUCCESS",
    eligible: true,
    reason: "Completed non-empty source, live acquisition, non-zero raw batch, canonical ingest, validation, and publication are correlated.",
  };
}

export function applyProofSuccess(state: ProofState): ProofState {
  return applyQualifiedProofResult(state, { eligible: true, classification: "FULL_CHAIN_PROOF_SUCCESS" });
}

export function applyQualifiedProofResult(state: ProofState, result: {
  eligible: boolean;
  classification: ProofClassification;
  businessDate?: string;
}): ProofState {
  if (!result.eligible || result.classification !== "FULL_CHAIN_PROOF_SUCCESS") {
    return {
      ...state,
      force: state.force === "next-run" ? null : state.force,
      visualEnabled: true,
      qualifiedBusinessDates: state.qualifiedBusinessDates || [],
    };
  }
  const dates = state.qualifiedBusinessDates || [];
  if (result.businessDate && dates.includes(result.businessDate)) {
    return {
      ...state,
      force: state.force === "next-run" ? null : state.force,
    };
  }
  const genuineFullChainSuccesses = (state.genuineFullChainSuccesses ?? state.consecutiveSuccesses ?? 0) + 1;
  return {
    ...state,
    genuineFullChainSuccesses,
    consecutiveSuccesses: genuineFullChainSuccesses,
    qualifiedBusinessDates: result.businessDate ? [...dates, result.businessDate] : dates,
    visualEnabled: genuineFullChainSuccesses >= PROOF_SUCCESS_TARGET ? false : true,
    force: state.force === "next-run" ? null : state.force,
  };
}

export function applyProofFailure(state: ProofState): ProofState {
  return {
    ...state,
    consecutiveSuccesses: 0,
    genuineFullChainSuccesses: 0,
    visualEnabled: true,
    force: state.force === "next-run" ? null : state.force,
  };
}

export function applyProofTrigger(state: ProofState, event: {
  publicationFailed?: boolean;
  validationFailed?: boolean;
  sourceModeChanged?: boolean;
  unexpectedFallback?: boolean;
  asyncDeliveryFailed?: boolean;
  schemaFingerprintChanged?: boolean;
}): ProofState {
  if (
    event.publicationFailed
    || event.validationFailed
    || event.sourceModeChanged
    || event.unexpectedFallback
    || event.asyncDeliveryFailed
    || event.schemaFingerprintChanged
  ) {
    return { ...state, consecutiveSuccesses: 0, genuineFullChainSuccesses: 0, visualEnabled: true };
  }
  return state;
}
