/**
 * Deterministic answers for human-in-the-loop flows.
 */

import {
  ANSWER_TYPES,
  CONFIDENCE_LEVELS,
  createAskNacResponse,
  sourceEntry,
} from "../askNacContract";
import { ASK_NAC_INTENTS } from "../intentRouter";
import { buildWeeklyDashboardAnswerLines } from "./weeklyDashboardSession";
import { formatOperatorMemoryLines } from "./operatorMemory";
import { buildWeeklyDashboardFilename } from "../export/weeklyDashboardXlsxExport";

export function buildTeachOperatorAnswer(route, tool, readiness) {
  const memory = tool?.memory;
  const branchLabel = tool?.branchLabel || route?.branchMention || "Network";

  return createAskNacResponse({
    answerType: ANSWER_TYPES.EXECUTIVE,
    title: "Operator knowledge saved",
    directAnswer: memory
      ? `Saved for ${branchLabel}: "${memory.fact}"`
      : "Operator knowledge could not be saved.",
    keyMetrics: memory
      ? [{ label: "Category", value: memory.category, source: "operator_memory" }]
      : [],
    insights: [
      "This fact is stored as permanent operator knowledge and will be used in future why-answers with source attribution.",
    ],
    recommendations: [],
    sources: (tool?.sources || []).map((s) => sourceEntry(s.name, s.detail)),
    warnings: tool?.error ? [tool.error] : [],
    confidence: memory ? CONFIDENCE_LEVELS.HIGH : CONFIDENCE_LEVELS.NONE,
    isAiGenerated: false,
    intent: ASK_NAC_INTENTS.VAULT_TEACH_OPERATOR,
    branchLabel,
    readiness,
    diagnostics: { memoryId: memory?.id || null },
  });
}

export function buildManualInputPendingAnswer(route, tool, readiness) {
  const field = tool?.promptField;
  const session = tool?.pendingSession;
  const branchLabel = tool?.branchLabel || "Branch";
  const periodLabel = tool?.vaultPeriod?.periodLabel || "this period";

  return createAskNacResponse({
    answerType: ANSWER_TYPES.EXECUTIVE,
    title: `Weekly dashboard · ${branchLabel}`,
    directAnswer: field
      ? `To complete the weekly dashboard for ${periodLabel}, I need ${field.label}. ${field.prompt || `Please provide ${field.label}.`}`
      : "Additional manual input is required to complete this dashboard.",
    keyMetrics: [],
    insights: [
      "Manual inputs apply to this reporting period only — they are not reused for other weeks.",
    ],
    recommendations: [
      `Reply with the value (e.g. "82 covers" or "7Rooms covers were 82").`,
    ],
    sources: (tool?.sources || []).map((s) => sourceEntry(s.name, s.detail)),
    warnings: [],
    confidence: CONFIDENCE_LEVELS.MEDIUM,
    isAiGenerated: false,
    intent: route.intent,
    branchLabel,
    periodLabel,
    readiness,
    awaitingInput: true,
    pendingSession: session ? { id: session.id, status: session.status, missingFields: tool.missingFields } : null,
    pendingSessionId: session?.id || null,
  });
}

export function buildWeeklyDashboardCompleteAnswer(route, tool, readiness) {
  const lines = buildWeeklyDashboardAnswerLines(tool);
  const branchLabel = tool?.branchLabel || "Branch";
  const confidence = tool?.confidenceResult?.level || CONFIDENCE_LEVELS.MEDIUM;
  const pkg = tool?.weeklyDashboardPackage || null;
  const xlsxName = pkg ? buildWeeklyDashboardFilename(pkg) : null;

  return createAskNacResponse({
    answerType: ANSWER_TYPES.EXECUTIVE,
    title: `Weekly dashboard · ${branchLabel}`,
    directAnswer: [
      ...lines,
      "",
      xlsxName
        ? `Management XLSX ready: ${xlsxName} — use Download XLSX to save the workbook (Dashboard, Data, Source, 90 Days).`
        : "Dashboard summary complete — XLSX export data could not be assembled.",
    ].join("\n"),
    keyMetrics: [
      tool?.aggregation?.totalSales != null
        ? { label: "Total sales", value: `${Number(tool.aggregation.totalSales).toLocaleString()} SAR`, source: "vault" }
        : null,
      tool?.manualInputs?.seven_rooms_covers != null
        ? { label: "7Rooms covers", value: String(tool.manualInputs.seven_rooms_covers), source: "manual_input" }
        : null,
    ].filter(Boolean),
    insights: tool?.coverageAssessment?.coverageNotes || [],
    recommendations: [
      xlsxName ? "Download the XLSX workbook for the full management dashboard." : "Review vault coverage before sharing externally.",
    ],
    sources: (tool?.sources || []).map((s) => sourceEntry(s.name, s.detail)),
    warnings: [],
    confidence,
    dataConfidence: tool?.confidenceResult?.dataConfidence,
    isAiGenerated: false,
    intent: ASK_NAC_INTENTS.VAULT_WEEKLY_DASHBOARD,
    branchLabel,
    periodLabel: tool?.vaultPeriod?.periodLabel,
    readiness,
    awaitingInput: false,
    pendingSession: tool?.pendingSession
      ? { id: tool.pendingSession.id, status: "complete" }
      : null,
    pendingSessionId: null,
    weeklyDashboardPackage: pkg,
    exportOptions: pkg ? [{ format: "weekly_dashboard_xlsx", label: "Download XLSX", filename: xlsxName }] : [],
    diagnostics: { weeklyDashboardSheets: ["Dashboard", "Data", "Source", "90 Days"] },
  });
}

export function buildWeeklyDashboardAnswer(route, tool, readiness) {
  if (tool?.status === "pending") {
    return buildManualInputPendingAnswer(route, tool, readiness);
  }
  return buildWeeklyDashboardCompleteAnswer(route, tool, readiness);
}

export function buildOperatorMemoryInsightLines(operatorMemories = []) {
  return formatOperatorMemoryLines(operatorMemories, { max: 3 }).map(
    (line) => `Operator knowledge: ${line}`,
  );
}
