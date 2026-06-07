/**
 * Parse calendar day / month ranges for Data Vault queries (uploaded facts).
 */

const MONTH_MAP = Object.freeze({
  january: 0,
  jan: 0,
  february: 1,
  feb: 1,
  march: 2,
  mar: 2,
  april: 3,
  apr: 3,
  may: 4,
  june: 5,
  jun: 5,
  july: 6,
  jul: 6,
  august: 7,
  aug: 7,
  september: 8,
  sep: 8,
  sept: 8,
  october: 9,
  oct: 9,
  november: 10,
  nov: 10,
  december: 11,
  dec: 11,
});

function pad2(n) {
  return String(n).padStart(2, "0");
}

function isoDate(y, m, d) {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

function monthBounds(year, monthIndex) {
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  return {
    startDate: isoDate(year, monthIndex + 1, 1),
    endDate: isoDate(year, monthIndex + 1, lastDay),
    label: new Date(Date.UTC(year, monthIndex, 1, 12)).toLocaleDateString("en-GB", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }),
    isSingleDay: false,
    isMonth: true,
  };
}

/**
 * @returns {{ startDate: string, endDate: string, label: string, isSingleDay: boolean, isMonth?: boolean }|null}
 */
export function parseVaultPeriodFromQuestion(question = "", referenceDate = new Date()) {
  const q = String(question || "").toLowerCase().trim();
  if (!q) return null;

  const dmy = q.match(/\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](20\d{2})\b/);
  if (dmy) {
    const iso = isoDate(Number(dmy[3]), Number(dmy[2]), Number(dmy[1]));
    return { startDate: iso, endDate: iso, label: iso, isSingleDay: true };
  }

  const dayMonthYear = q.match(
    /\b(\d{1,2})(?:st|nd|rd|th)?\s+(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sep|sept|october|oct|november|nov|december|dec)\b(?:\s+(20\d{2}))?/,
  );
  if (dayMonthYear) {
    const day = Number(dayMonthYear[1]);
    const monthIndex = MONTH_MAP[dayMonthYear[2]];
    let year = dayMonthYear[3] ? Number(dayMonthYear[3]) : referenceDate.getFullYear();
    if (!dayMonthYear[3] && monthIndex > referenceDate.getMonth()) year -= 1;
    const iso = isoDate(year, monthIndex + 1, day);
    const label = new Date(Date.UTC(year, monthIndex, day, 12)).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });
    return { startDate: iso, endDate: iso, label, isSingleDay: true };
  }

  const monthDay = q.match(
    /\b(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sep|sept|october|oct|november|nov|december|dec)\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:\s+(20\d{2}))?/,
  );
  if (monthDay) {
    const monthIndex = MONTH_MAP[monthDay[1]];
    const day = Number(monthDay[2]);
    let year = monthDay[3] ? Number(monthDay[3]) : referenceDate.getFullYear();
    if (!monthDay[3] && monthIndex > referenceDate.getMonth()) year -= 1;
    const iso = isoDate(year, monthIndex + 1, day);
    const label = new Date(Date.UTC(year, monthIndex, day, 12)).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });
    return { startDate: iso, endDate: iso, label, isSingleDay: true };
  }

  if (/\b(this month|month to date|mtd)\b/.test(q)) {
    const y = referenceDate.getFullYear();
    const m = referenceDate.getMonth();
    return monthBounds(y, m);
  }

  const monthOnly = q.match(
    /\b(?:for|in|during|cover(?:ing|age)?)\s+(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sep|sept|october|oct|november|nov|december|dec)\b(?:\s+(20\d{2}))?/,
  );
  if (monthOnly) {
    const monthIndex = MONTH_MAP[monthOnly[1]];
    let year = monthOnly[2] ? Number(monthOnly[2]) : referenceDate.getFullYear();
    if (!monthOnly[2] && monthIndex > referenceDate.getMonth()) year -= 1;
    return monthBounds(year, monthIndex);
  }

  return null;
}

export function hasVaultDayPeriod(question) {
  const period = parseVaultPeriodFromQuestion(question);
  return Boolean(period?.isSingleDay);
}
