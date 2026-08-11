/**
 * Universal coverage model — not Cash-Up-specific.
 */

import type { DateRange, IsoDate } from "./types.ts";

export type CoverageReport = {
  domain: string;
  requestedStart: IsoDate | null;
  requestedEnd: IsoDate | null;
  expectedRecords: number | null;
  availableRecords: number | null;
  missingRecords: number | null;
  coverageRatio: number | null;
  freshness: string | null;
  warnings: string[];
};

export function emptyCoverage(domain = "unknown"): CoverageReport {
  return {
    domain,
    requestedStart: null,
    requestedEnd: null,
    expectedRecords: null,
    availableRecords: null,
    missingRecords: null,
    coverageRatio: null,
    freshness: null,
    warnings: [],
  };
}

export function buildCoverageReport(input: {
  domain: string;
  range?: DateRange | null;
  expectedRecords?: number | null;
  availableRecords?: number | null;
  freshness?: string | null;
  warnings?: string[];
}): CoverageReport {
  const expected = input.expectedRecords ?? null;
  const available = input.availableRecords ?? null;
  const missing = expected != null && available != null
    ? Math.max(0, expected - available)
    : null;
  const ratio = expected != null && expected > 0 && available != null
    ? available / expected
    : null;

  const warnings = [...(input.warnings || [])];
  if (ratio != null && ratio < 1) warnings.push("partial_coverage");
  if (ratio != null && ratio < 0.5) warnings.push("weak_coverage");

  return {
    domain: input.domain,
    requestedStart: input.range?.startDate || null,
    requestedEnd: input.range?.endDate || null,
    expectedRecords: expected,
    availableRecords: available,
    missingRecords: missing,
    coverageRatio: ratio,
    freshness: input.freshness || null,
    warnings,
  };
}

/** Inclusive day count for ISO date ranges. */
export function inclusiveDayCount(range: DateRange): number {
  const start = Date.parse(`${range.startDate}T00:00:00Z`);
  const end = Date.parse(`${range.endDate}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0;
  return Math.round((end - start) / 86400000) + 1;
}
