/**
 * Reusable analytical confidence for Ask NAC vault / cash-up answers.
 */

import { CONFIDENCE_LEVELS } from "../askNacContract";
import { assessPeriodCoverage } from "../coverage/coverageAwareness";

/**
 * @param {object} params
 * @param {object} params.route
 * @param {object} params.tool
 * @param {object} [params.coverageAssessment]
 * @returns {{ level: string, explanation: string, dataConfidence: object }}
 */
export function resolveAnalyticalConfidence({ route, tool, coverageAssessment = null } = {}) {
  const assessment = coverageAssessment
    || assessPeriodCoverage({
      requestedPeriod: route?.vaultPeriod || {
        startDate: tool?.startDate,
        endDate: tool?.endDate,
        label: tool?.periodLabel,
      },
      aggregation: tool?.aggregation,
    });

  const sources = tool?.vaultSources || [];
  const lowParser = sources.some((s) => s.confidence != null && s.confidence < 0.55);
  const partialVault = (tool?.coverage || []).some((c) => c.readinessStatus === "partial");

  let level = assessment.confidence || CONFIDENCE_LEVELS.MEDIUM;
  let explanation = assessment.confidenceExplanation || "Coverage assessed from uploaded cash-up facts.";

  if (assessment.completeness === "unavailable") {
    level = CONFIDENCE_LEVELS.LOW;
  } else if (lowParser || partialVault) {
    if (level === CONFIDENCE_LEVELS.HIGH) level = CONFIDENCE_LEVELS.MEDIUM;
    explanation = `${explanation} Some source files have partial parse confidence.`;
  }

  if ((tool?.warnings || []).length > 0 && level === CONFIDENCE_LEVELS.HIGH) {
    level = CONFIDENCE_LEVELS.MEDIUM;
  }

  return {
    level,
    explanation,
    dataConfidence: assessment.dataConfidence || {
      level,
      explanation,
      requestedPeriod: assessment.requestedPeriodLabel,
    },
  };
}

export function formatConfidenceLine(confidenceResult) {
  if (!confidenceResult?.explanation) return null;
  const label = String(confidenceResult.level || "medium");
  const cap = label.charAt(0).toUpperCase() + label.slice(1);
  return `Confidence: ${cap} — ${confidenceResult.explanation}`;
}
