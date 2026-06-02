/**
 * Shared time windows for all intelligence modules.
 */

import {
  buildIntelligenceRangeContract,
  hoursToRange,
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

/** RPC `p_hours` from platform filter state (selectedRange wins when out of sync). */
export function hoursFromPlatformFilters(filters = {}) {
  const fromRange = rangeToHours(filters.selectedRange || "today");
  const stored = Number(filters.timeRangeHours);
  if (!Number.isFinite(stored)) return fromRange;
  if (hoursToRange(stored) !== (filters.selectedRange || "today")) return fromRange;
  return stored;
}

/** Full contract from platform filter context. */
export function rangeContractFromFilters(filters = {}) {
  return buildIntelligenceRangeContract(filters.selectedRange || "today");
}
