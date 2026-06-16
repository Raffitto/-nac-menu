import {
  buildStructuredFact,
  explainConfidence,
  extractLabelValuePairs,
  extractPaymentAndDeliveryFacts,
  getParserMatrix,
  parseNacDateFromText,
  resolveBranchFromMatrix,
  resolveDateFromMatrix,
} from "./vaultParseUtils";

const CASH_UP_LABELS = {
  total_sales: ["total sales", "gross sales", "sales total"],
  net_sales: ["net sales", "net total", "net revenue"],
  guest_count: ["guest count", "guests", "number of guests", "pax", "covers", "guests count"],
  order_count: ["order count", "orders", "number of orders", "tickets"],
  avg_per_guest: [
    "avg per guest",
    "average per guest",
    "avg spend",
    "average spend",
    "average per guest spend",
  ],
  ccm_sales: ["ccm sales", "ccm total", "ccm"],
  discounts: ["discounts", "discount total", "total discounts"],
  voids: ["voids", "void total", "total voids"],
  target_sales: ["target", "budget", "sales target", "daily target"],
  breakfast_sales: ["breakfast sales", "breakfast total"],
  lunch_sales: ["lunch sales", "lunch total"],
  dinner_sales: ["dinner sales", "dinner total"],
  cash_expected: ["cash expected", "expected cash", "system cash", "pos cash", "cash due"],
  cash_counted: ["cash counted", "actual cash", "physical cash", "cash in drawer", "counted cash"],
  cash_variance: ["variance", "cash variance", "difference", "over/short", "over short", "over-short"],
  cash_shortage: ["shortage", "short", "under", "cash short"],
  cash_overage: ["overage", "over", "surplus", "cash over"],
  petty_cash_variance: ["petty cash variance", "petty cash difference"],
};

const CORE_KEYS = ["total_sales", "net_sales", "guest_count", "order_count"];

export function parseCashUpReport(intermediate, context) {
  const matrix = getParserMatrix(intermediate);
  const text = intermediate?.text || "";
  const branchId = resolveBranchFromMatrix(matrix, context.branchId);
  const { periodStart, periodEnd } = resolveDateFromMatrix(
    matrix,
    context.periodStart,
    context.periodEnd,
    text,
  );

  const parsedPeriod = parseNacDateFromText(text) || periodStart;

  const { values, confidence: labelConfidence } = extractLabelValuePairs(matrix, CASH_UP_LABELS, {
    minConfidenceKeys: 4,
    text,
  });

  const coreMatched = CORE_KEYS.filter((key) => values[key] != null).length;
  const rawConfidence = Math.min(
    1,
    labelConfidence * 0.6 + (coreMatched / CORE_KEYS.length) * 0.4,
  );
  const confidenceMeta = explainConfidence(rawConfidence, {
    coreMatched,
    coreRequired: 3,
    warnings: intermediate?.adapterWarnings || [],
  });

  const facts = [];
  const base = {
    fileId: context.fileId,
    branchId,
    brandWide: context.brandWide,
    department: context.department,
    reportType: "cash_up",
    sensitivityLevel: context.sensitivityLevel,
    periodStart: parsedPeriod || periodStart,
    periodEnd: parsedPeriod || periodEnd,
    createdBy: context.createdBy,
    confidence: rawConfidence,
  };

  for (const [key, raw] of Object.entries(values)) {
    if (key.endsWith("__row")) continue;
    const numeric = typeof raw === "number" ? raw : parseNumberSafe(raw);
    const metricValue = numeric != null ? numeric : null;
    if (metricValue == null && typeof raw !== "string") continue;

    facts.push(
      buildStructuredFact({
        ...base,
        metricKey: key,
        metricValue,
        dimensions: typeof raw === "string" && metricValue == null ? { text_value: raw } : {},
        sourceRowRef: values[`${key}__row`] ? `row:${values[`${key}__row`]}` : null,
      }),
    );
  }

  for (const extra of extractPaymentAndDeliveryFacts(matrix)) {
    facts.push(
      buildStructuredFact({
        ...base,
        metricKey: extra.metric_key,
        metricValue: extra.metric_value,
        dimensions: extra.dimensions,
        sourceRowRef: extra.source_row_ref,
      }),
    );
  }

  const expected = values.cash_expected;
  const counted = values.cash_counted;
  if (values.cash_variance == null && expected != null && counted != null) {
    const variance = Number(counted) - Number(expected);
    if (Number.isFinite(variance)) {
      facts.push(
        buildStructuredFact({
          ...base,
          metricKey: "cash_variance",
          metricValue: variance,
          dimensions: { computed: true },
          sourceRowRef: "computed:variance",
        }),
      );
      if (variance < 0) {
        facts.push(
          buildStructuredFact({
            ...base,
            metricKey: "cash_shortage",
            metricValue: Math.abs(variance),
            dimensions: { computed: true },
            sourceRowRef: "computed:shortage",
          }),
        );
      } else if (variance > 0) {
        facts.push(
          buildStructuredFact({
            ...base,
            metricKey: "cash_overage",
            metricValue: variance,
            dimensions: { computed: true },
            sourceRowRef: "computed:overage",
          }),
        );
      }
    }
  }

  return {
    ok: facts.length > 0,
    confidence: rawConfidence,
    confidenceMeta,
    facts,
    periodStart: base.periodStart,
    periodEnd: base.periodEnd,
    branchId,
    sections: (intermediate?.sections || []).map((s) => s.label),
    stats: {
      coreMatched,
      factCount: facts.length,
      parser: "cash_up",
      confidenceLevel: confidenceMeta.level,
    },
    warnings: confidenceMeta.warnings,
    error: facts.length ? null : "No cash-up metrics found in file layout.",
  };
}

function parseNumberSafe(raw) {
  if (raw == null || raw === "") return null;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  const cleaned = String(raw)
    .replace(/[, SAR sar riyal riyals]/gi, "")
    .replace(/[^\d.-]/g, "")
    .trim();
  if (!cleaned) return null;
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}
