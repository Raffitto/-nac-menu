/**
 * Canonical NAC / KSA business week.
 * Week starts Sunday and ends Saturday. Timezone: Asia/Riyadh.
 * Do not use locale Monday-start or rolling last-7 as "this week".
 */

export const NAC_WEEK_TZ = "Asia/Riyadh";

export function riyadhIsoDate(referenceDate = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: NAC_WEEK_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(referenceDate instanceof Date ? referenceDate : new Date(referenceDate));
  const get = (type) => parts.find((p) => p.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function addIsoDays(iso, delta) {
  const [y, m, d] = String(iso).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + Number(delta || 0)));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

export function utcWeekdaySundayFirst(isoDate) {
  const t = Date.parse(`${isoDate}T12:00:00Z`);
  if (!Number.isFinite(t)) return 0;
  return new Date(t).getUTCDay();
}

export function nacBusinessWeekRange(isoDate) {
  const startDate = addIsoDays(isoDate, -utcWeekdaySundayFirst(isoDate));
  return { startDate, endDate: addIsoDays(startDate, 6) };
}

export function nacPreviousBusinessWeekRange(isoDate) {
  const current = nacBusinessWeekRange(isoDate);
  return {
    startDate: addIsoDays(current.startDate, -7),
    endDate: addIsoDays(current.endDate, -7),
  };
}

export function daysBetweenIso(start, end) {
  const a = Date.parse(`${start}T12:00:00Z`);
  const b = Date.parse(`${end}T12:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86400000);
}

/**
 * Same weekday positions in the previous Sunday week.
 * Example: Wed 9 Sep available 6–8 Sep → prior 30 Aug–1 Sep.
 */
export function nacLikeForLikePriorWeek(availableStart, availableEnd) {
  if (!availableStart || !availableEnd) return null;
  const week = nacBusinessWeekRange(availableStart);
  const priorStart = addIsoDays(week.startDate, -7);
  return {
    startDate: addIsoDays(priorStart, daysBetweenIso(week.startDate, availableStart)),
    endDate: addIsoDays(priorStart, daysBetweenIso(week.startDate, availableEnd)),
  };
}

export function latestCompletedBusinessDate(referenceDate = new Date()) {
  return addIsoDays(riyadhIsoDate(referenceDate), -1);
}

export function nacThisWeekPeriod(referenceDate = new Date()) {
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

export function nacLastWeekPeriod(referenceDate = new Date()) {
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
