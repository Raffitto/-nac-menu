/**
 * Autonomous vault file classification from filename (+ optional content hints).
 */

import { VAULT_REPORT_TYPES } from "./vaultConstants";

const REPORT_PATTERNS = [
  { type: "cash_up", score: 16, patterns: [/\bcash[\s_-]?up\b/i, /\bdaily cash\b/i] },
  { type: "reception_daily_report", score: 16, patterns: [/\breception\b/i, /\bcovers?\b/i, /\breservations?\b/i] },
  { type: "daily_logbook", score: 16, patterns: [/\blogbook\b/i, /\bdaily log\b/i, /\bshift log\b/i] },
  { type: "ccm_reconciliation", score: 15, patterns: [/\bccm\b/i, /\breconcil/i, /\baudit\b/i] },
  { type: "weekly_sales_overview", score: 14, patterns: [/\bweekly sales\b/i, /\bsales overview\b/i] },
  { type: "foodics_export", score: 14, patterns: [/\bfoodics\b/i, /\bwaiter sales\b/i, /\bproduct sales\b/i] },
  { type: "pnl", score: 14, patterns: [/\bp&?l\b/i, /\bprofit and loss\b/i] },
  { type: "budget", score: 13, patterns: [/\bbudget\b/i] },
  { type: "forecast", score: 13, patterns: [/\bforecast\b/i] },
  { type: "gm_report", score: 13, patterns: [/\bgm report\b/i, /\bgeneral manager\b/i] },
  { type: "audit_report", score: 13, patterns: [/\baudit report\b/i, /\boperational audit\b/i] },
  { type: "brand_brain_sop", score: 12, patterns: [/\bsop\b/i, /\bstandard operating\b/i, /\btraining\b/i] },
  { type: "other", score: 1, patterns: [] },
];

const BRANCH_PATTERNS = [
  { id: "khobar", patterns: [/\bkhobar\b/i, /\bnac\b/i, /\bal khobar\b/i] },
  { id: "riyadh", patterns: [/\briyadh\b/i] },
  { id: "jeddah", patterns: [/\bjeddah\b/i, /\bjedda\b/i] },
];

const DEPARTMENT_HINTS = [
  { value: "reception", patterns: [/\breception\b/i, /\breservation\b/i] },
  { value: "operations", patterns: [/\boperations?\b/i, /\blogbook\b/i, /\bshift\b/i] },
  { value: "sales", patterns: [/\bsales\b/i, /\bfoodics\b/i] },
  { value: "cost_control", patterns: [/\bcost control\b/i, /\bccm\b/i] },
  { value: "hr", patterns: [/\bhr\b/i, /\btraining\b/i] },
  { value: "marketing", patterns: [/\bmarketing\b/i, /\bbrand\b/i] },
  { value: "kitchen", patterns: [/\bkitchen\b/i, /\bprep\b/i] },
];

const MONTHS = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};

function isKnownReportType(type) {
  return VAULT_REPORT_TYPES.some((item) => item.value === type) || REPORT_PATTERNS.some((p) => p.type === type);
}

function detectReportType(text) {
  let best = { type: "other", score: 0 };
  for (const rule of REPORT_PATTERNS) {
    if (!rule.patterns.length) continue;
    if (rule.patterns.some((pattern) => pattern.test(text)) && rule.score > best.score) {
      best = { type: rule.type, score: rule.score };
    }
  }
  return best;
}

function detectBranch(text, fallback = null) {
  for (const rule of BRANCH_PATTERNS) {
    if (rule.patterns.some((pattern) => pattern.test(text))) return rule.id;
  }
  return fallback;
}

function detectDepartment(text, reportType) {
  for (const rule of DEPARTMENT_HINTS) {
    if (rule.patterns.some((pattern) => pattern.test(text))) return rule.value;
  }
  if (reportType === "reception_daily_report") return "reception";
  if (reportType === "daily_logbook") return "operations";
  if (reportType === "cash_up") return "operations";
  if (reportType === "ccm_reconciliation" || reportType === "audit_report") return "cost_control";
  if (reportType === "foodics_export" || reportType === "weekly_sales_overview" || reportType === "pnl") {
    return "sales";
  }
  if (reportType === "brand_brain_sop") return "brand";
  return "operations";
}

function detectSensitivity(reportType) {
  if (["pnl", "budget", "forecast", "cash_up"].includes(reportType)) return "finance";
  if (reportType === "brand_brain_sop") return "internal";
  if (["audit_report", "ccm_reconciliation", "gm_report"].includes(reportType)) return "management";
  return "internal";
}

function detectDataLayer(reportType) {
  if (reportType === "brand_brain_sop") return "brand_brain";
  if (reportType === "other") return "unknown";
  return "operational";
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function detectPeriod(text, referenceYear = new Date().getUTCFullYear()) {
  const iso = text.match(/\b(20\d{2})[-_/](\d{1,2})[-_/](\d{1,2})\b/);
  if (iso) {
    const date = `${iso[1]}-${pad2(iso[2])}-${pad2(iso[3])}`;
    return { periodStart: date, periodEnd: date, periodLabel: date };
  }

  const dmy = text.match(/\b(\d{1,2})[-_/](\d{1,2})[-_/](20\d{2})\b/);
  if (dmy) {
    const date = `${dmy[3]}-${pad2(dmy[2])}-${pad2(dmy[1])}`;
    return { periodStart: date, periodEnd: date, periodLabel: date };
  }

  for (const [name, monthNum] of Object.entries(MONTHS)) {
    if (new RegExp(`\\b${name}\\b`, "i").test(text)) {
      const start = `${referenceYear}-${pad2(monthNum)}-01`;
      const endDate = new Date(Date.UTC(referenceYear, monthNum, 0));
      const end = `${referenceYear}-${pad2(monthNum)}-${pad2(endDate.getUTCDate())}`;
      return {
        periodStart: start,
        periodEnd: end,
        periodLabel: `${name.charAt(0).toUpperCase()}${name.slice(1)} ${referenceYear}`,
      };
    }
  }

  if (/\bweekly\b/i.test(text)) {
    return { periodStart: null, periodEnd: null, periodLabel: "Weekly period" };
  }

  return { periodStart: null, periodEnd: null, periodLabel: null };
}

function normalizeConfidence(score, max = 16) {
  return Math.min(0.98, Math.max(0.35, Number((score / max).toFixed(2))));
}

/**
 * @returns {{
 *   detectedReportType: string,
 *   detectedBranch: string|null,
 *   detectedDepartment: string,
 *   detectedSensitivity: string,
 *   detectedDataLayer: string,
 *   detectedPeriod: object,
 *   classificationConfidence: number,
 *   allowManualOverride: true,
 *   matchedRules: string[],
 * }}
 */
export function classifyVaultUpload({
  filename = "",
  contentSnippet = "",
  metadata = {},
} = {}) {
  const text = `${filename} ${contentSnippet}`.trim();
  const manualType = metadata.reportType && metadata.reportType !== "other" ? metadata.reportType : null;
  const detected = detectReportType(text);
  const reportType = manualType || (isKnownReportType(detected.type) ? detected.type : "other");
  const branch = metadata.branch && metadata.branch !== "brand"
    ? metadata.branch
    : detectBranch(text, metadata.branch || null);
  const department = metadata.department || detectDepartment(text, reportType);
  const sensitivity = metadata.sensitivity || detectSensitivity(reportType);
  const dataLayer = metadata.dataLayer || detectDataLayer(reportType);
  const detectedPeriod = detectPeriod(text);
  const periodStart = metadata.periodStart || detectedPeriod.periodStart;
  const periodEnd = metadata.periodEnd || detectedPeriod.periodEnd;
  const periodLabel = metadata.periodLabel || detectedPeriod.periodLabel;
  const confidence = manualType ? 1 : normalizeConfidence(detected.score);

  return {
    detectedReportType: reportType,
    detectedBranch: branch,
    detectedDepartment: department,
    detectedSensitivity: sensitivity,
    detectedDataLayer: dataLayer,
    detectedPeriod: { periodStart, periodEnd, periodLabel },
    classificationConfidence: confidence,
    allowManualOverride: true,
    matchedRules: detected.score > 0 ? [`report:${reportType}`] : [],
  };
}

export function mergeAutoClassification(metadata = {}, classification = {}) {
  const useAuto = metadata.useAutoClassification !== false;
  if (!useAuto) return metadata;

  return {
    ...metadata,
    reportType:
      metadata.manualReportType ||
      (metadata.reportType && metadata.reportType !== "other" ? metadata.reportType : null) ||
      classification.detectedReportType ||
      metadata.reportType,
    branch:
      metadata.manualBranch ||
      metadata.branch ||
      (classification.detectedBranch && classification.detectedBranch !== "brand"
        ? classification.detectedBranch
        : null),
    department: metadata.manualDepartment || classification.detectedDepartment || metadata.department,
    sensitivity: metadata.manualSensitivity || classification.detectedSensitivity || metadata.sensitivity,
    dataLayer: metadata.manualDataLayer || classification.detectedDataLayer || metadata.dataLayer,
    periodStart: metadata.periodStart || classification.detectedPeriod?.periodStart || null,
    periodEnd: metadata.periodEnd || classification.detectedPeriod?.periodEnd || null,
    periodLabel: metadata.periodLabel || classification.detectedPeriod?.periodLabel || null,
    autoClassification: classification,
  };
}
