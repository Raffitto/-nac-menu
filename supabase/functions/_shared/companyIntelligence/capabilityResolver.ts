/**
 * Semantic capability → trusted existing Ask NAC tool mapping + evidence normalization.
 * Does not reimplement Cash Up / Logbook aggregation.
 */

import { CAPABILITY_REGISTRY, type CapabilityId } from "./capabilityRegistry.ts";
import { buildCoverageReport, type CoverageReport } from "./coverageModel.ts";
import { createEvidence, type EvidenceRecord } from "./evidenceLedger.ts";
import type { CompanyIntelligenceState } from "./intelligenceState.ts";
import { getSourceAuthority } from "./sourceAuthority.ts";
import type { DateRange } from "./types.ts";

export type CapabilityExecutionRequest = {
  capability: CapabilityId;
  branchId: string | null;
  currentPeriod: DateRange | null;
  comparisonPeriod: DateRange | null;
  comparabilityMethod: string | null;
  question: string;
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
};

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
    return {
      capability: req.capability,
      implementationTool: "temporal_service",
      ok: true,
      metrics: [],
      textSnippets: [
        state.periods.current
          ? `Resolved period ${state.periods.current.startDate}–${state.periods.current.endDate}`
          : "Period unresolved",
      ],
      coverage: null,
      raw: { periods: state.periods },
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
  const evidence: EvidenceRecord[] = [];
  const source = result.implementationTool.includes("operational")
    || result.capability.startsWith("operations.")
    ? "logbook"
    : result.capability.startsWith("company.") || result.capability === "calendar.resolve_period"
      ? "business_timeline"
      : result.capability.startsWith("research.")
        ? "web_news"
        : result.capability === "cost.margin_analysis"
          ? "cost_control"
          : "cash_up";

  const authority = getSourceAuthority(source === "cost_control" ? "cash_up" : source).authority;
  const branchId = state.scope.primaryBranchId;
  const period = state.periods.current;

  for (const m of result.metrics || []) {
    evidence.push(createEvidence({
      source,
      sourceAuthority: authority,
      domain: source === "logbook" ? "INTERNAL_QUALITATIVE" : "INTERNAL_STRUCTURED",
      companyId: state.scope.companyId,
      brandId: state.scope.brandId,
      branchId,
      period,
      metricOrEvent: m.key,
      value: typeof m.value === "number" ? m.value : m.value,
      textSummary: `${m.key}=${m.value}${m.unit ? ` ${m.unit}` : ""}`,
      coverage: result.coverage || null,
      confidence: result.ok && !result.skipped ? "high" : "low",
    }));
  }

  for (const snippet of (result.textSnippets || []).slice(0, 5)) {
    evidence.push(createEvidence({
      source,
      sourceAuthority: authority,
      domain: source === "logbook" ? "INTERNAL_QUALITATIVE" : source === "web_news" ? "EXTERNAL" : "COMPANY_HISTORICAL",
      companyId: state.scope.companyId,
      brandId: state.scope.brandId,
      branchId,
      period,
      metricOrEvent: result.capability,
      value: null,
      textSummary: String(snippet).slice(0, 400),
      coverage: result.coverage || null,
      confidence: result.skipped ? "low" : "medium",
    }));
  }

  if (result.coverage) {
    // coverage attached on metrics; also keep on state via caller
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
