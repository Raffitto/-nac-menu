/**
 * Ask NAC temporal coverage contract.
 * Requested calendar windows must not be described as if missing days were included.
 * Timezone: Asia/Riyadh.
 */

export const NAC_OPERATING_TZ = "Asia/Riyadh";

export const COVERAGE_STATUS = Object.freeze({
  COMPLETE: "COMPLETE",
  PARTIAL: "PARTIAL",
  NO_DATA: "NO_DATA",
  CURRENT_DAY_NOT_COMPLETE: "CURRENT_DAY_NOT_COMPLETE",
  SOURCE_DELAYED: "SOURCE_DELAYED",
});

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function riyadhYmd(referenceDate = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: NAC_OPERATING_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(referenceDate instanceof Date ? referenceDate : new Date(referenceDate));
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function addIsoDays(iso, delta) {
  const [y, m, d] = String(iso).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + Number(delta || 0)));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

export function listInclusiveIsoDates(start, end) {
  if (!start || !end || start > end) return [];
  const dates = [];
  let cursor = start;
  let guard = 0;
  while (cursor <= end && guard < 400) {
    dates.push(cursor);
    cursor = addIsoDays(cursor, 1);
    guard += 1;
  }
  return dates;
}

export function formatShortSalesDate(iso) {
  if (!iso) return "";
  const [y, m, d] = String(iso).split("-").map(Number);
  if (!y || !m || !d) return String(iso);
  return `${d} ${SHORT_MONTHS[m - 1]} ${y}`;
}

export function formatCoverageRangeLabel(start, end) {
  if (!start && !end) return "the available dates";
  if (start && end && start === end) return formatShortSalesDate(start);
  if (start && end) return `${formatShortSalesDate(start)}–${formatShortSalesDate(end)}`;
  return formatShortSalesDate(start || end);
}

/**
 * Latest completed business date for completed-day analytics.
 * Today in Asia/Riyadh is generally not complete.
 */
export function latestCompletedBusinessDate(referenceDate = new Date(), { todayIsComplete = false } = {}) {
  const today = riyadhYmd(referenceDate);
  if (todayIsComplete) return today;
  const hour = Number(new Intl.DateTimeFormat("en-GB", {
    timeZone: NAC_OPERATING_TZ,
    hour: "2-digit",
    hourCycle: "h23",
  }).format(referenceDate instanceof Date ? referenceDate : new Date(referenceDate)).replace(/[^\d]/g, "").slice(0, 2)) || 0;
  return addIsoDays(today, hour < 8 ? -2 : -1);
}

export function buildTemporalCoverage({
  requestedStart = null,
  requestedEnd = null,
  requestedLabel = null,
  availableDates = [],
  latestAvailableDate = null,
  source = "cash_up",
  referenceDate = new Date(),
  todayIsComplete = false,
  sourceFailed = false,
} = {}) {
  const today = riyadhYmd(referenceDate);
  const latestCompleted = latestCompletedBusinessDate(referenceDate, { todayIsComplete });
  const calendarStart = requestedStart;
  const calendarEnd = requestedEnd;
  const analyticsEnd = requestedEnd && requestedEnd > latestCompleted ? latestCompleted : requestedEnd;
  const analyticsValid = Boolean(requestedStart && analyticsEnd && requestedStart <= analyticsEnd);
  const expectedDates = analyticsValid ? listInclusiveIsoDates(requestedStart, analyticsEnd) : [];
  const rawAvailable = [...new Set((availableDates || []).filter(Boolean))].sort();
  const available = requestedStart && requestedEnd
    ? rawAvailable.filter((d) => d >= requestedStart && d <= requestedEnd)
    : rawAvailable;
  const latestInWindow = latestAvailableDate
    && requestedStart
    && latestAvailableDate >= requestedStart
    && analyticsValid
    && latestAvailableDate <= analyticsEnd
    ? latestAvailableDate
    : null;
  const latestAvailable = latestInWindow
    || available.filter((d) => !analyticsEnd || d <= analyticsEnd).slice(-1)[0]
    || null;
  const priorLatestAvailableDate = latestAvailableDate
    && requestedStart
    && latestAvailableDate < requestedStart
    ? latestAvailableDate
    : null;

  const missingDates = expectedDates.filter((d) => !available.includes(d));

  const analyticsAvailable = analyticsEnd
    ? available.filter((d) => d <= analyticsEnd)
    : available;
  const coverageStart = analyticsAvailable[0] || null;
  const coverageEnd = analyticsAvailable[analyticsAvailable.length - 1] || latestAvailable || null;

  let status = COVERAGE_STATUS.NO_DATA;
  if (sourceFailed) {
    status = COVERAGE_STATUS.SOURCE_DELAYED;
  } else if (!available.length && !latestAvailable) {
    status = COVERAGE_STATUS.NO_DATA;
  } else if (expectedDates.length && available.length >= expectedDates.length && missingDates.length === 0) {
    status = COVERAGE_STATUS.COMPLETE;
  } else if (
    requestedEnd === today
    && !todayIsComplete
    && missingDates.length === 0
    && !available.includes(today)
    && (available.length > 0 || latestAvailable)
  ) {
    status = COVERAGE_STATUS.CURRENT_DAY_NOT_COMPLETE;
  } else if (available.length > 0 || latestAvailable) {
    status = COVERAGE_STATUS.PARTIAL;
  }

  return {
    source,
    calendarPeriod: {
      startDate: calendarStart,
      endDate: calendarEnd,
      label: requestedLabel || formatCoverageRangeLabel(calendarStart, calendarEnd),
    },
    analyticsPeriod: analyticsValid
      ? { startDate: requestedStart, endDate: analyticsEnd, label: formatCoverageRangeLabel(requestedStart, analyticsEnd) }
      : null,
    requestedPeriod: {
      startDate: requestedStart,
      endDate: requestedEnd,
      label: requestedLabel || formatCoverageRangeLabel(requestedStart, requestedEnd),
    },
    availablePeriod: coverageStart && coverageEnd
      ? { startDate: coverageStart, endDate: coverageEnd, label: formatCoverageRangeLabel(coverageStart, coverageEnd) }
      : null,
    latestCompletedDate: latestCompleted,
    latestAvailableDate: latestAvailable,
    priorLatestAvailableDate,
    expectedDates,
    availableDates: analyticsAvailable,
    missingDates,
    coverageStatus: status,
    today,
  };
}

export function formatMissingDatesProse(missingDates = []) {
  if (!missingDates.length) return "";
  const labels = missingDates.slice(0, 8).map(formatShortSalesDate);
  const extra = missingDates.length > 8 ? `, and ${missingDates.length - 8} more` : "";
  if (labels.length === 1) return `${labels[0]} does not have sales data yet.`;
  return `${labels.join(", ")}${extra} do not have sales data yet.`;
}

/**
 * Spoken window for answers. Never names unavailable dates as included.
 */
function isMonthishCoverage(coverage) {
  const label = String(coverage?.requestedPeriod?.label || "");
  if (/month|mtd|to date/i.test(label)) return true;
  const start = coverage?.requestedPeriod?.startDate || "";
  return String(start).slice(8) === "01";
}

export function spokenPeriodLabel(coverage, { weekish = false } = {}) {
  if (!coverage) return "the requested period";
  const through = coverage.availablePeriod?.endDate || coverage.latestAvailableDate || coverage.priorLatestAvailableDate;
  const latestLabel = String(coverage?.requestedPeriod?.label || "");
  if (/latest available sales date|latest completed|latest cash up/i.test(latestLabel) && through) {
    return formatShortSalesDate(through);
  }
  if (coverage.coverageStatus === COVERAGE_STATUS.NO_DATA && weekish) {
    const start = coverage.requestedPeriod?.startDate;
    const todayPhrase = start && start === coverage.today
      ? `started today, ${formatShortSalesDate(start)}`
      : `is ${formatCoverageRangeLabel(start, coverage.requestedPeriod?.endDate)}`;
    return `The current NAC week ${todayPhrase}, and no completed sales day is available yet`;
  }
  if (
    coverage.coverageStatus === COVERAGE_STATUS.PARTIAL
    || coverage.coverageStatus === COVERAGE_STATUS.CURRENT_DAY_NOT_COMPLETE
  ) {
    if (weekish && through) return `so far this week through ${formatShortSalesDate(through)}`;
    if (isMonthishCoverage(coverage) && through) {
      return `so far this month through ${formatShortSalesDate(through)}`;
    }
    if (through) return formatCoverageRangeLabel(coverage.availablePeriod?.startDate, through);
  }
  if (coverage.coverageStatus === COVERAGE_STATUS.COMPLETE) {
    const calendarOpen = coverage.calendarPeriod?.endDate
      && coverage.analyticsPeriod?.endDate
      && coverage.calendarPeriod.endDate > coverage.analyticsPeriod.endDate;
    if (calendarOpen && through) {
      if (weekish) return `so far this week through ${formatShortSalesDate(through)}`;
      if (isMonthishCoverage(coverage)) return `so far this month through ${formatShortSalesDate(through)}`;
    }
    return coverage.requestedPeriod?.label || coverage.availablePeriod?.label || "the requested period";
  }
  if (coverage.coverageStatus === COVERAGE_STATUS.NO_DATA) {
    return coverage.requestedPeriod?.label || "the requested period";
  }
  return coverage.availablePeriod?.label || coverage.requestedPeriod?.label || "the requested period";
}

export function temporalDisclosureLines(coverage) {
  if (!coverage) return [];
  const lines = [];
  const through = coverage.availablePeriod?.endDate || coverage.latestAvailableDate;
  if (
    coverage.coverageStatus === COVERAGE_STATUS.PARTIAL
    || coverage.coverageStatus === COVERAGE_STATUS.CURRENT_DAY_NOT_COMPLETE
  ) {
    if (through) lines.push(`Sales are currently available through ${formatShortSalesDate(through)}.`);
    if (coverage.missingDates.length) lines.push(formatMissingDatesProse(coverage.missingDates));
  }
  if (coverage.coverageStatus === COVERAGE_STATUS.NO_DATA) {
    lines.push(`No ${coverage.source === "cash_up" ? "Cash Up" : coverage.source} data is available for ${coverage.requestedPeriod?.label || "the requested period"}.`);
    const prior = coverage.priorLatestAvailableDate || coverage.latestAvailableDate;
    if (prior) {
      lines.push(`The latest completed business day is ${formatShortSalesDate(prior)}.`);
    }
  }
  if (coverage.coverageStatus === COVERAGE_STATUS.SOURCE_DELAYED) {
    lines.push("The sales source did not finish loading. Figures are not shown as zero.");
  }
  return lines;
}

export function applySpokenPeriodToAnswer(answer, coverage, { weekish = false } = {}) {
  if (!answer || !coverage) return answer;
  const spoken = spokenPeriodLabel(coverage, { weekish });
  const requested = coverage.requestedPeriod?.label;
  let text = String(answer);
  if (
    requested
    && requested !== spoken
    && text.includes(requested)
  ) {
    text = text.split(requested).join(spoken);
  }
  const missingEnd = coverage.missingDates[coverage.missingDates.length - 1];
  if (missingEnd && coverage.coverageStatus !== COVERAGE_STATUS.COMPLETE) {
    const longEnd = new Date(`${missingEnd}T12:00:00Z`).toLocaleDateString("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });
    if (text.includes(longEnd)) {
      text = text.split(longEnd).join(formatShortSalesDate(coverage.availablePeriod?.endDate || coverage.latestAvailableDate));
    }
  }
  const extra = temporalDisclosureLines(coverage).filter((line) => !text.includes(line.slice(0, 24)));
  if (extra.length) text = `${text.trim()} ${extra.join(" ")}`;
  return text;
}

function metricNumber(metrics, pattern) {
  const row = (metrics || []).find((m) => pattern.test(String(m.label || m.key || "")));
  const n = Number(row?.value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Last-line defense for answers that still name a requested end date
 * while keyMetrics show missing days.
 */
export function toCoverageContract(coverage, { weekish = false } = {}) {
  const requestedStart = coverage?.requestedPeriod?.startDate || null;
  const requestedEnd = coverage?.requestedPeriod?.endDate || null;
  const availableStart = coverage?.availablePeriod?.startDate || null;
  const availableEnd = coverage?.availablePeriod?.endDate || coverage?.latestAvailableDate || null;
  const spokenLabel = spokenPeriodLabel(coverage, { weekish });
  const missing = coverage?.missingDates || [];
  const synthesisInstruction = coverage?.coverageStatus === COVERAGE_STATUS.COMPLETE
    ? "The requested period is complete. You may name the requested dates."
    : [
      "Never describe unavailable dates as included.",
      availableEnd ? `Describe the result as through ${formatShortSalesDate(availableEnd)} / so far this period.` : "",
      requestedEnd && availableEnd && requestedEnd !== availableEnd
        ? `Do not say sales were for ${requestedEnd} or include ${requestedEnd} in the period window.`
        : "",
      formatMissingDatesProse(missing),
    ].filter(Boolean).join(" ");
  const analyticsDates = coverage?.expectedDates || [];
  const availableInAnalytics = (coverage?.availableDates || []).filter((d) => analyticsDates.includes(d));
  return {
    source: coverage?.source || "cash_up",
    calendarStart: coverage?.calendarPeriod?.startDate || requestedStart,
    calendarEnd: coverage?.calendarPeriod?.endDate || requestedEnd,
    analyticsStart: coverage?.analyticsPeriod?.startDate || requestedStart,
    analyticsEnd: coverage?.analyticsPeriod?.endDate || availableEnd,
    requestedStart,
    requestedEnd,
    availableStart,
    availableEnd,
    latestAvailableDate: coverage?.latestAvailableDate || availableEnd,
    priorLatestAvailableDate: coverage?.priorLatestAvailableDate || null,
    expectedDayCount: analyticsDates.length || null,
    availableDayCount: availableInAnalytics.length || coverage?.availableDates?.length || null,
    availableDates: coverage?.availableDates || [],
    missingDates: missing,
    coverageStatus: coverage?.coverageStatus || COVERAGE_STATUS.NO_DATA,
    isCurrentPeriod: Boolean(requestedEnd && coverage?.today && requestedEnd >= coverage.today),
    spokenLabel,
    synthesisInstruction,
  };
}

function stripIsoLeaks(text, contract) {
  if (!contract?.availableEnd || !contract?.requestedEnd || !text) return text;
  if (contract.availableEnd >= contract.requestedEnd) return text;
  const requested = contract.requestedEnd;
  return String(text).replace(new RegExp(`\\b${requested}\\b`, "g"), formatShortSalesDate(contract.availableEnd));
}

export function applyPeriodSafetyNet(text, response = {}) {
  const contract = response.coverageContract || null;
  let sanitized = sanitizeIncompletePeriodAnswer(text, response);
  sanitized = stripIsoLeaks(sanitized, contract);
  if (contract?.availableEnd && contract?.requestedEnd && contract.availableEnd < contract.requestedEnd) {
    const months = [
      "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December",
    ];
    const longDate = (iso) => {
      const [y, m, d] = String(iso).split("-").map(Number);
      if (!y || !m || !d) return "";
      return `${months[m - 1]} ${d}, ${y}`;
    };
    const reqLong = longDate(contract.requestedEnd);
    const availLong = longDate(contract.availableEnd);
    const reqShort = formatShortSalesDate(contract.requestedEnd);
    if (reqLong && availLong) {
      sanitized = sanitized.replace(new RegExp(`\\bAs of\\s+${reqLong}\\b`, "gi"), `As of ${availLong}`);
      sanitized = sanitized.replace(new RegExp(`\\b${reqLong}\\b`, "g"), availLong);
    }
    if (reqShort) {
      sanitized = sanitized.replace(new RegExp(`\\bAs of\\s+${reqShort}\\b`, "gi"), `as of ${formatShortSalesDate(contract.availableEnd)}`);
      sanitized = sanitized.replace(new RegExp(`\\bthrough\\s+${reqShort}\\b`, "gi"), `through ${formatShortSalesDate(contract.availableEnd)}`);
    }
  }
  return { text: sanitized, correctionNeeded: sanitized !== String(text || "") };
}

export function sanitizeIncompletePeriodAnswer(text, response = {}) {
  const raw = String(text || "");
  const metrics = response.keyMetrics || [];
  const dayCount = metricNumber(metrics, /day[_ ]?count|days included/i);
  const expected = metricNumber(metrics, /expectedDayCount|expected day/i);
  const missing = metricNumber(metrics, /missingDayCount|missing day/i);
  const incomplete = (missing != null && missing > 0)
    || (expected != null && dayCount != null && dayCount > 0 && dayCount < expected);
  if (!incomplete) return raw;

  const miss = missing != null ? missing : Math.max(0, expected - dayCount);
  const clipEnd = (start, end) => {
    let latest = end;
    for (let i = 0; i < miss; i += 1) latest = addIsoDays(latest, -1);
    if (start && latest < start) latest = start;
    return `so far this period through ${formatShortSalesDate(latest)}`;
  };
  const MONTHS = {
    january: "01", february: "02", march: "03", april: "04", may: "05", june: "06",
    july: "07", august: "08", september: "09", october: "10", november: "11", december: "12",
  };
  const usToIso = (part) => {
    const m = String(part).match(/([A-Za-z]+)\s+(\d{1,2}),\s+(20\d{2})/);
    if (!m) return null;
    const mm = MONTHS[m[1].toLowerCase()];
    if (!mm) return null;
    return `${m[3]}-${mm}-${String(m[2]).padStart(2, "0")}`;
  };
  let next = raw.replace(
    /(\d{4}-\d{2}-\d{2})\s*(?:to|until|through|–|-)\s*(\d{4}-\d{2}-\d{2})/gi,
    (_all, start, end) => clipEnd(start, end),
  );
  next = next.replace(
    /([A-Za-z]+\s+\d{1,2},\s+20\d{2})\s*(?:to|until|through|–|-)\s*([A-Za-z]+\s+\d{1,2},\s+20\d{2})/gi,
    (_all, startUs, endUs) => {
      const start = usToIso(startUs);
      const end = usToIso(endUs);
      if (!start || !end) return _all;
      return clipEnd(start, end);
    },
  );
  return next;
}

export function isSimpleOperationalMetricQuestion(question = "") {
  const q = String(question || "").toLowerCase();
  if (/\b(why|compare|versus|\bvs\b|forecast|expect|should we|what caused|difference)\b/.test(q)) {
    return false;
  }
  const metric = /\b(sales|covers|average spend|avg spend|cash[\s-]?up|latest sale|net sales)\b/.test(q);
  const when = /\b(today|yesterday|this week|current week|this month|mtd|month to date|latest|last sale|current sales)\b/.test(q);
  return metric && when;
}

export function coverageFromCashUpAggregation(aggregation, requestedPeriod, extras = {}) {
  const breakdown = Array.isArray(aggregation?.dailyBreakdown) ? aggregation.dailyBreakdown : [];
  let availableDates = Array.isArray(aggregation?.availableDates) && aggregation.availableDates.length
    ? aggregation.availableDates.map(String)
    : breakdown.filter((row) => row.totalSales != null).map((row) => row.date);
  if (!availableDates.length && aggregation?.salesCoverageStart && aggregation?.salesCoverageEnd) {
    availableDates = listInclusiveIsoDates(aggregation.salesCoverageStart, aggregation.salesCoverageEnd);
  }
  return buildTemporalCoverage({
    requestedStart: requestedPeriod?.startDate || aggregation?.requestedStartDate || null,
    requestedEnd: requestedPeriod?.endDate || aggregation?.requestedEndDate || null,
    requestedLabel: requestedPeriod?.label || null,
    availableDates,
    latestAvailableDate: aggregation?.salesCoverageEnd || availableDates[availableDates.length - 1] || extras.latestAvailableDate || null,
    source: extras.source || "cash_up",
    referenceDate: extras.referenceDate || new Date(),
    todayIsComplete: extras.todayIsComplete === true,
    sourceFailed: extras.sourceFailed === true,
  });
}
