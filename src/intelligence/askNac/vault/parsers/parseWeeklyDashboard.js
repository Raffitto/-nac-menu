import {
  buildStructuredFact,
  explainConfidence,
  extractLabelValuePairs,
  getParserMatrix,
  parseNacDateFromText,
  resolveBranchFromMatrix,
  resolveDateFromMatrix,
} from "./vaultParseUtils";

const DASHBOARD_LABELS = {
  total_sales: ["total sales", "total sales (sar)", "sales (sar)"],
  guest_count: ["cash-up guests", "guests (cash-up)", "guest count", "guests"],
  seven_rooms_covers: ["7rooms covers", "7 rooms covers", "reservation covers"],
  average_spend: ["average spend", "average spend (sar)", "avg spend"],
  delivery_sales: ["delivery sales", "delivery sales (sar)"],
  delivery_orders: ["delivery orders"],
  google_review_total: ["total reviews", "total reviews (logbook)"],
  google_average_stars: ["average stars"],
};

const TEXT_SECTION_KEYS = {
  executive_summary: ["executive summary"],
  operational_commentary: ["operational commentary"],
};

export function parseWeeklyDashboardReport(intermediate, context) {
  const matrix = getParserMatrix(intermediate);
  const text = intermediate?.text || "";
  const branchId = resolveBranchFromMatrix(matrix, context.branchId);
  const { periodStart, periodEnd } = resolveDateFromMatrix(
    matrix,
    context.periodStart,
    context.periodEnd,
    text,
  );

  const { values, confidence: labelConfidence } = extractLabelValuePairs(matrix, DASHBOARD_LABELS, {
    minConfidenceKeys: 2,
    text,
  });

  const sectionText = extractSectionText(text);
  const coreMatched = ["total_sales", "guest_count", "average_spend"].filter((key) => values[key] != null).length;
  const rawConfidence = Math.min(
    1,
    labelConfidence * 0.45 + (coreMatched / 3) * 0.35 + (sectionText.executiveSummary.length ? 0.2 : 0),
  );
  const confidenceMeta = explainConfidence(rawConfidence, {
    coreMatched,
    coreRequired: 1,
    warnings: intermediate?.adapterWarnings || [],
  });

  const facts = [];
  const base = {
    fileId: context.fileId,
    branchId,
    brandWide: context.brandWide,
    department: context.department || "operations",
    reportType: "weekly_dashboard",
    sensitivityLevel: context.sensitivityLevel || "management",
    periodStart: periodStart || parseNacDateFromText(text),
    periodEnd: periodEnd || periodStart,
    createdBy: context.createdBy,
    confidence: rawConfidence,
  };

  for (const [key, raw] of Object.entries(values)) {
    const numeric = typeof raw === "number" ? raw : parseNumberSafe(raw);
    if (numeric == null) continue;
    facts.push(
      buildStructuredFact({
        ...base,
        metricKey: key,
        metricValue: numeric,
        grain: "weekly",
      }),
    );
  }

  for (const line of sectionText.executiveSummary.slice(0, 6)) {
    facts.push(
      buildStructuredFact({
        ...base,
        metricKey: "executive_summary_line",
        metricValue: null,
        dimensions: { text_value: line, section: "executive_summary" },
        grain: "line",
      }),
    );
  }

  for (const line of sectionText.operationalCommentary.slice(0, 8)) {
    facts.push(
      buildStructuredFact({
        ...base,
        metricKey: "operational_commentary_line",
        metricValue: null,
        dimensions: { text_value: line, section: "operational_commentary" },
        grain: "line",
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
    sections: ["executive_summary", "sales", "guests", "delivery", "operational_commentary"],
    stats: { coreMatched, factCount: facts.length, sectionLines: sectionText.executiveSummary.length + sectionText.operationalCommentary.length },
    warnings: facts.length === 0 ? ["No weekly dashboard metrics or commentary detected."] : [],
    error: facts.length === 0 ? "Weekly dashboard parser found no structured content." : null,
  };
}

function extractSectionText(text = "") {
  const lines = String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const executiveSummary = [];
  const operationalCommentary = [];
  let mode = null;

  for (const line of lines) {
    const lower = line.toLowerCase();
    if (TEXT_SECTION_KEYS.executive_summary.some((label) => lower === label || lower.startsWith(`${label}`))) {
      mode = "executive";
      continue;
    }
    if (TEXT_SECTION_KEYS.operational_commentary.some((label) => lower === label || lower.startsWith(`${label}`))) {
      mode = "operational";
      continue;
    }
    if (/^(sales performance|guest performance|coverage|delivery|google review|top products|least products)/i.test(lower)) {
      mode = null;
      continue;
    }
    if (mode === "executive" && line.length > 12) executiveSummary.push(line);
    if (mode === "operational" && line.length > 12) operationalCommentary.push(line);
  }

  return { executiveSummary, operationalCommentary };
}

function parseNumberSafe(raw) {
  if (raw == null || raw === "") return null;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  const cleaned = String(raw).replace(/[, SAR]/gi, "").replace(/[^\d.-]/g, "").trim();
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}
