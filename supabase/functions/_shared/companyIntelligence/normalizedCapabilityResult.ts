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
import { buildMatchedCoverageComparison } from "../cashUpMatchedCoverageComparison.ts";

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

export type NormalizedDailyFact = {
  date: IsoDate;
  net_sales: number | null;
  covers: number | null;
  orders: number | null;
  avg_spend: number | null;
};

export type CommercialMetricBundle = {
  net_sales: number | null;
  covers: number | null;
  orders: number | null;
  avg_spend: number | null;
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
  dailyFacts: NormalizedDailyFact[];
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

function signedPercentChange(current: number, previous: number): { delta: number; percentChange: number | null } {
  const delta = current - previous;
  if (previous === 0) return { delta, percentChange: null };
  return { delta, percentChange: (delta / previous) * 100 };
}

function comparisonHasUsableValues(comparison: NormalizedComparison | null): boolean {
  if (!comparison) return false;
  if (comparison.mode === "not_comparable") return true;
  return comparison.current.value != null
    && comparison.previous.value != null
    && (comparison.percentChange != null || comparison.delta != null);
}

/**
 * Map vault aggregations onto NormalizedComparison using the existing
 * coverage-aware Cash Up helper. Never headline-compare unmatched raw totals.
 */
export function comparisonFromCashUpAggregations(
  aggregation: Record<string, unknown>,
  previousAggregation: Record<string, unknown>,
  options: {
    requestedCurrent?: DateRange | null;
    requestedPrevious?: DateRange | null;
    methodHint?: string | null;
  } = {},
): NormalizedComparison | null {
  const safe = buildMatchedCoverageComparison(aggregation, previousAggregation) as Record<string, unknown>;
  const currentStart = options.requestedCurrent?.startDate || null;
  const currentEnd = options.requestedCurrent?.endDate || null;
  const previousStart = options.requestedPrevious?.startDate || null;
  const previousEnd = options.requestedPrevious?.endDate || null;
  const warnings: string[] = [];
  if (typeof safe.reason === "string" && safe.reason) warnings.push(String(safe.reason));

  const finish = (
    mode: NormalizedComparisonMode,
    currentValue: number,
    previousValue: number,
    matchedDayCount: number | null,
    extraWarnings: string[] = [],
  ): NormalizedComparison => {
    const { delta, percentChange } = signedPercentChange(currentValue, previousValue);
    return {
      mode,
      current: { startDate: currentStart, endDate: currentEnd, value: currentValue },
      previous: { startDate: previousStart, endDate: previousEnd, value: previousValue },
      matchedDayCount,
      delta,
      percentChange,
      warnings: [...new Set([...warnings, ...extraWarnings])],
    };
  };

  if (safe.mode === "matched") {
    const currentMatched = asObject(safe.currentMatched);
    const previousMatched = asObject(safe.previousMatched);
    const currentValue = num(currentMatched?.totalSales);
    const previousValue = num(previousMatched?.totalSales);
    if (currentValue == null || previousValue == null) return null;
    return finish(
      mapComparabilityMethodToMode(options.methodHint || "matched_days"),
      currentValue,
      previousValue,
      num(safe.matchedDayCount),
      ["like_for_like"],
    );
  }

  if (safe.mode === "full") {
    const currentFull = asObject(safe.current) || aggregation;
    const previousFull = asObject(safe.previous) || previousAggregation;
    const currentValue = num(currentFull.totalSales ?? currentFull.net_sales);
    const previousValue = num(previousFull.totalSales ?? previousFull.net_sales);
    if (currentValue == null || previousValue == null) return null;
    return finish("full_period", currentValue, previousValue, num(currentFull.dayCount), ["like_for_like"]);
  }

  const currentAvg = num(safe.currentAvgDailySales);
  const previousAvg = num(safe.previousAvgDailySales);
  if (currentAvg != null && previousAvg != null) {
    return finish("daily_average", currentAvg, previousAvg, null, ["daily_average_fallback"]);
  }

  return {
    mode: "unavailable",
    current: { startDate: currentStart, endDate: currentEnd, value: null },
    previous: { startDate: previousStart, endDate: previousEnd, value: null },
    matchedDayCount: null,
    delta: null,
    percentChange: null,
    warnings,
  };
}

function pickCommercialBundle(agg: Record<string, unknown> | null | undefined): CommercialMetricBundle {
  const net_sales = num(agg?.totalSales ?? agg?.net_sales ?? agg?.total_sales);
  const covers = num(agg?.totalGuests ?? agg?.guest_count ?? agg?.covers);
  const orders = num(agg?.totalOrders ?? agg?.order_count);
  const avg_spend = num(agg?.averageSpend ?? agg?.avg_per_guest)
    ?? (net_sales != null && covers && covers > 0 ? net_sales / covers : null);
  return { net_sales, covers, orders, avg_spend };
}

/**
 * Current/previous commercial bundle using the same matched-coverage helper as sales comparison.
 */
export function commercialBundleFromCashUpAggregations(
  aggregation: Record<string, unknown>,
  previousAggregation: Record<string, unknown>,
): {
  mode: string;
  current: CommercialMetricBundle;
  previous: CommercialMetricBundle;
  matchedDayCount: number | null;
} | null {
  const safe = buildMatchedCoverageComparison(aggregation, previousAggregation) as Record<string, unknown>;
  if (safe.mode === "matched") {
    return {
      mode: "matched",
      current: pickCommercialBundle(asObject(safe.currentMatched)),
      previous: pickCommercialBundle(asObject(safe.previousMatched)),
      matchedDayCount: num(safe.matchedDayCount),
    };
  }
  if (safe.mode === "full") {
    return {
      mode: "full",
      current: pickCommercialBundle(asObject(safe.current) || aggregation),
      previous: pickCommercialBundle(asObject(safe.previous) || previousAggregation),
      matchedDayCount: num((asObject(safe.current) || aggregation).dayCount),
    };
  }
  const currentDays = num(aggregation.dayCount) || 0;
  const previousDays = num(previousAggregation.dayCount) || 0;
  const current = pickCommercialBundle(aggregation);
  const previous = pickCommercialBundle(previousAggregation);
  if (!currentDays || !previousDays) return null;
  return {
    mode: String(safe.mode || "daily_average"),
    current: {
      net_sales: num(safe.currentAvgDailySales) ?? (current.net_sales != null ? current.net_sales / currentDays : null),
      covers: current.covers != null ? current.covers / currentDays : null,
      orders: current.orders != null ? current.orders / currentDays : null,
      avg_spend: current.avg_spend,
    },
    previous: {
      net_sales: num(safe.previousAvgDailySales) ?? (previous.net_sales != null ? previous.net_sales / previousDays : null),
      covers: previous.covers != null ? previous.covers / previousDays : null,
      orders: previous.orders != null ? previous.orders / previousDays : null,
      avg_spend: previous.avg_spend,
    },
    matchedDayCount: null,
  };
}

function dailyFactsFromBreakdown(breakdown: unknown): NormalizedDailyFact[] {
  if (!Array.isArray(breakdown)) return [];
  const out: NormalizedDailyFact[] = [];
  for (const row of breakdown.slice(0, 62) as Array<Record<string, unknown>>) {
    const date = str(row.date) || str(row.business_date);
    if (!date) continue;
    const net_sales = num(row.totalSales ?? row.net_sales ?? row.sales);
    const covers = num(row.totalGuests ?? row.covers ?? row.guest_count);
    const orders = num(row.totalOrders ?? row.orders ?? row.order_count);
    const avg_spend = num(row.averageSpend ?? row.avg_spend)
      ?? (net_sales != null && covers && covers > 0 ? net_sales / covers : null);
    out.push({ date, net_sales, covers, orders, avg_spend });
  }
  return out;
}

function rankingsFromDailyFacts(facts: NormalizedDailyFact[]): NormalizedRanking[] {
  const rankings: NormalizedRanking[] = [];
  const specs: Array<{ metricKey: string; unit: string | null; pick: (f: NormalizedDailyFact) => number | null }> = [
    { metricKey: "net_sales", unit: "SAR", pick: (f) => f.net_sales },
    { metricKey: "covers", unit: null, pick: (f) => f.covers },
    { metricKey: "orders", unit: null, pick: (f) => f.orders },
    { metricKey: "avg_spend", unit: "SAR", pick: (f) => f.avg_spend },
  ];
  for (const spec of specs) {
    const rows = facts
      .map((f) => ({ date: f.date, value: spec.pick(f) }))
      .filter((r) => r.value != null && Number.isFinite(Number(r.value))) as Array<{ date: string; value: number }>;
    if (!rows.length) continue;
    const top = [...rows].sort((a, b) => b.value - a.value).slice(0, 5);
    const bottom = [...rows].sort((a, b) => a.value - b.value).slice(0, 5);
    top.forEach((row, idx) => {
      rankings.push({
        rank: idx + 1,
        direction: "top",
        date: row.date,
        label: null,
        metricKey: spec.metricKey,
        value: row.value,
        unit: spec.unit,
      });
    });
    bottom.forEach((row, idx) => {
      rankings.push({
        rank: idx + 1,
        direction: "bottom",
        date: row.date,
        label: null,
        metricKey: spec.metricKey,
        value: row.value,
        unit: spec.unit,
      });
    });
  }
  return rankings;
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

  const isCompareCapability = input.capabilityId === "commercial.compare"
    || input.capabilityId === "commercial.trend";
  if (
    isCompareCapability
    && input.statusHint !== "not_comparable"
    && !comparisonHasUsableValues(finalComparison)
  ) {
    const dataset = asObject(raw.conversationDataset);
    const aggregationForCompare = asObject(dataset?.aggregation)
      || asObject(raw.aggregation)
      || asObject(raw.aggregated);
    const previousAggregation = asObject(raw.previousAggregation)
      || asObject(dataset?.previousAggregation);
    if (aggregationForCompare && previousAggregation) {
      const fromAggregations = comparisonFromCashUpAggregations(
        aggregationForCompare,
        previousAggregation,
        {
          requestedCurrent: input.requestedPeriod,
          requestedPrevious: input.comparisonPeriod,
          methodHint: input.methodHint,
        },
      );
      if (fromAggregations) finalComparison = fromAggregations;
    }
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

  // Canonical Cash Up: raw tools use `aggregation`; built answers use conversationDataset.aggregation.
  const dataset = asObject(raw.conversationDataset);
  const aggregation = asObject(dataset?.aggregation)
    || asObject(raw.aggregation)
    || asObject(raw.aggregated);
  if (aggregation) {
    const aggPairs: Array<[string, unknown, string | null]> = [
      ["net_sales", aggregation.totalSales ?? aggregation.net_sales ?? aggregation.total_sales, "SAR"],
      ["gross_sales", aggregation.totalGrossSales ?? aggregation.gross_sales ?? aggregation.grossSales, "SAR"],
      ["covers", aggregation.totalGuests ?? aggregation.guest_count ?? aggregation.covers, null],
      ["orders", aggregation.totalOrders ?? aggregation.order_count, null],
      ["avg_spend", aggregation.averageSpend ?? aggregation.avg_per_guest, "SAR"],
      ["day_count", aggregation.dayCount ?? aggregation.day_count, null],
    ];
    for (const [key, value, unit] of aggPairs) {
      if (metrics.some((m) => m.metricKey === key)) continue;
      const n = num(value);
      if (n == null) continue;
      metrics.push(normalizeMetric({ metricKey: key, value: n, unit, source, coverage }));
    }
  }
  const keyMetrics = Array.isArray(raw.keyMetrics) ? raw.keyMetrics as Array<Record<string, unknown>> : [];
  for (const row of keyMetrics.slice(0, 16)) {
    const label = str(row.label);
    let key = str(row.metricKey) || str(row.metric_key) || str(row.key);
    if (!key && label) {
      const l = label.toLowerCase();
      if (/\bnet sales\b|\btotal sales\b|^sales$/.test(l)) key = "net_sales";
      else if (/\bguest|\bcover/.test(l)) key = "covers";
      else if (/avg|average spend|per guest/.test(l)) key = "avg_spend";
      else if (/\border/.test(l)) key = "orders";
      else if (/sales change|period change|delta %/.test(l)) key = "delta_pct";
    }
    if (!key || metrics.some((m) => m.metricKey === key)) continue;
    const rawValue = row.value ?? row.metric_value ?? row.metricValue;
    let value: number | string | null = num(rawValue);
    if (value == null && typeof rawValue === "string") {
      const cleaned = rawValue.replace(/[SAR$€£,/\s]/gi, "").replace(/%$/, "").trim();
      const parsed = Number(cleaned);
      value = Number.isFinite(parsed) ? parsed : (rawValue.trim() || null);
    }
    if (value == null) continue;
    metrics.push(normalizeMetric({
      metricKey: key,
      value,
      unit: str(row.unit),
      label: label || null,
      source,
      coverage,
    }));
  }

  // Facts array shapes — only when no period aggregation (avoids first-day masquerade).
  if (!aggregation) {
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
  }

  const aggregatedExtra = asObject(raw.aggregated) || asObject(raw.aggregation);
  if (aggregatedExtra) {
    for (const [key, value] of Object.entries(aggregatedExtra)) {
      if (["totalSales", "totalGuests", "totalOrders", "averageSpend", "dayCount", "dailyBreakdown", "deliveryPlatformBreakdown"].includes(key)) {
        continue;
      }
      if (metrics.some((m) => m.metricKey === key)) continue;
      const n = num(value);
      if (n == null) continue;
      metrics.push(normalizeMetric({ metricKey: key, value: n, source, coverage }));
    }
  }

  if (
    finalComparison?.percentChange != null
    && !metrics.some((m) => m.metricKey === "delta_pct")
  ) {
    metrics.push(normalizeMetric({
      metricKey: "delta_pct",
      value: finalComparison.percentChange,
      unit: "%",
      source,
      coverage,
    }));
  }

  const previousAggregation = asObject(raw.previousAggregation)
    || asObject(asObject(raw.conversationDataset)?.previousAggregation);
  if (aggregation && previousAggregation) {
    const bundle = commercialBundleFromCashUpAggregations(aggregation, previousAggregation);
    if (bundle) {
      const prevPairs: Array<[string, number | null, string | null]> = [
        ["previous_net_sales", bundle.previous.net_sales, "SAR"],
        ["previous_covers", bundle.previous.covers, null],
        ["previous_orders", bundle.previous.orders, null],
        ["previous_avg_spend", bundle.previous.avg_spend, "SAR"],
      ];
      for (const [key, value, unit] of prevPairs) {
        if (metrics.some((m) => m.metricKey === key) || value == null) continue;
        metrics.push(normalizeMetric({ metricKey: key, value, unit, source, coverage }));
      }
      const deltaPairs: Array<[string, number | null, number | null]> = [
        ["covers_delta_pct", bundle.current.covers, bundle.previous.covers],
        ["orders_delta_pct", bundle.current.orders, bundle.previous.orders],
        ["avg_spend_delta_pct", bundle.current.avg_spend, bundle.previous.avg_spend],
      ];
      for (const [key, currentValue, previousValue] of deltaPairs) {
        if (metrics.some((m) => m.metricKey === key)) continue;
        const { percentChange } = currentValue != null && previousValue != null
          ? signedPercentChange(currentValue, previousValue)
          : { percentChange: null };
        if (percentChange == null) continue;
        metrics.push(normalizeMetric({ metricKey: key, value: percentChange, unit: "%", source, coverage }));
      }
    }
  }

  const dailyFacts = dailyFactsFromBreakdown(
    aggregation?.dailyBreakdown
    || asObject(raw.conversationDataset)?.dailyBreakdown
    || raw.dailyBreakdown,
  );

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
      value: num(row.value) ?? num(row.net_sales) ?? num(row.sales) ?? num(row.totalGuests),
      unit: str(row.unit) || "SAR",
    });
  });
  if (!rankings.length && dailyFacts.length) {
    rankings.push(...rankingsFromDailyFacts(dailyFacts));
  }

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
    dailyFacts,
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
