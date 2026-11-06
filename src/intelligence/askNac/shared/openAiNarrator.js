/**
 * Ask NAC OpenAI analyst narrator — pure helpers (testable; Edge mirrors in TS).
 * OpenAI must never retrieve data or invent numbers.
 */

export const MAX_FACT_ROWS = 24;
export const MAX_NARRATION_TOKENS = 600;
export const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";

function trimRows(value, depth = 0) {
  if (depth > 4) return "[truncated]";
  if (Array.isArray(value)) {
    return value.slice(0, MAX_FACT_ROWS).map((row) => trimRows(row, depth + 1));
  }
  if (value && typeof value === "object") {
    const out = {};
    const keys = Object.keys(value).slice(0, 32);
    for (const key of keys) out[key] = trimRows(value[key], depth + 1);
    return out;
  }
  if (typeof value === "string" && value.length > 400) {
    return `${value.slice(0, 400)}…`;
  }
  return value;
}

/** Extract numeric values from keyMetrics for preservation checks. */
export function extractMetricNumericSignature(keyMetrics = []) {
  return (keyMetrics || []).map((m) => ({
    label: m.label,
    value: m.value,
    unit: m.unit || "",
  }));
}

/** Reject AI output that changed verified metric numbers. */
export function validateMetricPreservation(originalMetrics = [], candidateMetrics = []) {
  const orig = extractMetricNumericSignature(originalMetrics);
  const cand = extractMetricNumericSignature(candidateMetrics);
  if (orig.length !== cand.length) return false;
  for (let i = 0; i < orig.length; i += 1) {
    if (orig[i].label !== cand[i].label) return false;
    if (Number(orig[i].value) !== Number(cand[i].value) && String(orig[i].value) !== String(cand[i].value)) {
      return false;
    }
  }
  return true;
}

/**
 * Build compact facts payload for OpenAI narration.
 */
export function buildNarrationPayload(deterministicAnswer, { question = "", intent = null, tool = null, diagnostics = null } = {}) {
  return {
    question,
    intent,
    deterministicAnswer: {
      answerType: deterministicAnswer.answerType,
      title: deterministicAnswer.title,
      directAnswer: deterministicAnswer.directAnswer,
      keyMetrics: (deterministicAnswer.keyMetrics || []).slice(0, MAX_FACT_ROWS),
      insights: (deterministicAnswer.insights || []).slice(0, 12),
      recommendations: (deterministicAnswer.recommendations || []).slice(0, 8),
      warnings: deterministicAnswer.warnings || [],
      missingData: deterministicAnswer.missingData || [],
      sources: deterministicAnswer.sources || [],
      vaultSources: deterministicAnswer.vaultSources || [],
      periodLabel: deterministicAnswer.periodLabel,
      branchLabel: deterministicAnswer.branchLabel,
      confidence: deterministicAnswer.confidence,
      operationalFindings: (deterministicAnswer.operationalFindings || []).slice(0, 12).map((item) => ({
        date: item.dateLabel || item.date,
        table: item.tableNumber || null,
        product: item.product,
        action: item.action,
        resolution: item.resolution,
        quote: String(item.evidenceExcerpt || "").slice(0, 240),
      })),
    },
    toolFacts: tool ? trimRows(tool) : null,
    diagnostics: diagnostics ? trimRows(diagnostics) : null,
  };
}

/**
 * A narrated complaint may name only tables that the quoted register already contains.
 * Anything else is rejected and the verified answer is kept.
 */
export function narrationIntroducesUnsupportedIncident(narratedText = "", findings = []) {
  const tables = new Set(
    (findings || []).map((item) => String(item.tableNumber || item.table || "")).filter(Boolean),
  );
  const evidence = (findings || [])
    .map((item) => `${item.product || ""} ${item.evidenceExcerpt || item.quote || ""} ${item.dateLabel || item.date || ""}`)
    .join(" ")
    .toLowerCase();
  const named = String(narratedText || "").matchAll(/\btable\s+(\d+)\b/gi);
  for (const match of named) {
    if (!tables.has(match[1]) && !evidence.includes(`table ${match[1]}`)) return true;
  }
  return false;
}

/**
 * Merge OpenAI JSON narration into deterministic answer without changing numbers.
 */
export function mergeNarratedResponse(deterministicAnswer, aiJson = {}) {
  if (!aiJson || typeof aiJson !== "object") return deterministicAnswer;

  const candidateMetrics = Array.isArray(aiJson.keyMetrics)
    ? aiJson.keyMetrics
    : deterministicAnswer.keyMetrics;

  if (!validateMetricPreservation(deterministicAnswer.keyMetrics, candidateMetrics)) {
    return {
      ...deterministicAnswer,
      warnings: [
        ...(deterministicAnswer.warnings || []),
        "OpenAI changed verified numbers — showing deterministic answer only.",
      ],
    };
  }

  const directAnswer = String(aiJson.directAnswer || "").trim();
  if (!directAnswer) return deterministicAnswer;

  if (narrationIntroducesUnsupportedIncident(directAnswer, deterministicAnswer.operationalFindings || [])) {
    return {
      ...deterministicAnswer,
      warnings: [
        ...(deterministicAnswer.warnings || []),
        "OpenAI named a complaint that is not in the logbook quotes — showing the verified register only.",
      ],
    };
  }

  return {
    ...deterministicAnswer,
    directAnswer,
    executiveSummary: aiJson.executiveSummary || deterministicAnswer.executiveSummary || null,
    insights: Array.isArray(aiJson.insights) && aiJson.insights.length
      ? aiJson.insights.filter(Boolean)
      : deterministicAnswer.insights,
    recommendations: Array.isArray(aiJson.recommendations) && aiJson.recommendations.length
      ? aiJson.recommendations.filter(Boolean)
      : deterministicAnswer.recommendations,
    keyMetrics: deterministicAnswer.keyMetrics,
    sources: deterministicAnswer.sources,
    warnings: deterministicAnswer.warnings,
    missingData: deterministicAnswer.missingData,
    vaultSources: deterministicAnswer.vaultSources,
    isAiGenerated: true,
  };
}

export function buildNarrationSystemPrompt() {
  return [
    "You are Ask NAC, a business intelligence analyst for NAC restaurants.",
    "You ONLY explain structured facts already retrieved by internal tools.",
    "NEVER invent numbers, metrics, complaints, dates, actions, or data sources.",
    "Every incident you mention must already be in operationalFindings, and its wording must stay traceable to that item's quote.",
    "NEVER change numeric values in keyMetrics.",
    "NEVER add unsupported metrics.",
    "Preserve sources, warnings, missingData, and vaultSources exactly.",
    "Return valid JSON matching the Ask NAC response schema fields you may edit:",
    "directAnswer, executiveSummary (optional), insights, recommendations.",
    "Keep answers concise (2-4 sentences in directAnswer unless report-style).",
  ].join(" ");
}

export function buildNarrationUserPrompt(payload) {
  return [
    "Explain these verified facts for the user question.",
    "You may improve wording in directAnswer, add executiveSummary, insights, and recommendations.",
    "Do NOT change keyMetrics numeric values.",
    `Payload: ${JSON.stringify(payload)}`,
  ].join("\n\n");
}
