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
} from "./nilContract";

export {
  registerNilDomain,
  getNilDomain,
  listNilDomains,
  getNilBundleKeys,
} from "./domainRegistry";

export {
  registerNilSignalAdapter,
  normalizeSignalBundle,
  adaptGenericSignal,
  groupSignalsByDomain,
} from "./signalFramework";

export {
  scoreStatementConfidence,
  scoreOverallReasoningConfidence,
} from "./confidenceScoring";

export { businessReasoningEngine } from "./businessReasoningEngine";
export { formatNilReasoningText, nilReasoningToAskNacFields } from "./formatNilReasoning";
