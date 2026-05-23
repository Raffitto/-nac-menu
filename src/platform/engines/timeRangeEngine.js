/**
 * Shared time windows for all intelligence modules.
 */

import {
  buildIntelligenceRangeContract,
  rangeToHours,
} from "../contracts/intelligenceRangeContract";

export {
  INTELLIGENCE_RANGE_IDS,
  normalizeIntelligenceRange,
  buildIntelligenceRangeContract,
  DEFAULT_RANGE,
  MONTH_HOURS,
  RANGE_OPTIONS,
  rangeExportLabel,
  rangeToHours,
  rangeToSince,
  getRangeBounds,
  hoursToRange,
} from "../contracts/intelligenceRangeContract";

/** RPC `p_hours` from platform filter state. */
export function hoursFromPlatformFilters(filters = {}) {
  if (filters.timeRangeHours != null) return Number(filters.timeRangeHours) || 24;
  return rangeToHours(filters.selectedRange || "today");
}

/** Full contract from platform filter context. */
export function rangeContractFromFilters(filters = {}) {
  return buildIntelligenceRangeContract(filters.selectedRange || "today");
}
