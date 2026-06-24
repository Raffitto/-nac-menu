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
import { mergeMatrixAndText } from "./vaultIntermediate";
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

const TABULAR_STAFF_LABELS = [
  { re: /^mod\s+restaurant$/i, bucket: "mod_restaurant" },
  { re: /^chef\s+on\s+duty$/i, bucket: "chef_on_duty" },
  { re: /^mod\s+bar$/i, bucket: "mod_bar" },
];

const RECEPTION_SHIFT_ROWS = new Set(["breakfast", "lunch", "dinner", "total"]);

function isTabularStaffLabel(line) {
  const norm = normCell(line).toLowerCase();
  if (!norm) return true;
  if (TABULAR_STAFF_LABELS.some((def) => def.re.test(norm))) return true;
  return /^(lunch|dinner)\s+shift$/i.test(norm) || /^handover\b/i.test(norm) || /^floor$/i.test(norm);
}

function extractMultilineLabelFields(lines) {
  const extracted = {};
  for (let i = 0; i < lines.length; i += 1) {
    const line = normCell(lines[i]);
    if (/^day\s*:?\s*$/i.test(line) && i + 1 < lines.length) {
      extracted.shift = normCell(lines[i + 1]);
      continue;
    }
    if (/^date\s*:?\s*$/i.test(line) && i + 1 < lines.length) {
      extracted.log_date = normCell(lines[i + 1]);
    }
  }
  return extracted;
}

function extractTabularStaffDuty(lines) {
  const collected = { mod_restaurant: [], chef_on_duty: [], mod_bar: [] };
  for (let i = 0; i < lines.length; i += 1) {
    const norm = normCell(lines[i]);
    const def = TABULAR_STAFF_LABELS.find((entry) => entry.re.test(norm));
    if (!def) continue;
    let j = i + 1;
    while (j < lines.length && isTabularStaffLabel(lines[j])) j += 1;
    if (j >= lines.length) continue;
    const name = normCell(lines[j]);
    if (name && !isTabularStaffLabel(name)) collected[def.bucket].push(name);
  }

  const extracted = {};
  if (collected.mod_restaurant[0]) extracted.lunch_mod = collected.mod_restaurant[0];
  if (collected.mod_restaurant[1]) extracted.dinner_mod = collected.mod_restaurant[1];
  if (collected.chef_on_duty.length) extracted.chef_on_duty = collected.chef_on_duty.join(" / ");
  if (collected.mod_bar.length) extracted.bar_mod = collected.mod_bar.join(" / ");
  return extracted;
}

function extractShiftBulletNarratives(lines) {
  const sections = { breakfast: [], lunch: [], dinner: [] };
  let current = null;

  for (const rawLine of lines) {
    const line = normCell(rawLine);
    if (/^breakfast\s*:?\s*$/i.test(line)) {
      current = "breakfast";
      continue;
    }
    if (/^lunch\s*:\s*$/i.test(line)) {
      current = "lunch";
      continue;
    }
    if (/^dinner\s*:?\s*$/i.test(line) && !/^dinner\s+shift$/i.test(line)) {
      current = "dinner";
      continue;
    }
    if (/^reception\b/i.test(line) || /^google\s+review\b/i.test(line)) {
      current = null;
      continue;
    }
    if (!current || !/^\*/.test(String(rawLine || "").trim())) continue;
    sections[current].push(String(rawLine).replace(/^\*\s*/, "").trim());
  }

  const allBullets = [...sections.breakfast, ...sections.lunch, ...sections.dinner];
  const complaintRe = /complain|refused|under\s*cooked|remove from bill|charge|didn'?t like|apologize/i;
  const highlightRe = /smooth|quiet|busy|well|satisfied|inventory was done/i;
  const issueRe = /unavailable|\b86\b/i;

  const extracted = {};
  const complaints = allBullets.filter((bullet) => complaintRe.test(bullet));
  const highlights = allBullets.filter((bullet) => highlightRe.test(bullet) && !complaintRe.test(bullet));
  const issues = allBullets.filter((bullet) => issueRe.test(bullet));
  if (complaints.length) extracted.complaints = complaints.join(" ");
  if (highlights.length) extracted.operational_highlights = highlights.join(" ");
  if (issues.length) extracted.operational_issues = issues.join(" ");
  if (sections.dinner.length) extracted.dinner_notes = sections.dinner.join(" ");
  return extracted;
}

function extractReceptionVerticalMetrics(lines) {
  const metrics = {};
  for (let i = 0; i < lines.length; i += 1) {
    const shift = normCell(lines[i]).toLowerCase();
    if (!RECEPTION_SHIFT_ROWS.has(shift)) continue;
    const nums = [];
    for (let j = 1; j <= 6 && i + j < lines.length; j += 1) {
      const candidate = normCell(lines[i + j]).replace(/,/g, "");
      if (!/^-?\d+(\.\d+)?$/.test(candidate)) break;
      nums.push(Number(candidate));
    }
    if (shift === "total" && nums.length >= 5) {
      metrics.reservations = nums[0];
      metrics.covers = nums[1];
      metrics.walkins = nums[2];
      metrics.no_shows = nums[3];
      metrics.cancellations = nums[4];
    }
  }
  return metrics;
}

function extractGoogleReviewCounts(text, lines = []) {
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

  if (!Object.values(counts).some((n) => n > 0)) {
    for (let i = 0; i < lines.length; i += 1) {
      const inline = lines[i].match(/^([1-5])\s*star\s+(\d+)/i);
      if (inline) {
        counts[`google_review_${inline[1]}`] = Number(inline[2]);
        continue;
      }
      const starOnly = lines[i].match(/^([1-5])\s*star$/i);
      if (!starOnly || i + 1 >= lines.length) continue;
      const next = normCell(lines[i + 1]).replace(/,/g, "");
      if (/^\d+$/.test(next)) counts[`google_review_${starOnly[1]}`] = Number(next);
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

  Object.assign(
    extracted,
    extractMultilineLabelFields(lines),
    extractTabularStaffDuty(lines),
    extractShiftBulletNarratives(lines),
    extractFreeformLogbookSections(text),
  );

  const matrix = mergeMatrixAndText({ lines, matrix: intermediate?.matrix || [] });
  const receptionVertical = extractReceptionVerticalMetrics(lines);
  const receptionInline = {
    ...extractInlineMetrics(text, RECEPTION_INLINE),
    ...receptionVertical,
  };

  const branchId =
    normalizeBranchId(extracted.branch) ||
    resolveBranchFromMatrix(matrix, context.branchId);

  const periodStart =
    parseIsoDate(extracted.log_date) ||
    parseNacDateFromText(text) ||
    parseNacDateFromFilename(logbookFilenameHint(context)) ||
    context.periodStart ||
    null;
  const periodEnd = periodStart || context.periodEnd || context.periodStart || null;

  const googleCounts = extractGoogleReviewCounts(text, lines);
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
