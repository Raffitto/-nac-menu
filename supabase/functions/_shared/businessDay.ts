/** NAC business day key — keep in sync with src/dashboard/utils/businessDay.js */

export const NAC_BUSINESS_TZ = "Asia/Riyadh";
export const BUSINESS_DAY_START_HOUR = 3;

function partsInTz(date: Date, timeZone = NAC_BUSINESS_TZ) {
  const d = date instanceof Date ? date : new Date(date);
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(d);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value || 0);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
  };
}

/** YYYY-MM-DD key for the NAC business day containing `date` */
export function getBusinessDayKey(date = new Date(), timeZone = NAC_BUSINESS_TZ): string {
  const p = partsInTz(date instanceof Date ? date : new Date(date), timeZone);
  let y = p.year;
  let m = p.month;
  let d = p.day;
  if (p.hour < BUSINESS_DAY_START_HOUR) {
    const utc = Date.UTC(y, m - 1, d);
    const prev = new Date(utc - 86400000);
    const pp = partsInTz(prev, timeZone);
    y = pp.year;
    m = pp.month;
    d = pp.day;
  }
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
