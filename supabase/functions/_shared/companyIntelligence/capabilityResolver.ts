/**
 * Semantic capability → trusted existing Ask NAC tool mapping + evidence normalization.
 * Does not reimplement Cash Up / Logbook aggregation.
 */

import { CAPABILITY_REGISTRY, type CapabilityId } from "./capabilityRegistry.ts";
import { buildCoverageReport, type CoverageReport } from "./coverageModel.ts";
import { createEvidence, type EvidenceRecord } from "./evidenceLedger.ts";
import {
  buildEventPerformanceObservation,
  forecastEventWindow,
} from "./eventForecast.ts";
import { resolveEventWindow, resolveHolidayTemporalBundle } from "./holidayCalendar.ts";
import type { CompanyIntelligenceState } from "./intelligenceState.ts";
import {
  normalizeCapabilityResult,
  normalizedResultToEvidenceParts,
  type NormalizedCapabilityResult,
} from "./normalizedCapabilityResult.ts";
import { defaultBusinessTimeline } from "./businessTimeline.ts";
import type { DateRange } from "./types.ts";

export type CapabilityExecutionRequest = {
  capability: CapabilityId;
  branchId: string | null;
  currentPeriod: DateRange | null;
  comparisonPeriod: DateRange | null;
  comparabilityMethod: string | null;
  question: string;
  historyLookbackDays?: number | null;
};

export type CapabilityExecutionResult = {
  capability: CapabilityId;
  implementationTool: string;
  ok: boolean;
  skipped?: boolean;
  skipReason?: string | null;
  metrics?: Array<{ key: string; value: number | string; unit?: string }>;
  textSnippets?: string[];
  coverage?: CoverageReport | null;
  raw?: Record<string, unknown> | null;
  error?: string | null;
  /** Canonical shape — preferred by all downstream Fabric stages. */
  normalized?: NormalizedCapabilityResult | null;
};

/** Attach/refresh canonical normalized payload on any executor result. */
export function withNormalizedCapabilityResult(
  result: CapabilityExecutionResult,
  state: CompanyIntelligenceState,
): CapabilityExecutionResult {
  const normalized = normalizeCapabilityResult({
    capabilityId: result.capability,
    implementationTool: result.implementationTool,
    ok: result.ok,
    skipped: result.skipped,
    skipReason: result.skipReason,
    branchId: state.scope.primaryBranchId,
    companyId: state.scope.companyId,
    brandId: state.scope.brandId,
    requestedPeriod: state.periods.current,
    comparisonPeriod: state.periods.comparison,
    methodHint: state.comparability?.recommendedMethod || null,
    statusHint: state.comparability?.status || null,
    raw: result.raw || null,
    metrics: result.metrics,
    textSnippets: result.textSnippets,
    coverage: result.coverage || null,
  });
  const parts = normalizedResultToEvidenceParts(normalized);
  return {
    ...result,
    metrics: parts.metrics,
    textSnippets: parts.textSnippets,
    coverage: parts.coverage,
    normalized,
  };
}

export type CapabilityExecutor = (
  req: CapabilityExecutionRequest,
) => Promise<CapabilityExecutionResult>;

/** Pure mapping for route/tool selection — no I/O. */
export function resolveCapabilityImplementation(capability: CapabilityId): {
  implementationTool: string;
  queryFocus: string | null;
  vaultIntent: string | null;
} {
  const def = CAPABILITY_REGISTRY[capability];
  const tool = def?.implementationTool || "none";
  switch (capability) {
    case "commercial.performance":
      return { implementationTool: tool, queryFocus: "performance_overview", vaultIntent: "vault_cash_up_summary" };
    case "commercial.compare":
    case "commercial.trend":
      return { implementationTool: tool, queryFocus: "period_compare", vaultIntent: "vault_cash_up_summary" };
    case "commercial.rank_days":
      return { implementationTool: tool, queryFocus: "day_ranking", vaultIntent: "vault_cash_up_summary" };
    case "operations.review":
    case "operations.recurring_issues":
      return { implementationTool: tool, queryFocus: null, vaultIntent: "vault_operational_review" };
    case "company.scope_compare":
      return { implementationTool: tool, queryFocus: null, vaultIntent: "executive_analysis" };
    case "commercial.forecast":
      return { implementationTool: tool, queryFocus: null, vaultIntent: null };
    case "company.branch_timeline":
    case "calendar.resolve_period":
      return { implementationTool: tool, queryFocus: null, vaultIntent: null };
    case "cost.margin_analysis":
      return { implementationTool: tool, queryFocus: "performance_overview", vaultIntent: "vault_cash_up_summary" };
    case "guest.feedback":
      return { implementationTool: tool, queryFocus: null, vaultIntent: "vault_reception" };
    case "staff.performance":
      return { implementationTool: tool, queryFocus: null, vaultIntent: null };
    default:
      return { implementationTool: tool, queryFocus: null, vaultIntent: null };
  }
}

/** Deterministic local executor for timeline/calendar/cost stubs (no DB). */
export async function executeBuiltinCapability(
  req: CapabilityExecutionRequest,
  state: CompanyIntelligenceState,
): Promise<CapabilityExecutionResult | null> {
  if (req.capability === "calendar.resolve_period") {
    const snippets = [
      state.periods.current
        ? `Resolved period ${state.periods.current.startDate}–${state.periods.current.endDate}`
        : "Period unresolved",
    ];
    if (state.periods.eventWindow) {
      snippets.push(
        `Event window convention: ${state.periods.eventWindow.conventionLabel} around ${state.periods.eventWindow.anchorDate}`,
      );
    }
    if (state.periods.nextHolidayDate) {
      snippets.push(`Next holiday date: ${state.periods.nextHolidayDate}`);
    }
    return {
      capability: req.capability,
      implementationTool: "temporal_service",
      ok: true,
      metrics: [],
      textSnippets: snippets,
      coverage: null,
      raw: { periods: state.periods },
    };
  }
  if (req.capability === "commercial.forecast") {
    const holidayId = (state.periods.eventWindow?.holidayId || "saudi_founding_day") as "saudi_founding_day";
    const target = state.periods.forecast
      ? resolveEventWindow({
        holidayId,
        year: Number(String(state.periods.forecast.semantic || state.periods.forecast.startDate || "").match(/20\d{2}/)?.[0]
          || String(state.periods.nextHolidayDate || "").slice(0, 4)
          || String(state.periods.forecast.startDate || "").slice(0, 4)),
      })
      : resolveHolidayTemporalBundle(req.question)?.nextWindow || null;

    const histWindow = state.periods.eventWindow
      ? resolveEventWindow({
        holidayId,
        year: state.periods.eventWindow.year,
      })
      : resolveHolidayTemporalBundle(req.question)?.historicalWindow || null;
    const histSalesEvidence = state.evidence.find((e) =>
      e.metricOrEvent === "net_sales" && typeof e.value === "number" && e.source === "cash_up"
    );
    const histCovers = state.evidence.find((e) => e.metricOrEvent === "covers" && typeof e.value === "number");
    const observations = [];
    if (histWindow && histSalesEvidence) {
      observations.push(buildEventPerformanceObservation({
        eventWindow: histWindow,
        netSales: Number(histSalesEvidence.value),
        covers: typeof histCovers?.value === "number" ? Number(histCovers.value) : null,
        coverageRatio: histSalesEvidence.coverage?.coverageRatio ?? 1,
        source: "cash_up",
      }));
    } else if (histWindow) {
      // No invented observation — empty/null sales keeps forecast honest.
      observations.push(buildEventPerformanceObservation({
        eventWindow: histWindow,
        netSales: null,
        coverageRatio: 0,
        source: "cash_up",
      }));
    }

    const recentBaseline = (() => {
      // Prefer recent trading evidence if present; otherwise omit (no fabrication).
      const recent = state.evidence.find((e) =>
        e.metricOrEvent === "recent_daily_avg_net_sales" && typeof e.value === "number"
      );
      if (!recent || !recent.period) return null;
      return {
        label: "recent_comparable_trading",
        range: recent.period,
        netSales: null,
        dailyAverageNetSales: Number(recent.value),
        coverageRatio: recent.coverage?.coverageRatio ?? null,
        source: "cash_up",
        kind: "DERIVED" as const,
      };
    })();

    const branchId = req.branchId;
    const targetOperating = branchId && target
      ? defaultBusinessTimeline.getOperatingStatus(branchId, target.range)
      : null;

    const forecast = forecastEventWindow({
      targetWindow: target,
      historicalObservations: observations.filter((o) => o.netSales != null),
      recentBaseline,
      branchOperatingInTarget: targetOperating ? targetOperating.status === "operating" : true,
    });

    return {
      capability: req.capability,
      implementationTool: "event_forecast",
      ok: forecast.ok,
      metrics: [
        ...(forecast.centralEstimate != null
          ? [{ key: "forecast_net_sales", value: forecast.centralEstimate, unit: forecast.unit }]
          : []),
        { key: "forecast_confidence", value: forecast.confidence },
        { key: "forecast_method", value: forecast.method },
        { key: "historical_event_observations", value: forecast.historicalObservationCount },
      ],
      textSnippets: [
        `FORECAST (not observed): method=${forecast.method}; confidence=${forecast.confidence}`,
        forecast.centralEstimate != null
          ? `Central estimate ${forecast.centralEstimate} ${forecast.unit}`
            + (forecast.expectedRange
              ? ` (range ${forecast.expectedRange.low}–${forecast.expectedRange.high})`
              : "")
          : "Insufficient data for a central estimate",
        ...forecast.assumptions.slice(0, 3),
        ...forecast.limitations.slice(0, 3),
        ...forecast.comparabilityNotes,
        "External factors were not researched and are not included.",
      ],
      coverage: buildCoverageReport({
        domain: "sales",
        range: target?.range || state.periods.forecast,
        expectedRecords: forecast.historicalObservationCount || 1,
        availableRecords: forecast.historicalObservationCount,
        warnings: forecast.limitations,
      }),
      raw: {
        kind: "FORECAST",
        forecast,
        sourceAuthority: "cash_up",
        shiftPolicy: "foodics_not_shift_segregated",
      },
    };
  }
  if (req.capability === "company.branch_timeline") {
    return {
      capability: req.capability,
      implementationTool: "business_timeline",
      ok: true,
      metrics: [],
      textSnippets: [`Timeline checked for ${req.branchId || "branch"}`],
      coverage: null,
      raw: { feasibility: state.feasibility },
    };
  }
  if (req.capability === "cost.margin_analysis") {
    return {
      capability: req.capability,
      implementationTool: "cost_margin",
      ok: true,
      skipped: false,
      metrics: [],
      textSnippets: [
        "Canonical cost-control / margin data is not available; sales alone cannot establish margin.",
      ],
      coverage: buildCoverageReport({
        domain: "cost",
        range: req.currentPeriod,
        expectedRecords: 1,
        availableRecords: 0,
        warnings: ["canonical_cost_unavailable"],
      }),
      raw: { available: false },
    };
  }
  if (req.capability === "staff.performance") {
    return {
      capability: req.capability,
      implementationTool: "staff_performance",
      ok: true,
      skipped: true,
      skipReason: "staff_source_unavailable",
      metrics: [],
      textSnippets: ["Staff-performance evidence is not available for this request."],
      coverage: buildCoverageReport({
        domain: "staff",
        range: req.currentPeriod,
        expectedRecords: 1,
        availableRecords: 0,
      }),
      raw: null,
    };
  }
  if (
    req.capability === "research.historical_weather"
    || req.capability === "research.external_events"
  ) {
    return {
      capability: req.capability,
      implementationTool: CAPABILITY_REGISTRY[req.capability].implementationTool,
      ok: true,
      skipped: true,
      skipReason: "paid_research_disabled",
      metrics: [],
      textSnippets: ["External research is disabled in this phase."],
      coverage: null,
      raw: null,
    };
  }
  return null;
}

export function normalizeCapabilityResultToEvidence(
  result: CapabilityExecutionResult,
  state: CompanyIntelligenceState,
): EvidenceRecord[] {
  const finalized = result.normalized
    ? result
    : withNormalizedCapabilityResult(result, state);
  const normalized = finalized.normalized!;
  const evidence: EvidenceRecord[] = [];
  const coverage = finalized.coverage || null;

  for (const m of normalized.metrics) {
    const isForecast = result.capability === "commercial.forecast"
      || String(m.metricKey || "").startsWith("forecast_");
    evidence.push(createEvidence({
      source: isForecast ? "event_forecast" : normalized.source,
      sourceAuthority: normalized.sourceAuthority,
      domain: normalized.source === "logbook" ? "INTERNAL_QUALITATIVE" : "INTERNAL_STRUCTURED",
      companyId: normalized.scope.companyId || state.scope.companyId,
      brandId: normalized.scope.brandId || state.scope.brandId,
      branchId: normalized.scope.branchId || state.scope.primaryBranchId,
      period: isForecast
        ? (state.periods.forecast || normalized.requestedPeriod || state.periods.current)
        : (normalized.requestedPeriod || state.periods.current),
      metricOrEvent: m.metricKey,
      value: m.value,
      textSummary: `${isForecast ? "FORECAST " : ""}${m.label}=${m.value}${m.unit ? ` ${m.unit}` : ""}`,
      coverage,
      confidence: isForecast
        ? "low"
        : (normalized.provenance.ok && !normalized.provenance.skipped ? "high" : "low"),
    }));
  }

  if (normalized.comparison?.percentChange != null) {
    evidence.push(createEvidence({
      source: normalized.source,
      sourceAuthority: normalized.sourceAuthority,
      domain: "INTERNAL_STRUCTURED",
      companyId: state.scope.companyId,
      brandId: state.scope.brandId,
      branchId: state.scope.primaryBranchId,
      period: state.periods.current,
      metricOrEvent: "delta_pct",
      value: normalized.comparison.percentChange,
      textSummary: `delta_pct=${normalized.comparison.percentChange}% (${normalized.comparison.mode})`,
      coverage,
      confidence: "high",
    }));
  }

  for (const q of normalized.qualitativeEvidence.slice(0, 5)) {
    evidence.push(createEvidence({
      source: normalized.source,
      sourceAuthority: normalized.sourceAuthority,
      domain: normalized.source === "logbook" ? "INTERNAL_QUALITATIVE" : "COMPANY_HISTORICAL",
      companyId: state.scope.companyId,
      brandId: state.scope.brandId,
      branchId: q.branchId || state.scope.primaryBranchId,
      period: q.periodStart && q.periodEnd
        ? { startDate: q.periodStart, endDate: q.periodEnd }
        : state.periods.current,
      metricOrEvent: result.capability,
      value: null,
      textSummary: q.summary,
      coverage,
      confidence: q.relevance === "high" ? "high" : "medium",
    }));
  }

  return evidence;
}

/** Mock executor for tests / offline QA — never invents commercial KPIs unless seeded. */
export function createMockCapabilityExecutor(
  seed: Record<string, CapabilityExecutionResult> = {},
): CapabilityExecutor {
  return async (req) => {
    if (seed[req.capability]) return seed[req.capability];
    const mapping = resolveCapabilityImplementation(req.capability);
    if (req.capability === "commercial.performance") {
      return {
        capability: req.capability,
        implementationTool: mapping.implementationTool,
        ok: true,
        metrics: [
          { key: "net_sales", value: 100000, unit: "SAR" },
          { key: "covers", value: 1200 },
        ],
        textSnippets: ["Cash Up performance for requested period"],
        coverage: buildCoverageReport({
          domain: "sales",
          range: req.currentPeriod,
          expectedRecords: 10,
          availableRecords: 10,
        }),
      };
    }
    if (req.capability === "commercial.compare" || req.capability === "commercial.trend") {
      const method = req.comparabilityMethod || "matched_days";
      return {
        capability: req.capability,
        implementationTool: mapping.implementationTool,
        ok: true,
        metrics: [
          { key: "delta_pct", value: -5.6, unit: "%" },
          { key: "comparison_method", value: method },
        ],
        textSnippets: [`Comparison via ${method}`],
        coverage: buildCoverageReport({
          domain: "sales",
          range: req.currentPeriod,
          expectedRecords: 10,
          availableRecords: method === "matched_days" ? 8 : 10,
        }),
      };
    }
    if (req.capability === "commercial.rank_days") {
      return {
        capability: req.capability,
        implementationTool: mapping.implementationTool,
        ok: true,
        metrics: [{ key: "worst_day_sales", value: 4200, unit: "SAR" }],
        textSnippets: ["Weakest day identified from Cash Up daily ranking"],
        coverage: buildCoverageReport({
          domain: "sales",
          range: req.currentPeriod,
          expectedRecords: 30,
          availableRecords: 28,
        }),
      };
    }
    if (req.capability.startsWith("operations.")) {
      return {
        capability: req.capability,
        implementationTool: mapping.implementationTool,
        ok: true,
        metrics: [],
        textSnippets: ["Logbook noted weak walk-ins on Sunday"],
        coverage: buildCoverageReport({
          domain: "logbook",
          range: req.currentPeriod,
          expectedRecords: 7,
          availableRecords: 5,
        }),
      };
    }
    return {
      capability: req.capability,
      implementationTool: mapping.implementationTool,
      ok: true,
      skipped: true,
      skipReason: "no_mock_seed",
      metrics: [],
      textSnippets: [],
      coverage: null,
    };
  };
}
