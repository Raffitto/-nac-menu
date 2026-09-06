/**
 * Authoritative Ask NAC coverage contract — attach BEFORE model synthesis.
 * Source-specific: this module describes Cash Up / sales-day coverage only.
 */

export const COVERAGE_STATUS = {
  COMPLETE: "COMPLETE",
  PARTIAL: "PARTIAL",
  NO_DATA: "NO_DATA",
  CURRENT_DAY_NOT_COMPLETE: "CURRENT_DAY_NOT_COMPLETE",
  SOURCE_DELAYED: "SOURCE_DELAYED",
} as const;

export type CoverageStatus = (typeof COVERAGE_STATUS)[keyof typeof COVERAGE_STATUS];

export type CoverageContract = {
  source: string;
  requestedStart: string | null;
  requestedEnd: string | null;
  availableStart: string | null;
  availableEnd: string | null;
  latestAvailableDate: string | null;
  priorLatestAvailableDate?: string | null;
  expectedDayCount: number | null;
  availableDayCount: number | null;
  availableDates: string[];
  missingDates: string[];
  coverageStatus: CoverageStatus;
  isCurrentPeriod: boolean;
  spokenLabel: string;
  synthesisInstruction: string;
};

const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function riyadhYmd(referenceDate = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(referenceDate);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function addIsoDays(iso: string, delta: number): string {
  const [y, m, d] = String(iso).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + Number(delta || 0)));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

export function formatShortSalesDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const [y, m, d] = String(iso).split("-").map(Number);
  if (!y || !m || !d) return String(iso);
  return `${d} ${SHORT[m - 1]} ${y}`;
}

function listDates(start: string | null, end: string | null): string[] {
  if (!start || !end || start > end) return [];
  const out: string[] = [];
  let cur = start;
  let guard = 0;
  while (cur <= end && guard < 400) {
    out.push(cur);
    cur = addIsoDays(cur, 1);
    guard += 1;
  }
  return out;
}

export function buildCashUpCoverageContract(input: {
  requestedStart?: string | null;
  requestedEnd?: string | null;
  requestedLabel?: string | null;
  availableDates?: string[];
  latestAvailableDate?: string | null;
  sourceFailed?: boolean;
  referenceDate?: Date;
  source?: string;
}): CoverageContract {
  const requestedStart = input.requestedStart || null;
  const requestedEnd = input.requestedEnd || null;
  const expected = listDates(requestedStart, requestedEnd);
  const rawAvailable = [...new Set((input.availableDates || []).filter(Boolean))].sort();
  const available = requestedStart && requestedEnd
    ? rawAvailable.filter((d) => d >= requestedStart && d <= requestedEnd)
    : rawAvailable;
  const today = riyadhYmd(input.referenceDate || new Date());
  const latestInWindow = input.latestAvailableDate
    && requestedStart
    && input.latestAvailableDate >= requestedStart
    && (!requestedEnd || input.latestAvailableDate <= requestedEnd)
    ? input.latestAvailableDate
    : null;
  const latestAvailable = latestInWindow || available[available.length - 1] || null;
  const priorLatestAvailableDate = input.latestAvailableDate
    && requestedStart
    && input.latestAvailableDate < requestedStart
    ? input.latestAvailableDate
    : null;
  const missing = expected.filter((d) => !available.includes(d));
  const availableStart = available[0] || null;
  const availableEnd = available[available.length - 1] || latestAvailable || null;

  let coverageStatus: CoverageStatus = COVERAGE_STATUS.NO_DATA;
  if (input.sourceFailed) coverageStatus = COVERAGE_STATUS.SOURCE_DELAYED;
  else if (!available.length && !latestAvailable) coverageStatus = COVERAGE_STATUS.NO_DATA;
  else if (expected.length && available.length >= expected.length && missing.length === 0) {
    coverageStatus = COVERAGE_STATUS.COMPLETE;
  } else if (requestedEnd === today && !available.includes(today) && (available.length || latestAvailable)) {
    coverageStatus = COVERAGE_STATUS.CURRENT_DAY_NOT_COMPLETE;
  } else {
    coverageStatus = COVERAGE_STATUS.PARTIAL;
  }

  const isCurrentPeriod = Boolean(requestedEnd && requestedEnd >= today);
  const weekish = /this week|current week/i.test(String(input.requestedLabel || ""));
  const monthish = /month|mtd/i.test(String(input.requestedLabel || ""));
  let spokenLabel = input.requestedLabel || "the requested period";
  if (coverageStatus === COVERAGE_STATUS.NO_DATA && weekish && requestedStart === today) {
    spokenLabel = `The current NAC week started today, ${formatShortSalesDate(requestedStart)}, and no completed sales day is available yet`;
  } else if (coverageStatus === COVERAGE_STATUS.COMPLETE) {
    spokenLabel = input.requestedLabel || `${formatShortSalesDate(requestedStart)}–${formatShortSalesDate(requestedEnd)}`;
  } else if (availableEnd && weekish) {
    spokenLabel = `so far this week through ${formatShortSalesDate(availableEnd)}`;
  } else if (availableEnd && monthish && isCurrentPeriod) {
    spokenLabel = `so far this month through ${formatShortSalesDate(availableEnd)}`;
  } else if (availableEnd && isCurrentPeriod) {
    spokenLabel = `so far this period through ${formatShortSalesDate(availableEnd)}`;
  } else if (availableStart && availableEnd) {
    spokenLabel = `${formatShortSalesDate(availableStart)}–${formatShortSalesDate(availableEnd)}`;
  }

  const missingProse = missing.length === 1
    ? `${formatShortSalesDate(missing[0])} does not have sales data yet.`
    : missing.length
      ? `Missing sales dates: ${missing.slice(0, 6).map(formatShortSalesDate).join(", ")}.`
      : "";

  const synthesisInstruction = coverageStatus === COVERAGE_STATUS.COMPLETE
    ? "The requested period is complete. You may name the requested dates."
    : [
      "Never describe unavailable dates as included.",
      availableEnd ? `Describe the result as through ${formatShortSalesDate(availableEnd)} / so far this period.` : "",
      requestedEnd && availableEnd && requestedEnd !== availableEnd
        ? `Do not say sales were for ${requestedEnd} or include ${requestedEnd} in the period window.`
        : "",
      missingProse,
    ].filter(Boolean).join(" ");

  return {
    source: input.source || "cash_up",
    requestedStart,
    requestedEnd,
    availableStart,
    availableEnd,
    latestAvailableDate: latestAvailable,
    priorLatestAvailableDate,
    expectedDayCount: expected.length || null,
    availableDayCount: available.length || null,
    availableDates: available,
    missingDates: missing,
    coverageStatus,
    isCurrentPeriod,
    spokenLabel,
    synthesisInstruction,
  };
}

export function coverageFromCashUpAggregation(
  aggregation: Record<string, unknown> | null | undefined,
  requested: { startDate?: string; endDate?: string; label?: string } | null | undefined,
  extras: { sourceFailed?: boolean; source?: string; referenceDate?: Date } = {},
): CoverageContract {
  const breakdown = Array.isArray(aggregation?.dailyBreakdown) ? aggregation.dailyBreakdown as { date?: string; totalSales?: number | null }[] : [];
  let availableDates = Array.isArray(aggregation?.availableDates) && (aggregation.availableDates as string[]).length
    ? (aggregation.availableDates as string[]).map(String)
    : breakdown.filter((row) => row.totalSales != null).map((row) => String(row.date));
  if (!availableDates.length && aggregation?.salesCoverageStart && aggregation?.salesCoverageEnd) {
    availableDates = listDates(String(aggregation.salesCoverageStart), String(aggregation.salesCoverageEnd));
  }
  return buildCashUpCoverageContract({
    requestedStart: requested?.startDate || (aggregation?.requestedStartDate as string) || null,
    requestedEnd: requested?.endDate || (aggregation?.requestedEndDate as string) || null,
    requestedLabel: requested?.label || null,
    availableDates,
    latestAvailableDate: (aggregation?.salesCoverageEnd as string) || availableDates[availableDates.length - 1] || null,
    sourceFailed: extras.sourceFailed,
    referenceDate: extras.referenceDate,
    source: extras.source || "cash_up",
  });
}

export function sanitizeIncompletePeriodAnswer(text: string, response: Record<string, unknown> = {}): string {
  const raw = String(text || "");
  const metrics = (response.keyMetrics as { label?: string; key?: string; value?: unknown }[]) || [];
  const metricNumber = (pattern: RegExp) => {
    const row = metrics.find((m) => pattern.test(String(m.label || m.key || "")));
    const n = Number(row?.value);
    return Number.isFinite(n) ? n : null;
  };
  const dayCount = metricNumber(/day[_ ]?count|days included/i);
  const expected = metricNumber(/expectedDayCount|expected day/i);
  const missing = metricNumber(/missingDayCount|missing day/i);
  const incomplete = (missing != null && missing > 0)
    || (expected != null && dayCount != null && dayCount > 0 && dayCount < expected);
  if (!incomplete) return raw;
  const miss = missing != null ? missing : Math.max(0, (expected || 0) - (dayCount || 0));
  const clipEnd = (start: string, end: string) => {
    let latest = end;
    for (let i = 0; i < miss; i += 1) latest = addIsoDays(latest, -1);
    if (start && latest < start) latest = start;
    return `so far this period through ${formatShortSalesDate(latest)}`;
  };
  const MONTHS: Record<string, string> = {
    january: "01", february: "02", march: "03", april: "04", may: "05", june: "06",
    july: "07", august: "08", september: "09", october: "10", november: "11", december: "12",
  };
  const usToIso = (part: string) => {
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

function formatLongUsDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const [y, m, d] = String(iso).split("-").map(Number);
  if (!y || !m || !d) return String(iso);
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  return `${months[m - 1]} ${d}, ${y}`;
}

function rewriteRequestedEndDates(text: string, contract: CoverageContract | null | undefined): string {
  if (!contract?.availableEnd || !contract?.requestedEnd || contract.availableEnd >= contract.requestedEnd) {
    return text;
  }
  const through = `through ${formatShortSalesDate(contract.availableEnd)}`;
  const asOf = `as of ${formatShortSalesDate(contract.availableEnd)}`;
  const reqShort = formatShortSalesDate(contract.requestedEnd);
  const reqLong = formatLongUsDate(contract.requestedEnd);
  const availLong = formatLongUsDate(contract.availableEnd);
  let next = text;
  if (reqLong) {
    next = next.replace(new RegExp(`\\bAs of\\s+${reqLong}\\b`, "gi"), `As of ${availLong}`);
    next = next.replace(new RegExp(`\\b${reqLong}\\b`, "g"), availLong);
  }
  if (reqShort) {
    next = next.replace(new RegExp(`\\bAs of\\s+${reqShort}\\b`, "gi"), asOf);
    next = next.replace(new RegExp(`\\bthrough\\s+${reqShort}\\b`, "gi"), through);
  }
  return next;
}

export function applyPeriodSafetyNet(text: string, response: Record<string, unknown> = {}) {
  const contract = (response.coverageContract || null) as CoverageContract | null;
  let sanitized = sanitizeIncompletePeriodAnswer(text, response);
  sanitized = rewriteRequestedEndDates(sanitized, contract);
  if (contract?.availableEnd && contract?.requestedEnd && contract.availableEnd < contract.requestedEnd) {
    sanitized = sanitized.replace(
      new RegExp(`\\b${contract.requestedEnd}\\b`, "g"),
      formatShortSalesDate(contract.availableEnd),
    );
  }
  return { text: sanitized, correctionNeeded: sanitized !== String(text || "") };
}

export function coverageContractFromFabric(input: {
  period?: { startDate?: string; endDate?: string; label?: string } | null;
  coverage?: Array<{
    domain?: string;
    requestedStart?: string | null;
    requestedEnd?: string | null;
    expectedRecords?: number | null;
    availableRecords?: number | null;
    freshness?: string | null;
    availableDates?: string[];
  }>;
  evidence?: Array<{ period?: { startDate?: string; endDate?: string } | null }>;
  referenceDate?: Date;
}): CoverageContract {
  const reports = (input.coverage || []).map((c) => ({
    ...c,
    availableRecords: c.availableRecords ?? (c as { availableDays?: number }).availableDays ?? null,
    expectedRecords: c.expectedRecords ?? (c as { expectedDays?: number }).expectedDays ?? null,
  }));
  const sales = reports.find((c) => c.domain === "sales" && (c.availableRecords || c.freshness))
    || reports.find((c) => c.domain === "sales")
    || reports.find((c) => (c.availableRecords || 0) > 0)
    || reports[0]
    || null;
  const requestedStart = sales?.requestedStart || input.period?.startDate || null;
  const requestedEnd = sales?.requestedEnd || input.period?.endDate || null;
  let latest = sales?.freshness || null;
  const observed = (input.evidence || [])
    .map((row) => row.period)
    .filter((period): period is { startDate: string; endDate: string } => Boolean(
      period?.startDate && period?.endDate && period.startDate === period.endDate,
    ))
    .map((period) => period.startDate);
  let availableDates = [
    ...new Set([
      ...observed,
      ...((sales as { availableDates?: string[] } | null)?.availableDates || []),
    ]),
  ].sort();
  if (!latest && requestedStart && sales?.availableRecords && sales.availableRecords > 0) {
    latest = addIsoDays(requestedStart, Number(sales.availableRecords) - 1);
    if (requestedEnd && latest > requestedEnd) latest = requestedEnd;
  }
  if (!availableDates.length && latest && requestedStart && latest >= requestedStart) {
    const clipEnd = requestedEnd && latest > requestedEnd ? requestedEnd : latest;
    availableDates = listDates(requestedStart, clipEnd);
  }
  return buildCashUpCoverageContract({
    requestedStart,
    requestedEnd,
    requestedLabel: input.period?.label || null,
    availableDates,
    latestAvailableDate: latest,
    referenceDate: input.referenceDate,
    source: "cash_up",
  });
}

export function isSimpleOperationalMetricQuestion(question = ""): boolean {
  const q = String(question || "").toLowerCase();
  if (/\b(why|compare|versus|\bvs\b|forecast|expect|should we|what caused|difference)\b/.test(q)) {
    return false;
  }
  const metric = /\b(sales|covers|average spend|avg spend|cash[\s-]?up|latest sale|net sales)\b/.test(q);
  const when = /\b(today|yesterday|this week|current week|this month|mtd|month to date|latest|last sale|current sales)\b/.test(q);
  return metric && when;
}
