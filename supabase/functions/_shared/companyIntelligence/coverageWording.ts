/**
 * Coverage-aware period wording for Ask NAC.
 * Does not change sales arithmetic — only how requested vs observed ranges are described.
 */

import type { CoverageReport } from "./coverageModel.ts";
import type { EvidenceRecord } from "./evidenceLedger.ts";
import type { DateRange, IsoDate } from "./types.ts";

export type RangeCoverage = {
  requestedStart: IsoDate | null;
  requestedEnd: IsoDate | null;
  coverageStart: IsoDate | null;
  coverageEnd: IsoDate | null;
  coveredDayCount: number | null;
  expectedDayCount: number | null;
  missingDates: IsoDate[];
  isPartial: boolean;
  latestAvailable: IsoDate | null;
};

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatShortSalesDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const [y, m, d] = String(iso).split("-").map(Number);
  if (!y || !m || !d) return String(iso);
  return `${d} ${SHORT_MONTHS[m - 1]} ${y}`;
}

export function formatCoverageRangeLabel(start: string | null, end: string | null): string {
  if (!start && !end) return "the available dates";
  if (start && end && start === end) return formatShortSalesDate(start);
  if (start && end) return `${formatShortSalesDate(start)}–${formatShortSalesDate(end)}`;
  return formatShortSalesDate(start || end);
}

export function listInclusiveIsoDates(start?: string | null, end?: string | null): IsoDate[] {
  if (!start || !end || start > end) return [];
  const dates: IsoDate[] = [];
  let cursor = Date.parse(`${start}T12:00:00Z`);
  const last = Date.parse(`${end}T12:00:00Z`);
  if (!Number.isFinite(cursor) || !Number.isFinite(last)) return [];
  while (cursor <= last) {
    dates.push(new Date(cursor).toISOString().slice(0, 10) as IsoDate);
    cursor += 86400000;
  }
  return dates;
}

function observedDatesFromEvidence(evidence: EvidenceRecord[] = []): IsoDate[] {
  const dates = new Set<string>();
  for (const row of evidence) {
    const period = row.period;
    if (period?.startDate && period?.endDate && period.startDate === period.endDate) {
      dates.add(period.startDate);
    }
  }
  return [...dates].sort() as IsoDate[];
}

export function deriveRangeCoverage(input: {
  period?: DateRange | null;
  coverage?: CoverageReport[] | null;
  evidence?: EvidenceRecord[] | null;
}): RangeCoverage {
  const period = input.period || null;
  const salesCov = (input.coverage || []).find((c) => c.domain === "sales") || (input.coverage || [])[0] || null;
  const requestedStart = (salesCov?.requestedStart || period?.startDate || null) as IsoDate | null;
  const requestedEnd = (salesCov?.requestedEnd || period?.endDate || null) as IsoDate | null;
  const expected = salesCov?.expectedRecords
    ?? (requestedStart && requestedEnd ? listInclusiveIsoDates(requestedStart, requestedEnd).length : null);
  const covered = salesCov?.availableRecords ?? null;
  const latestAvailable = (salesCov?.freshness || null) as IsoDate | null;
  const observedDates = observedDatesFromEvidence(input.evidence || []);

  let coverageStart = observedDates[0] || requestedStart;
  let coverageEnd = observedDates[observedDates.length - 1] || latestAvailable || requestedEnd;
  if (latestAvailable && (!coverageEnd || latestAvailable < coverageEnd)) {
    coverageEnd = latestAvailable;
  }

  let missingDates: IsoDate[] = [];
  if (requestedStart && requestedEnd) {
    const requested = listInclusiveIsoDates(requestedStart, requestedEnd);
    if (observedDates.length) {
      const have = new Set(observedDates);
      missingDates = requested.filter((d) => !have.has(d));
    } else if (latestAvailable && requestedEnd > latestAvailable) {
      missingDates = listInclusiveIsoDates(
        new Date(Date.parse(`${latestAvailable}T12:00:00Z`) + 86400000).toISOString().slice(0, 10),
        requestedEnd,
      );
    } else if (expected != null && covered != null && covered < expected && requested.length) {
      missingDates = requested.slice(covered);
    }
  }

  const isPartial = Boolean(
    (expected != null && covered != null && covered > 0 && covered < expected)
    || missingDates.length > 0,
  );

  if (isPartial && missingDates.length && coverageEnd && missingDates.includes(coverageEnd)) {
    const coveredSet = new Set(missingDates);
    const remaining = listInclusiveIsoDates(requestedStart, requestedEnd).filter((d) => !coveredSet.has(d));
    coverageStart = remaining[0] || coverageStart;
    coverageEnd = remaining[remaining.length - 1] || coverageEnd;
  }

  return {
    requestedStart,
    requestedEnd,
    coverageStart: coverageStart || null,
    coverageEnd: coverageEnd || null,
    coveredDayCount: covered,
    expectedDayCount: expected,
    missingDates,
    isPartial,
    latestAvailable,
  };
}

export function formatMissingDatesProse(missingDates: string[]): string {
  if (!missingDates.length) return "";
  const labels = missingDates.slice(0, 8).map((d) => formatShortSalesDate(d));
  const extra = missingDates.length > 8 ? `, and ${missingDates.length - 8} more` : "";
  if (labels.length === 1) return `${labels[0]} does not have sales data yet.`;
  return `${labels.join(", ")}${extra} do not have sales data yet.`;
}

export function buildCoverageAwareSalesLead(input: {
  branchLabel: string;
  period?: DateRange | null;
  coverage?: CoverageReport[] | null;
  evidence?: EvidenceRecord[] | null;
}): { windowLabel: string; preamble: string[]; coverage: RangeCoverage } {
  const coverage = deriveRangeCoverage(input);
  const requestedLabel = input.period?.label
    || formatCoverageRangeLabel(coverage.requestedStart, coverage.requestedEnd);
  const coveredLabel = formatCoverageRangeLabel(coverage.coverageStart, coverage.coverageEnd);
  const preamble: string[] = [];

  if (coverage.isPartial && coverage.coverageEnd) {
    preamble.push(`Sales are currently available through ${formatShortSalesDate(coverage.coverageEnd)}.`);
    if (coverage.missingDates.length) {
      preamble.push(formatMissingDatesProse(coverage.missingDates));
    }
    return { windowLabel: coveredLabel, preamble, coverage };
  }

  return { windowLabel: requestedLabel, preamble, coverage };
}
