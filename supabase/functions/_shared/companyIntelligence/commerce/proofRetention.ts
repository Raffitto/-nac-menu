export const PROOF_SUCCESS_TARGET = 5;

export type ProofForce = "on" | "off" | "next-run" | null;

export type ProofState = {
  visualEnabled: boolean;
  consecutiveSuccesses: number;
  force: ProofForce;
  lastSourceMode: string | null;
  lastSchemaFingerprint: string | null;
};

export function defaultProofState(): ProofState {
  return {
    visualEnabled: true,
    consecutiveSuccesses: 0,
    force: null,
    lastSourceMode: "authenticated_read_fallback",
    lastSchemaFingerprint: null,
  };
}

export function shouldRecordVisuals(state: ProofState): boolean {
  if (state.force === "off") return false;
  if (state.force === "on" || state.force === "next-run") return true;
  if (!state.visualEnabled) return false;
  return state.consecutiveSuccesses < PROOF_SUCCESS_TARGET;
}

export function applyProofSuccess(state: ProofState): ProofState {
  const consecutiveSuccesses = state.consecutiveSuccesses + 1;
  return {
    ...state,
    consecutiveSuccesses,
    visualEnabled: consecutiveSuccesses >= PROOF_SUCCESS_TARGET ? false : state.visualEnabled,
    force: state.force === "next-run" ? null : state.force,
  };
}

export function applyProofFailure(state: ProofState): ProofState {
  return {
    ...state,
    consecutiveSuccesses: 0,
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
    return { ...state, consecutiveSuccesses: 0, visualEnabled: true };
  }
  return state;
}
