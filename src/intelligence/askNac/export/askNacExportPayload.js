/**
 * Ask NAC export payload — normalized report data from question + response + filters.
 * Exports must not invent numbers; only structured answer fields are included.
 */

import { ANSWER_TYPES } from "../askNacContract";
import { branchDisplayName } from "../../../dashboard/utils/rangeState";
import { hoursToRange } from "../../../dashboard/utils/rangeState";
import {
  applyExecutiveMetricDisplayLabels,
  formatExportAnswerText,
  normalizeExecutiveBriefForExport,
} from "./executiveBriefExport";

export const EXPORT_FORMATS = Object.freeze({
  PDF: "pdf",
  EXECUTIVE: "executive",
  DETAILED: "detailed",
  JSON: "json",
  CSV: "csv",
  WEEKLY_DASHBOARD_XLSX: "weekly_dashboard_xlsx",
});

export const PROVENANCE_IDS = Object.freeze({
  VERIFIED: "verified_deterministic",
  AI_NARRATED: "ai_narrated_verified",
  PARTIAL: "partial_verified",
  MISSING_DATA: "missing_data",
  ERROR: "error",
});

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function formatAskNacGeneratedAt(date = new Date()) {
  return date.toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Riyadh",
  });
}

export function buildFilterContextSummary(filters = {}) {
  const parts = [];
  const branch = filters.branch ? branchDisplayName(filters.branch) : "Network (all branches)";
  parts.push(branch);

  const range = filters.selectedRange || hoursToRange(filters.timeRangeHours ?? 24);
  const rangeLabels = { today: "Today", "7d": "7D", month: "Month-to-date" };
  parts.push(rangeLabels[range] || filters.periodLabel || "Today");

  if (filters.language && filters.language !== "all") parts.push(`Language: ${filters.language}`);
  if (filters.shift && filters.shift !== "all") parts.push(`Shift: ${filters.shift}`);
  if (filters.eventType && filters.eventType !== "all") parts.push(`Event: ${filters.eventType}`);
  if (filters.dayType && filters.dayType !== "all") parts.push(`Day: ${filters.dayType}`);
  if (filters.role && filters.role !== "all") parts.push(`Role: ${filters.role}`);

  return parts.join(" · ");
}

/**
 * Classify answer provenance for export headers.
 */
export function resolveAnswerProvenance(response = {}) {
  if (response.answerType === ANSWER_TYPES.MISSING_DATA) {
    return {
      id: PROVENANCE_IDS.MISSING_DATA,
      label: "Data Requirement Report",
      description: "Missing-data response — no verified metric values were available for this question.",
    };
  }
  if (response.answerType === ANSWER_TYPES.ERROR) {
    return {
      id: PROVENANCE_IDS.ERROR,
      label: "Error response",
      description: "The query could not be completed with verified data.",
    };
  }

  const partialLive = Boolean(response.diagnostics?.partialLive);
  const hasWarnings = Array.isArray(response.warnings) && response.warnings.length > 0;
  const partial =
    partialLive ||
    hasWarnings ||
    response.confidence === "medium" ||
    response.confidence === "low";

  if (response.isAiGenerated) {
    return {
      id: PROVENANCE_IDS.AI_NARRATED,
      label: "AI-narrated from verified data",
      description: partial
        ? "OpenAI explanation of structured facts — some sources are partial or hybrid."
        : "OpenAI explanation of structured facts returned by internal read-only tools.",
      partial,
    };
  }

  if (partial) {
    return {
      id: PROVENANCE_IDS.PARTIAL,
      label: "Verified deterministic (partial)",
      description: "Counts from Supabase tools — rollup/hybrid or warnings indicate incomplete coverage.",
      partial: true,
    };
  }

  return {
    id: PROVENANCE_IDS.VERIFIED,
    label: "Verified deterministic",
    description: "Counts from Supabase read-only tools without AI narration.",
    partial: false,
  };
}

export function hasExportableContent(response) {
  if (!response || typeof response !== "object") return false;
  const brief = response.executiveBrief;
  const hasBrief = Boolean(
    brief &&
      (String(brief.executiveSummary || "").trim() ||
        brief.keyFindings?.length ||
        brief.operationalRisks?.length),
  );
  return Boolean(
    hasBrief ||
      response.weeklyDashboardPackage ||
      formatExportAnswerText(response.directAnswer) ||
      (response.keyMetrics && response.keyMetrics.length > 0) ||
      (response.missingData && response.missingData.length > 0) ||
      response.answerType === ANSWER_TYPES.MISSING_DATA,
  );
}

export function buildAskNacExportFilename(format, date = new Date()) {
  const stamp = date.toISOString().slice(0, 16).replace(/[:T]/g, "-");
  const ext = format === EXPORT_FORMATS.JSON ? "json" : format === EXPORT_FORMATS.CSV ? "csv" : "pdf";
  return `ask-nac-${format}-${stamp}.${ext}`;
}

/**
 * @param {{ question: string, response: object, filters?: object }} input
 */
export function buildAskNacExportPayload({ question = "", response = {}, filters = {} } = {}) {
  const generatedAt = new Date();
  const provenance = resolveAnswerProvenance(response);
  const periodLabel =
    response.periodLabel ||
    ({ today: "Today", "7d": "Last 7 days", month: "Month-to-date" }[
      filters.selectedRange || hoursToRange(filters.timeRangeHours ?? 24)
    ] ??
      "Today");

  const branchLabel =
    response.branchLabel ||
    (filters.branch ? branchDisplayName(filters.branch) : "Network (all branches)");

  const reportTitle =
    provenance.id === PROVENANCE_IDS.MISSING_DATA
      ? "Ask NAC — Data Requirement Report"
      : `Ask NAC — ${response.title || "Intelligence Answer"}`;

  return {
    meta: {
      generatedAt: generatedAt.toISOString(),
      generatedAtLabel: formatAskNacGeneratedAt(generatedAt),
      reportTitle,
      provenance,
      answerType: response.answerType,
      intent: response.intent || null,
      confidence: response.confidence || null,
      serverConnected: response.serverConnected ?? null,
      isAiGenerated: Boolean(response.isAiGenerated),
    },
    question: String(question || "").trim(),
    context: {
      periodLabel,
      branchLabel,
      filterSummary: buildFilterContextSummary({ ...filters, periodLabel }),
      filters: {
        branch: filters.branch ?? null,
        selectedRange: filters.selectedRange ?? null,
        timeRangeHours: filters.timeRangeHours ?? null,
        language: filters.language ?? null,
        shift: filters.shift ?? null,
        eventType: filters.eventType ?? null,
        dayType: filters.dayType ?? null,
        role: filters.role ?? null,
      },
    },
    answer: {
      title: response.title || "",
      directAnswer: formatExportAnswerText(response.directAnswer),
    },
    executiveBrief: response.executiveBrief
      ? normalizeExecutiveBriefForExport(response.executiveBrief)
      : null,
    keyMetrics: applyExecutiveMetricDisplayLabels(response.keyMetrics || []).map((m) => ({
      key: m.key || null,
      label: m.label,
      value: m.value,
      unit: m.unit || "",
      source: m.source || "",
      note: m.note || "",
    })),
    insights: [...(response.insights || [])],
    recommendations: [...(response.recommendations || [])],
    sources: (response.sources || []).map((s) => ({
      name: s.name,
      detail: s.detail || "",
    })),
    vaultSources: (response.vaultSources || []).map((s) => ({
      fileId: s.fileId || null,
      title: s.title || "",
      reportType: s.reportType || "",
      confidence: s.confidence ?? null,
      parserVersion: s.parserVersion || null,
    })),
    warnings: [...(response.warnings || [])],
    missingData: [...(response.missingData || [])],
    diagnostics: response.diagnostics ? { ...response.diagnostics } : null,
    assumptions: buildExportAssumptions(response),
    dataCompleteness: buildDataCompleteness(response, provenance),
    rawResponse: response,
  };
}

function buildExportAssumptions(response = {}) {
  const lines = [];
  if (response.diagnostics?.source === "hybrid") {
    lines.push("Month-to-date may combine daily rollup with live Today business-day data.");
  }
  if (response.isAiGenerated) {
    lines.push("Narrative wording may be AI-generated; numeric facts match tool output only.");
  }
  (response.insights || []).forEach((line) => {
    if (/redirect|review|menu qr|session|rollup|hybrid/i.test(line)) {
      lines.push(line);
    }
  });
  return [...new Set(lines)];
}

function buildDataCompleteness(response = {}, provenance = {}) {
  const items = [];
  items.push(`Provenance: ${provenance.label}`);
  items.push(`Confidence: ${response.confidence || "n/a"}`);
  if (response.diagnostics?.source) {
    items.push(`Metric source: ${response.diagnostics.source}`);
  }
  if (response.diagnostics?.partialLive) {
    items.push("Partial live merge applied for month-to-date.");
  }
  if (response.diagnostics?.includesCurrentBusinessDay === false && response.diagnostics?.source === "rollup") {
    items.push("Current business day may not be included in rollup-only totals.");
  }
  if ((response.warnings || []).length) {
    items.push(`${response.warnings.length} warning(s) attached — see Warnings section.`);
  }
  if ((response.missingData || []).length) {
    items.push(`${response.missingData.length} missing-data item(s) documented.`);
  }
  if ((response.vaultSources || []).length) {
    items.push(`${response.vaultSources.length} Data Vault source file(s) cited.`);
  }
  return items;
}

export function hasTabularKeyMetrics(payload) {
  return Array.isArray(payload?.keyMetrics) && payload.keyMetrics.length > 0;
}
