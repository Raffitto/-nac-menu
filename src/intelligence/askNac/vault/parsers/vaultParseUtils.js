/** Shared helpers for vault structured report parsers. */

import { normalizeBranchId } from "../../../../dashboard/utils/branchIdentity";
import { mergeMatrixAndText } from "./vaultIntermediate";

export const VAULT_PARSER_VERSION = "vault-prototype-v2";

export const CONFIDENCE_PUBLISH_THRESHOLD = 0.55;
export const CONFIDENCE_HIGH_THRESHOLD = 0.75;

export function normHeader(value) {
  return String(value ?? "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[_-]+/g, " ");
}

export function normCell(value) {
  return String(value ?? "").trim();
}

export function parseNumber(raw) {
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

export function parseIsoDate(raw) {
  const text = normCell(raw);
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;

  const dmy = text.match(/(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
  if (dmy) {
    const day = dmy[1].padStart(2, "0");
    const month = dmy[2].padStart(2, "0");
    return `${dmy[3]}-${month}-${day}`;
  }

  const d = new Date(text);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

export function parseNacDateFromText(text) {
  const blob = String(text || "");
  const isoInline = blob.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (isoInline) return isoInline[1];
  const dmy = blob.match(/\b(\d{1,2})[/.-](\d{1,2})[/.-](20\d{2})\b/);
  if (dmy) return parseIsoDate(`${dmy[1]}/${dmy[2]}/${dmy[3]}`);
  return null;
}

export function explainConfidence(confidence, options = {}) {
  const { coreMatched = 0, coreRequired = 1, warnings = [] } = options;
  const baseWarnings = [...warnings];

  if (confidence < CONFIDENCE_PUBLISH_THRESHOLD) {
    return {
      level: "low",
      publish: false,
      needsMapping: true,
      explanation: "Low confidence — raw extract only. Needs mapping/review.",
      warnings: [...baseWarnings, "Needs mapping/review."],
    };
  }

  if (confidence >= CONFIDENCE_HIGH_THRESHOLD && coreMatched >= coreRequired) {
    return {
      level: "high",
      publish: true,
      needsMapping: false,
      explanation: "High confidence — structured facts published.",
      warnings: baseWarnings,
    };
  }

  return {
    level: "medium",
    publish: true,
    needsMapping: false,
    explanation: "Medium confidence — facts published with review warnings.",
    warnings: [...baseWarnings, "Some fields missing — manual review recommended."],
  };
}

/**
 * Extract inline metrics from prose e.g. "reservations 176, covers 521".
 */
export function extractInlineMetrics(text, metricPatterns) {
  const blob = String(text || "").toLowerCase();
  const found = {};
  for (const { key, re } of metricPatterns) {
    const match = blob.match(re);
    if (match) found[key] = parseNumber(match[1]);
  }
  return found;
}

export function matrixToLines(matrix) {
  const lines = [];
  for (const row of matrix || []) {
    if (!Array.isArray(row)) continue;
    const cells = row.map(normCell).filter(Boolean);
    if (cells.length) lines.push(cells.join(" | "));
  }
  return lines;
}

export function matrixToText(matrix) {
  return matrixToLines(matrix).join("\n");
}

/**
 * Scan a spreadsheet matrix for label/value pairs (col0 label, col1+ value).
 */
export function extractLabelValuePairs(matrix, labelMap, options = {}) {
  const { minConfidenceKeys = 1, text = "" } = options;
  const found = {};
  const normalizedMap = Object.entries(labelMap).map(([key, labels]) => ({
    key,
    labels: labels.map(normHeader),
  }));

  const scanRows = [...(matrix || [])];
  if (text) {
    for (const line of String(text).split(/\r?\n/)) {
      const colon = line.match(/^([^:]{2,60}):\s*(.+)$/);
      if (colon) scanRows.push([colon[1], colon[2]]);
    }
  }

  for (let rowIndex = 0; rowIndex < scanRows.length; rowIndex += 1) {
    const row = scanRows[rowIndex];
    if (!Array.isArray(row) || row.length < 2) continue;

    const label = normHeader(row[0]);
    if (!label) continue;

    const valueCell = row.slice(1).find((cell) => normCell(cell) !== "") ?? row[1];
    const numeric = parseNumber(valueCell);
    const textVal = normCell(valueCell);

    for (const entry of normalizedMap) {
      if (found[entry.key] != null) continue;
      if (entry.labels.some((candidate) => label === candidate || label.includes(candidate))) {
        found[entry.key] = numeric ?? textVal ?? null;
        found[`${entry.key}__row`] = rowIndex + 1;
      }
    }
  }

  const matched = Object.keys(found).filter((k) => !k.endsWith("__row")).length;
  const confidence =
    minConfidenceKeys > 0 ? Math.min(1, matched / minConfidenceKeys) : matched > 0 ? 0.5 : 0;

  return { values: found, matched, confidence };
}

/**
 * Dynamic payment / delivery rows: "Talabat Sales", "Cash", etc.
 */
export function extractPaymentAndDeliveryFacts(matrix, startRow = 0) {
  const facts = [];
  const paymentRe =
    /^(cash|card|credit|visa|master|mada|amex|apple pay|google pay|transfer|bank)\b/i;
  const deliveryRe =
    /^(talabat|hungerstation|jahez|careem|deliveroo|keeta|noon food|ccm)\b/i;

  for (let rowIndex = startRow; rowIndex < (matrix || []).length; rowIndex += 1) {
    const row = matrix[rowIndex];
    if (!Array.isArray(row) || row.length < 2) continue;
    const label = normCell(row[0]);
    if (!label) continue;
    const lower = normHeader(label);
    const value = parseNumber(row[1] ?? row[row.length - 1]);
    if (value == null) continue;

    if (deliveryRe.test(lower)) {
      const platform = lower.split(/\s+/)[0].replace(/\s+/g, "_");
      const isOrders = /order/.test(lower);
      facts.push({
        metric_key: isOrders ? "delivery_orders" : "delivery_sales",
        metric_value: value,
        dimensions: { platform, label },
        source_row_ref: `row:${rowIndex + 1}`,
      });
      if (/ccm/.test(lower) && !isOrders) {
        facts.push({
          metric_key: "ccm_sales",
          metric_value: value,
          dimensions: { label },
          source_row_ref: `row:${rowIndex + 1}`,
        });
      }
      continue;
    }

    if (paymentRe.test(lower) || /payment/.test(lower)) {
      const method = lower.replace(/\s*sales?\s*$/i, "").replace(/\s+/g, "_");
      facts.push({
        metric_key: "payment_method",
        metric_value: value,
        dimensions: { method, label },
        source_row_ref: `row:${rowIndex + 1}`,
      });
    }
  }

  return facts;
}

export function resolveBranchFromMatrix(matrix, fallbackBranch) {
  for (const row of matrix || []) {
    if (!Array.isArray(row) || row.length < 2) continue;
    if (normHeader(row[0]) === "branch" || normHeader(row[0]) === "location") {
      return normalizeBranchId(row[1]) || fallbackBranch;
    }
  }
  return normalizeBranchId(fallbackBranch);
}

export function resolveDateFromMatrix(matrix, fallbackStart, fallbackEnd, text = "") {
  for (const row of matrix || []) {
    if (!Array.isArray(row) || row.length < 2) continue;
    const head = normHeader(row[0]);
    if (head === "date" || head === "business date" || head === "report date" || head === "day") {
      const iso = parseIsoDate(row[1]);
      if (iso) return { periodStart: iso, periodEnd: iso };
    }
  }

  const fromText = parseNacDateFromText(text || matrixToText(matrix));
  if (fromText) return { periodStart: fromText, periodEnd: fromText };

  return {
    periodStart: fallbackStart || null,
    periodEnd: fallbackEnd || fallbackStart || null,
  };
}

export function getParserMatrix(intermediate) {
  if (!intermediate) return [];
  if (Array.isArray(intermediate)) return intermediate;
  return mergeMatrixAndText(intermediate);
}

export function buildStructuredFact({
  fileId,
  branchId,
  brandWide,
  department,
  reportType,
  sensitivityLevel,
  metricKey,
  metricValue,
  metricUnit,
  dimensions,
  periodStart,
  periodEnd,
  sourceRowRef,
  confidence,
  createdBy,
  grain = "daily",
}) {
  return {
    file_id: fileId,
    branch_id: branchId,
    brand_wide: Boolean(brandWide),
    department,
    report_type: reportType,
    sensitivity_level: sensitivityLevel,
    metric_key: metricKey,
    metric_value: metricValue,
    metric_unit: metricUnit || null,
    dimensions: dimensions || {},
    period_start: periodStart,
    period_end: periodEnd,
    grain,
    source_row_ref: sourceRowRef || null,
    confidence,
    created_by: createdBy,
  };
}

export function buildRawExtractFacts(intermediate, context) {
  const text =
    typeof intermediate === "string"
      ? intermediate
      : intermediate?.text || matrixToText(intermediate?.matrix || intermediate);
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 60);
  return [
    buildStructuredFact({
      ...context,
      metricKey: "raw_extract",
      metricValue: null,
      dimensions: { text_value: lines.join("\n"), published: false },
      grain: "snapshot",
      confidence: context.confidence,
    }),
  ];
}
