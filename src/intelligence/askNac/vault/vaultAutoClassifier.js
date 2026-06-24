/**
 * Autonomous vault file classification from filename (+ optional content hints).
 */

import { VAULT_REPORT_TYPES } from "./vaultConstants";
import { resolveKnowledgeTaxonomy } from "../knowledge/knowledgeTaxonomy";

const REPORT_PATTERNS = [
  { type: "cash_up", score: 16, patterns: [/\bcash[\s_-]?up\b/i, /\bdaily cash\b/i] },
  { type: "reception_daily_report", score: 16, patterns: [/\breception\b/i, /\bcovers?\b/i, /\breservations?\b/i] },
  { type: "daily_logbook", score: 18, patterns: [/nac[\s_./-]*logbook|logbook[\s_./-]*nac/i] },
  { type: "daily_logbook", score: 16, patterns: [/logbook/i, /\bdaily log\b/i, /\bshift log\b/i] },
  { type: "food_safety_haccp", score: 20, patterns: [/\bhaccp\b/i, /\bhazard analysis\b/i] },
  { type: "food_safety_audit", score: 19, patterns: [/\bfood safety audit\b/i, /\bhygiene audit\b/i] },
  { type: "food_safety_temperature", score: 18, patterns: [/\btemperature log\b/i, /\btemp(?:erature)?\s+monitor/i, /\bcooling log\b/i, /\bholding (?:hot|cold)\b/i] },
  { type: "food_safety_calibration", score: 18, patterns: [/\bthermometer calibration\b/i, /\bcalibration (?:log|record)\b/i] },
  { type: "food_safety_receiving", score: 18, patterns: [/\breceiving checklist\b/i, /\bsupplier vehicle check\b/i, /\bfood sampling\b/i] },
  { type: "food_safety_cleaning", score: 17, patterns: [/\bhood cleaning\b/i, /\boven cleaning\b/i, /\bice machine cleaning\b/i, /\bpersonal hygiene checklist\b/i] },
  { type: "food_safety_incident", score: 17, patterns: [/\bincident report\b/i, /\bfoodborne illness\b/i] },
  { type: "waste_report", score: 16, patterns: [/\bwaste\b/i, /\bspoilage\b/i] },
  { type: "waste_recycling", score: 16, patterns: [/\brecycling\b/i] },
  { type: "supplier_evaluation", score: 16, patterns: [/\bsupplier evaluation\b/i, /\bvendor evaluation\b/i] },
  { type: "supplier_invoice", score: 15, patterns: [/\bsupplier invoice\b/i] },
  { type: "recipe", score: 15, patterns: [/\brecipe\b/i, /\byield sheet\b/i] },
  { type: "food_bible", score: 16, patterns: [/\bfood bible\b/i] },
  { type: "preventive_maintenance", score: 15, patterns: [/\bpreventive maintenance\b/i, /\bmaintenance program\b/i] },
  { type: "ccm_reconciliation", score: 15, patterns: [/\bccm\b/i, /\breconcil/i, /\baudit\b/i] },
  { type: "weekly_sales_overview", score: 14, patterns: [/\bweekly sales\b/i, /\bsales overview\b/i] },
  { type: "weekly_dashboard", score: 16, patterns: [/\bweekly dashboard\b/i, /\bexecutive reports?\b/i, /\bnac[\s-]?weekly[\s-]?dashboard\b/i] },
  { type: "foodics_export", score: 14, patterns: [/\bfoodics\b/i, /\bwaiter sales\b/i, /\bproduct sales\b/i] },
  { type: "pnl", score: 14, patterns: [/\bp&?l\b/i, /\bprofit and loss\b/i] },
  { type: "budget", score: 13, patterns: [/\bbudget\b/i] },
  { type: "forecast", score: 13, patterns: [/\bforecast\b/i] },
  { type: "gm_report", score: 13, patterns: [/\bgm report\b/i, /\bgeneral manager\b/i] },
  { type: "audit_report", score: 13, patterns: [/\baudit report\b/i, /\boperational audit\b/i] },
  { type: "training_manual", score: 14, patterns: [/\binduction handbook\b/i, /\btraining manual\b/i] },
  { type: "marketing_document", score: 14, patterns: [/\bmarketing\b/i, /\bcampaign\b/i, /\bepos\b/i] },
  { type: "corporate_manual", score: 14, patterns: [/\bfranchise manual\b/i, /\bcorporate manual\b/i] },
  { type: "brand_brain_sop", score: 12, patterns: [/\bsop\b/i, /\bstandard operating\b/i, /\bcustomer service\b/i] },
  { type: "job_description", score: 13, patterns: [/\bjob description\b/i] },
  { type: "other", score: 1, patterns: [] },
];

const BRANCH_PATTERNS = [
  { id: "khobar", patterns: [/khobar/i, /\bnac\b/i, /\bal khobar\b/i] },
  { id: "riyadh", patterns: [/riyadh/i] },
  { id: "jeddah", patterns: [/jeddah/i, /\bjedda\b/i] },
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
  if (reportType === "foodics_export" || reportType === "weekly_sales_overview" || reportType === "weekly_dashboard" || reportType === "pnl") {
    return "sales";
  }
  if (reportType === "brand_brain_sop" || String(reportType).startsWith("food_safety_")) return "kitchen";
  if (["recipe", "food_bible", "supplier_evaluation", "supplier_invoice"].includes(reportType)) {
    return reportType.includes("supplier") ? "purchasing" : "kitchen";
  }
  return "operations";
}

function detectSensitivity(reportType) {
  if (["pnl", "budget", "forecast", "cash_up"].includes(reportType)) return "finance";
  if (reportType === "brand_brain_sop") return "internal";
  if (["audit_report", "ccm_reconciliation", "gm_report"].includes(reportType)) return "management";
  return "internal";
}

function detectDataLayer(reportType) {
  if (
    reportType === "brand_brain_sop"
    || String(reportType).startsWith("food_safety_")
    || ["recipe", "food_bible", "corporate_manual", "training_manual", "job_description", "marketing_document"].includes(reportType)
  ) {
    return "brand_brain";
  }
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
    const dayMonth = text.match(
      new RegExp(`(\\d{1,2})[\\s_/-]+${name}(?:[\\s_./-]|$)`, "i"),
    );
    if (dayMonth) {
      const date = `${referenceYear}-${pad2(monthNum)}-${pad2(dayMonth[1])}`;
      return { periodStart: date, periodEnd: date, periodLabel: date };
    }
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
  const taxonomy = resolveKnowledgeTaxonomy({ filename, contentSnippet, reportType });
  const resolvedReportType = (!manualType && taxonomy.detectedReportType && taxonomy.detectedReportType !== "other")
    ? taxonomy.detectedReportType
    : reportType;
  const branch = metadata.branch && metadata.branch !== "brand"
    ? metadata.branch
    : detectBranch(text, metadata.branch || null);
  const department = metadata.department || detectDepartment(text, resolvedReportType);
  const sensitivity = metadata.sensitivity || detectSensitivity(resolvedReportType);
  const dataLayer = metadata.dataLayer || detectDataLayer(resolvedReportType);
  const detectedPeriod = detectPeriod(text);
  const periodStart = metadata.periodStart || detectedPeriod.periodStart;
  const periodEnd = metadata.periodEnd || detectedPeriod.periodEnd;
  const periodLabel = metadata.periodLabel || detectedPeriod.periodLabel;
  const confidence = manualType ? 1 : normalizeConfidence(detected.score);

  return {
    detectedReportType: resolvedReportType,
    detectedBranch: branch,
    detectedDepartment: department,
    detectedSensitivity: sensitivity,
    detectedDataLayer: dataLayer,
    detectedPeriod: { periodStart, periodEnd, periodLabel },
    detectedKnowledgeDomain: taxonomy.knowledgeDomain,
    detectedKnowledgeSubdomain: taxonomy.knowledgeSubdomain,
    detectedArtifactType: taxonomy.artifactType,
    detectedAuthorityLevel: taxonomy.authorityLevel,
    classificationConfidence: confidence,
    allowManualOverride: true,
    matchedRules: [
      ...(detected.score > 0 ? [`report:${resolvedReportType}`] : []),
      ...(taxonomy.matchedKnowledgeRule ? [`knowledge:${taxonomy.matchedKnowledgeRule}`] : []),
    ],
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
    knowledgeDomain: metadata.knowledgeDomain || classification.detectedKnowledgeDomain || null,
    knowledgeSubdomain: metadata.knowledgeSubdomain || classification.detectedKnowledgeSubdomain || null,
    artifactType: metadata.artifactType || classification.detectedArtifactType || null,
    authorityLevel: metadata.authorityLevel || classification.detectedAuthorityLevel || null,
    autoClassification: classification,
  };
}
