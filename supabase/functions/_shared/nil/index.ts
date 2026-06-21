/**
 * NAC OS Intelligence Layer (NIL) — public exports.
 */

export {
  EVIDENCE_LEVELS,
  NIL_DOMAINS,
  NIL_DOMAIN_LABELS,
  NIL_CONFIDENCE,
  createSignal,
  createReasoningStatement,
  createNilReasoningResult,
  createEmptySignalBundleInput,
  resetNilStatementCounter,
} from "./nilContract.ts";

export {
  registerNilDomain,
  getNilDomain,
  listNilDomains,
  getNilBundleKeys,
} from "./domainRegistry.ts";

export {
  registerNilSignalAdapter,
  normalizeSignalBundle,
  adaptGenericSignal,
  groupSignalsByDomain,
} from "./signalFramework.ts";

export {
  scoreStatementConfidence,
  scoreOverallReasoningConfidence,
} from "./confidenceScoring.ts";

export { businessReasoningEngine } from "./businessReasoningEngine.ts";
export { formatNilReasoningText, nilReasoningToAskNacFields } from "./formatNilReasoning.ts";
