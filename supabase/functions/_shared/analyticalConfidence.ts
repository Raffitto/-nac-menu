/**
 * Reusable analytical confidence for Ask NAC vault / cash-up answers (Edge).
 */

import { assessPeriodCoverage, CONFIDENCE_LEVELS } from "./coverageAwareness.ts";

export function resolveAnalyticalConfidence({
  route,
  tool,
  coverageAssessment = null,
}: {
  route?: Record<string, unknown>;
  tool?: Record<string, unknown>;
  coverageAssessment?: ReturnType<typeof assessPeriodCoverage> | null;
} = {}) {
  const assessment = coverageAssessment
    || assessPeriodCoverage({
      requestedPeriod: (route?.vaultPeriod as Record<string, unknown> | undefined) || {
        startDate: tool?.startDate,
        endDate: tool?.endDate,
        label: tool?.periodLabel,
      },
      aggregation: tool?.aggregation as Record<string, unknown> | undefined,
    });

  const sources = (tool?.vaultSources as { confidence?: number }[]) || [];
  const lowParser = sources.some((s) => s.confidence != null && s.confidence < 0.55);
  const partialVault = ((tool?.coverage as { readinessStatus?: string }[]) || []).some((c) => c.readinessStatus === "partial");

  let level = assessment.confidence || CONFIDENCE_LEVELS.MEDIUM;
  let explanation = assessment.confidenceExplanation || "Coverage assessed from uploaded cash-up facts.";

  if (assessment.completeness === "unavailable") {
    level = CONFIDENCE_LEVELS.LOW;
  } else if (lowParser || partialVault) {
    if (level === CONFIDENCE_LEVELS.HIGH) level = CONFIDENCE_LEVELS.MEDIUM;
    explanation = `${explanation} Some source files have partial parse confidence.`;
  }

  if (((tool?.warnings as string[]) || []).length > 0 && level === CONFIDENCE_LEVELS.HIGH) {
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

export function formatConfidenceLine(confidenceResult: { level?: string; explanation?: string } | null) {
  if (!confidenceResult?.explanation) return null;
  const label = String(confidenceResult.level || "medium");
  const cap = label.charAt(0).toUpperCase() + label.slice(1);
  return `Confidence: ${cap} — ${confidenceResult.explanation}`;
}
