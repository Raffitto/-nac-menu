/**
 * Foodics completed-day calendar. Uses Asia/Riyadh civil dates, not the
 * NAC 03:00 operational day. The current Riyadh date is never acquired.
 */

export const FOODICS_ACQUISITION_TZ = "Asia/Riyadh";
export const FOODICS_BRIDGE_NIGHTLY = {
  timezone: FOODICS_ACQUISITION_TZ,
  hour: 1,
  minute: 30,
} as const;

type WallClock = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function asDate(value: Date | string): Date {
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`invalid_as_of:${value}`);
  return parsed;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function riyadhWallClock(asOf: Date | string): WallClock {
  const date = asDate(asOf);
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: FOODICS_ACQUISITION_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value || 0);
  let hour = get("hour");
  if (hour === 24) hour = 0;
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour,
    minute: get("minute"),
    second: get("second"),
  };
}

export function formatIsoDate(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** Asia/Riyadh civil YYYY-MM-DD for the instant. */
export function riyadhCalendarDate(asOf: Date | string): string {
  const w = riyadhWallClock(asOf);
  return formatIsoDate(w.year, w.month, w.day);
}

/** Riyadh wall-clock timestamp with fixed +03:00 offset (no DST). */
export function riyadhOffsetTimestamp(asOf: Date | string): string {
  const w = riyadhWallClock(asOf);
  return `${formatIsoDate(w.year, w.month, w.day)}T${pad(w.hour)}:${pad(w.minute)}:${pad(w.second)}+03:00`;
}

export function addCalendarDays(date: string, days: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`invalid_calendar_date:${date}`);
  const [year, month, day] = date.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day + days));
  return formatIsoDate(utc.getUTCFullYear(), utc.getUTCMonth() + 1, utc.getUTCDate());
}

export function compareIsoDates(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function dateRangeInclusive(from: string, to: string): string[] {
  if (compareIsoDates(from, to) > 0) return [];
  const out: string[] = [];
  let cursor = from;
  while (compareIsoDates(cursor, to) <= 0) {
    out.push(cursor);
    cursor = addCalendarDays(cursor, 1);
  }
  return out;
}

/**
 * Newest Foodics business date that is safe to acquire: yesterday in Asia/Riyadh.
 * Never returns the current Riyadh civil date.
 */
export function newestSafeCompletedDate(asOf: Date | string): string {
  return addCalendarDays(riyadhCalendarDate(asOf), -1);
}

export function isCurrentRiyadhBusinessDate(date: string, asOf: Date | string): boolean {
  return date === riyadhCalendarDate(asOf);
}

export function isSafeCompletedDate(date: string, asOf: Date | string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date)
    && compareIsoDates(date, newestSafeCompletedDate(asOf)) <= 0;
}

/** True around the 01:30 Asia/Riyadh nightly launch window. */
export function isNightlySchedulerWindow(asOf: Date | string): boolean {
  const w = riyadhWallClock(asOf);
  return w.hour === FOODICS_BRIDGE_NIGHTLY.hour;
}
