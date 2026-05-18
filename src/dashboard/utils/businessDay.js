/** NAC operational day: 03:00 Asia/Riyadh → 02:59:59 next calendar day */

export const NAC_BUSINESS_TZ = "Asia/Riyadh";
export const BUSINESS_DAY_START_HOUR = 3;

function partsInTz(date, timeZone = NAC_BUSINESS_TZ) {
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
  const get = (type) => Number(parts.find((p) => p.type === type)?.value || 0);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

/** YYYY-MM-DD key for the NAC business day containing `date` */
export function getBusinessDayKey(date = new Date(), timeZone = NAC_BUSINESS_TZ) {
  const p = partsInTz(date, timeZone);
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

function zonedTimeToUtc(y, m, d, h, min = 0, sec = 0, timeZone = NAC_BUSINESS_TZ) {
  const guess = new Date(Date.UTC(y, m - 1, d, h, min, sec));
  const p = partsInTz(guess, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const offset = asUtc - guess.getTime();
  return new Date(Date.UTC(y, m - 1, d, h, min, sec) - offset);
}

/** Start of current calendar month in Asia/Riyadh (month-to-date lower bound) */
export function getCurrentMonthStart(date = new Date(), timeZone = NAC_BUSINESS_TZ) {
  const p = partsInTz(date, timeZone);
  return zonedTimeToUtc(p.year, p.month, 1, 0, 0, 0, timeZone);
}

/** { start, end, key, label } for the business day containing `date` */
export function getBusinessDayRange(date = new Date(), timeZone = NAC_BUSINESS_TZ) {
  const key = getBusinessDayKey(date, timeZone);
  const [y, m, d] = key.split("-").map(Number);
  const start = zonedTimeToUtc(y, m, d, BUSINESS_DAY_START_HOUR, 0, 0, timeZone);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1000);
  const label = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(start);
  return { start, end, key, label };
}

export function isWithinBusinessDay(timestamp, referenceDate = new Date(), timeZone = NAC_BUSINESS_TZ) {
  const ts = timestamp instanceof Date ? timestamp : new Date(timestamp);
  const { start, end } = getBusinessDayRange(referenceDate, timeZone);
  return ts >= start && ts <= end;
}

/** Map dashboard p_hours filter to human period label */
export function periodLabelFromHours(pHours, referenceDate = new Date()) {
  const h = Number(pHours) || 0;
  if (h === 0) return "All time";
  if (h === 24) {
    const { label, key } = getBusinessDayRange(referenceDate);
    return `Business day ${label} (${key}) · 3:00 AM – 2:59 AM`;
  }
  if (h === 168) return "Last 7 business days · from 3:00 AM anchors";
  if (h === 999 || h === 720) {
    const start = getCurrentMonthStart(referenceDate);
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: NAC_BUSINESS_TZ,
      month: "short",
      day: "numeric",
    });
    return `This month · ${fmt.format(start)} – now (Asia/Riyadh)`;
  }
  return `Last ${h} hours`;
}

/** Client-side filter when RPC cannot be re-run (e.g. cached rows) */
export function filterEventsByBusinessHours(events, pHours, referenceDate = new Date()) {
  const h = Number(pHours) || 0;
  if (!h || !Array.isArray(events)) return events;
  let since;
  if (h === 24) {
    since = getBusinessDayRange(referenceDate).start;
  } else if (h === 168) {
    const cur = getBusinessDayRange(referenceDate);
    since = new Date(cur.start.getTime() - 6 * 24 * 60 * 60 * 1000);
  } else if (h === 999 || h === 720) {
    since = getCurrentMonthStart(referenceDate);
  } else {
    since = new Date(referenceDate.getTime() - h * 60 * 60 * 1000);
  }
  return events.filter((e) => {
    const t = new Date(e.created_at || e.timestamp);
    return t >= since && t <= referenceDate;
  });
}

export function businessDayExportNote(referenceDate = new Date()) {
  const { key } = getBusinessDayRange(referenceDate);
  return `NAC business day ${key}: 03:00 – 02:59 (Asia/Riyadh)`;
}
