/**
 * Calendar completion vs missing completed days.
 * Current incomplete business days are not "missing" historical days.
 */

import { addIsoDays, formatManagerDate, parseIsoUtc } from "./managementPresentation.ts";
import type { DateRange } from "./types.ts";

function inclusiveDays(start: string, end: string): number {
  const a = Date.parse(`${start}T00:00:00Z`);
  const b = Date.parse(`${end}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return 0;
  return Math.round((b - a) / 86400000) + 1;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function ksaCalendarIso(referenceDate: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(referenceDate);
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const d = parts.find((p) => p.type === "day")?.value;
  if (y && m && d) return `${y}-${m}-${d}`;
  return referenceDate.toISOString().slice(0, 10);
}

export function latestCompletedBusinessDay(referenceDate: Date = new Date()): string {
  return addIsoDays(ksaCalendarIso(referenceDate), -1);
}

export function isCurrentIncompleteDay(iso: string | null | undefined, referenceDate: Date = new Date()): boolean {
  if (!iso) return false;
  return iso === ksaCalendarIso(referenceDate);
}

export function completedThroughDate(
  requestedEnd: string | null | undefined,
  referenceDate: Date = new Date(),
): string | null {
  if (!requestedEnd) return latestCompletedBusinessDay(referenceDate);
  const yesterday = latestCompletedBusinessDay(referenceDate);
  return requestedEnd < yesterday ? requestedEnd : yesterday;
}

export type CalendarCoverageStatus =
  | "complete_through_yesterday"
  | "includes_incomplete_today"
  | "missing_completed_days"
  | "today_incomplete"
  | "unavailable"
  | "full";

export type CalendarCoverage = {
  requestedStart: string | null;
  requestedEnd: string | null;
  completedThrough: string | null;
  expectedCompletedDays: number | null;
  observedCompletedDays: number | null;
  missingCompletedDays: number | null;
  currentIncompleteDays: number;
  status: CalendarCoverageStatus;
};

export function classifyCalendarCoverage(input: {
  requestedStart?: string | null;
  requestedEnd?: string | null;
  observedDays?: number | null;
  observedDates?: string[];
  referenceDate?: Date;
}): CalendarCoverage {
  const ref = input.referenceDate || new Date();
  const today = ksaCalendarIso(ref);
  const yesterday = latestCompletedBusinessDay(ref);
  const start = input.requestedStart || null;
  const end = input.requestedEnd || null;
  const completedThrough = completedThroughDate(end, ref);
  const includesToday = Boolean(start && end && start <= today && end >= today);
  let expectedCompleted: number | null = null;
  if (start && completedThrough && start <= completedThrough) {
    expectedCompleted = inclusiveDays(start, completedThrough);
  } else if (start && end && end < start) {
    expectedCompleted = 0;
  }
  const observedDates = (input.observedDates || []).filter((d) => d && (!completedThrough || d <= completedThrough));
  const observedCompleted = observedDates.length
    ? observedDates.length
    : (input.observedDays != null
      ? (includesToday ? Math.max(0, Number(input.observedDays) - (end === today ? 1 : 0)) : Number(input.observedDays))
      : null);
  const missingCompleted = expectedCompleted != null && observedCompleted != null
    ? Math.max(0, expectedCompleted - observedCompleted)
    : null;
  let status: CalendarCoverageStatus = "full";
  if (observedCompleted === 0 && isCurrentIncompleteDay(start, ref) && start === end) {
    status = "today_incomplete";
  } else if (observedCompleted === 0) {
    status = "unavailable";
  } else if (missingCompleted != null && missingCompleted > 0) {
    status = "missing_completed_days";
  } else if (includesToday) {
    status = "includes_incomplete_today";
  } else if (completedThrough) {
    status = "complete_through_yesterday";
  }
  return {
    requestedStart: start,
    requestedEnd: end,
    completedThrough,
    expectedCompletedDays: expectedCompleted,
    observedCompletedDays: observedCompleted,
    missingCompletedDays: missingCompleted,
    currentIncompleteDays: includesToday ? 1 : 0,
    status,
  };
}

export function formatThroughPeriod(period: DateRange | null | undefined, referenceDate: Date = new Date()): string | null {
  if (!period?.startDate) return null;
  const through = completedThroughDate(period.endDate, referenceDate);
  if (!through) return null;
  const start = parseIsoUtc(period.startDate);
  if (!start) return null;
  const month = MONTHS[start.getUTCMonth()];
  const throughDt = parseIsoUtc(through);
  const throughDay = throughDt ? throughDt.getUTCDate() : through;
  if (period.startDate === period.endDate) return formatManagerDate(period.startDate);
  if (period.startDate.endsWith("-01") && period.startDate.slice(0, 7) === String(through).slice(0, 7)) {
    return `${month} through ${throughDay} ${month}`;
  }
  return null;
}
