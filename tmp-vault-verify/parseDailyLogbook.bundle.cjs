var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/intelligence/askNac/vault/parsers/parseDailyLogbook.js
var parseDailyLogbook_exports = {};
__export(parseDailyLogbook_exports, {
  parseDailyLogbookReport: () => parseDailyLogbookReport,
  parseDailyLogbookText: () => parseDailyLogbookText,
  parseLogbookLine: () => parseLogbookLine
});
module.exports = __toCommonJS(parseDailyLogbook_exports);

// src/dashboard/utils/branchIdentity.js
var CANONICAL_BRANCH_IDS = ["khobar", "riyadh", "jeddah"];
var ALIAS_RULES = [
  { id: "khobar", test: (s) => /khobar|alkhobar|الخبر/.test(s) },
  { id: "riyadh", test: (s) => /riyadh|رياض/.test(s) },
  { id: "jeddah", test: (s) => /jeddah|jedda|جدة|jiddah/.test(s) }
];
function normalizeBranchId(raw) {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  if (lower === "all") return null;
  if (CANONICAL_BRANCH_IDS.includes(lower)) return lower;
  const stripped = lower.replace(/^nac\s*[-_]?\s*/, "").trim();
  if (CANONICAL_BRANCH_IDS.includes(stripped)) return stripped;
  for (const rule of ALIAS_RULES) {
    if (rule.test(lower) || rule.test(stripped)) return rule.id;
  }
  return null;
}

// src/intelligence/askNac/vault/parsers/vaultParseUtils.js
var CONFIDENCE_PUBLISH_THRESHOLD = 0.55;
var CONFIDENCE_HIGH_THRESHOLD = 0.75;
function normHeader(value) {
  return String(value ?? "").toLowerCase().trim().replace(/\s+/g, " ").replace(/[_-]+/g, " ");
}
function normCell(value) {
  return String(value ?? "").trim();
}
function parseNumber(raw) {
  if (raw == null || raw === "") return null;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  const cleaned = String(raw).replace(/[, SAR sar riyal riyals]/gi, "").replace(/[^\d.-]/g, "").trim();
  if (!cleaned) return null;
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}
function parseIsoDate(raw) {
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
function parseNacDateFromText(text) {
  const blob = String(text || "");
  const isoInline = blob.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (isoInline) return isoInline[1];
  const dmy = blob.match(/\b(\d{1,2})[/.-](\d{1,2})[/.-](20\d{2})\b/);
  if (dmy) return parseIsoDate(`${dmy[1]}/${dmy[2]}/${dmy[3]}`);
  return null;
}
function explainConfidence(confidence, options = {}) {
  const { coreMatched = 0, coreRequired = 1, warnings = [] } = options;
  const baseWarnings = [...warnings];
  if (confidence < CONFIDENCE_PUBLISH_THRESHOLD) {
    return {
      level: "low",
      publish: false,
      needsMapping: true,
      explanation: "Low confidence \u2014 raw extract only. Needs mapping/review.",
      warnings: [...baseWarnings, "Needs mapping/review."]
    };
  }
  if (confidence >= CONFIDENCE_HIGH_THRESHOLD && coreMatched >= coreRequired) {
    return {
      level: "high",
      publish: true,
      needsMapping: false,
      explanation: "High confidence \u2014 structured facts published.",
      warnings: baseWarnings
    };
  }
  return {
    level: "medium",
    publish: true,
    needsMapping: false,
    explanation: "Medium confidence \u2014 facts published with review warnings.",
    warnings: [...baseWarnings, "Some fields missing \u2014 manual review recommended."]
  };
}
function extractInlineMetrics(text, metricPatterns) {
  const blob = String(text || "").toLowerCase();
  const found = {};
  for (const { key, re } of metricPatterns) {
    const match = blob.match(re);
    if (match) found[key] = parseNumber(match[1]);
  }
  return found;
}
function matrixToLines(matrix) {
  const lines = [];
  for (const row of matrix || []) {
    if (!Array.isArray(row)) continue;
    const cells = row.map(normCell).filter(Boolean);
    if (cells.length) lines.push(cells.join(" | "));
  }
  return lines;
}
function matrixToText(matrix) {
  return matrixToLines(matrix).join("\n");
}
function resolveBranchFromMatrix(matrix, fallbackBranch) {
  for (const row of matrix || []) {
    if (!Array.isArray(row) || row.length < 2) continue;
    if (normHeader(row[0]) === "branch" || normHeader(row[0]) === "location") {
      return normalizeBranchId(row[1]) || fallbackBranch;
    }
  }
  return normalizeBranchId(fallbackBranch);
}
function buildStructuredFact({
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
  grain = "daily"
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
    created_by: createdBy
  };
}

// src/intelligence/askNac/vault/parsers/parseDailyLogbook.js
var LOGBOOK_PATTERNS = [
  { key: "branch", re: /^\s*branch\s*[:=-]\s*(.+)$/i },
  { key: "log_date", re: /^\s*(?:day|date)\s*[:=-]\s*(.+)$/i },
  { key: "shift", re: /^\s*shift\s*[:=-]\s*(.+)$/i },
  { key: "lunch_mod", re: /^\s*lunch\s*(?:mod|manager)\s*[:=-]\s*(.+)$/i },
  { key: "dinner_mod", re: /^\s*dinner\s*(?:mod|manager)\s*[:=-]\s*(.+)$/i },
  { key: "mod_on_duty", re: /^\s*(mod|manager on duty)\s*[:=-]\s*(.+)$/i },
  { key: "chef_on_duty", re: /^\s*(chef on duty|head chef|chef)\s*[:=-]\s*(.+)$/i },
  { key: "bar_mod", re: /^\s*(bar mod|bar manager)\s*[:=-]\s*(.+)$/i },
  { key: "operational_highlights", re: /^\s*(operational highlights?|highlights?)\s*[:=-]\s*(.+)$/i },
  { key: "complaints", re: /^\s*complaints?\s*[:=-]\s*(.+)$/i },
  { key: "operational_issues", re: /^\s*(operational issues?|issues?)\s*[:=-]\s*(.+)$/i },
  { key: "staff_performance_notes", re: /^\s*(staff performance(?: notes)?)\s*[:=-]\s*(.+)$/i },
  { key: "training_notes", re: /^\s*(training(?: notes)?)\s*[:=-]\s*(.+)$/i },
  { key: "dinner_notes", re: /^\s*(dinner notes?|dinner service notes?)\s*[:=-]\s*(.+)$/i }
];
var RECEPTION_INLINE = [
  { key: "reservations", re: /reservations?\s*[:=]?\s*([\d,.]+)/i },
  { key: "covers", re: /\bcovers?\s*[:=]?\s*([\d,.]+)/i },
  { key: "walkins", re: /walk[\s-]?ins?\s*[:=]?\s*([\d,.]+)/i },
  { key: "no_shows", re: /no[\s-]?shows?\s*[:=]?\s*([\d,.]+)/i },
  { key: "cancellations", re: /cancellations?\s*[:=]?\s*([\d,.]+)/i }
];
function capturePatternValue(line, pattern) {
  const match = line.match(pattern.re);
  if (!match) return null;
  return normCell(match[2] || match[1]);
}
function extractGoogleReviewCounts(text) {
  const counts = {
    google_review_5: 0,
    google_review_4: 0,
    google_review_3: 0,
    google_review_2: 0,
    google_review_1: 0
  };
  const pairPatterns = [
    /([1-5])[\s-]*star\s*[:=-]?\s*(\d+)/gi,
    /([1-5])\s*-\s*star\s*(\d+)/gi,
    /([1-5])\s*\*\s*[:=-]?\s*(\d+)/gi
  ];
  for (const re of pairPatterns) {
    let m2;
    while ((m2 = re.exec(text)) !== null) {
      counts[`google_review_${m2[1]}`] = Number(m2[2]);
    }
  }
  if (Object.values(counts).some((n) => n > 0)) return counts;
  const starLineRe = /([1-5])\s*(?:star|\*)/gi;
  let m;
  while ((m = starLineRe.exec(text)) !== null) {
    const star = Number(m[1]);
    if (star >= 1 && star <= 5) counts[`google_review_${star}`] += 1;
  }
  return counts;
}
function parseDailyLogbookText(text, context, intermediate = null) {
  const lines = String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const extracted = {};
  for (const line of lines) {
    for (const pattern of LOGBOOK_PATTERNS) {
      if (extracted[pattern.key]) continue;
      const value = capturePatternValue(line, pattern);
      if (value) extracted[pattern.key] = value;
    }
  }
  const receptionInline = extractInlineMetrics(text, RECEPTION_INLINE);
  const branchId = normalizeBranchId(extracted.branch) || resolveBranchFromMatrix(
    lines.map((line) => line.split(/[:=-]/).map((p) => p.trim())),
    context.branchId
  );
  const periodStart = parseIsoDate(extracted.log_date) || parseNacDateFromText(text) || context.periodStart || null;
  const periodEnd = periodStart || context.periodEnd || null;
  const googleCounts = extractGoogleReviewCounts(text);
  const textFieldKeys = [
    "complaints",
    "operational_issues",
    "operational_highlights",
    "staff_performance_notes",
    "training_notes",
    "dinner_notes"
  ];
  const matchedText = textFieldKeys.filter((k) => extracted[k]).length;
  const matchedMeta = [
    "shift",
    "lunch_mod",
    "dinner_mod",
    "mod_on_duty",
    "chef_on_duty",
    "bar_mod",
    "log_date"
  ].filter((k) => extracted[k]).length;
  const receptionMatched = Object.values(receptionInline).filter((v) => v != null).length;
  const googleMatched = Object.values(googleCounts).filter((n) => n > 0).length;
  const rawConfidence = Math.min(
    1,
    matchedText * 0.08 + matchedMeta * 0.06 + receptionMatched * 0.07 + (googleMatched > 0 ? 0.12 : 0)
  );
  const confidenceMeta = explainConfidence(rawConfidence, {
    coreMatched: receptionMatched + matchedMeta,
    coreRequired: 2,
    warnings: intermediate?.adapterWarnings || []
  });
  const facts = [];
  const base = {
    fileId: context.fileId,
    branchId,
    brandWide: context.brandWide,
    department: context.department || "operations",
    reportType: "daily_logbook",
    sensitivityLevel: context.sensitivityLevel,
    periodStart,
    periodEnd,
    createdBy: context.createdBy,
    confidence: rawConfidence
  };
  const snapshotFields = [
    "shift",
    "lunch_mod",
    "dinner_mod",
    "mod_on_duty",
    "chef_on_duty",
    "bar_mod",
    "operational_highlights",
    "complaints",
    "operational_issues",
    "staff_performance_notes",
    "training_notes",
    "dinner_notes"
  ];
  for (const key of snapshotFields) {
    if (!extracted[key]) continue;
    facts.push(
      buildStructuredFact({
        ...base,
        metricKey: key,
        metricValue: null,
        dimensions: { text_value: extracted[key] },
        grain: "snapshot",
        sourceRowRef: `field:${key}`
      })
    );
  }
  for (const [key, metricValue] of Object.entries(receptionInline)) {
    if (metricValue == null) continue;
    facts.push(
      buildStructuredFact({
        ...base,
        metricKey: key,
        metricValue,
        dimensions: { section: "reception" },
        grain: "daily",
        sourceRowRef: "reception_inline"
      })
    );
  }
  for (const [metricKey, metricValue] of Object.entries(googleCounts)) {
    if (!metricValue) continue;
    facts.push(
      buildStructuredFact({
        ...base,
        metricKey,
        metricValue,
        dimensions: { source: "google_reviews" },
        grain: "daily",
        sourceRowRef: "google_reviews"
      })
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
    sections: ["logbook", "reception", "google_reviews"],
    stats: {
      matchedText,
      matchedMeta,
      receptionMatched,
      googleMatched,
      factCount: facts.length,
      parser: "daily_logbook",
      confidenceLevel: confidenceMeta.level
    },
    warnings: confidenceMeta.warnings,
    error: facts.length ? null : "No logbook fields detected in text layout."
  };
}
function parseDailyLogbookReport(intermediate, context) {
  const text = intermediate?.text || matrixToText(intermediate?.matrix || intermediate);
  return parseDailyLogbookText(text, context, intermediate);
}
function parseLogbookLine(line) {
  for (const pattern of LOGBOOK_PATTERNS) {
    const value = capturePatternValue(line, pattern);
    if (value) return { key: pattern.key, value };
  }
  if (normHeader(line).startsWith("branch")) {
    const parts = line.split(/[:=-]/);
    return { key: "branch", value: normCell(parts[1]) };
  }
  return null;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  parseDailyLogbookReport,
  parseDailyLogbookText,
  parseLogbookLine
});
