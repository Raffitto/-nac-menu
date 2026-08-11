/**
 * NAC / KSA business-calendar helpers.
 * Operational week is Sunday-first; weekend remains Friday–Saturday.
 */

import type { IsoDate } from "./types.ts";

export const KSA_WEEKEND_DAYS = Object.freeze([5, 6] as const); // Fri=5, Sat=6 (JS getUTCDay)

/** Sunday-first business week: Sun=0 … Sat=6 */
export function sundayFirstWeekdayIndex(isoDate: IsoDate): number {
  const js = utcWeekday(isoDate); // Sun=0 … Sat=6 already in JS
  return js;
}

export function utcWeekday(isoDate: IsoDate): number {
  const t = Date.parse(`${isoDate}T12:00:00Z`);
  if (!Number.isFinite(t)) return 0;
  return new Date(t).getUTCDay();
}

export const WEEKDAY_NAMES_SUNDAY_FIRST = Object.freeze([
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const);

export function weekdayNameSundayFirst(isoDate: IsoDate): string {
  return WEEKDAY_NAMES_SUNDAY_FIRST[sundayFirstWeekdayIndex(isoDate)] || "Sunday";
}

export function isKsaWeekend(isoDate: IsoDate): boolean {
  const d = utcWeekday(isoDate);
  return d === 5 || d === 6;
}

/** ISO week key with Sunday as first day of the business week. */
export function saudiBusinessWeekKey(isoDate: IsoDate): string {
  const t = Date.parse(`${isoDate}T12:00:00Z`);
  const d = new Date(t);
  const day = d.getUTCDay(); // 0=Sun
  const weekStart = new Date(d);
  weekStart.setUTCDate(d.getUTCDate() - day);
  const y = weekStart.getUTCFullYear();
  const m = String(weekStart.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(weekStart.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`; // week starting Sunday
}

export function saudiBusinessWeekRange(isoDate: IsoDate): { startDate: IsoDate; endDate: IsoDate } {
  const key = saudiBusinessWeekKey(isoDate);
  const start = Date.parse(`${key}T12:00:00Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  const endDate = end.toISOString().slice(0, 10) as IsoDate;
  return { startDate: key as IsoDate, endDate };
}

export type WeekdayComposition = {
  weekdays: string[];
  sundayFirstIndexes: number[];
  weekendDayCount: number;
  signature: string;
};

export function weekdayComposition(dates: IsoDate[]): WeekdayComposition {
  const weekdays = dates.map(weekdayNameSundayFirst);
  const sundayFirstIndexes = dates.map(sundayFirstWeekdayIndex);
  const weekendDayCount = dates.filter(isKsaWeekend).length;
  return {
    weekdays,
    sundayFirstIndexes,
    weekendDayCount,
    signature: sundayFirstIndexes.join("-"),
  };
}

export function weekdayCompositionsMatch(a: WeekdayComposition, b: WeekdayComposition): boolean {
  return a.signature === b.signature;
}

export function addUtcDays(isoDate: IsoDate, days: number): IsoDate {
  const t = Date.parse(`${isoDate}T12:00:00Z`);
  const d = new Date(t);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10) as IsoDate;
}

export function enumerateInclusiveDates(startDate: IsoDate, endDate: IsoDate): IsoDate[] {
  const out: IsoDate[] = [];
  let cur = startDate;
  let guard = 0;
  while (cur <= endDate && guard < 400) {
    out.push(cur);
    cur = addUtcDays(cur, 1);
    guard += 1;
  }
  return out;
}
