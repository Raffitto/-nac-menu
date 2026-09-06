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
  return todayIsComplete ? today : addIsoDays(today, -1);
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
  const expectedDates = listInclusiveIsoDates(requestedStart, requestedEnd);
  const available = [...new Set((availableDates || []).filter(Boolean))].sort();
  const latestCompleted = latestCompletedBusinessDate(referenceDate, { todayIsComplete });
  const latestAvailable = latestAvailableDate || available[available.length - 1] || null;
  const today = riyadhYmd(referenceDate);

  let missingDates = expectedDates.filter((d) => !available.includes(d));
  if (!available.length && latestAvailable && requestedEnd && requestedEnd > latestAvailable) {
    missingDates = listInclusiveIsoDates(addIsoDays(latestAvailable, 1), requestedEnd);
  }

  const coverageStart = available[0] || null;
  const coverageEnd = available[available.length - 1] || latestAvailable || null;

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
    && !available.includes(today)
    && (available.length > 0 || latestAvailable)
  ) {
    status = COVERAGE_STATUS.CURRENT_DAY_NOT_COMPLETE;
  } else if (available.length > 0 || latestAvailable) {
    status = COVERAGE_STATUS.PARTIAL;
  }

  return {
    source,
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
    expectedDates,
    availableDates: available,
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
export function spokenPeriodLabel(coverage, { weekish = false } = {}) {
  if (!coverage) return "the requested period";
  const through = coverage.availablePeriod?.endDate || coverage.latestAvailableDate;
  if (
    coverage.coverageStatus === COVERAGE_STATUS.PARTIAL
    || coverage.coverageStatus === COVERAGE_STATUS.CURRENT_DAY_NOT_COMPLETE
  ) {
    if (weekish && through) return `so far this week through ${formatShortSalesDate(through)}`;
    if (through) return formatCoverageRangeLabel(coverage.availablePeriod?.startDate, through);
  }
  if (coverage.coverageStatus === COVERAGE_STATUS.COMPLETE) {
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
    if (coverage.latestAvailableDate) {
      lines.push(`Latest available date: ${formatShortSalesDate(coverage.latestAvailableDate)}.`);
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
    && coverage.coverageStatus !== COVERAGE_STATUS.COMPLETE
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
  return {
    source: coverage?.source || "cash_up",
    requestedStart,
    requestedEnd,
    availableStart,
    availableEnd,
    latestAvailableDate: coverage?.latestAvailableDate || availableEnd,
    expectedDayCount: coverage?.expectedDates?.length || null,
    availableDayCount: coverage?.availableDates?.length || null,
    missingDates: missing,
    coverageStatus: coverage?.coverageStatus || COVERAGE_STATUS.NO_DATA,
    isCurrentPeriod: Boolean(requestedEnd && coverage?.today && requestedEnd >= coverage.today),
    spokenLabel,
    synthesisInstruction,
  };
}

export function applyPeriodSafetyNet(text, response = {}) {
  const sanitized = sanitizeIncompletePeriodAnswer(text, response);
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
  const availableDates = breakdown.filter((row) => row.totalSales != null).map((row) => row.date);
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
