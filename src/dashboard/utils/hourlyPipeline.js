/**
 * Hourly chart pipeline — range-aware granularity + debug payload for window.__NAC_PIPELINE_DEBUG__.hourly
 */

import { rangeToHours, MONTH_HOURS } from "./rangeState";
import {
  normalizeHourlyDistribution,
  detectHourlyGranularity,
  hourlyChartRows,
  businessDayKeysForRange,
} from "./hourlyBucketLabels";

/** Today (24h) → hourly buckets; 7D/month → daily buckets (Asia/Riyadh). */
export function resolveChartGranularityForHours(hours) {
  const h = Number(hours);
  if (!Number.isFinite(h) || h <= 0) return "hour";
  if (h <= 24) return "hour";
  return "day";
}

export function dayCountForHours(hours) {
  const h = Number(hours);
  if (h === MONTH_HOURS || h === 720) return 31;
  if (h >= 168) return 7;
  return 7;
}

export function normalizeHourlyForRange(byHourRaw = [], hours = 24) {
  const gran = resolveChartGranularityForHours(hours);
  const dayCount = dayCountForHours(hours);
  return normalizeHourlyDistribution(byHourRaw, {
    granularity: gran,
    dayCount,
    dayKeys: gran === "day" ? businessDayKeysForRange(dayCount) : undefined,
  });
}

export function buildHourlyChartData(byHourRaw = [], hours = 24) {
  const gran = resolveChartGranularityForHours(hours);
  const normalized = normalizeHourlyForRange(byHourRaw, hours);
  const rows = hourlyChartRows(normalized, {
    fillGaps: false,
    granularity: gran,
    dayCount: dayCountForHours(hours),
  });
  return { rows, granularity: gran, normalized };
}

export function buildHourlyDebugPayload({
  hours,
  selectedRange,
  branch,
  source,
  byHourRaw = [],
  byHourNormalized = [],
  chartRows = [],
}) {
  const gran = resolveChartGranularityForHours(hours);
  const rawGran = detectHourlyGranularity(byHourRaw);
  const nonZero = (chartRows.length ? chartRows : byHourNormalized).filter((r) => (Number(r.count) || 0) > 0);
  return {
    at: new Date().toISOString(),
    selectedRange: selectedRange || null,
    hours: Number(hours) || 24,
    branch: branch || null,
    source: source || null,
    expectedGranularity: gran,
    rawGranularity: rawGran,
    rawBucketCount: (byHourRaw || []).length,
    normalizedBucketCount: (byHourNormalized || []).length,
    chartBucketCount: (chartRows || []).length,
    nonZeroBuckets: nonZero.length,
    sampleLabels: (chartRows || byHourNormalized).slice(0, 5).map((r) => r.label || r.hour),
    collapsedToSingleBar:
      gran === "hour"
        ? nonZero.length <= 1 && (byHourNormalized || []).length >= 24
        : nonZero.length <= 1 && (byHourNormalized || []).length > 1,
    buckets: (chartRows || byHourNormalized).map((r) => ({
      label: r.label || String(r.hour),
      count: Number(r.count) || 0,
      granularity: r.granularity || gran,
    })),
  };
}

export function publishHourlyPipelineDebug(payload) {
  if (typeof window === "undefined") return;
  window.__NAC_PIPELINE_DEBUG__ = window.__NAC_PIPELINE_DEBUG__ || {};
  window.__NAC_PIPELINE_DEBUG__.hourly = payload;
}

export function hoursFromFilters(filters = {}) {
  return filters.timeRangeHours ?? rangeToHours(filters.selectedRange || "today");
}
