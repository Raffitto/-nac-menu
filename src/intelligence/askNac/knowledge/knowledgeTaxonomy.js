/**
 * NAC Master Knowledge Taxonomy — domain, subdomain, artifact, authority, metrics.
 */

export const KNOWLEDGE_DOMAINS = Object.freeze([
  "executive",
  "operations",
  "commercial",
  "culinary",
  "procurement",
  "food_safety",
  "hr",
  "asset",
  "brand",
  "competitive",
  "finance",
  "unknown",
]);

export const AUTHORITY_LEVELS = Object.freeze([
  "corporate_manual",
  "signed_policy",
  "job_description",
  "branch_sop",
  "uploaded_report",
  "manager_memory",
  "operator_memory",
  "inferred",
]);

export const ARTIFACT_TYPES = Object.freeze([
  "policy_manual",
  "procedure",
  "checklist",
  "log",
  "report",
  "evaluation",
  "invoice",
  "recipe",
  "specification",
  "training_material",
  "dashboard",
  "memory",
  "unknown",
]);

/** Domains tracked for readiness placeholders (operations scored in production today). */
export const KNOWLEDGE_DOMAIN_READINESS = Object.freeze([
  { domain: "operations", label: "Operations", productionScored: true },
  { domain: "food_safety", label: "Food Safety", productionScored: false },
  { domain: "finance", label: "Finance", productionScored: false },
  { domain: "procurement", label: "Procurement", productionScored: false },
  { domain: "culinary", label: "Culinary", productionScored: false },
  { domain: "brand", label: "Brand", productionScored: false },
]);

export const METRIC_CATALOG = Object.freeze({
  cash_up: [
    "net_sales", "gross_sales", "total_sales", "guest_count", "order_count",
    "avg_per_guest", "cash_sales", "card_sales", "delivery_sales", "delivery_orders",
  ],
  daily_logbook: [
    "complaints", "operational_highlights", "operational_issues", "dinner_notes",
    "training_notes", "staff_performance_notes", "covers", "reservations", "walkins",
    "no_shows", "cancellations", "google_review_1", "google_review_2", "google_review_3",
    "google_review_4", "google_review_5",
  ],
  food_safety: [
    "temperature", "corrective_action", "violation", "audit_score", "expiry_date",
    "calibration_result",
  ],
  waste: ["item", "unit_price", "reason", "employee", "total_loss"],
  procurement: ["supplier", "item", "invoice_number", "unit_price", "quantity"],
});

const REPORT_TYPE_KNOWLEDGE = Object.freeze({
  cash_up: { domain: "operations", subdomain: null, artifactType: "report", authority: "uploaded_report" },
  reception_daily_report: { domain: "operations", subdomain: null, artifactType: "report", authority: "uploaded_report" },
  daily_logbook: { domain: "operations", subdomain: null, artifactType: "report", authority: "uploaded_report" },
  daily_briefing: { domain: "operations", subdomain: null, artifactType: "report", authority: "uploaded_report" },
  ccm_reconciliation: { domain: "operations", subdomain: null, artifactType: "report", authority: "uploaded_report" },
  breakage_report: { domain: "operations", subdomain: "waste.spoilage", artifactType: "report", authority: "uploaded_report" },
  discount_void_comp: { domain: "operations", subdomain: null, artifactType: "report", authority: "uploaded_report" },
  guest_feedback: { domain: "commercial", subdomain: null, artifactType: "report", authority: "uploaded_report" },
  weekly_sales_overview: { domain: "executive", subdomain: null, artifactType: "dashboard", authority: "uploaded_report" },
  weekly_dashboard: { domain: "executive", subdomain: null, artifactType: "dashboard", authority: "uploaded_report" },
  foodics_export: { domain: "commercial", subdomain: null, artifactType: "report", authority: "uploaded_report" },
  pnl: { domain: "finance", subdomain: null, artifactType: "report", authority: "uploaded_report" },
  budget: { domain: "finance", subdomain: null, artifactType: "report", authority: "uploaded_report" },
  forecast: { domain: "finance", subdomain: null, artifactType: "report", authority: "uploaded_report" },
  gm_report: { domain: "executive", subdomain: null, artifactType: "report", authority: "uploaded_report" },
  audit_report: { domain: "food_safety", subdomain: "food_safety.audit", artifactType: "report", authority: "uploaded_report" },
  brand_brain_sop: { domain: "brand", subdomain: "brand.sop", artifactType: "procedure", authority: "branch_sop" },
  food_safety_haccp: { domain: "food_safety", subdomain: "food_safety.haccp", artifactType: "policy_manual", authority: "corporate_manual" },
  food_safety_temperature: { domain: "food_safety", subdomain: "food_safety.temperature", artifactType: "log", authority: "uploaded_report" },
  food_safety_receiving: { domain: "food_safety", subdomain: "food_safety.receiving", artifactType: "checklist", authority: "uploaded_report" },
  food_safety_storage: { domain: "food_safety", subdomain: "food_safety.storage", artifactType: "procedure", authority: "branch_sop" },
  food_safety_cleaning: { domain: "food_safety", subdomain: "food_safety.cleaning", artifactType: "checklist", authority: "uploaded_report" },
  food_safety_calibration: { domain: "food_safety", subdomain: "food_safety.calibration", artifactType: "log", authority: "uploaded_report" },
  food_safety_audit: { domain: "food_safety", subdomain: "food_safety.audit", artifactType: "report", authority: "uploaded_report" },
  food_safety_incident: { domain: "food_safety", subdomain: "food_safety.incident", artifactType: "report", authority: "uploaded_report" },
  waste_report: { domain: "operations", subdomain: "waste.spoilage", artifactType: "report", authority: "uploaded_report" },
  waste_recycling: { domain: "operations", subdomain: "waste.recycling", artifactType: "report", authority: "uploaded_report" },
  supplier_evaluation: { domain: "procurement", subdomain: "procurement.supplier", artifactType: "evaluation", authority: "uploaded_report" },
  supplier_invoice: { domain: "procurement", subdomain: "procurement.invoice", artifactType: "invoice", authority: "uploaded_report" },
  purchase_order: { domain: "procurement", subdomain: "procurement.purchase_order", artifactType: "report", authority: "uploaded_report" },
  recipe: { domain: "culinary", subdomain: "culinary.recipe", artifactType: "recipe", authority: "corporate_manual" },
  food_bible: { domain: "culinary", subdomain: "culinary.food_bible", artifactType: "specification", authority: "corporate_manual" },
  yield_sheet: { domain: "culinary", subdomain: "culinary.yield", artifactType: "specification", authority: "corporate_manual" },
  preventive_maintenance: { domain: "asset", subdomain: "asset.maintenance", artifactType: "log", authority: "uploaded_report" },
  training_manual: { domain: "hr", subdomain: "brand.training", artifactType: "training_material", authority: "corporate_manual" },
  job_description: { domain: "hr", subdomain: "hr.job_description", artifactType: "policy_manual", authority: "job_description" },
  marketing_document: { domain: "commercial", subdomain: "commercial.campaign", artifactType: "report", authority: "uploaded_report" },
  corporate_manual: { domain: "brand", subdomain: "brand.manual", artifactType: "policy_manual", authority: "corporate_manual" },
  other: { domain: "unknown", subdomain: null, artifactType: "unknown", authority: "uploaded_report" },
});

const CONTENT_CLASSIFICATION_RULES = [
  { reportType: "food_safety_haccp", domain: "food_safety", subdomain: "food_safety.haccp", artifactType: "policy_manual", authority: "corporate_manual", score: 20, patterns: [/\bhaccp\b/i, /\bhazard analysis\b/i] },
  { reportType: "food_safety_audit", domain: "food_safety", subdomain: "food_safety.audit", artifactType: "report", authority: "uploaded_report", score: 19, patterns: [/\bfood safety audit\b/i, /\bhygiene audit\b/i, /\bsafety audit\b/i] },
  { reportType: "food_safety_temperature", domain: "food_safety", subdomain: "food_safety.temperature", artifactType: "log", authority: "uploaded_report", score: 18, patterns: [/\btemperature log\b/i, /\btemp(?:erature)?\s+monitor/i, /\bholding hot\b/i, /\bholding cold\b/i, /\bcooling log\b/i, /\bdefrost/i, /\bph monitor/i] },
  { reportType: "food_safety_calibration", domain: "food_safety", subdomain: "food_safety.calibration", artifactType: "log", authority: "uploaded_report", score: 18, patterns: [/\bthermometer calibration\b/i, /\bcalibration log\b/i, /\bcalibration record\b/i] },
  { reportType: "food_safety_receiving", domain: "food_safety", subdomain: "food_safety.receiving", artifactType: "checklist", authority: "uploaded_report", score: 18, patterns: [/\breceiving checklist\b/i, /\breceiving log\b/i, /\bsupplier vehicle check\b/i, /\bfood sampling\b/i] },
  { reportType: "food_safety_storage", domain: "food_safety", subdomain: "food_safety.storage", artifactType: "procedure", authority: "branch_sop", score: 17, patterns: [/\bstorage procedure\b/i, /\bstorage sop\b/i, /\bfifo\b/i] },
  { reportType: "food_safety_cleaning", domain: "food_safety", subdomain: "food_safety.cleaning", artifactType: "checklist", authority: "uploaded_report", score: 17, patterns: [/\bhood cleaning\b/i, /\boven cleaning\b/i, /\bice machine cleaning\b/i, /\bequipment cleaning\b/i, /\bpersonal hygiene checklist\b/i] },
  { reportType: "food_safety_incident", domain: "food_safety", subdomain: "food_safety.incident", artifactType: "report", authority: "uploaded_report", score: 17, patterns: [/\bincident report\b/i, /\baccident report\b/i, /\bfoodborne illness\b/i, /\ballergen\b/i, /\btraceability\b/i, /\brecall\b/i] },
  { reportType: "waste_recycling", domain: "operations", subdomain: "waste.recycling", artifactType: "report", authority: "uploaded_report", score: 16, patterns: [/\brecycling\b/i] },
  { reportType: "waste_report", domain: "operations", subdomain: "waste.spoilage", artifactType: "report", authority: "uploaded_report", score: 16, patterns: [/\bwaste\b/i, /\bspoilage\b/i, /\bshrinkage\b/i] },
  { reportType: "supplier_evaluation", domain: "procurement", subdomain: "procurement.supplier", artifactType: "evaluation", authority: "uploaded_report", score: 16, patterns: [/\bsupplier evaluation\b/i, /\bsupplier assessment\b/i, /\bvendor evaluation\b/i] },
  { reportType: "supplier_invoice", domain: "procurement", subdomain: "procurement.invoice", artifactType: "invoice", authority: "uploaded_report", score: 16, patterns: [/\bsupplier invoice\b/i, /\bpurchase invoice\b/i, /\binvoice\b/i] },
  { reportType: "purchase_order", domain: "procurement", subdomain: "procurement.purchase_order", artifactType: "report", authority: "uploaded_report", score: 15, patterns: [/\bpurchase order\b/i, /\bpo\b/i] },
  { reportType: "recipe", domain: "culinary", subdomain: "culinary.recipe", artifactType: "recipe", authority: "corporate_manual", score: 15, patterns: [/\brecipe\b/i, /\byield sheet\b/i] },
  { reportType: "food_bible", domain: "culinary", subdomain: "culinary.food_bible", artifactType: "specification", authority: "corporate_manual", score: 16, patterns: [/\bfood bible\b/i] },
  { reportType: "preventive_maintenance", domain: "asset", subdomain: "asset.maintenance", artifactType: "log", authority: "uploaded_report", score: 15, patterns: [/\bpreventive maintenance\b/i, /\bmaintenance program\b/i, /\bpm schedule\b/i] },
  { reportType: "training_manual", domain: "hr", subdomain: "brand.training", artifactType: "training_material", authority: "corporate_manual", score: 14, patterns: [/\binduction handbook\b/i, /\btraining manual\b/i, /\bonboarding\b/i] },
  { reportType: "marketing_document", domain: "commercial", subdomain: "commercial.campaign", artifactType: "report", authority: "uploaded_report", score: 14, patterns: [/\bmarketing\b/i, /\bcampaign\b/i, /\bepos\b/i, /\bpos software\b/i] },
  { reportType: "corporate_manual", domain: "brand", subdomain: "brand.manual", artifactType: "policy_manual", authority: "corporate_manual", score: 14, patterns: [/\bfranchise manual\b/i, /\bcorporate manual\b/i, /\boperations manual\b/i] },
  { reportType: "brand_brain_sop", domain: "brand", subdomain: "brand.sop", artifactType: "procedure", authority: "branch_sop", score: 13, patterns: [/\bsop\b/i, /\bstandard operating\b/i, /\bcustomer service\b/i, /\bmanual\b/i] },
  { reportType: "job_description", domain: "hr", subdomain: "hr.job_description", artifactType: "policy_manual", authority: "job_description", score: 13, patterns: [/\bjob description\b/i, /\bjd\b/i] },
];

export function mapReportTypeToKnowledge(reportType = "") {
  const key = String(reportType || "other");
  return REPORT_TYPE_KNOWLEDGE[key] || REPORT_TYPE_KNOWLEDGE.other;
}

export function classifyKnowledgeFromContent(text = "", reportType = "other") {
  const normalized = String(text || "").trim();
  let best = null;

  for (const rule of CONTENT_CLASSIFICATION_RULES) {
    if (!rule.patterns.some((pattern) => pattern.test(normalized))) continue;
    if (!best || rule.score > best.score) best = rule;
  }

  if (best) {
    return {
      knowledgeDomain: best.domain,
      knowledgeSubdomain: best.subdomain,
      artifactType: best.artifactType,
      authorityLevel: best.authority,
      detectedReportType: best.reportType,
      matchedKnowledgeRule: best.subdomain || best.reportType,
    };
  }

  const mapped = mapReportTypeToKnowledge(reportType);
  return {
    knowledgeDomain: mapped.domain,
    knowledgeSubdomain: mapped.subdomain,
    artifactType: mapped.artifactType,
    authorityLevel: mapped.authority,
    detectedReportType: reportType,
    matchedKnowledgeRule: mapped.subdomain || mapped.domain,
  };
}

export function resolveKnowledgeTaxonomy({ filename = "", contentSnippet = "", reportType = "other" } = {}) {
  const text = `${filename} ${contentSnippet}`.trim();
  const contentMatch = classifyKnowledgeFromContent(text, reportType);
  const reportMapped = mapReportTypeToKnowledge(reportType);

  if (contentMatch.detectedReportType !== reportType && contentMatch.matchedKnowledgeRule) {
    return contentMatch;
  }

  if (reportMapped.domain !== "unknown" && contentMatch.knowledgeDomain === "unknown") {
    return {
      knowledgeDomain: reportMapped.domain,
      knowledgeSubdomain: reportMapped.subdomain,
      artifactType: reportMapped.artifactType,
      authorityLevel: reportMapped.authority,
      detectedReportType: reportType,
      matchedKnowledgeRule: reportMapped.subdomain || reportMapped.domain,
    };
  }

  return contentMatch;
}

export function assessDomainReadinessPlaceholders({ fileInventory = {} } = {}) {
  return KNOWLEDGE_DOMAIN_READINESS.map((entry) => {
    if (entry.productionScored) {
      return {
        ...entry,
        status: "production_scored",
        score: null,
        detail: "Scored via operational coverage (cash-up, logbook, reception, briefing).",
      };
    }
    const storedCount = Object.entries(fileInventory).reduce((sum, [type, count]) => {
      const mapped = mapReportTypeToKnowledge(type);
      return mapped.domain === entry.domain ? sum + Number(count || 0) : sum;
    }, 0);
    return {
      ...entry,
      status: storedCount > 0 ? "stored_only" : "not_yet_parseable",
      score: null,
      detail: storedCount > 0
        ? `${storedCount} file(s) registered — taxonomy classified, structured parsing not production-ready.`
        : "Not yet parseable / stored only — awaiting domain parsers.",
      storedFileCount: storedCount,
    };
  });
}

export const STORED_KNOWLEDGE_REPORT_TYPES = Object.freeze(
  Object.keys(REPORT_TYPE_KNOWLEDGE).filter((key) => ![
    "cash_up", "reception_daily_report", "daily_logbook", "daily_briefing",
    "ccm_reconciliation", "breakage_report", "discount_void_comp", "guest_feedback",
    "weekly_sales_overview", "weekly_dashboard", "pnl",
  ].includes(key)),
);
