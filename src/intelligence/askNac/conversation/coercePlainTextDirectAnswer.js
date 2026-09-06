/**
 * Ensure Ask NAC directAnswer is always renderable plain text.
 */

import { sanitizeIncompletePeriodAnswer } from "../coverage/temporalCoverage";

export function coercePlainTextDirectAnswer(directAnswer, response = {}) {
  if (typeof directAnswer === "string") {
    const trimmed = directAnswer.trim();
    if (trimmed && trimmed !== "[object Object]") return trimmed;
  }

  if (directAnswer && typeof directAnswer === "object") {
    const value = directAnswer;
    const candidates = [
      value.executiveSummary,
      value.answer,
      value.summary,
      value.text,
      value.directAnswer,
    ];
    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
    }
  }

  const briefSummary = response?.executiveBrief?.executiveSummary;
  if (typeof briefSummary === "string" && briefSummary.trim()) {
    return briefSummary.trim();
  }

  return "";
}

export function resolveAskNacDirectAnswer(response = {}) {
  const coerced = coercePlainTextDirectAnswer(response.directAnswer, response);
  if (coerced) return sanitizeIncompletePeriodAnswer(coerced, response);
  return "No summary available.";
}
