import {
  buildStructuredFact,
  explainConfidence,
  extractInlineMetrics,
  extractLabelValuePairs,
  getParserMatrix,
  resolveBranchFromMatrix,
  resolveDateFromMatrix,
} from "./vaultParseUtils";

const RECEPTION_LABELS = {
  reservations: ["reservations", "reservation count", "total reservations"],
  covers: ["covers", "expected covers", "booked covers"],
  walkins: ["walk ins", "walk-ins", "walkins", "walk in guests", "walk-ins total"],
  no_shows: ["no shows", "no-shows", "noshows", "no show"],
  cancellations: ["cancellations", "cancelled", "canceled"],
  final_covers: ["final covers", "actual covers", "total covers served"],
  shift: ["shift", "service period"],
};

const INLINE_PATTERNS = [
  { key: "reservations", re: /reservations?\s*[:=]?\s*([\d,.]+)/i },
  { key: "covers", re: /\bcovers?\s*[:=]?\s*([\d,.]+)/i },
  { key: "walkins", re: /walk[\s-]?ins?\s*[:=]?\s*([\d,.]+)/i },
  { key: "no_shows", re: /no[\s-]?shows?\s*[:=]?\s*([\d,.]+)/i },
  { key: "cancellations", re: /cancellations?\s*[:=]?\s*([\d,.]+)/i },
];

const CORE_KEYS = ["reservations", "covers", "walkins", "no_shows"];

export function parseReceptionDailyReport(intermediate, context) {
  const matrix = getParserMatrix(intermediate);
  const text = intermediate?.text || "";
  const branchId = resolveBranchFromMatrix(matrix, context.branchId);
  const { periodStart, periodEnd } = resolveDateFromMatrix(
    matrix,
    context.periodStart,
    context.periodEnd,
    text,
  );

  const { values, confidence: labelConfidence } = extractLabelValuePairs(
    matrix,
    RECEPTION_LABELS,
    { minConfidenceKeys: 3, text },
  );

  const inline = extractInlineMetrics(text, INLINE_PATTERNS);
  for (const [key, val] of Object.entries(inline)) {
    if (values[key] == null && val != null) values[key] = val;
  }

  const multiDateFacts = extractReceptionDateColumns(matrix, context, branchId);

  const coreMatched = CORE_KEYS.filter((key) => values[key] != null).length;
  const rawConfidence = Math.min(
    1,
    labelConfidence * 0.55 + (coreMatched / CORE_KEYS.length) * 0.35 + (multiDateFacts.length ? 0.1 : 0),
  );
  const confidenceMeta = explainConfidence(rawConfidence, {
    coreMatched,
    coreRequired: 2,
    warnings: intermediate?.adapterWarnings || [],
  });

  const facts = [...multiDateFacts];
  const base = {
    fileId: context.fileId,
    branchId,
    brandWide: context.brandWide,
    department: context.department || "reception",
    reportType: "reception_daily_report",
    sensitivityLevel: context.sensitivityLevel,
    periodStart,
    periodEnd,
    createdBy: context.createdBy,
    confidence: rawConfidence,
  };

  for (const [key, raw] of Object.entries(values)) {
    if (key.endsWith("__row")) continue;
    const numeric = typeof raw === "number" ? raw : Number(String(raw).replace(/,/g, ""));
    const isShift = key === "shift";
    const metricValue = isShift ? null : Number.isFinite(numeric) ? numeric : null;

    if (!isShift && metricValue == null) continue;

    facts.push(
      buildStructuredFact({
        ...base,
        metricKey: key,
        metricValue,
        dimensions: isShift ? { text_value: String(raw) } : {},
        sourceRowRef: values[`${key}__row`] ? `row:${values[`${key}__row`]}` : null,
        grain: isShift ? "snapshot" : "daily",
      }),
    );
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
      parser: "reception_daily_report",
      confidenceLevel: confidenceMeta.level,
    },
    warnings: confidenceMeta.warnings,
    error: facts.length ? null : "No reception daily metrics found in file layout.",
  };
}

function extractReceptionDateColumns(matrix, context, branchId) {
  const facts = [];
  if (!matrix?.length) return facts;

  const header = matrix.find((row) =>
    Array.isArray(row) && row.filter((c) => /\d{1,2}[\/.\-]\d{1,2}/.test(String(c))).length >= 2,
  );
  if (!header) return facts;

  const dateCols = [];
  header.forEach((cell, idx) => {
    if (idx === 0) return;
    const iso = String(cell).match(/\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}/);
    if (iso) dateCols.push({ idx, label: String(cell) });
  });
  if (!dateCols.length) return facts;

  for (const row of matrix) {
    if (!Array.isArray(row) || row.length < 2) continue;
    const metricKey = String(row[0] || "").toLowerCase();
    if (!metricKey || metricKey.includes("date")) continue;
    for (const col of dateCols) {
      const val = Number(String(row[col.idx]).replace(/,/g, ""));
      if (!Number.isFinite(val)) continue;
      facts.push(
        buildStructuredFact({
          fileId: context.fileId,
          branchId,
          brandWide: context.brandWide,
          department: context.department || "reception",
          reportType: "reception_daily_report",
          sensitivityLevel: context.sensitivityLevel,
          metricKey: metricKey.replace(/\s+/g, "_").slice(0, 40),
          metricValue: val,
          dimensions: { column_date: col.label },
          periodStart: context.periodStart,
          periodEnd: context.periodEnd,
          grain: "daily",
          confidence: context.confidence,
          createdBy: context.createdBy,
        }),
      );
    }
  }

  return facts;
}
