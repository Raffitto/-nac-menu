/**
 * Unified intelligence time windows — Today, 7D, Month.
 * All dashboard modules should use these IDs with timeRangeEngine.
 */

import {
  DEFAULT_RANGE,
  MONTH_HOURS,
  RANGE_OPTIONS,
  rangeExportLabel,
  rangeToHours,
  rangeToSince,
  getRangeBounds,
  hoursToRange,
} from "../../dashboard/utils/rangeState";

export const INTELLIGENCE_RANGE_IDS = ["today", "7d", "month"];

export function normalizeIntelligenceRange(range) {
  const id = String(range || DEFAULT_RANGE).toLowerCase();
  return INTELLIGENCE_RANGE_IDS.includes(id) ? id : DEFAULT_RANGE;
}

/** Stable contract object for hooks, RPC params, and exports. */
export function buildIntelligenceRangeContract(range, referenceDate = new Date()) {
  const id = normalizeIntelligenceRange(range);
  const hours = rangeToHours(id);
  const bounds = getRangeBounds(id, referenceDate);
  const option = RANGE_OPTIONS.find((o) => o.id === id);

  return {
    id,
    label: option?.label ?? "Today",
    title: option?.title ?? "",
    hours,
    isRollupRange: hours >= 168 || hours === MONTH_HOURS,
    sinceIso: rangeToSince(id, referenceDate),
    bounds,
    exportLabel: rangeExportLabel(id),
  };
}

export {
  DEFAULT_RANGE,
  MONTH_HOURS,
  RANGE_OPTIONS,
  rangeExportLabel,
  rangeToHours,
  rangeToSince,
  getRangeBounds,
  hoursToRange,
};
