import {
  buildStructuredFact,
  explainConfidence,
  extractLabelValuePairs,
  getParserMatrix,
  parseNacDateFromText,
  resolveBranchFromMatrix,
  resolveDateFromMatrix,
} from "./vaultParseUtils";

const WEEKLY_LABELS = {
  total_sales: ["total sales", "weekly sales", "sales total", "gross sales"],
  guest_count: ["guest count", "guests", "covers", "pax"],
  avg_spend: ["avg spend", "average spend", "avg per guest"],
  weekly_trend: ["trend", "weekly trend", "sales trend"],
  target: ["target", "weekly target", "budget"],
  variance: ["variance", "vs target", "vs budget", "difference"],
  action_item: ["action item", "action items", "follow up", "follow-up", "next steps"],
};

const CORE_KEYS = ["total_sales", "weekly_trend", "variance"];

export function parseWeeklySalesReport(intermediate, context) {
  const matrix = getParserMatrix(intermediate);
  const text = intermediate?.text || "";
  const branchId = resolveBranchFromMatrix(matrix, context.branchId);
  const { periodStart, periodEnd } = resolveDateFromMatrix(
    matrix,
    context.periodStart,
    context.periodEnd,
    text,
  );

  const { values, confidence: labelConfidence } = extractLabelValuePairs(matrix, WEEKLY_LABELS, {
    minConfidenceKeys: 3,
    text,
  });

  const coreMatched = CORE_KEYS.filter((key) => values[key] != null).length;
  const rawConfidence = Math.min(
    1,
    labelConfidence * 0.55 + (coreMatched / CORE_KEYS.length) * 0.45,
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
    department: context.department || "sales",
    reportType: "weekly_sales_overview",
    sensitivityLevel: context.sensitivityLevel,
    periodStart: periodStart || parseNacDateFromText(text),
    periodEnd: periodEnd || periodStart,
    createdBy: context.createdBy,
    confidence: rawConfidence,
  };

  for (const [key, raw] of Object.entries(values)) {
    if (key.endsWith("__row")) continue;
    const isText = ["weekly_trend", "action_item"].includes(key);
    if (isText) {
      facts.push(
        buildStructuredFact({
          ...base,
          metricKey: key,
          metricValue: null,
          dimensions: { text_value: String(raw) },
          grain: "line",
        }),
      );
      continue;
    }
    const numeric = typeof raw === "number" ? raw : parseNumberSafe(raw);
    if (numeric == null && !isText) continue;
    facts.push(
      buildStructuredFact({
        ...base,
        metricKey: key,
        metricValue: numeric,
        grain: key === "variance" ? "snapshot" : "daily",
      }),
    );
  }

  return {
    ok: facts.length > 0,
    branchId,
    periodStart: base.periodStart,
    periodEnd: base.periodEnd,
    confidence: rawConfidence,
    confidenceMeta,
    facts,
    sections: ["weekly_sales", "trends", "action_items"],
    stats: { coreMatched, factCount: facts.length },
    warnings: facts.length === 0 ? ["No weekly metrics detected."] : [],
    error: facts.length === 0 ? "Weekly sales parser found no structured metrics." : null,
  };
}

function parseNumberSafe(raw) {
  if (raw == null || raw === "") return null;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  const cleaned = String(raw).replace(/[, SAR]/gi, "").replace(/[^\d.-]/g, "").trim();
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}
