/** Shared Ask NAC metric response helpers — keep in sync with src/intelligence/askNac/shared/askNacResponseHelpers.js */

import { collectAskNacMetricWarnings } from "./mtdDiagnostics.ts";

export function coercePlainTextDirectAnswer(
  directAnswer: unknown,
  response: { executiveBrief?: { executiveSummary?: string } } = {},
): string {
  if (typeof directAnswer === "string") {
    const trimmed = directAnswer.trim();
    if (trimmed && trimmed !== "[object Object]") return trimmed;
  }
  if (directAnswer && typeof directAnswer === "object") {
    const value = directAnswer as Record<string, unknown>;
    for (const key of ["executiveSummary", "answer", "summary", "text", "directAnswer"]) {
      const candidate = value[key];
      if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
    }
  }
  const briefSummary = response.executiveBrief?.executiveSummary;
  if (typeof briefSummary === "string" && briefSummary.trim()) return briefSummary.trim();
  return "";
}

export function resolveAskNacDirectAnswer(
  response: { directAnswer?: unknown; executiveBrief?: { executiveSummary?: string } } = {},
): string {
  return coercePlainTextDirectAnswer(response.directAnswer, response) || "No summary available.";
}

export function buildMenuMetricAnswerFields(
  tool: {
    partial?: boolean;
    mtdHybrid?: ReturnType<typeof import("./mtdDiagnostics.ts").normalizeMtdDiagnostics>;
    dataSource?: string;
    rpc?: string;
  },
  {
    label,
    value,
    metricSource,
    periodLabel,
    branchLabel,
  }: {
    label: string;
    value: number;
    metricSource: string;
    periodLabel: string;
    branchLabel: string;
  },
) {
  const warnings = collectAskNacMetricWarnings(tool);
  const confidence = tool.partial || tool.mtdHybrid?.partialLive ? "medium" : "high";
  const insights =
    tool.dataSource === "hybrid" || tool.mtdHybrid?.source === "hybrid"
      ? ["Month-to-date uses hybrid rollup + live Today merge."]
      : [];

  return {
    answerType: "metric",
    title: `${label} · ${periodLabel}`,
    directAnswer: `${value.toLocaleString()} ${label.toLowerCase()} for ${branchLabel} (${periodLabel}).`,
    keyMetrics: [{ label, value, source: metricSource }],
    insights,
    recommendations: [] as string[],
    sources: [{ name: tool.rpc || "fetchAskNacMenuMetrics", detail: tool.dataSource || "verified" }],
    warnings,
    missingData: [] as unknown[],
    confidence,
    exportOptions: [] as unknown[],
    isAiGenerated: false,
    diagnostics: tool.mtdHybrid || null,
    periodLabel,
    branchLabel,
  };
}
