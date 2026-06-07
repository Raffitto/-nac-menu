import {
  buildStructuredFact,
  explainConfidence,
  extractLabelValuePairs,
  extractPaymentAndDeliveryFacts,
  getParserMatrix,
  resolveBranchFromMatrix,
  resolveDateFromMatrix,
} from "./vaultParseUtils";

const CCM_LABELS = {
  ccm_expected: ["ccm expected", "expected ccm", "expected total", "system expected"],
  ccm_actual: ["ccm actual", "actual ccm", "actual total", "pos total", "cash up total"],
  ccm_difference: ["difference", "variance", "ccm difference", "reconciliation difference"],
  reconciliation_status: ["reconciliation status", "status", "match status", "balanced"],
  payment_method_total: ["payment method total", "payment total", "total payments", "payments total"],
};

const CORE_KEYS = ["ccm_expected", "ccm_actual", "ccm_difference"];

export function parseCcmReconciliationReport(intermediate, context) {
  const matrix = getParserMatrix(intermediate);
  const text = intermediate?.text || "";
  const branchId = resolveBranchFromMatrix(matrix, context.branchId);
  const { periodStart, periodEnd } = resolveDateFromMatrix(
    matrix,
    context.periodStart,
    context.periodEnd,
    text,
  );

  const { values, confidence: labelConfidence } = extractLabelValuePairs(matrix, CCM_LABELS, {
    minConfidenceKeys: 2,
    text,
  });

  const coreMatched = CORE_KEYS.filter((key) => values[key] != null).length;
  const rawConfidence = Math.min(
    1,
    labelConfidence * 0.7 + (coreMatched / CORE_KEYS.length) * 0.3,
  );
  const confidenceMeta = explainConfidence(rawConfidence, {
    coreMatched,
    coreRequired: 2,
    warnings: intermediate?.adapterWarnings || [],
  });

  const facts = [];
  const base = {
    fileId: context.fileId,
    branchId,
    brandWide: context.brandWide,
    department: context.department || "admin",
    reportType: "ccm_reconciliation",
    sensitivityLevel: context.sensitivityLevel,
    periodStart,
    periodEnd,
    createdBy: context.createdBy,
    confidence: rawConfidence,
  };

  for (const [key, raw] of Object.entries(values)) {
    if (key.endsWith("__row")) continue;
    if (key === "reconciliation_status") {
      facts.push(
        buildStructuredFact({
          ...base,
          metricKey: key,
          metricValue: null,
          dimensions: { text_value: String(raw) },
          grain: "snapshot",
          sourceRowRef: values[`${key}__row`] ? `row:${values[`${key}__row`]}` : null,
        }),
      );
      continue;
    }
    const numeric = typeof raw === "number" ? raw : Number(String(raw).replace(/,/g, ""));
    if (!Number.isFinite(numeric)) continue;
    facts.push(
      buildStructuredFact({
        ...base,
        metricKey: key,
        metricValue: numeric,
        sourceRowRef: values[`${key}__row`] ? `row:${values[`${key}__row`]}` : null,
      }),
    );
  }

  for (const extra of extractPaymentAndDeliveryFacts(matrix)) {
    if (extra.metric_key === "payment_method") {
      facts.push(
        buildStructuredFact({
          ...base,
          metricKey: "payment_method_total",
          metricValue: extra.metric_value,
          dimensions: extra.dimensions,
          sourceRowRef: extra.source_row_ref,
        }),
      );
    }
  }

  return {
    ok: facts.length > 0,
    confidence: rawConfidence,
    confidenceMeta,
    facts,
    periodStart,
    periodEnd,
    branchId,
    sections: (intermediate?.sections || []).map((s) => s.label),
    stats: {
      coreMatched,
      factCount: facts.length,
      parser: "ccm_reconciliation",
      confidenceLevel: confidenceMeta.level,
    },
    warnings: confidenceMeta.warnings,
    error: facts.length ? null : "No CCM reconciliation fields detected.",
  };
}
