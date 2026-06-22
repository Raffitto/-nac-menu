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

const MONTH_PATTERN = "(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sep|sept|october|oct|november|nov|december|dec)";

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

function resolveYearForMonth(monthIndex, explicitYear, referenceDate) {
  let year = explicitYear ? Number(explicitYear) : referenceDate.getFullYear();
  if (!explicitYear && monthIndex > referenceDate.getMonth()) year -= 1;
  return year;
}

function formatDayMonthLabel(year, monthIndex, day) {
  return new Date(Date.UTC(year, monthIndex, day, 12)).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatRangeLabel(startDate, endDate) {
  const [sy, sm, sd] = startDate.split("-").map(Number);
  const [ey, em, ed] = endDate.split("-").map(Number);
  if (startDate === endDate) return formatDayMonthLabel(sy, sm - 1, sd);
  if (sy === ey && sm === em) {
    const monthLabel = new Date(Date.UTC(sy, sm - 1, 1, 12)).toLocaleDateString("en-GB", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });
    return `${sd}–${ed} ${monthLabel}`;
  }
  return `${formatDayMonthLabel(sy, sm - 1, sd)} – ${formatDayMonthLabel(ey, em - 1, ed)}`;
}

function buildCustomRangePeriod(startDate, endDate, label, periodType = "custom_range") {
  return {
    startDate,
    endDate,
    label: label || formatRangeLabel(startDate, endDate),
    periodType,
    isSingleDay: startDate === endDate,
    isRange: startDate !== endDate,
  };
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
 * Parse first/second half month phrases from a text fragment.
 */
export function parseHalfMonthPhrase(text = "", referenceDate = new Date()) {
  const q = String(text || "").toLowerCase().trim();
  if (!q) return null;

  const firstHalfMonth = q.match(new RegExp(`\\bfirst\\s+half\\s+(?:of\\s+)?${MONTH_PATTERN}(?:\\s+(20\\d{2}))?\\b`));
  if (firstHalfMonth) {
    const monthIndex = MONTH_MAP[firstHalfMonth[1]];
    const year = resolveYearForMonth(monthIndex, firstHalfMonth[2], referenceDate);
    const startDate = isoDate(year, monthIndex + 1, 1);
    const endDate = isoDate(year, monthIndex + 1, 15);
    return buildCustomRangePeriod(startDate, endDate, `first half of ${formatRangeLabel(startDate, endDate).split("–")[1]?.trim() || firstHalfMonth[1]}`, "first_half");
  }

  const secondHalfMonth = q.match(new RegExp(`\\bsecond\\s+half\\s+(?:of\\s+)?${MONTH_PATTERN}(?:\\s+(20\\d{2}))?\\b`));
  if (secondHalfMonth) {
    const monthIndex = MONTH_MAP[secondHalfMonth[1]];
    const year = resolveYearForMonth(monthIndex, secondHalfMonth[2], referenceDate);
    const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
    let endDay = lastDay;
    const isCurrentMonth = year === referenceDate.getFullYear() && monthIndex === referenceDate.getMonth();
    if (isCurrentMonth) endDay = Math.min(lastDay, referenceDate.getDate());
    const startDate = isoDate(year, monthIndex + 1, 16);
    const endDate = isoDate(year, monthIndex + 1, endDay);
    return buildCustomRangePeriod(startDate, endDate, `second half of ${secondHalfMonth[1]} ${year}`, "second_half");
  }

  if (/\bfirst\s+half\s+(?:of\s+)?this\s+month\b/.test(q)) {
    const y = referenceDate.getFullYear();
    const m = referenceDate.getMonth();
    const startDate = isoDate(y, m + 1, 1);
    const endDate = isoDate(y, m + 1, 15);
    return buildCustomRangePeriod(startDate, endDate, "first half this month", "first_half");
  }

  if (/\bsecond\s+half\s+(?:of\s+)?this\s+month\b/.test(q)) {
    const y = referenceDate.getFullYear();
    const m = referenceDate.getMonth();
    const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const endDay = Math.min(lastDay, referenceDate.getDate());
    const startDate = isoDate(y, m + 1, 16);
    const endDate = isoDate(y, m + 1, endDay);
    return buildCustomRangePeriod(startDate, endDate, "second half this month", "second_half");
  }

  return null;
}

/**
 * Parse explicit calendar ranges from a text fragment.
 */
export function parseExplicitDateRangeFromText(text = "", referenceDate = new Date()) {
  const q = String(text || "").toLowerCase().trim();
  if (!q) return null;

  const half = parseHalfMonthPhrase(q, referenceDate);
  if (half) return half;

  let m = q.match(/\b(20\d{2}-\d{2}-\d{2})\s*(?:to|until|through|-)\s*(20\d{2}-\d{2}-\d{2})\b/);
  if (m && m[1] <= m[2]) {
    return buildCustomRangePeriod(m[1], m[2], formatRangeLabel(m[1], m[2]));
  }

  m = q.match(/\b(\d{1,2})[/.-](\d{1,2})\s*(?:to|until|through|-)\s*(\d{1,2})[/.-](\d{1,2})\b/);
  if (m) {
    const year = referenceDate.getFullYear();
    const startDate = isoDate(year, Number(m[2]), Number(m[1]));
    const endDate = isoDate(year, Number(m[4]), Number(m[3]));
    if (startDate <= endDate) return buildCustomRangePeriod(startDate, endDate, formatRangeLabel(startDate, endDate));
  }

  m = q.match(new RegExp(`\\b${MONTH_PATTERN}\\s+(\\d{1,2})\\s*-\\s*(\\d{1,2})(?:st|nd|rd|th)?\\b(?:\\s+(20\\d{2}))?`));
  if (m) {
    const monthIndex = MONTH_MAP[m[1]];
    const year = resolveYearForMonth(monthIndex, m[4], referenceDate);
    const startDate = isoDate(year, monthIndex + 1, Number(m[2]));
    const endDate = isoDate(year, monthIndex + 1, Number(m[3]));
    if (startDate <= endDate) return buildCustomRangePeriod(startDate, endDate, formatRangeLabel(startDate, endDate));
  }

  m = q.match(new RegExp(`\\b${MONTH_PATTERN}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:to|until|through|-)\\s+${MONTH_PATTERN}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:\\s+(20\\d{2}))?`));
  if (m) {
    const startMonth = MONTH_MAP[m[1]];
    const endMonth = MONTH_MAP[m[3]];
    const year = resolveYearForMonth(startMonth, m[5], referenceDate);
    const startDate = isoDate(year, startMonth + 1, Number(m[2]));
    const endDate = isoDate(year, endMonth + 1, Number(m[4]));
    if (startDate <= endDate) return buildCustomRangePeriod(startDate, endDate, formatRangeLabel(startDate, endDate));
  }

  m = q.match(new RegExp(`\\b${MONTH_PATTERN}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:to|until|through|-)\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:\\s+(20\\d{2}))?`));
  if (m) {
    const monthIndex = MONTH_MAP[m[1]];
    const year = resolveYearForMonth(monthIndex, m[4], referenceDate);
    const startDate = isoDate(year, monthIndex + 1, Number(m[2]));
    const endDate = isoDate(year, monthIndex + 1, Number(m[3]));
    if (startDate <= endDate) return buildCustomRangePeriod(startDate, endDate, formatRangeLabel(startDate, endDate));
  }

  m = q.match(new RegExp(`\\bbetween\\s+${MONTH_PATTERN}\\s+(\\d{1,2})\\s+and\\s+${MONTH_PATTERN}\\s+(\\d{1,2})\\b(?:\\s+(20\\d{2}))?`));
  if (m) {
    const startMonth = MONTH_MAP[m[1]];
    const endMonth = MONTH_MAP[m[3]];
    const year = resolveYearForMonth(startMonth, m[5], referenceDate);
    const startDate = isoDate(year, startMonth + 1, Number(m[2]));
    const endDate = isoDate(year, endMonth + 1, Number(m[4]));
    if (startDate <= endDate) return buildCustomRangePeriod(startDate, endDate, formatRangeLabel(startDate, endDate));
  }

  m = q.match(new RegExp(`\\bbetween\\s+${MONTH_PATTERN}\\s+(\\d{1,2})\\s+and\\s+(\\d{1,2})\\b(?:\\s+(20\\d{2}))?`));
  if (m) {
    const monthIndex = MONTH_MAP[m[1]];
    const year = resolveYearForMonth(monthIndex, m[4], referenceDate);
    const startDate = isoDate(year, monthIndex + 1, Number(m[2]));
    const endDate = isoDate(year, monthIndex + 1, Number(m[3]));
    if (startDate <= endDate) return buildCustomRangePeriod(startDate, endDate, formatRangeLabel(startDate, endDate));
  }

  m = q.match(new RegExp(`\\bfrom\\s+${MONTH_PATTERN}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:until|to)\\s+${MONTH_PATTERN}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:\\s+(20\\d{2}))?`));
  if (m) {
    const startMonth = MONTH_MAP[m[1]];
    const endMonth = MONTH_MAP[m[3]];
    const year = resolveYearForMonth(startMonth, m[5], referenceDate);
    const startDate = isoDate(year, startMonth + 1, Number(m[2]));
    const endDate = isoDate(year, endMonth + 1, Number(m[4]));
    if (startDate <= endDate) return buildCustomRangePeriod(startDate, endDate, formatRangeLabel(startDate, endDate));
  }

  m = q.match(new RegExp(`\\bfrom\\s+${MONTH_PATTERN}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:until|to)\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:\\s+(20\\d{2}))?`));
  if (m) {
    const monthIndex = MONTH_MAP[m[1]];
    const year = resolveYearForMonth(monthIndex, m[4], referenceDate);
    const startDate = isoDate(year, monthIndex + 1, Number(m[2]));
    const endDate = isoDate(year, monthIndex + 1, Number(m[3]));
    if (startDate <= endDate) return buildCustomRangePeriod(startDate, endDate, formatRangeLabel(startDate, endDate));
  }

  m = q.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH_PATTERN}\\s+(?:to|until|through|-)\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH_PATTERN}\\b(?:\\s+(20\\d{2}))?`));
  if (m) {
    const startMonth = MONTH_MAP[m[2]];
    const endMonth = MONTH_MAP[m[4]];
    const year = resolveYearForMonth(startMonth, m[5], referenceDate);
    const startDate = isoDate(year, startMonth + 1, Number(m[1]));
    const endDate = isoDate(year, endMonth + 1, Number(m[3]));
    if (startDate <= endDate) return buildCustomRangePeriod(startDate, endDate, formatRangeLabel(startDate, endDate));
  }

  return null;
}

function parseFlexiblePeriodFragment(text = "", referenceDate = new Date()) {
  return parseExplicitDateRangeFromText(text, referenceDate) || parseHalfMonthPhrase(text, referenceDate);
}

function hasRangeConnector(q) {
  return /\b(to|until|through|between|from)\b/.test(q)
    || new RegExp(`\\b${MONTH_PATTERN}\\s+\\d{1,2}\\s*-\\s*\\d{1,2}\\b`).test(q)
    || /\b(20\d{2}-\d{2}-\d{2})\s*(?:to|until|-)\s*(20\d{2}-\d{2}-\d{2})\b/.test(q)
    || /\b\d{1,2}[/.-]\d{1,2}\s*(?:to|until|-)\s*\d{1,2}[/.-]\d{1,2}\b/.test(q)
    || /\b(first|second)\s+half\b/.test(q);
}

/**
 * @returns {{ periodType: string, startDate: string, endDate: string, label: string, isSingleDay: boolean, isMonth?: boolean, isWeek?: boolean, isRange?: boolean }|null}
 */
export function parseVaultPeriodFromQuestion(question = "", referenceDate = new Date()) {
  const q = String(question || "").toLowerCase().trim();
  if (!q) return null;

  if (/\bcompare\b/.test(q) && /\b(vs|versus|against|with|compared to)\b/.test(q)) {
    const compare = parseVaultComparePeriodsFromQuestion(question, referenceDate);
    if (compare?.current) return compare.current;
  }

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
    const label = formatDayMonthLabel(day.getFullYear(), day.getMonth(), day.getDate());
    return { startDate: iso, endDate: iso, label, periodType: "single_day", isSingleDay: true };
  }

  const explicitRange = parseExplicitDateRangeFromText(q, referenceDate);
  if (explicitRange) return explicitRange;

  if (!hasRangeConnector(q)) {
    const dmy = q.match(/\b(\d{1,2})[/.-](\d{1,2})[/.-](20\d{2})\b/);
    if (dmy) {
      const iso = isoDate(Number(dmy[3]), Number(dmy[2]), Number(dmy[1]));
      return { startDate: iso, endDate: iso, label: iso, periodType: "single_day", isSingleDay: true };
    }

    const dayMonthYear = q.match(
      new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH_PATTERN}\\b(?:\\s+(20\\d{2}))?`),
    );
    if (dayMonthYear) {
      const day = Number(dayMonthYear[1]);
      const monthIndex = MONTH_MAP[dayMonthYear[2]];
      const year = resolveYearForMonth(monthIndex, dayMonthYear[3], referenceDate);
      const iso = isoDate(year, monthIndex + 1, day);
      const label = formatDayMonthLabel(year, monthIndex, day);
      return { startDate: iso, endDate: iso, label, periodType: "single_day", isSingleDay: true };
    }

    const monthDay = q.match(
      new RegExp(`\\b${MONTH_PATTERN}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:\\s+(20\\d{2}))?`),
    );
    if (monthDay) {
      const monthIndex = MONTH_MAP[monthDay[1]];
      const day = Number(monthDay[2]);
      const year = resolveYearForMonth(monthIndex, monthDay[3], referenceDate);
      const iso = isoDate(year, monthIndex + 1, day);
      const label = formatDayMonthLabel(year, monthIndex, day);
      return { startDate: iso, endDate: iso, label, periodType: "single_day", isSingleDay: true };
    }
  }

  if (/\b(this month|current month|month to date|mtd)\b/.test(q)) {
    return monthToDateBounds(referenceDate);
  }

  if (/\b(this year|year to date|year-to-date|ytd)\b/.test(q)) {
    const y = referenceDate.getFullYear();
    return {
      startDate: isoDate(y, 1, 1),
      endDate: isoDate(y, referenceDate.getMonth() + 1, referenceDate.getDate()),
      label: `${y} year-to-date`,
      periodType: "year_to_date",
      isSingleDay: false,
      isRange: true,
    };
  }

  if (/\b(this week|current week|past week)\b/.test(q)) {
    return {
      ...rollingRange(referenceDate, 7, { label: "this week", periodType: "this_week" }),
      isWeek: true,
    };
  }

  const monthOnly = q.match(
    new RegExp(`\\b(?:for|in|during|cover(?:ing|age)?)\\s+${MONTH_PATTERN}\\b(?:\\s+(20\\d{2}))?`),
  );
  if (monthOnly) {
    const monthIndex = MONTH_MAP[monthOnly[1]];
    const year = resolveYearForMonth(monthIndex, monthOnly[2], referenceDate);
    return monthBounds(year, monthIndex);
  }

  const contextualMonth = q.match(
    new RegExp(`\\b(cash[\\s-]?up|ccm|reconciliation|reconcile|logbook|reception|uploaded|coverage|report|files)\\b.*\\b${MONTH_PATTERN}\\b(?:\\s+(20\\d{2}))?`),
  );
  if (contextualMonth) {
    const monthIndex = MONTH_MAP[contextualMonth[2]];
    const year = resolveYearForMonth(monthIndex, contextualMonth[3], referenceDate);
    return monthBounds(year, monthIndex);
  }

  return null;
}

/**
 * Current + previous rolling/custom periods for cash-up compare questions.
 */
export function parseVaultComparePeriodsFromQuestion(question = "", referenceDate = new Date()) {
  const q = String(question || "").toLowerCase().trim();
  if (!q) return null;

  const customSplit = q.match(/\bcompare\s+(.+?)\s+(?:vs|versus|against|with|compared to)\s+(.+)$/);
  if (customSplit) {
    const current = parseFlexiblePeriodFragment(customSplit[1], referenceDate);
    const previous = parseFlexiblePeriodFragment(customSplit[2], referenceDate);
    if (current && previous) {
      return {
        current: { ...current, label: current.label || formatRangeLabel(current.startDate, current.endDate) },
        previous: { ...previous, label: previous.label || formatRangeLabel(previous.startDate, previous.endDate) },
        periodType: "custom_compare",
        isComparison: true,
      };
    }
  }

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

/**
 * Normalized custom compare structure for flexible period engine.
 */
export function parseVaultCustomCompareFromQuestion(question = "", referenceDate = new Date()) {
  const compare = parseVaultComparePeriodsFromQuestion(question, referenceDate);
  if (!compare?.current || !compare?.previous) return null;
  return {
    periodType: compare.periodType === "custom_compare" ? "custom_compare" : "period_compare",
    currentPeriod: compare.current,
    comparisonPeriod: compare.previous,
    isRange: true,
    isComparison: true,
  };
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
  "year_to_date",
  "previous_7_days",
  "previous_14_days",
  "custom_range",
  "first_half",
  "second_half",
]);

export function isVaultCashUpAnalyticsPeriod(period) {
  return Boolean(period?.periodType && CASH_UP_ANALYTICS_PERIOD_TYPES.has(period.periodType));
}

export function isVaultFlexibleRangePeriod(period) {
  return Boolean(period?.periodType && ["custom_range", "first_half", "second_half"].includes(period.periodType));
}
