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

function shiftLocalDate(referenceDate, dayDelta) {
  const day = new Date(referenceDate);
  day.setDate(day.getDate() + dayDelta);
  return day;
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
    periodType: "named_month",
    isSingleDay: false,
    isMonth: true,
    isRange: true,
  };
}

function monthToDateBounds(referenceDate) {
  const y = referenceDate.getFullYear();
  const m = referenceDate.getMonth();
  const label = new Date(Date.UTC(y, m, 1, 12)).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  return {
    startDate: isoDate(y, m + 1, 1),
    endDate: isoDate(y, m + 1, referenceDate.getDate()),
    label: `${label} (to date)`,
    periodType: "this_month",
    isSingleDay: false,
    isMonth: true,
    isRange: true,
  };
}

function rollingRange(referenceDate, days, { endOffset = 0, label, periodType }) {
  const end = shiftLocalDate(referenceDate, endOffset);
  const start = shiftLocalDate(end, -(days - 1));
  return {
    startDate: isoDate(start.getFullYear(), start.getMonth() + 1, start.getDate()),
    endDate: isoDate(end.getFullYear(), end.getMonth() + 1, end.getDate()),
    label,
    periodType,
    isSingleDay: false,
    isRange: true,
  };
}

function previousCalendarWeekBounds(referenceDate) {
  const end = shiftLocalDate(referenceDate, -referenceDate.getDay());
  const start = shiftLocalDate(end, -6);
  return {
    startDate: isoDate(start.getFullYear(), start.getMonth() + 1, start.getDate()),
    endDate: isoDate(end.getFullYear(), end.getMonth() + 1, end.getDate()),
    label: "previous week",
    periodType: "previous_week",
    isSingleDay: false,
    isWeek: true,
    isRange: true,
  };
}

/**
 * @returns {{ periodType: string, startDate: string, endDate: string, label: string, isSingleDay: boolean, isMonth?: boolean, isWeek?: boolean, isRange?: boolean }|null}
 */
export function parseVaultPeriodFromQuestion(question = "", referenceDate = new Date()) {
  const q = String(question || "").toLowerCase().trim();
  if (!q) return null;

  if (/\b(last|past)\s+30\s+days?\b/.test(q)) {
    return rollingRange(referenceDate, 30, { label: "last 30 days", periodType: "last_30_days" });
  }

  if (/\b(last|past)\s+14\s+days?\b/.test(q) || /\b(last|past)\s+two\s+weeks?\b/.test(q)) {
    return rollingRange(referenceDate, 14, { label: "last 14 days", periodType: "last_14_days" });
  }

  if (/\b(last|past)\s+7\s+days?\b/.test(q)) {
    return rollingRange(referenceDate, 7, { label: "last 7 days", periodType: "last_7_days" });
  }

  if (/\bprevious\s+week\b/.test(q)) {
    return previousCalendarWeekBounds(referenceDate);
  }

  if (/\blast\s+week\b/.test(q)) {
    return rollingRange(referenceDate, 7, { endOffset: -1, label: "last week", periodType: "last_week" });
  }

  if (/\byesterday\b/.test(q)) {
    const day = shiftLocalDate(referenceDate, -1);
    const iso = isoDate(day.getFullYear(), day.getMonth() + 1, day.getDate());
    const label = new Date(Date.UTC(day.getFullYear(), day.getMonth(), day.getDate(), 12)).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });
    return { startDate: iso, endDate: iso, label, periodType: "single_day", isSingleDay: true };
  }

  const dmy = q.match(/\b(\d{1,2})[/.-](\d{1,2})[/.-](20\d{2})\b/);
  if (dmy) {
    const iso = isoDate(Number(dmy[3]), Number(dmy[2]), Number(dmy[1]));
    return { startDate: iso, endDate: iso, label: iso, periodType: "single_day", isSingleDay: true };
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
    return { startDate: iso, endDate: iso, label, periodType: "single_day", isSingleDay: true };
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
    return { startDate: iso, endDate: iso, label, periodType: "single_day", isSingleDay: true };
  }

  if (/\b(this month|current month|month to date|mtd)\b/.test(q)) {
    return monthToDateBounds(referenceDate);
  }

  if (/\b(this week|current week|past week)\b/.test(q)) {
    return {
      ...rollingRange(referenceDate, 7, { label: "this week", periodType: "this_week" }),
      isWeek: true,
    };
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

  const contextualMonth = q.match(
    /\b(cash[\s-]?up|ccm|reconciliation|reconcile|logbook|reception|uploaded|coverage|report|files)\b.*\b(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sep|sept|october|oct|november|nov|december|dec)\b(?:\s+(20\d{2}))?/,
  );
  if (contextualMonth) {
    const monthIndex = MONTH_MAP[contextualMonth[2]];
    let year = contextualMonth[3] ? Number(contextualMonth[3]) : referenceDate.getFullYear();
    if (!contextualMonth[3] && monthIndex > referenceDate.getMonth()) year -= 1;
    return monthBounds(year, monthIndex);
  }

  return null;
}

/**
 * Current + previous rolling periods for cash-up compare questions.
 */
export function parseVaultComparePeriodsFromQuestion(question = "", referenceDate = new Date()) {
  const q = String(question || "").toLowerCase().trim();
  if (!q) return null;

  const compare7 = /\b(last|past)\s+7\s+days?\b.*\b(vs|versus|compared to|against|compare)\b.*\b(previous|prior|preceding)\s+7\s+days?\b/.test(q)
    || /\bcompare\b.*\b(last|past)\s+7\s+days?\b.*\b(previous|prior|preceding)\s+7\s+days?\b/.test(q);
  if (compare7) {
    const current = rollingRange(referenceDate, 7, { label: "last 7 days", periodType: "last_7_days" });
    const previousEnd = shiftLocalDate(new Date(`${current.startDate}T12:00:00`), -1);
    const previous = rollingRange(previousEnd, 7, { label: "previous 7 days", periodType: "previous_7_days" });
    return { current, previous };
  }

  const compare14 = /\b(last|past)\s+14\s+days?\b.*\b(vs|versus|compared to|against|compare)\b/.test(q);
  if (compare14) {
    const current = rollingRange(referenceDate, 14, { label: "last 14 days", periodType: "last_14_days" });
    const previousEnd = shiftLocalDate(new Date(`${current.startDate}T12:00:00`), -1);
    const previous = rollingRange(previousEnd, 14, { label: "previous 14 days", periodType: "previous_14_days" });
    return { current, previous };
  }

  return null;
}

export function hasVaultDayPeriod(question) {
  const period = parseVaultPeriodFromQuestion(question);
  return Boolean(period?.isSingleDay);
}

export function isVaultRangePeriod(period) {
  return Boolean(period?.isRange && !period?.isSingleDay);
}

const CASH_UP_ANALYTICS_PERIOD_TYPES = new Set([
  "last_7_days",
  "last_14_days",
  "last_30_days",
  "last_week",
  "previous_week",
  "this_week",
  "this_month",
  "previous_7_days",
  "previous_14_days",
]);

export function isVaultCashUpAnalyticsPeriod(period) {
  return Boolean(period?.periodType && CASH_UP_ANALYTICS_PERIOD_TYPES.has(period.periodType));
}
