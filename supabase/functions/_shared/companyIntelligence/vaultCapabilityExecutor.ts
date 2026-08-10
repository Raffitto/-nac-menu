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

type LegacyToolRunner = (input: {
  vaultIntent: string;
  queryFocus: string | null;
  request: CapabilityExecutionRequest;
}) => Promise<Record<string, unknown> | null>;

function extractMetrics(tool: Record<string, unknown> | null): Array<{ key: string; value: number | string; unit?: string }> {
  if (!tool) return [];
  const metrics: Array<{ key: string; value: number | string; unit?: string }> = [];
  const facts = Array.isArray(tool.facts) ? tool.facts as Array<Record<string, unknown>> : [];
  for (const fact of facts.slice(0, 12)) {
    const key = String(fact.metric_key || fact.key || "");
    const value = fact.metric_value ?? fact.value;
    if (!key || value == null) continue;
    if (typeof value === "number" || typeof value === "string") {
      metrics.push({ key, value, unit: fact.unit ? String(fact.unit) : undefined });
    }
  }
  const aggregated = tool.aggregated as Record<string, unknown> | undefined;
  if (aggregated) {
    for (const [key, value] of Object.entries(aggregated)) {
      if (typeof value === "number") metrics.push({ key, value });
    }
  }
  const comparison = tool.comparison as Record<string, unknown> | undefined;
  if (comparison && typeof comparison.deltaPct === "number") {
    metrics.push({ key: "delta_pct", value: comparison.deltaPct, unit: "%" });
  }
  if (comparison && typeof comparison.delta_pct === "number") {
    metrics.push({ key: "delta_pct", value: comparison.delta_pct as number, unit: "%" });
  }
  return metrics;
}

function extractCoverage(tool: Record<string, unknown> | null, req: CapabilityExecutionRequest) {
  const cov = (tool?.coverage || tool?.matchedCoverage || null) as Record<string, unknown> | null;
  if (!cov) {
    return buildCoverageReport({
      domain: req.capability.startsWith("operations") ? "logbook" : "sales",
      range: req.currentPeriod,
      expectedRecords: null,
      availableRecords: null,
    });
  }
  return buildCoverageReport({
    domain: String(cov.domain || "sales"),
    range: req.currentPeriod,
    expectedRecords: typeof cov.expectedDays === "number" ? cov.expectedDays
      : typeof cov.expectedRecords === "number" ? cov.expectedRecords : null,
    availableRecords: typeof cov.availableDays === "number" ? cov.availableDays
      : typeof cov.availableRecords === "number" ? cov.availableRecords : null,
    freshness: cov.freshness ? String(cov.freshness) : null,
    warnings: Array.isArray(cov.warnings) ? cov.warnings.map(String) : [],
  });
}

function extractSnippets(tool: Record<string, unknown> | null): string[] {
  if (!tool) return [];
  const snippets: string[] = [];
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
      return {
        capability: req.capability,
        implementationTool: mapping.implementationTool,
        ok: Boolean(tool),
        metrics: extractMetrics(tool),
        textSnippets: extractSnippets(tool),
        coverage: extractCoverage(tool, req),
        raw: tool,
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
