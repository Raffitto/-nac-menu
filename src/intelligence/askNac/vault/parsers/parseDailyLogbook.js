import {
  buildStructuredFact,
  explainConfidence,
  extractInlineMetrics,
  matrixToText,
  normCell,
  normHeader,
  parseIsoDate,
  parseNacDateFromFilename,
  parseNacDateFromText,
  resolveBranchFromMatrix,
} from "./vaultParseUtils";
import { normalizeBranchId } from "../../../../dashboard/utils/branchIdentity";

const LOGBOOK_PATTERNS = [
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
  { key: "dinner_notes", re: /^\s*(dinner notes?|dinner service notes?)\s*[:=-]\s*(.+)$/i },
];

const FREEFORM_LOGBOOK_SECTIONS = [
  { key: "complaints", re: /\b(?:guest\s+)?complaints?\b\s*[:.-]?\s*([^\n]+)/i },
  { key: "dinner_notes", re: /\bdinner\s+(?:operation|service|notes?)\b\s*[:.-]?\s*([^\n]+)/i },
  { key: "operational_highlights", re: /\boperational\s+(?:highlights?|summary)\b\s*[:.-]?\s*([^\n]+)/i },
  { key: "operational_issues", re: /\boperational\s+issues?\b\s*[:.-]?\s*([^\n]+)/i },
  { key: "training_notes", re: /\btraining(?:\s+notes?)?\b\s*[:.-]?\s*([^\n]+)/i },
];

function extractFreeformLogbookSections(text) {
  const extracted = {};
  for (const section of FREEFORM_LOGBOOK_SECTIONS) {
    const match = String(text || "").match(section.re);
    if (match?.[1]) extracted[section.key] = normCell(match[1]);
  }
  return extracted;
}

function logbookFilenameHint(context = {}) {
  return String(context.originalFilename || context.filename || "").toLowerCase();
}

const RECEPTION_INLINE = [
  { key: "reservations", re: /reservations?\s*[:=]?\s*([\d,.]+)/i },
  { key: "covers", re: /\bcovers?\s*[:=]?\s*([\d,.]+)/i },
  { key: "walkins", re: /walk[\s-]?ins?\s*[:=]?\s*([\d,.]+)/i },
  { key: "no_shows", re: /no[\s-]?shows?\s*[:=]?\s*([\d,.]+)/i },
  { key: "cancellations", re: /cancellations?\s*[:=]?\s*([\d,.]+)/i },
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
    google_review_1: 0,
  };

  const pairPatterns = [
    /([1-5])[\s-]*star\s*[:=-]?\s*(\d+)/gi,
    /([1-5])\s*-\s*star\s*(\d+)/gi,
    /([1-5])\s*\*\s*[:=-]?\s*(\d+)/gi,
  ];
  for (const re of pairPatterns) {
    let m;
    while ((m = re.exec(text)) !== null) {
      counts[`google_review_${m[1]}`] = Number(m[2]);
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

export function parseDailyLogbookText(text, context, intermediate = null) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const extracted = {};
  for (const line of lines) {
    for (const pattern of LOGBOOK_PATTERNS) {
      if (extracted[pattern.key]) continue;
      const value = capturePatternValue(line, pattern);
      if (value) extracted[pattern.key] = value;
    }
  }

  Object.assign(extracted, extractFreeformLogbookSections(text));

  const receptionInline = extractInlineMetrics(text, RECEPTION_INLINE);

  const branchId =
    normalizeBranchId(extracted.branch) ||
    resolveBranchFromMatrix(
      lines.map((line) => line.split(/[:=-]/).map((p) => p.trim())),
      context.branchId,
    );

  const periodStart =
    parseIsoDate(extracted.log_date) ||
    parseNacDateFromText(text) ||
    parseNacDateFromFilename(logbookFilenameHint(context)) ||
    context.periodStart ||
    null;
  const periodEnd = periodStart || context.periodEnd || context.periodStart || null;

  const googleCounts = extractGoogleReviewCounts(text);
  const textFieldKeys = [
    "complaints",
    "operational_issues",
    "operational_highlights",
    "staff_performance_notes",
    "training_notes",
    "dinner_notes",
  ];
  const matchedText = textFieldKeys.filter((k) => extracted[k]).length;
  const matchedMeta = [
    "shift",
    "lunch_mod",
    "dinner_mod",
    "mod_on_duty",
    "chef_on_duty",
    "bar_mod",
    "log_date",
  ].filter((k) => extracted[k]).length;
  const receptionMatched = Object.values(receptionInline).filter((v) => v != null).length;
  const googleMatched = Object.values(googleCounts).filter((n) => n > 0).length;

  let rawConfidence = Math.min(
    1,
    matchedText * 0.08 +
      matchedMeta * 0.06 +
      receptionMatched * 0.07 +
      (googleMatched > 0 ? 0.12 : 0),
  );

  const filenameHint = logbookFilenameHint(context);
  const substantiveText = String(text || "").trim().length;
  const filenameLogbook = /\blogbook\b/i.test(filenameHint);
  if (filenameLogbook && substantiveText >= 120) {
    rawConfidence = Math.max(rawConfidence, 0.62);
  }
  if (context.reportType === "daily_logbook" && branchId && substantiveText >= 80) {
    rawConfidence = Math.max(rawConfidence, 0.58);
  }

  const confidenceMeta = explainConfidence(rawConfidence, {
    coreMatched:
      receptionMatched +
      matchedMeta +
      (filenameLogbook && branchId ? 1 : 0) +
      (periodStart ? 1 : 0),
    coreRequired: 2,
    warnings: intermediate?.adapterWarnings || [],
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
    confidence: rawConfidence,
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
    "dinner_notes",
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
        sourceRowRef: `field:${key}`,
      }),
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
        sourceRowRef: "reception_inline",
      }),
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
        sourceRowRef: "google_reviews",
      }),
    );
  }

  if (periodStart) {
    for (const fact of facts) {
      if (!fact.period_start) fact.period_start = periodStart;
      if (!fact.period_end) fact.period_end = periodEnd || periodStart;
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
    sections: ["logbook", "reception", "google_reviews"],
    stats: {
      matchedText,
      matchedMeta,
      receptionMatched,
      googleMatched,
      factCount: facts.length,
      parser: "daily_logbook",
      confidenceLevel: confidenceMeta.level,
    },
    warnings: confidenceMeta.warnings,
    error: facts.length ? null : "No logbook fields detected in text layout.",
  };
}

export function parseDailyLogbookReport(intermediate, context) {
  const text = intermediate?.text || matrixToText(intermediate?.matrix || intermediate);
  return parseDailyLogbookText(text, context, intermediate);
}

export function parseLogbookLine(line) {
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
