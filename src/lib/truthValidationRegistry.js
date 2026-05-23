/**
 * Global truth validation registry — window.NAC_DEBUG / operational validation.
 */

import { isNacDebugEnabled } from "./nacDebug";
import { buildTruthValidationPackage } from "../platform/engines/truthValidationEngine";
import {
  recordValidationObservations,
  readValidationObservations,
} from "../platform/engines/validationChecklistEngine";

let lastPackage = null;
let lastBuildInput = null;

export function publishTruthValidation(pkg) {
  lastPackage = pkg;
  if (typeof window === "undefined") return;
  window.__NAC_TRUTH_VALIDATION__ = pkg;
  if (isNacDebugEnabled()) {
    // eslint-disable-next-line no-console
    console.info("[NAC truth validation]", pkg);
  }
}

export function getTruthValidation() {
  return lastPackage;
}

export function buildAndPublishTruthValidation(input = {}) {
  lastBuildInput = { ...input };
  const observations = input.observations || readValidationObservations();
  const pkg = buildTruthValidationPackage({ ...input, observations });
  publishTruthValidation(pkg);
  return pkg;
}

/** Manual floor counts — window.NAC_RECORD_OBSERVATION({ qr_scans_30min: 12 }) */
export function installTruthValidationGlobals() {
  if (typeof window === "undefined") return;
  window.NAC_RECORD_OBSERVATION = (partial) => {
    const obs = recordValidationObservations(partial);
    if (lastBuildInput) {
      buildAndPublishTruthValidation({ ...lastBuildInput, observations: obs });
    }
    return obs;
  };
}
