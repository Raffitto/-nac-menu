/**
 * Export date ranges — presets + custom bounds for PDF/XLSX exports.
 * Default selection mirrors the dashboard filter when unchanged.
 */

import {
  getRangeBounds,
  rangeExportLabel,
  rangeToHours,
  DEFAULT_RANGE,
} from "./rangeState";
import { NAC_BUSINESS_TZ, calendarDayBoundsRiyadh } from "./businessDay";
import { getRiyadhDateKey } from "./googleReviewSnapshotHistory";

export const EXPORT_RANGE_PRESETS = [
  { id: "today", label: "Today" },
  { id: "7d", label: "7D" },
  { id: "30d", label: "30D" },
  { id: "month", label: "This Month" },
  { id: "custom", label: "Custom range" },
];

/** Map dashboard range to the matching export preset (30d is export-only). */
export function dashboardRangeToExportPreset(dashboardRange = DEFAULT_RANGE) {
  if (dashboardRange === "today" || dashboardRange === "7d" || dashboardRange === "month") {
    return dashboardRange;
  }
  return "7d";
}

export function formatExportPeriodLabel(since, until) {
  const fmt = (d) =>
    new Intl.DateTimeFormat("en-GB", {
      timeZone: NAC_BUSINESS_TZ,
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(d instanceof Date ? d : new Date(d));
  return `${fmt(since)} – ${fmt(until)}`;
}

/**
 * Resolve export bounds from preset + optional custom dates.
 * @param {{ preset: string, startDate?: string, endDate?: string, dashboardRange?: string }} opts
 */
export function resolveExportRange({
  preset,
  startDate,
  endDate,
  dashboardRange = DEFAULT_RANGE,
} = {}) {
  const now = new Date();
  let since;
  let until = now;
  let periodId = preset;
  let useRpc = false;
  let rpcHours = 24;

  const applyPreset = (id) => {
    periodId = id;
    if (id === "30d") {
      until = now;
      since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      useRpc = false;
      return;
    }
    if (id === "custom" && startDate && endDate) {
      const startBounds = calendarDayBoundsRiyadh(startDate);
      const endBounds = calendarDayBoundsRiyadh(endDate);
      if (startBounds && endBounds) {
        since = startBounds.start;
        until = endBounds.end > now ? now : endBounds.end;
        useRpc = false;
      }
      return;
    }
    const bounds = getRangeBounds(id, now);
    since = bounds.since;
    until = bounds.until;
    useRpc = ["today", "7d", "month"].includes(id);
    rpcHours = rangeToHours(id);
  };

  if (!preset || preset === "dashboard") {
    applyPreset(dashboardRangeToExportPreset(dashboardRange));
    periodId = dashboardRange;
  } else {
    applyPreset(preset);
  }

  if (!since) {
    const bounds = getRangeBounds(dashboardRange, now);
    since = bounds.since;
    until = bounds.until;
    periodId = dashboardRange;
    useRpc = true;
    rpcHours = rangeToHours(dashboardRange);
  }

  const startDateKey = getRiyadhDateKey(since);
  const endDateKey = getRiyadhDateKey(until);

  return {
    preset: periodId,
    since,
    until,
    sinceIso: since.toISOString(),
    untilIso: until.toISOString(),
    startDate: startDateKey,
    endDate: endDateKey,
    periodLabel: formatExportPeriodLabel(since, until),
    rangeLabel: rangeExportLabel(periodId) || formatExportPeriodLabel(since, until),
    useRpc,
    rpcHours,
  };
}

export function todayRiyadhDateKey() {
  return getRiyadhDateKey();
}
