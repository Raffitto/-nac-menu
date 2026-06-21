/**
 * External Context Intelligence — public exports.
 */

export {
  EXTERNAL_SIGNAL_TYPES,
  EXTERNAL_IMPACT_DIRECTIONS,
  EXTERNAL_CONFIDENCE_LEVELS,
  SIGNAL_TYPE_TO_NIL_DOMAIN,
  EXTERNAL_CONTEXT_UNAVAILABLE_NOTE,
  FORBIDDEN_CAUSALITY_PATTERNS,
  normalizeCompetitorName,
  validateExternalContextSignalRow,
  validateCompetitorRow,
  mapSignalTypeToNilDomain,
  scoreSignalPeriodOverlap,
  containsForbiddenCausalityLanguage,
} from "./externalContextContract";

export {
  normalizeCompetitorRecord,
  filterActiveCompetitorsForBranch,
  findCompetitorByName,
  KHOBAR_COMPETITOR_SEED_NAMES,
} from "./competitorRegistry";

export {
  adaptExternalContextToNilBundle,
  mergeNilSignalBundles,
  hasExternalContextSignals,
} from "./adapters/externalContextSignalAdapter";
