/**
 * Canonical NAC / KSA business week (Edge copy — keep in lockstep with
 * src/intelligence/askNac/shared/nacBusinessWeek.js).
 */

export const NAC_WEEK_TZ = "Asia/Riyadh";

export function riyadhIsoDate(referenceDate: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: NAC_WEEK_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(referenceDate);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function addIsoDays(iso: string, delta: number): string {
  const [y, m, d] = String(iso).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + Number(delta || 0)));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

export function utcWeekdaySundayFirst(isoDate: string): number {
  const t = Date.parse(`${isoDate}T12:00:00Z`);
  if (!Number.isFinite(t)) return 0;
  return new Date(t).getUTCDay();
}

export function nacBusinessWeekRange(isoDate: string): { startDate: string; endDate: string } {
  const startDate = addIsoDays(isoDate, -utcWeekdaySundayFirst(isoDate));
  return { startDate, endDate: addIsoDays(startDate, 6) };
}

export function nacPreviousBusinessWeekRange(isoDate: string): { startDate: string; endDate: string } {
  const current = nacBusinessWeekRange(isoDate);
  return {
    startDate: addIsoDays(current.startDate, -7),
    endDate: addIsoDays(current.endDate, -7),
  };
}

export function daysBetweenIso(start: string, end: string): number {
  const a = Date.parse(`${start}T12:00:00Z`);
  const b = Date.parse(`${end}T12:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86400000);
}

export function nacLikeForLikePriorWeek(availableStart: string, availableEnd: string) {
  const week = nacBusinessWeekRange(availableStart);
  const priorStart = addIsoDays(week.startDate, -7);
  return {
    startDate: addIsoDays(priorStart, daysBetweenIso(week.startDate, availableStart)),
    endDate: addIsoDays(priorStart, daysBetweenIso(week.startDate, availableEnd)),
  };
}

export function riyadhHour(referenceDate: Date = new Date()): number {
  const raw = new Intl.DateTimeFormat("en-GB", {
    timeZone: NAC_WEEK_TZ,
    hour: "2-digit",
    hourCycle: "h23",
  }).format(referenceDate);
  return Number(String(raw).replace(/[^\d]/g, "").slice(0, 2)) || 0;
}

export const CASH_UP_COMPLETED_DAY_HOUR = 8;

export function latestCompletedBusinessDate(referenceDate: Date = new Date()): string {
  const today = riyadhIsoDate(referenceDate);
  const lag = riyadhHour(referenceDate) < CASH_UP_COMPLETED_DAY_HOUR ? 2 : 1;
  return addIsoDays(today, -lag);
}

export function nacThisWeekPeriod(referenceDate: Date = new Date()) {
  const today = riyadhIsoDate(referenceDate);
  const { startDate, endDate } = nacBusinessWeekRange(today);
  return {
    startDate,
    endDate,
    requestedStartDate: startDate,
    requestedEndDate: endDate,
    label: "this week",
    periodType: "this_week",
    isSingleDay: false,
    isWeek: true,
    isRange: true,
    expectedDayCount: 7,
  };
}

export function nacLastWeekPeriod(referenceDate: Date = new Date()) {
  const today = riyadhIsoDate(referenceDate);
  const { startDate, endDate } = nacPreviousBusinessWeekRange(today);
  return {
    startDate,
    endDate,
    requestedStartDate: startDate,
    requestedEndDate: endDate,
    label: "last week",
    periodType: "last_week",
    isSingleDay: false,
    isWeek: true,
    isRange: true,
    expectedDayCount: 7,
  };
}
