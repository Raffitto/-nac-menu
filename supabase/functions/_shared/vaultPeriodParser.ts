/**
 * Parse calendar day / month ranges for Data Vault queries (uploaded facts).
 */

export type VaultPeriod = {
  startDate: string;
  endDate: string;
  label: string;
  periodType?: string;
  isSingleDay: boolean;
  isMonth?: boolean;
  isWeek?: boolean;
  isRange?: boolean;
  expectedDayCount?: number;
};

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

const PERIOD_TZ = "Asia/Riyadh";

function calendarYmdInTz(referenceDate, timeZone = PERIOD_TZ) {
  const d = referenceDate instanceof Date ? referenceDate : new Date(referenceDate);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value || 0);
  return { year: get("year"), month: get("month"), day: get("day") };
}

function addCalendarDays(year: number, month: number, day: number, delta: number) {
  const dt = new Date(Date.UTC(year, month - 1, day + delta));
  return { year: dt.getUTCFullYear(), month: dt.getUTCMonth() + 1, day: dt.getUTCDate() };
}

const RELATIVE_DAY_WORDS = Object.freeze({
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
});

/** Exact single calendar day N days before Asia/Riyadh today — not a rolling window. */
function parseRelativeDaysAgoPeriod(q: string, referenceDate: Date) {
  const couple = String(q || "").toLowerCase().match(/\ba\s+couple\s+of\s+days?\s+ago\b/);
  const m = couple
    ? ["couple", null, "couple"] as unknown as RegExpMatchArray
    : String(q || "").toLowerCase().match(
      /\b(?:(\d{1,3})|(a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve))\s+days?\s+ago\b/,
    );
  if (!m && !couple) return null;
  const n = couple
    ? 2
    : (m![1] ? Number(m![1]) : RELATIVE_DAY_WORDS[m![2] as keyof typeof RELATIVE_DAY_WORDS]);
  if (!Number.isFinite(n) || n < 1) return null;
  const today = calendarYmdInTz(referenceDate);
  const day = addCalendarDays(today.year, today.month, today.day, -Math.min(366, n));
  const iso = isoDate(day.year, day.month, day.day);
  const label = formatDayMonthLabel(day.year, day.month - 1, day.day);
  return {
    startDate: iso,
    endDate: iso,
    label,
    periodType: "single_day",
    isSingleDay: true,
    expectedDayCount: 1,
  };
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

function rollingRange(referenceDate, days, { endOffset = 0, label, periodType }: {
  endOffset?: number;
  label?: string;
  periodType?: string;
}) {
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
export function listPeriodDates(period: Pick<VaultPeriod, "startDate" | "endDate"> | null | undefined) {
  if (!period?.startDate || !period?.endDate || period.startDate > period.endDate) return [];
  const dates: string[] = [];
  let cursor = new Date(`${period.startDate}T12:00:00`);
  const end = new Date(`${period.endDate}T12:00:00`);
  while (cursor <= end) {
    dates.push(isoDate(cursor.getFullYear(), cursor.getMonth() + 1, cursor.getDate()));
    cursor = shiftLocalDate(cursor, 1);
  }
  return dates;
}

function previousCalendarWeekBounds(referenceDate) {
  return sundayWeekBounds(referenceDate, "previous_complete");
}

function ymdWeekdaySundayFirst(ymd: { year: number; month: number; day: number }) {
  return new Date(Date.UTC(ymd.year, ymd.month - 1, ymd.day)).getUTCDay();
}

function sundayWeekBounds(referenceDate: Date, mode: "current_to_date" | "previous_complete") {
  const today = calendarYmdInTz(referenceDate);
  const dow = ymdWeekdaySundayFirst(today);
  const thisStart = addCalendarDays(today.year, today.month, today.day, -dow);
  if (mode === "current_to_date") {
    const startDate = isoDate(thisStart.year, thisStart.month, thisStart.day);
    const endDate = isoDate(today.year, today.month, today.day);
    return {
      startDate,
      endDate,
      label: "this week",
      periodType: "this_week",
      isSingleDay: startDate === endDate,
      isWeek: true,
      isRange: startDate !== endDate,
      expectedDayCount: listPeriodDates({ startDate, endDate }).length,
    };
  }
  const prevEnd = addCalendarDays(thisStart.year, thisStart.month, thisStart.day, -1);
  const prevStart = addCalendarDays(prevEnd.year, prevEnd.month, prevEnd.day, -6);
  const startDate = isoDate(prevStart.year, prevStart.month, prevStart.day);
  const endDate = isoDate(prevEnd.year, prevEnd.month, prevEnd.day);
  return {
    startDate,
    endDate,
    label: "previous week",
    periodType: "previous_week",
    isSingleDay: false,
    isWeek: true,
    isRange: true,
    expectedDayCount: 7,
  };
}

function quarterIndex(monthIndex0: number) {
  return Math.floor(monthIndex0 / 3);
}

function quarterBounds(year: number, quarter: number) {
  const startMonth = (quarter - 1) * 3 + 1;
  const endMonth = startMonth + 2;
  const lastDay = new Date(Date.UTC(year, endMonth, 0)).getUTCDate();
  const startDate = isoDate(year, startMonth, 1);
  const endDate = isoDate(year, endMonth, lastDay);
  return {
    startDate,
    endDate,
    label: `Q${quarter} ${year}`,
    periodType: "quarter",
    isSingleDay: false,
    isRange: true,
    expectedDayCount: listPeriodDates({ startDate, endDate }).length,
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

  // "from 9 to 13 aug" / "9 to 13 August" — month only on the end day.
  m = q.match(new RegExp(`\\b(?:from\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:to|until|through|-)\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH_PATTERN}\\b(?:\\s+(20\\d{2}))?`));
  if (m) {
    const monthIndex = MONTH_MAP[m[3]];
    const year = resolveYearForMonth(monthIndex, m[4], referenceDate);
    const startDate = isoDate(year, monthIndex + 1, Number(m[1]));
    const endDate = isoDate(year, monthIndex + 1, Number(m[2]));
    if (startDate <= endDate) return buildCustomRangePeriod(startDate, endDate, formatRangeLabel(startDate, endDate));
  }

  // "from 9 to August 13"
  m = q.match(new RegExp(`\\b(?:from\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:to|until|through|[–—-])\\s+${MONTH_PATTERN}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:\\s+(20\\d{2}))?`));
  if (m) {
    const monthIndex = MONTH_MAP[m[2]];
    const year = resolveYearForMonth(monthIndex, m[4], referenceDate);
    const startDate = isoDate(year, monthIndex + 1, Number(m[1]));
    const endDate = isoDate(year, monthIndex + 1, Number(m[3]));
    if (startDate <= endDate) return buildCustomRangePeriod(startDate, endDate, formatRangeLabel(startDate, endDate));
  }

  m = q.match(new RegExp(`\\bbetween\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s+and\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH_PATTERN}\\b(?:\\s+(20\\d{2}))?`));
  if (m) {
    const monthIndex = MONTH_MAP[m[3]];
    const year = resolveYearForMonth(monthIndex, m[4], referenceDate);
    const startDate = isoDate(year, monthIndex + 1, Number(m[1]));
    const endDate = isoDate(year, monthIndex + 1, Number(m[2]));
    if (startDate <= endDate) return buildCustomRangePeriod(startDate, endDate, formatRangeLabel(startDate, endDate));
  }

  m = q.match(new RegExp(`\\bfrom\\s+(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:to|until|through)\\s+(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\b(?:\\s+${MONTH_PATTERN})?(?:\\s+(20\\d{2}))?`));
  if (m) {
    const monthIndex = m[3] ? MONTH_MAP[m[3]] : calendarYmdInTz(referenceDate).month - 1;
    const year = resolveYearForMonth(monthIndex, m[4], referenceDate);
    const startDate = isoDate(year, monthIndex + 1, Number(m[1]));
    const endDate = isoDate(year, monthIndex + 1, Number(m[2]));
    if (startDate <= endDate) return buildCustomRangePeriod(startDate, endDate, formatRangeLabel(startDate, endDate));
  }

  m = q.match(new RegExp(`\\b(?:from\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s*[–—-]\\s*(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH_PATTERN}\\b(?:\\s+(20\\d{2}))?`));
  if (m) {
    const monthIndex = MONTH_MAP[m[3]];
    const year = resolveYearForMonth(monthIndex, m[4], referenceDate);
    const startDate = isoDate(year, monthIndex + 1, Number(m[1]));
    const endDate = isoDate(year, monthIndex + 1, Number(m[2]));
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

  if (
    (/\bcompare\b/.test(q) && /\b(vs|versus|against|with|compared to|compared with)\b/.test(q))
    || /\b(vs\.?|versus|compared with|compared to|against)\b/.test(q)
  ) {
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

  const firstNDays = q.match(/\bfirst\s+(\d{1,3})\s+days?\b/);
  if (firstNDays) {
    const n = Math.min(31, Math.max(1, Number(firstNDays[1])));
    const y = referenceDate.getFullYear();
    const m = referenceDate.getMonth();
    const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const endDay = Math.min(n, lastDay);
    const startDate = isoDate(y, m + 1, 1);
    const endDate = isoDate(y, m + 1, endDay);
    return buildCustomRangePeriod(startDate, endDate, `first ${n} days`, "first_n_days");
  }

  if (/\b(previous\s+(?:complete\s+)?week|last\s+week|past\s+week)\b/.test(q)) {
    return { ...previousCalendarWeekBounds(referenceDate), periodType: /\blast\s+week\b/.test(q) ? "last_week" : "previous_week", label: /\blast\s+week\b/.test(q) ? "last week" : "previous week" };
  }

  if (/\blast weekend\b/.test(q)) {
    const today = calendarYmdInTz(referenceDate);
    let d = addCalendarDays(today.year, today.month, today.day, -1);
    while (new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay() !== 6) {
      d = addCalendarDays(d.year, d.month, d.day, -1);
    }
    const sat = isoDate(d.year, d.month, d.day);
    const fri = addCalendarDays(d.year, d.month, d.day, -1);
    return {
      startDate: isoDate(fri.year, fri.month, fri.day),
      endDate: sat,
      label: "last weekend",
      periodType: "last_weekend",
      isSingleDay: false,
      isRange: true,
      expectedDayCount: 2,
    };
  }

  const prevN = q.match(/\bprevious\s+(\d{1,3})\s+days?\b/);
  if (prevN && !/\blast\s+\d/.test(q)) {
    const n = Math.min(366, Math.max(1, Number(prevN[1])));
    const last = rollingRange(referenceDate, n, { label: `last ${n} days`, periodType: `last_${n}_days` });
    const previousEnd = shiftLocalDate(new Date(`${last.startDate}T12:00:00`), -1);
    return rollingRange(previousEnd, n, { label: `previous ${n} days`, periodType: `previous_${n}_days` });
  }

  if (/\btoday\b/.test(q) && !/\bday\s+before\s+today\b/.test(q)) {
    const ymd = calendarYmdInTz(referenceDate);
    const iso = isoDate(ymd.year, ymd.month, ymd.day);
    const label = formatDayMonthLabel(ymd.year, ymd.month - 1, ymd.day);
    return {
      startDate: iso,
      endDate: iso,
      label,
      periodType: "single_day",
      isSingleDay: true,
      expectedDayCount: 1,
    };
  }

  if (/\byesterday\b|\bthe\s+day\s+before\s+today\b|\bday\s+before\s+today\b/.test(q)) {
    const today = calendarYmdInTz(referenceDate);
    const day = addCalendarDays(today.year, today.month, today.day, -1);
    const iso = isoDate(day.year, day.month, day.day);
    const label = formatDayMonthLabel(day.year, day.month - 1, day.day);
    return {
      startDate: iso,
      endDate: iso,
      label,
      periodType: "single_day",
      isSingleDay: true,
      expectedDayCount: 1,
    };
  }

  const daysAgo = parseRelativeDaysAgoPeriod(q, referenceDate);
  if (daysAgo) return daysAgo;

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

    const monthYear = q.match(new RegExp(`\\b${MONTH_PATTERN}\\s+(20\\d{2})\\b`));
    if (monthYear) {
      return monthBoundsFromToken(monthYear[1], monthYear[2], referenceDate);
    }

    const monthDay = q.match(
      new RegExp(`\\b${MONTH_PATTERN}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?!\\d)(?:\\s+(20\\d{2}))?`),
    );
    if (monthDay && Number(monthDay[2]) <= 31) {
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

  if (/\b(last|previous)\s+month\b/.test(q)) {
    const shifted = new Date(referenceDate.getFullYear(), referenceDate.getMonth() - 1, 1);
    return monthBounds(shifted.getFullYear(), shifted.getMonth());
  }

  const namedQuarter = q.match(/\b(?:q|quarter\s*)([1-4])\s*(20\d{2})\b/) || q.match(/\b(first|second|third|fourth|1st|2nd|3rd|4th)\s+quarter(?:\s+(20\d{2}))?\b/);
  if (namedQuarter) {
    const word = { first: 1, "1st": 1, second: 2, "2nd": 2, third: 3, "3rd": 3, fourth: 4, "4th": 4 };
    const qn = namedQuarter[1] && word[namedQuarter[1] as keyof typeof word]
      ? word[namedQuarter[1] as keyof typeof word]
      : Number(namedQuarter[1]);
    const year = namedQuarter[2] ? Number(namedQuarter[2]) : referenceDate.getFullYear();
    if (qn >= 1 && qn <= 4) return quarterBounds(year, qn);
  }
  if (/\b(last|previous)\s+quarter\b/.test(q)) {
    const idx = quarterIndex(referenceDate.getMonth());
    const prevQ = idx === 0 ? 4 : idx;
    const year = idx === 0 ? referenceDate.getFullYear() - 1 : referenceDate.getFullYear();
    return quarterBounds(year, prevQ);
  }
  if (/\b(this quarter|quarter to date|qtd)\b/.test(q)) {
    const qn = quarterIndex(referenceDate.getMonth()) + 1;
    const full = quarterBounds(referenceDate.getFullYear(), qn);
    const endDate = isoDate(referenceDate.getFullYear(), referenceDate.getMonth() + 1, referenceDate.getDate());
    return { ...full, endDate, label: `Q${qn} ${referenceDate.getFullYear()} (to date)`, periodType: "quarter_to_date" };
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

  if (/\b(last|previous)\s+year\b/.test(q)) {
    const y = referenceDate.getFullYear() - 1;
    return {
      startDate: isoDate(y, 1, 1),
      endDate: isoDate(y, 12, 31),
      label: String(y),
      periodType: "last_year",
      isSingleDay: false,
      isRange: true,
    };
  }

  const bareYear = q.match(/\b(20\d{2})\b/);
  const hasMonthToken = new RegExp(`\\b${MONTH_PATTERN}\\b`).test(q);
  if (
    !hasMonthToken
    && bareYear
    && /^(?:sales |how (?:were|was|did).*)?(?:in |for |during )?\s*20\d{2}\s*\??$/.test(q.replace(/^(what about|how about|and)\s+/i, ""))
  ) {
    const y = Number(bareYear[1]);
    return {
      startDate: isoDate(y, 1, 1),
      endDate: isoDate(y, 12, 31),
      label: String(y),
      periodType: "named_year",
      isSingleDay: false,
      isRange: true,
    };
  }

  if (/\b(this week|current week|week to date|wtd)\b/.test(q)) {
    return sundayWeekBounds(referenceDate, "current_to_date");
  }

  const namedMonth = q.match(
    new RegExp(`\\b(?:(?:for|in|during|of|this|the month of)\\s+)?${MONTH_PATTERN}\\b(?:\\s+(20\\d{2}))?`),
  );
  if (namedMonth && !new RegExp(`\\b${MONTH_PATTERN}\\s+\\d{1,2}(?:st|nd|rd|th)?\\b`).test(q)) {
    const token = String(namedMonth[1] || "");
    const hasPrep = new RegExp(`\\b(?:for|in|during|of|this|the month of)\\s+${token}\\b`).test(q);
    if (token === "may" && !hasPrep && !namedMonth[2]) {
      /* modal "may", not the month */
    } else {
      return monthBoundsFromToken(namedMonth[1], namedMonth[2], referenceDate);
    }
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

  // Management performance phrasing: "How did July perform overall?", "How was July?"
  const performanceMonth = q.match(
    new RegExp(
      `\\b(?:how (?:did|was|is)|perform(?:ed|ance)?|overall|business)\\b[^?]*\\b(${MONTH_TOKEN})\\b(?:\\s+(20\\d{2}))?`,
    ),
  ) || q.match(
    new RegExp(`\\b(${MONTH_TOKEN})\\b(?:\\s+(20\\d{2}))?\\s+(?:perform(?:ed|ance)?|overall|sales|results?)\\b`),
  );
  if (performanceMonth) {
    return monthBoundsFromToken(performanceMonth[1], performanceMonth[2], referenceDate);
  }

  const stripped = q
    .replace(/[?!.]+$/g, "")
    .replace(/^(?:what about|how about|and|actually|instead)\s+/i, "")
    .replace(/^(?:in|for|during)\s+/i, "")
    .trim();
  const bareMonth = stripped.match(new RegExp(`^${MONTH_PATTERN}(?:\\s+(20\\d{2}))?$`));
  if (bareMonth) {
    return monthBoundsFromToken(bareMonth[1], bareMonth[2], referenceDate);
  }

  return null;
}

/**
 * Current + previous rolling/custom periods for cash-up compare questions.
 */
export function parseVaultComparePeriodsFromQuestion(question = "", referenceDate = new Date()) {
  const q = String(question || "").toLowerCase().trim();
  if (!q) return null;

  const customSplit = q.match(/\bcompare\s+(.+?)\s+(?:vs\.?|versus|against|with|compared with|compared to)\s+(.+)$/);
  if (customSplit) {
    const previousFragment = String(customSplit[2] || "")
      .replace(/\bfor\s+(nac\s+)?(khobar|riyadh|jeddah|branch|network)\b.*$/i, "")
      .trim();
    const current = parseFlexiblePeriodFragment(customSplit[1], referenceDate);
    const previous = parseFlexiblePeriodFragment(previousFragment || customSplit[2], referenceDate);
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
    new RegExp(`\\b(?:compare\\s+)?(${MONTH_TOKEN})\\b(?:\\s+(20\\d{2}))?\\s+(?:vs\\.?|versus|with|against|compared with|compared to|to)\\s+(${MONTH_TOKEN})\\b(?:\\s+(20\\d{2}))?`),
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

  const fromToMonths = q.match(
    new RegExp(`\\bfrom\\s+(${MONTH_TOKEN})\\b(?:\\s+(20\\d{2}))?\\s+to\\s+(${MONTH_TOKEN})\\b(?:\\s+(20\\d{2}))?`),
  );
  if (fromToMonths) {
    const previous = monthBoundsFromToken(fromToMonths[1], fromToMonths[2], referenceDate);
    const current = monthBoundsFromToken(fromToMonths[3], fromToMonths[4] || fromToMonths[2], referenceDate);
    if (current && previous) {
      return { current, previous, periodType: "month_compare", isComparison: true };
    }
  }

  const compareN = q.match(
    /\b(?:compare\s+)?(?:last|past)\s+(\d{1,3})\s+days?\b.*\b(vs\.?|versus|compared with|compared to|against|with)\b.*\b(?:the\s+)?(?:\1\s+)?(previous|prior|preceding|before that)\b/,
  ) || q.match(
    /\bcompare\b.*\b(?:last|past)\s+(\d{1,3})\s+days?\b.*\b(previous|prior|preceding)\s+\1\s+days?\b/,
  )
    || q.match(/\b(?:last|past)\s+(\d{1,3})\s+days?\b.*\b(?:versus|vs\.?|against)\b.*\b(?:the\s+)?(?:\1\s+)?(?:days?\s+)?before that\b/);
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

  if (/\bthis month\b/.test(q) && /\b(last|previous) month\b/.test(q)) {
    const current = monthToDateBounds(referenceDate);
    return {
      current,
      previous: buildPreviousEquivalentVaultPeriod(current),
      periodType: "month_compare",
      isComparison: true,
    };
  }
  if (/\bthis week\b/.test(q) && /\blast week\b/.test(q)) {
    return {
      current: sundayWeekBounds(referenceDate, "current_to_date"),
      previous: { ...previousCalendarWeekBounds(referenceDate), periodType: "last_week", label: "last week" },
      periodType: "week_compare",
      isComparison: true,
    };
  }

  const vsParts = q.split(/\s+(?:vs\.?|versus|compared with|compared to|against)\s+/);
  if (vsParts.length === 2) {
    const current = parseVaultPeriodFromQuestion(vsParts[0], referenceDate) || parseFlexiblePeriodFragment(vsParts[0], referenceDate);
    const previous = parseVaultPeriodFromQuestion(vsParts[1], referenceDate) || parseFlexiblePeriodFragment(vsParts[1], referenceDate);
    if (current?.startDate && previous?.startDate) {
      return { current, previous, periodType: "semantic_compare", isComparison: true };
    }
  }

  return null;
}

/**
 * Previous-equivalent window for auto period-over-period on performance overview.
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
  "quarter",
  "quarter_to_date",
  "last_year",
  "named_year",
  "first_n_days",
]);

function isRollingDayPeriodType(periodType: string | undefined) {
  return /^last_\d+_days$/.test(periodType || "")
    || /^previous_\d+_days$/.test(periodType || "");
}

export function isVaultCashUpAnalyticsPeriod(period: VaultPeriod | null | undefined) {
  if (!period?.periodType) return false;
  if (CASH_UP_ANALYTICS_PERIOD_TYPES.has(period.periodType)) return true;
  if (isRollingDayPeriodType(period.periodType)) return true;
  // Any explicit multi-day window with bounds is analytics-eligible.
  return Boolean(period.isRange && period.startDate && period.endDate && period.startDate !== period.endDate);
}

export function isVaultFlexibleRangePeriod(period) {
  return Boolean(period?.periodType && ["custom_range", "first_half", "second_half"].includes(period.periodType));
}
