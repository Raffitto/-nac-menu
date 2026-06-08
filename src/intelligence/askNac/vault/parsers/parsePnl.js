import {
  buildStructuredFact,
  explainConfidence,
  extractLabelValuePairs,
  getParserMatrix,
  parseNacDateFromText,
  resolveBranchFromMatrix,
  resolveDateFromMatrix,
} from "./vaultParseUtils";

const PNL_LABELS = {
  revenue: ["revenue", "total revenue", "sales revenue", "net revenue"],
  cogs: ["cogs", "cost of goods", "cost of sales", "food cost"],
  labor: ["labor", "labour", "staff cost", "payroll", "wages"],
  profit: ["profit", "net profit", "operating profit", "ebitda"],
  margin: ["margin", "profit margin", "gross margin", "net margin"],
  discounts: ["discounts", "discount total"],
  voids: ["voids", "void total"],
};

const CORE_KEYS = ["revenue", "cogs", "labor", "profit"];

export function parsePnlReport(intermediate, context) {
  const matrix = getParserMatrix(intermediate);
  const text = intermediate?.text || "";
  const branchId = resolveBranchFromMatrix(matrix, context.branchId);
  const { periodStart, periodEnd } = resolveDateFromMatrix(
    matrix,
    context.periodStart,
    context.periodEnd,
    text,
  );

  const { values, confidence: labelConfidence } = extractLabelValuePairs(matrix, PNL_LABELS, {
    minConfidenceKeys: 3,
    text,
  });

  const coreMatched = CORE_KEYS.filter((key) => values[key] != null).length;
  const rawConfidence = Math.min(
    1,
    labelConfidence * 0.5 + (coreMatched / CORE_KEYS.length) * 0.5,
  );
  const confidenceMeta = explainConfidence(rawConfidence, {
    coreMatched,
    coreRequired: 2,
    warnings: intermediate?.adapterWarnings || [],
  });

  const facts = [];
  const parsedPeriod = parseNacDateFromText(text);
  const base = {
    fileId: context.fileId,
    branchId,
    brandWide: context.brandWide,
    department: context.department || "sales",
    reportType: "pnl",
    sensitivityLevel: context.sensitivityLevel || "finance",
    periodStart: periodStart || parsedPeriod,
    periodEnd: periodEnd || parsedPeriod,
    createdBy: context.createdBy,
    confidence: rawConfidence,
  };

  for (const [key, raw] of Object.entries(values)) {
    if (key.endsWith("__row")) continue;
    const numeric = parseNumberSafe(raw);
    if (numeric == null) continue;
    facts.push(
      buildStructuredFact({
        ...base,
        metricKey: key,
        metricValue: numeric,
        grain: "monthly",
        metricUnit: key === "margin" ? "percent" : "SAR",
      }),
    );
  }

  if (values.revenue != null && values.profit != null && values.margin == null) {
    const revenue = parseNumberSafe(values.revenue);
    const profit = parseNumberSafe(values.profit);
    if (revenue && profit != null) {
      facts.push(
        buildStructuredFact({
          ...base,
          metricKey: "margin",
          metricValue: Number(((profit / revenue) * 100).toFixed(2)),
          grain: "monthly",
          metricUnit: "percent",
        }),
      );
    }
  }

  return {
    ok: facts.length > 0,
    branchId,
    periodStart: base.periodStart,
    periodEnd: base.periodEnd,
    confidence: rawConfidence,
    confidenceMeta,
    facts,
    sections: ["pnl_summary"],
    stats: { coreMatched, factCount: facts.length },
    warnings: facts.length === 0 ? ["No P&L metrics detected."] : [],
    error: facts.length === 0 ? "P&L parser found no structured metrics." : null,
  };
}

function parseNumberSafe(raw) {
  if (raw == null || raw === "") return null;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  const cleaned = String(raw).replace(/[, SAR %]/gi, "").replace(/[^\d.-]/g, "").trim();
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}
