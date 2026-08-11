/**
 * Capability executor that reuses existing Ask NAC vault/query tools.
 * No duplicated aggregation logic.
 */

import {
  resolveCapabilityImplementation,
  type CapabilityExecutionRequest,
  type CapabilityExecutionResult,
  type CapabilityExecutor,
} from "./capabilityResolver.ts";
import { buildCoverageReport } from "./coverageModel.ts";
import { normalizeCapabilityResult } from "./normalizedCapabilityResult.ts";

type LegacyToolRunner = (input: {
  vaultIntent: string;
  queryFocus: string | null;
  request: CapabilityExecutionRequest;
}) => Promise<Record<string, unknown> | null>;

function parseNumericMetricValue(value: unknown): number | string | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === "—" || trimmed === "-") return null;
  // Preserve already-normalized numeric strings; strip thousands separators / currency junk.
  const cleaned = trimmed.replace(/[SAR$€£]/gi, "").replace(/,/g, "").replace(/%$/, "").trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (Number.isFinite(n)) return n;
  return trimmed;
}

function metricKeyFromLabel(label: unknown): string | null {
  const l = String(label || "").trim().toLowerCase();
  if (!l) return null;
  if (/\bnet sales\b|\btotal sales\b|^sales$/.test(l)) return "net_sales";
  if (/\bguest|\bcover/.test(l)) return "covers";
  if (/avg|average spend|per guest/.test(l)) return "avg_spend";
  if (/\border/.test(l) && !/change|delta/.test(l)) return "orders";
  if (/sales change|period change|delta %|% change/.test(l)) return "delta_pct";
  if (/days included|day count/.test(l)) return "day_count";
  return null;
}

function pushMetric(
  metrics: Array<{ key: string; value: number | string; unit?: string }>,
  key: string,
  value: unknown,
  unit?: string,
) {
  if (!key || metrics.some((m) => m.key === key)) return;
  const parsed = parseNumericMetricValue(value);
  if (parsed == null) return;
  metrics.push(unit ? { key, value: parsed, unit } : { key, value: parsed });
}

/** Canonical Cash Up answers expose keyMetrics + conversationDataset.aggregation — not only facts[]. */
function extractMetrics(tool: Record<string, unknown> | null): Array<{ key: string; value: number | string; unit?: string }> {
  if (!tool) return [];
  const metrics: Array<{ key: string; value: number | string; unit?: string }> = [];

  const dataset = tool.conversationDataset as Record<string, unknown> | undefined;
  const aggregation = (dataset?.aggregation || tool.aggregated) as Record<string, unknown> | undefined;
  if (aggregation && typeof aggregation === "object") {
    pushMetric(metrics, "net_sales", aggregation.totalSales ?? aggregation.net_sales ?? aggregation.total_sales, "SAR");
    pushMetric(metrics, "covers", aggregation.totalGuests ?? aggregation.guest_count ?? aggregation.covers);
    pushMetric(metrics, "orders", aggregation.totalOrders ?? aggregation.order_count);
    pushMetric(metrics, "avg_spend", aggregation.averageSpend ?? aggregation.avg_per_guest, "SAR");
    pushMetric(metrics, "day_count", aggregation.dayCount ?? aggregation.day_count);
    pushMetric(metrics, "delivery_sales", aggregation.totalDeliverySales, "SAR");
  }

  const keyMetrics = Array.isArray(tool.keyMetrics) ? tool.keyMetrics as Array<Record<string, unknown>> : [];
  for (const row of keyMetrics.slice(0, 16)) {
    const key = String(row.metricKey || row.metric_key || row.key || metricKeyFromLabel(row.label) || "");
    if (!key) continue;
    const unit = row.unit != null && String(row.unit).trim() ? String(row.unit) : undefined;
    pushMetric(metrics, key, row.value ?? row.metric_value ?? row.metricValue, unit);
  }

  const facts = Array.isArray(tool.facts) ? tool.facts as Array<Record<string, unknown>> : [];
  for (const fact of facts.slice(0, 12)) {
    const key = String(fact.metric_key || fact.metricKey || fact.key || "");
    pushMetric(metrics, key, fact.metric_value ?? fact.metricValue ?? fact.value, fact.unit ? String(fact.unit) : undefined);
  }

  if (aggregation && typeof aggregation === "object") {
    for (const [key, value] of Object.entries(aggregation)) {
      if (["totalSales", "totalGuests", "totalOrders", "averageSpend", "dayCount", "totalDeliverySales", "totalDeliveryOrders", "dailyBreakdown", "deliveryPlatformBreakdown"].includes(key)) {
        continue;
      }
      if (typeof value === "number") pushMetric(metrics, key, value);
    }
  }

  const comparison = tool.comparison as Record<string, unknown> | undefined;
  if (comparison && typeof comparison.deltaPct === "number") {
    pushMetric(metrics, "delta_pct", comparison.deltaPct, "%");
  }
  if (comparison && typeof comparison.delta_pct === "number") {
    pushMetric(metrics, "delta_pct", comparison.delta_pct, "%");
  }
  return metrics;
}

function extractCoverage(tool: Record<string, unknown> | null, req: CapabilityExecutionRequest) {
  const cov = (tool?.coverage || tool?.matchedCoverage || null) as Record<string, unknown> | null;
  const dataset = tool?.conversationDataset as Record<string, unknown> | undefined;
  const aggregation = (dataset?.aggregation || null) as Record<string, unknown> | null;
  const expectedFromAgg = typeof aggregation?.expectedDayCount === "number" ? aggregation.expectedDayCount : null;
  const availableFromAgg = typeof aggregation?.dayCount === "number" ? aggregation.dayCount : null;
  if (!cov) {
    return buildCoverageReport({
      domain: req.capability.startsWith("operations") ? "logbook" : "sales",
      range: req.currentPeriod,
      expectedRecords: expectedFromAgg,
      availableRecords: availableFromAgg,
    });
  }
  return buildCoverageReport({
    domain: String(cov.domain || "sales"),
    range: req.currentPeriod,
    expectedRecords: typeof cov.expectedDays === "number" ? cov.expectedDays
      : typeof cov.expectedRecords === "number" ? cov.expectedRecords
      : expectedFromAgg,
    availableRecords: typeof cov.availableDays === "number" ? cov.availableDays
      : typeof cov.availableRecords === "number" ? cov.availableRecords
      : availableFromAgg,
    freshness: cov.freshness ? String(cov.freshness) : null,
    warnings: Array.isArray(cov.warnings) ? cov.warnings.map(String) : [],
  });
}

function extractSnippets(tool: Record<string, unknown> | null): string[] {
  if (!tool) return [];
  const snippets: string[] = [];
  const direct = String(tool.directAnswer || "").trim();
  if (direct) snippets.push(direct.slice(0, 280));
  const docs = Array.isArray(tool.documents) ? tool.documents as Array<Record<string, unknown>> : [];
  for (const doc of docs.slice(0, 3)) {
    const text = String(doc.summary || doc.excerpt || doc.title || "").trim();
    if (text) snippets.push(text.slice(0, 280));
  }
  const issues = Array.isArray(tool.issues) ? tool.issues as Array<Record<string, unknown>> : [];
  for (const issue of issues.slice(0, 3)) {
    const text = String(issue.summary || issue.text || issue.title || "").trim();
    if (text) snippets.push(text.slice(0, 280));
  }
  return snippets;
}

export function createVaultCapabilityExecutor(runLegacyTool: LegacyToolRunner): CapabilityExecutor {
  return async (req) => {
    const mapping = resolveCapabilityImplementation(req.capability);
    if (!mapping.vaultIntent) {
      return {
        capability: req.capability,
        implementationTool: mapping.implementationTool,
        ok: true,
        skipped: true,
        skipReason: "no_vault_intent_mapping",
        metrics: [],
        textSnippets: [],
        coverage: null,
      };
    }

    try {
      const tool = await runLegacyTool({
        vaultIntent: mapping.vaultIntent,
        queryFocus: mapping.queryFocus,
        request: req,
      });
      const coverage = extractCoverage(tool, req);
      const metrics = extractMetrics(tool);
      const textSnippets = extractSnippets(tool);
      const normalized = normalizeCapabilityResult({
        capabilityId: req.capability,
        implementationTool: mapping.implementationTool,
        ok: Boolean(tool),
        branchId: req.branchId,
        requestedPeriod: req.currentPeriod,
        comparisonPeriod: req.comparisonPeriod,
        methodHint: req.comparabilityMethod,
        raw: tool,
        metrics,
        textSnippets,
        coverage,
      });
      return {
        capability: req.capability,
        implementationTool: mapping.implementationTool,
        ok: Boolean(tool),
        metrics,
        textSnippets,
        coverage,
        raw: tool,
        normalized,
        error: tool ? null : "empty_tool_result",
      } satisfies CapabilityExecutionResult;
    } catch (err) {
      return {
        capability: req.capability,
        implementationTool: mapping.implementationTool,
        ok: false,
        metrics: [],
        textSnippets: [],
        coverage: null,
        error: String((err as Error)?.message || err),
      };
    }
  };
}
