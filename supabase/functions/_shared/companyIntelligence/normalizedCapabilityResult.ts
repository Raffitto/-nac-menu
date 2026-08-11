/**
 * Canonical normalized capability-result contract.
 * Downstream Fabric stages must consume this — not raw Cash Up / vault / logbook shapes.
 */

import type { CapabilityId } from "./capabilityRegistry.ts";
import { buildCoverageReport, type CoverageReport } from "./coverageModel.ts";
import { getSourceAuthority } from "./sourceAuthority.ts";
import type {
  BranchId,
  ComparisonMethod,
  DateRange,
  IsoDate,
  SourceAuthority,
} from "./types.ts";

export type NormalizedCoverage = {
  requestedStart: IsoDate | null;
  requestedEnd: IsoDate | null;
  observedStart: IsoDate | null;
  observedEnd: IsoDate | null;
  expectedDays: number | null;
  observedDays: number | null;
  missingDays: number | null;
  expectedRecords: number | null;
  observedRecords: number | null;
  missingRecords: number | null;
  coverageRatio: number | null;
  freshness: string | null;
  warnings: string[];
};

export type NormalizedComparisonMode =
  | "full_period"
  | "matched_days"
  | "matched_weekdays"
  | "daily_average"
  | "unavailable"
  | "not_comparable";

export type NormalizedComparison = {
  mode: NormalizedComparisonMode;
  current: { startDate: IsoDate | null; endDate: IsoDate | null; value: number | null };
  previous: { startDate: IsoDate | null; endDate: IsoDate | null; value: number | null };
  matchedDayCount: number | null;
  delta: number | null;
  percentChange: number | null;
  warnings: string[];
};

export type NormalizedMetric = {
  metricKey: string;
  label: string;
  value: number | string | null;
  unit: string | null;
  numerator?: number | null;
  denominator?: number | null;
  source: string;
  coverage: NormalizedCoverage | null;
};

export type NormalizedRanking = {
  rank: number;
  direction: "top" | "bottom" | "unknown";
  date: IsoDate | null;
  label: string | null;
  metricKey: string;
  value: number | null;
  unit: string | null;
};

export type NormalizedQualitativeEvidence = {
  id: string;
  summary: string;
  periodStart: IsoDate | null;
  periodEnd: IsoDate | null;
  branchId: BranchId | null;
  documentRef: string | null;
  relevance: "high" | "medium" | "low";
};

export type NormalizedCapabilityResult = {
  capabilityId: CapabilityId;
  source: string;
  sourceAuthority: SourceAuthority;
  scope: {
    companyId: string | null;
    brandId: string | null;
    branchId: BranchId | null;
  };
  requestedPeriod: DateRange | null;
  observedPeriod: DateRange | null;
  coverage: NormalizedCoverage | null;
  metrics: NormalizedMetric[];
  comparison: NormalizedComparison | null;
  rankings: NormalizedRanking[];
  qualitativeEvidence: NormalizedQualitativeEvidence[];
  warnings: string[];
  provenance: {
    implementationTool: string;
    ok: boolean;
    skipped: boolean;
    skipReason: string | null;
  };
  rawRef: string | null;
};

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function str(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s || null;
}

export function coverageReportToNormalized(cov: CoverageReport | null | undefined): NormalizedCoverage | null {
  if (!cov) return null;
  return {
    requestedStart: cov.requestedStart,
    requestedEnd: cov.requestedEnd,
    observedStart: cov.requestedStart,
    observedEnd: cov.requestedEnd,
    expectedDays: cov.expectedRecords,
    observedDays: cov.availableRecords,
    missingDays: cov.missingRecords,
    expectedRecords: cov.expectedRecords,
    observedRecords: cov.availableRecords,
    missingRecords: cov.missingRecords,
    coverageRatio: cov.coverageRatio,
    freshness: cov.freshness,
    warnings: [...(cov.warnings || [])],
  };
}

export function normalizeCoverageFromUnknown(
  raw: unknown,
  fallbackPeriod: DateRange | null = null,
  domain = "sales",
): NormalizedCoverage {
  const obj = asObject(raw) || {};
  const nested = asObject(obj.dataConfidence) || {};
  const expected = num(obj.expectedDays) ?? num(obj.expectedRecords) ?? num(nested.expectedDays);
  const observed = num(obj.availableDays) ?? num(obj.observedDays) ?? num(obj.availableRecords)
    ?? num(obj.observedRecords) ?? num(nested.availableDays);
  const missing = expected != null && observed != null ? Math.max(0, expected - observed) : null;
  const ratio = expected != null && expected > 0 && observed != null ? observed / expected : num(obj.coverageRatio);
  const requestedStart = str(obj.requestedStart)
    || str(obj.salesCoverageStart)
    || str(nested.salesCoverageStart)
    || fallbackPeriod?.startDate
    || null;
  const requestedEnd = str(obj.requestedEnd)
    || str(obj.salesCoverageEnd)
    || str(nested.salesCoverageEnd)
    || fallbackPeriod?.endDate
    || null;
  const observedStart = str(obj.observedStart) || str(obj.availableStart) || str(nested.salesCoverageStart) || requestedStart;
  const observedEnd = str(obj.observedEnd) || str(obj.availableEnd) || str(nested.salesCoverageEnd) || requestedEnd;
  const warnings = [
    ...(Array.isArray(obj.warnings) ? obj.warnings.map(String) : []),
    ...(Array.isArray(obj.coverageNotes) ? obj.coverageNotes.map(String) : []),
  ];
  if (ratio != null && ratio < 1 && !warnings.includes("partial_coverage")) warnings.push("partial_coverage");
  if (ratio != null && ratio < 0.5 && !warnings.includes("weak_coverage")) warnings.push("weak_coverage");

  // Prefer buildCoverageReport math for records aliases when only days present.
  const report = buildCoverageReport({
    domain,
    range: requestedStart && requestedEnd
      ? { startDate: requestedStart, endDate: requestedEnd }
      : fallbackPeriod,
    expectedRecords: expected,
    availableRecords: observed,
    freshness: str(obj.freshness),
    warnings,
  });

  return {
    requestedStart: report.requestedStart || requestedStart,
    requestedEnd: report.requestedEnd || requestedEnd,
    observedStart,
    observedEnd,
    expectedDays: expected,
    observedDays: observed,
    missingDays: missing,
    expectedRecords: report.expectedRecords,
    observedRecords: report.availableRecords,
    missingRecords: report.missingRecords,
    coverageRatio: report.coverageRatio ?? ratio,
    freshness: report.freshness,
    warnings: report.warnings,
  };
}

export function mapComparabilityMethodToMode(
  method: ComparisonMethod | string | null | undefined,
  status?: string | null,
): NormalizedComparisonMode {
  if (status === "not_comparable" || method === "none") return "not_comparable";
  switch (method) {
    case "full_period":
      return "full_period";
    case "matched_days":
      return "matched_days";
    case "matched_weekday":
      return "matched_weekdays";
    case "daily_average":
      return "daily_average";
    default:
      return method ? "matched_days" : "unavailable";
  }
}

export function normalizeComparisonFromUnknown(
  raw: unknown,
  options: {
    requestedCurrent?: DateRange | null;
    requestedPrevious?: DateRange | null;
    methodHint?: string | null;
    statusHint?: string | null;
  } = {},
): NormalizedComparison | null {
  if (options.statusHint === "not_comparable") {
    return {
      mode: "not_comparable",
      current: {
        startDate: options.requestedCurrent?.startDate || null,
        endDate: options.requestedCurrent?.endDate || null,
        value: null,
      },
      previous: {
        startDate: options.requestedPrevious?.startDate || null,
        endDate: options.requestedPrevious?.endDate || null,
        value: null,
      },
      matchedDayCount: null,
      delta: null,
      percentChange: null,
      warnings: ["not_comparable"],
    };
  }

  const obj = asObject(raw);
  if (!obj && !options.methodHint) return null;

  const currentObj = asObject(obj?.current) || asObject(obj?.currentPeriod) || {};
  const previousObj = asObject(obj?.previous) || asObject(obj?.previousPeriod) || asObject(obj?.baseline) || {};
  const percentChange = num(obj?.percentChange) ?? num(obj?.deltaPct) ?? num(obj?.delta_pct)
    ?? num(obj?.pctChange) ?? num(obj?.changePct);
  const delta = num(obj?.delta) ?? num(obj?.absoluteDelta) ?? num(obj?.deltaAbs);
  const matchedDayCount = num(obj?.matchedDayCount) ?? num(obj?.matchedDays) ?? num(obj?.matched_day_count);
  const mode = mapComparabilityMethodToMode(
    str(obj?.mode) || str(obj?.method) || options.methodHint,
    options.statusHint,
  );
  const warnings = Array.isArray(obj?.warnings) ? obj!.warnings.map(String) : [];
  if (mode === "matched_days" && !warnings.includes("like_for_like")) warnings.push("like_for_like");

  return {
    mode,
    current: {
      startDate: str(currentObj.startDate) || options.requestedCurrent?.startDate || null,
      endDate: str(currentObj.endDate) || options.requestedCurrent?.endDate || null,
      value: num(currentObj.value) ?? num(currentObj.netSales) ?? num(currentObj.total) ?? num(obj?.currentValue),
    },
    previous: {
      startDate: str(previousObj.startDate) || options.requestedPrevious?.startDate || null,
      endDate: str(previousObj.endDate) || options.requestedPrevious?.endDate || null,
      value: num(previousObj.value) ?? num(previousObj.netSales) ?? num(previousObj.total) ?? num(obj?.previousValue),
    },
    matchedDayCount,
    delta,
    percentChange,
    warnings,
  };
}

const METRIC_LABELS: Record<string, string> = {
  net_sales: "Net sales",
  total_sales: "Total sales",
  covers: "Covers",
  guests: "Guests",
  orders: "Orders",
  avg_spend: "Average spend",
  average_spend: "Average spend",
  delta_pct: "Period change %",
};

export function normalizeMetric(
  input: {
    metricKey: string;
    value: number | string | null;
    unit?: string | null;
    label?: string | null;
    source: string;
    numerator?: number | null;
    denominator?: number | null;
    coverage?: NormalizedCoverage | null;
  },
): NormalizedMetric {
  return {
    metricKey: input.metricKey,
    label: input.label || METRIC_LABELS[input.metricKey] || input.metricKey.replace(/_/g, " "),
    value: input.value,
    unit: input.unit || (input.metricKey.includes("sales") || input.metricKey.includes("spend") ? "SAR" : input.metricKey === "delta_pct" ? "%" : null),
    numerator: input.numerator ?? null,
    denominator: input.denominator ?? null,
    source: input.source,
    coverage: input.coverage || null,
  };
}

export function normalizeQualitativeEvidence(
  entries: Array<Record<string, unknown>>,
  branchId: BranchId | null,
  period: DateRange | null,
): NormalizedQualitativeEvidence[] {
  const out: NormalizedQualitativeEvidence[] = [];
  for (let i = 0; i < Math.min(entries.length, 8); i++) {
    const e = entries[i];
    const summary = str(e.summary) || str(e.excerpt) || str(e.text) || str(e.title) || str(e.issue);
    if (!summary) continue;
    out.push({
      id: str(e.id) || str(e.documentId) || str(e.document_id) || `qual_${i + 1}`,
      summary: summary.slice(0, 280),
      periodStart: str(e.periodStart) || str(e.startDate) || str(e.date) || period?.startDate || null,
      periodEnd: str(e.periodEnd) || str(e.endDate) || str(e.date) || period?.endDate || null,
      branchId: (str(e.branchId) || str(e.branch_id) || branchId) as BranchId | null,
      documentRef: str(e.documentRef) || str(e.document_id) || str(e.sourcePath) || str(e.path) || null,
      relevance: (["high", "medium", "low"].includes(String(e.relevance || ""))
        ? String(e.relevance) as "high" | "medium" | "low"
        : "medium"),
    });
  }
  return out;
}

function inferSource(capabilityId: CapabilityId, implementationTool: string): string {
  if (capabilityId.startsWith("operations.")) return "logbook";
  if (capabilityId.startsWith("research.")) return "web_news";
  if (capabilityId === "company.branch_timeline" || capabilityId === "calendar.resolve_period") {
    return "business_timeline";
  }
  if (capabilityId === "commercial.forecast" || implementationTool === "event_forecast") {
    return "event_forecast";
  }
  if (capabilityId === "cost.margin_analysis") return "cost_control";
  if (capabilityId === "guest.feedback") return "reception";
  if (implementationTool.includes("foodics")) return "foodics";
  return "cash_up";
}

/**
 * Normalize any legacy tool blob / executor result into the canonical contract.
 */
export function normalizeCapabilityResult(input: {
  capabilityId: CapabilityId;
  implementationTool: string;
  ok?: boolean;
  skipped?: boolean;
  skipReason?: string | null;
  branchId?: BranchId | null;
  companyId?: string | null;
  brandId?: string | null;
  requestedPeriod?: DateRange | null;
  comparisonPeriod?: DateRange | null;
  methodHint?: string | null;
  statusHint?: string | null;
  raw?: Record<string, unknown> | null;
  metrics?: Array<{ key: string; value: number | string; unit?: string }>;
  textSnippets?: string[];
  coverage?: CoverageReport | null;
}): NormalizedCapabilityResult {
  const raw = input.raw || {};
  const source = inferSource(input.capabilityId, input.implementationTool);
  const authority = source === "cost_control"
    ? getSourceAuthority("cash_up").authority
    : getSourceAuthority(source).authority;

  const coverage = input.coverage
    ? coverageReportToNormalized(input.coverage)
    : normalizeCoverageFromUnknown(
      raw.coverage || raw.matchedCoverage || raw.dataConfidence || null,
      input.requestedPeriod,
      input.capabilityId.startsWith("operations") ? "logbook" : "sales",
    );

  const comparison = normalizeComparisonFromUnknown(
    raw.comparison || raw.periodComparison || null,
    {
      requestedCurrent: input.requestedPeriod,
      requestedPrevious: input.comparisonPeriod,
      methodHint: input.methodHint,
      statusHint: input.statusHint,
    },
  );

  // Promote delta_pct from loose metrics into comparison when needed.
  let finalComparison = comparison;
  const looseMetrics = input.metrics || [];
  const deltaMetric = looseMetrics.find((m) => m.key === "delta_pct" || m.key === "comparison_method");
  if (!finalComparison && deltaMetric && typeof deltaMetric.value === "number") {
    finalComparison = {
      mode: mapComparabilityMethodToMode(input.methodHint || "matched_days"),
      current: {
        startDate: input.requestedPeriod?.startDate || null,
        endDate: input.requestedPeriod?.endDate || null,
        value: null,
      },
      previous: {
        startDate: input.comparisonPeriod?.startDate || null,
        endDate: input.comparisonPeriod?.endDate || null,
        value: null,
      },
      matchedDayCount: coverage?.observedDays ?? null,
      delta: null,
      percentChange: deltaMetric.value,
      warnings: coverage?.warnings || [],
    };
  }
  if (finalComparison && typeof deltaMetric?.value === "string" && /matched|full_period|daily/.test(deltaMetric.value)) {
    finalComparison = {
      ...finalComparison,
      mode: mapComparabilityMethodToMode(deltaMetric.value),
    };
  }

  const metrics: NormalizedMetric[] = [];
  for (const m of looseMetrics) {
    if (m.key === "comparison_method") continue;
    metrics.push(normalizeMetric({
      metricKey: m.key,
      value: m.value,
      unit: m.unit,
      source,
      coverage,
    }));
  }

  // Facts array shapes
  const facts = Array.isArray(raw.facts) ? raw.facts as Array<Record<string, unknown>> : [];
  for (const fact of facts.slice(0, 16)) {
    const key = str(fact.metric_key) || str(fact.key);
    if (!key) continue;
    if (metrics.some((m) => m.metricKey === key)) continue;
    const value = num(fact.metric_value) ?? (fact.value as number | string | null) ?? null;
    metrics.push(normalizeMetric({
      metricKey: key,
      value,
      unit: str(fact.unit),
      source,
      coverage,
      numerator: num(fact.numerator),
      denominator: num(fact.denominator),
    }));
  }

  const aggregated = asObject(raw.aggregated);
  if (aggregated) {
    for (const [key, value] of Object.entries(aggregated)) {
      if (metrics.some((m) => m.metricKey === key)) continue;
      const n = num(value);
      if (n == null) continue;
      metrics.push(normalizeMetric({ metricKey: key, value: n, source, coverage }));
    }
  }

  // Rankings
  const rankings: NormalizedRanking[] = [];
  const rankRows = Array.isArray(raw.dayRanking)
    ? raw.dayRanking as Array<Record<string, unknown>>
    : Array.isArray(raw.rankings)
      ? raw.rankings as Array<Record<string, unknown>>
      : [];
  rankRows.slice(0, 10).forEach((row, idx) => {
    rankings.push({
      rank: num(row.rank) ?? idx + 1,
      direction: String(row.direction || "").includes("bottom") || String(row.direction || "").includes("worst")
        ? "bottom"
        : String(row.direction || "").includes("top") || String(row.direction || "").includes("best")
          ? "top"
          : "unknown",
      date: str(row.date) || str(row.business_date),
      label: str(row.label) || str(row.dayName),
      metricKey: str(row.metricKey) || str(row.metric_key) || "net_sales",
      value: num(row.value) ?? num(row.net_sales) ?? num(row.sales),
      unit: str(row.unit) || "SAR",
    });
  });

  const qualitativeEntries: Array<Record<string, unknown>> = [];
  if (Array.isArray(raw.documents)) qualitativeEntries.push(...raw.documents as Array<Record<string, unknown>>);
  if (Array.isArray(raw.issues)) qualitativeEntries.push(...raw.issues as Array<Record<string, unknown>>);
  if (Array.isArray(raw.logbookEntries)) qualitativeEntries.push(...raw.logbookEntries as Array<Record<string, unknown>>);
  for (const snippet of input.textSnippets || []) {
    qualitativeEntries.push({ summary: snippet, relevance: "medium" });
  }
  const qualitativeEvidence = normalizeQualitativeEvidence(
    qualitativeEntries,
    input.branchId || null,
    input.requestedPeriod || null,
  );

  const observedPeriod = coverage?.observedStart && coverage?.observedEnd
    ? {
      startDate: coverage.observedStart,
      endDate: coverage.observedEnd,
      label: null,
      semantic: "observed",
    }
    : input.requestedPeriod || null;

  const warnings = [
    ...(coverage?.warnings || []),
    ...(finalComparison?.warnings || []),
    ...(Array.isArray(raw.warnings) ? raw.warnings.map(String) : []),
  ];

  return {
    capabilityId: input.capabilityId,
    source,
    sourceAuthority: authority,
    scope: {
      companyId: input.companyId || null,
      brandId: input.brandId || null,
      branchId: input.branchId || null,
    },
    requestedPeriod: input.requestedPeriod || null,
    observedPeriod,
    coverage,
    metrics,
    comparison: finalComparison,
    rankings,
    qualitativeEvidence,
    warnings: [...new Set(warnings)],
    provenance: {
      implementationTool: input.implementationTool,
      ok: input.ok !== false,
      skipped: Boolean(input.skipped),
      skipReason: input.skipReason || null,
    },
    rawRef: input.skipped ? null : `raw:${input.capabilityId}`,
  };
}

/** Convert normalized result into evidence-ledger friendly slices (no raw blobs). */
export function normalizedResultToEvidenceParts(result: NormalizedCapabilityResult): {
  metrics: Array<{ key: string; value: number | string; unit?: string }>;
  textSnippets: string[];
  coverage: CoverageReport | null;
  comparisonMode: NormalizedComparisonMode | null;
  percentChange: number | null;
} {
  return {
    metrics: [
      ...result.metrics.map((m) => ({
        key: m.metricKey,
        value: m.value as number | string,
        unit: m.unit || undefined,
      })),
      ...(result.comparison?.percentChange != null
        ? [{ key: "delta_pct", value: result.comparison.percentChange, unit: "%" }]
        : []),
    ],
    textSnippets: result.qualitativeEvidence.map((q) => q.summary),
    coverage: result.coverage
      ? {
        domain: result.capabilityId.startsWith("operations") ? "logbook" : "sales",
        requestedStart: result.coverage.requestedStart,
        requestedEnd: result.coverage.requestedEnd,
        expectedRecords: result.coverage.expectedRecords ?? result.coverage.expectedDays,
        availableRecords: result.coverage.observedRecords ?? result.coverage.observedDays,
        missingRecords: result.coverage.missingRecords ?? result.coverage.missingDays,
        coverageRatio: result.coverage.coverageRatio,
        freshness: result.coverage.freshness,
        warnings: result.coverage.warnings,
      }
      : null,
    comparisonMode: result.comparison?.mode || null,
    percentChange: result.comparison?.percentChange ?? null,
  };
}
