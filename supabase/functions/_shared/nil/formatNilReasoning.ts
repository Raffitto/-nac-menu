/**
 * Format NIL reasoning output for Ask NAC / executive surfaces.
 */

import { CONFIDENCE_LABELS } from "./nilConfidence.ts";
import { EVIDENCE_LEVELS } from "./nilContract.ts";

const SECTION_TITLES = {
  [EVIDENCE_LEVELS.FACT]: "Confirmed Facts",
  [EVIDENCE_LEVELS.CORRELATION]: "Evidence-Based Correlations",
  [EVIDENCE_LEVELS.HYPOTHESIS]: "Hypotheses",
  [EVIDENCE_LEVELS.RECOMMENDATION]: "Recommendations",
};

/**
 * @param {import("./nilContract").NilReasoningResult} result
 * @returns {string}
 */
export function formatNilReasoningText(result) {
  if (!result) return "";

  const sections = [
    formatSection(SECTION_TITLES[EVIDENCE_LEVELS.FACT], result.facts),
    formatSection(SECTION_TITLES[EVIDENCE_LEVELS.CORRELATION], result.correlations),
    formatSection(SECTION_TITLES[EVIDENCE_LEVELS.HYPOTHESIS], result.hypotheses),
    formatSection(SECTION_TITLES[EVIDENCE_LEVELS.RECOMMENDATION], result.recommendations),
  ].filter(Boolean);

  const confidenceLine = result.confidence
    ? `\nConfidence\n\n${CONFIDENCE_LABELS[result.confidence] || result.confidence}`
    : "";

  return `${sections.join("\n\n")}${confidenceLine}`.trim();
}

function formatSection(title, statements = []) {
  if (!statements.length) return "";
  const bullets = statements.map((stmt) => {
    const suffix = stmt.confidence && stmt.level === EVIDENCE_LEVELS.HYPOTHESIS
      ? ` (Confidence: ${capitalize(stmt.confidence)})`
      : "";
    return `* ${stmt.text}${suffix}`;
  });
  return `${title}\n\n${bullets.join("\n")}`;
}

function capitalize(value) {
  return String(value).charAt(0).toUpperCase() + String(value).slice(1);
}

/**
 * @param {import("./nilContract").NilReasoningResult} result
 */
export function nilReasoningToAskNacFields(result) {
  return {
    directAnswer: formatNilReasoningText(result),
    insights: (result.hypotheses || []).map((h) => h.text),
    recommendations: (result.recommendations || []).map((r) => r.text),
    confidence: result.confidence,
    sources: collectSources(result),
    warnings: buildSeparationWarnings(result),
  };
}

function collectSources(result) {
  const all = [
    ...(result.facts || []),
    ...(result.correlations || []),
    ...(result.hypotheses || []),
    ...(result.recommendations || []),
  ];
  const seen = new Set();
  return all.flatMap((stmt) => stmt.sources || []).filter((source) => {
    const key = `${source.name}|${source.detail}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((source) => ({
    name: source.name,
    detail: [source.branch, source.period, source.detail].filter(Boolean).join(" · "),
  }));
}

function buildSeparationWarnings(result) {
  const warnings = [];
  if ((result.hypotheses || []).length && !(result.facts || []).length) {
    warnings.push("Hypotheses were generated without confirmed operational facts.");
  }
  if ((result.correlations || []).length && !(result.facts || []).length) {
    warnings.push("Correlations are present without confirmed operational facts.");
  }
  return warnings;
}
