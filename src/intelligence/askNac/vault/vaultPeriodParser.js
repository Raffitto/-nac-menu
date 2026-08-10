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
const MONTH_TOKEN = "(?:january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sep|sept|october|oct|november|nov|december|dec)";

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

export function monthBoundsFromToken(monthToken, explicitYear, referenceDate = new Date()) {
  const monthIndex = MONTH_MAP[String(monthToken || "").toLowerCase()];
  if (monthIndex == null) return null;
  const year = resolveYearForMonth(monthIndex, explicitYear, referenceDate);
  return monthBounds(year, monthIndex);
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
  const n = Math.max(1, Math.floor(Number(days) || 0));
  const end = shiftLocalDate(referenceDate, endOffset);
  const start = shiftLocalDate(end, -(n - 1));
  const startDate = isoDate(start.getFullYear(), start.getMonth() + 1, start.getDate());
  const endDate = isoDate(end.getFullYear(), end.getMonth() + 1, end.getDate());
  return {
    startDate,
    endDate,
    label: label || `last ${n} days`,
    periodType: periodType || `last_${n}_days`,
    isSingleDay: n === 1 && startDate === endDate,
    isRange: startDate !== endDate,
    expectedDayCount: n,
  };
}

/** Inclusive calendar dates for a resolved period (does not collapse to available data). */
export function listPeriodDates(period) {
  if (!period?.startDate || !period?.endDate || period.startDate > period.endDate) return [];
  const dates = [];
  let cursor = new Date(`${period.startDate}T12:00:00`);
  const end = new Date(`${period.endDate}T12:00:00`);
  while (cursor <= end) {
    dates.push(isoDate(cursor.getFullYear(), cursor.getMonth() + 1, cursor.getDate()));
    cursor = shiftLocalDate(cursor, 1);
  }
  return dates;
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

  // Generic "last/past N days" (covers 7/10/14/30 and arbitrary N). Cap keeps planner bounded.
  const lastN = q.match(/\b(last|past)\s+(\d{1,3})\s+days?\b/);
  if (lastN) {
    const n = Math.min(366, Math.max(1, Number(lastN[2])));
    return rollingRange(referenceDate, n, {
      label: `last ${n} days`,
      periodType: `last_${n}_days`,
    });
  }

  if (/\b(last|past)\s+two\s+weeks?\b/.test(q)) {
    return rollingRange(referenceDate, 14, { label: "last 14 days", periodType: "last_14_days" });
  }

  if (/\bprevious\s+week\b/.test(q)) {
    return previousCalendarWeekBounds(referenceDate);
  }

  if (/\blast\s+week\b/.test(q)) {
    return rollingRange(referenceDate, 7, { endOffset: -1, label: "last week", periodType: "last_week" });
  }

  if (/\btoday\b/.test(q)) {
    const iso = isoDate(
      referenceDate.getFullYear(),
      referenceDate.getMonth() + 1,
      referenceDate.getDate(),
    );
    const label = formatDayMonthLabel(
      referenceDate.getFullYear(),
      referenceDate.getMonth(),
      referenceDate.getDate(),
    );
    return {
      startDate: iso,
      endDate: iso,
      label,
      periodType: "single_day",
      isSingleDay: true,
      expectedDayCount: 1,
    };
  }

  if (/\byesterday\b/.test(q)) {
    const day = shiftLocalDate(referenceDate, -1);
    const iso = isoDate(day.getFullYear(), day.getMonth() + 1, day.getDate());
    const label = formatDayMonthLabel(day.getFullYear(), day.getMonth(), day.getDate());
    return {
      startDate: iso,
      endDate: iso,
      label,
      periodType: "single_day",
      isSingleDay: true,
      expectedDayCount: 1,
    };
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

  if (/\blast\s+month\b/.test(q)) {
    const shifted = new Date(referenceDate.getFullYear(), referenceDate.getMonth() - 1, 1);
    return monthBounds(shifted.getFullYear(), shifted.getMonth());
  }

  if (/\b(this year|year to date|year-to-date|ytd)\b/.test(q)) {
    const y = referenceDate.getFullYear();
    const startDate = isoDate(y, 1, 1);
    const endDate = isoDate(y, referenceDate.getMonth() + 1, referenceDate.getDate());
    return {
      startDate,
      endDate,
      label: `${y} year-to-date`,
      periodType: "year_to_date",
      isSingleDay: false,
      isRange: true,
      expectedDayCount: listPeriodDates({ startDate, endDate }).length,
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

  const operationalMonth = q.match(
    new RegExp(`\\b(?:summarize|summary|operations?|operationally|highlights?|issues?|happened)\\b[^?]*\\b(${MONTH_TOKEN})\\b(?:\\s+(20\\d{2}))?`),
  );
  if (operationalMonth) {
    return monthBoundsFromToken(operationalMonth[1], operationalMonth[2], referenceDate);
  }

  const monthBeforeOps = q.match(new RegExp(`\\b(${MONTH_TOKEN})\\b(?:\\s+(20\\d{2}))?\\s+operations?\\b`));
  if (monthBeforeOps) {
    return monthBoundsFromToken(monthBeforeOps[1], monthBeforeOps[2], referenceDate);
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

  const monthCompare = q.match(
    new RegExp(`\\b(?:compare\\s+)?(${MONTH_TOKEN})\\b(?:\\s+(20\\d{2}))?\\s+(?:vs|versus)\\s+(${MONTH_TOKEN})\\b(?:\\s+(20\\d{2}))?`),
  );
  if (monthCompare) {
    const current = monthBoundsFromToken(monthCompare[1], monthCompare[2], referenceDate);
    const previous = monthBoundsFromToken(monthCompare[3], monthCompare[4] || monthCompare[2], referenceDate);
    if (current && previous) {
      return {
        current,
        previous,
        periodType: "month_compare",
        isComparison: true,
      };
    }
  }

  const compareN = q.match(
    /\b(?:compare\s+)?(?:last|past)\s+(\d{1,3})\s+days?\b.*\b(vs|versus|compared to|against)\b.*\b(previous|prior|preceding)\s+\1\s+days?\b/,
  ) || q.match(
    /\bcompare\b.*\b(?:last|past)\s+(\d{1,3})\s+days?\b.*\b(previous|prior|preceding)\s+\1\s+days?\b/,
  );
  if (compareN) {
    const n = Math.min(366, Math.max(1, Number(compareN[1])));
    const current = rollingRange(referenceDate, n, {
      label: `last ${n} days`,
      periodType: `last_${n}_days`,
    });
    const previousEnd = shiftLocalDate(new Date(`${current.startDate}T12:00:00`), -1);
    const previous = rollingRange(previousEnd, n, {
      label: `previous ${n} days`,
      periodType: `previous_${n}_days`,
    });
    return { current, previous, isComparison: true };
  }

  return null;
}

/**
 * Previous non-overlapping equivalent window for the same span as `current`.
 * Used for performance-overview period-over-period context.
 */
export function buildPreviousEquivalentVaultPeriod(current) {
  if (!current?.startDate || !current?.endDate) return null;

  if (current.periodType === "this_month" || current.periodType === "named_month") {
    const [y, m] = current.startDate.split("-").map(Number);
    const prevMonthIndex = m - 2; // m is 1-based
    const year = prevMonthIndex < 0 ? y - 1 : y;
    const monthIndex = (prevMonthIndex + 12) % 12;
    const previous = monthBounds(year, monthIndex);
    // For MTD, mirror day-of-month span when possible.
    if (current.periodType === "this_month") {
      const span = listPeriodDates(current).length;
      const prevDates = listPeriodDates(previous);
      const clipped = prevDates.slice(0, Math.min(span, prevDates.length));
      if (clipped.length) {
        return buildCustomRangePeriod(
          clipped[0],
          clipped[clipped.length - 1],
          `${previous.label} (to date)`,
          "this_month_previous",
        );
      }
    }
    return previous;
  }

  const dates = listPeriodDates(current);
  const n = dates.length || current.expectedDayCount;
  if (!n) return null;
  const previousEnd = shiftLocalDate(new Date(`${current.startDate}T12:00:00`), -1);
  return rollingRange(previousEnd, n, {
    label: `previous ${n} days`,
    periodType: `previous_${n}_days`,
  });
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
  "last_week",
  "previous_week",
  "this_week",
  "this_month",
  "named_month",
  "year_to_date",
  "custom_range",
  "first_half",
  "second_half",
]);

function isRollingDayPeriodType(periodType) {
  return /^last_\d+_days$/.test(periodType || "")
    || /^previous_\d+_days$/.test(periodType || "");
}

export function isVaultCashUpAnalyticsPeriod(period) {
  if (!period?.periodType) return false;
  if (CASH_UP_ANALYTICS_PERIOD_TYPES.has(period.periodType)) return true;
  if (isRollingDayPeriodType(period.periodType)) return true;
  // Any explicit multi-day window with bounds is analytics-eligible.
  return Boolean(period.isRange && period.startDate && period.endDate && period.startDate !== period.endDate);
}

export function isVaultFlexibleRangePeriod(period) {
  return Boolean(period?.periodType && ["custom_range", "first_half", "second_half"].includes(period.periodType));
}
