/** Shared Ask NAC metric response helpers — keep Edge buildDeterministic aligned with client answerBuilder */

import { sourceEntry } from "../askNacContract.js";
import { collectAskNacMetricWarnings } from "./mtdDiagnostics.js";

export function buildMenuMetricAnswerFields(tool, { label, value, metricSource, periodLabel, branchLabel }) {
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
    recommendations: [],
    sources: [{ name: tool.rpc || "fetchAskNacMenuMetrics", detail: tool.dataSource || "verified" }],
    warnings,
    missingData: [],
    confidence,
    exportOptions: [],
    isAiGenerated: false,
    diagnostics: tool.mtdHybrid || null,
    periodLabel,
    branchLabel,
  };
}

export { sourceEntry };
