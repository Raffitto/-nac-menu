/** Shared admin intelligence range: today | 7d | month → RPC p_hours */

import { getBusinessDayRange, getCurrentMonthStart } from "./businessDay";

export const MONTH_HOURS = 999;

export const DEFAULT_RANGE = "today";

export const RANGE_OPTIONS = [
  { id: "today", label: "Today", hours: 24, title: "NAC business day · 3:00 AM – 2:59 AM (Asia/Riyadh)" },
  { id: "7d", label: "7D", hours: 168, title: "Last 7 business-day windows" },
  { id: "month", label: "This Month", hours: MONTH_HOURS, title: "Calendar month to date (Asia/Riyadh)" },
];

export function rangeToHours(range) {
  const match = RANGE_OPTIONS.find((o) => o.id === range);
  return match?.hours ?? 24;
}

export function hoursToRange(hours) {
  const h = Number(hours);
  if (h === 168) return "7d";
  if (h === MONTH_HOURS || h === 720) return "month";
  return "today";
}

export function rangeExportLabel(range) {
  const match = RANGE_OPTIONS.find((o) => o.id === range);
  return match?.label ?? "Today";
}

/** { since: Date, until: Date } for the selected range (business-day aware). */
export function getRangeBounds(range, referenceDate = new Date()) {
  const until = referenceDate instanceof Date ? referenceDate : new Date(referenceDate);
  if (range === "today") {
    const { start } = getBusinessDayRange(referenceDate);
    return { since: start, until };
  }
  if (range === "month") {
    return { since: getCurrentMonthStart(referenceDate), until };
  }
  if (range === "7d") {
    const cur = getBusinessDayRange(referenceDate);
    return {
      since: new Date(cur.start.getTime() - 6 * 24 * 60 * 60 * 1000),
      until,
    };
  }
  const hours = rangeToHours(range);
  if (hours === 24) {
    const { start } = getBusinessDayRange(referenceDate);
    return { since: start, until };
  }
  if (hours === MONTH_HOURS) {
    return { since: getCurrentMonthStart(referenceDate), until };
  }
  return { since: new Date(until.getTime() - hours * 3600000), until };
}

/** ISO timestamp lower bound for client-side Supabase queries */
export function rangeToSince(range, referenceDate = new Date()) {
  if (range === "today") {
    return getBusinessDayRange(referenceDate).start.toISOString();
  }
  if (range === "month") {
    return getCurrentMonthStart(referenceDate).toISOString();
  }
  if (range === "7d") {
    const cur = getBusinessDayRange(referenceDate);
    return new Date(cur.start.getTime() - 6 * 24 * 60 * 60 * 1000).toISOString();
  }
  const hours = rangeToHours(range);
  if (hours === 24) return getBusinessDayRange(referenceDate).start.toISOString();
  if (hours === MONTH_HOURS) return getCurrentMonthStart(referenceDate).toISOString();
  return new Date(referenceDate.getTime() - hours * 3600000).toISOString();
}

export { branchDisplayName, defaultBranchId, normalizeBranchId } from "./branchIdentity";
