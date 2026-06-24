/**
 * NAC Master Knowledge Taxonomy — Edge mirror (readiness + report-type mapping).
 */

const REPORT_TYPE_KNOWLEDGE: Record<string, {
  domain: string;
  subdomain: string | null;
  artifactType: string;
  authority: string;
}> = {
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
  food_safety_cleaning: { domain: "food_safety", subdomain: "food_safety.cleaning", artifactType: "checklist", authority: "uploaded_report" },
  food_safety_calibration: { domain: "food_safety", subdomain: "food_safety.calibration", artifactType: "log", authority: "uploaded_report" },
  food_safety_audit: { domain: "food_safety", subdomain: "food_safety.audit", artifactType: "report", authority: "uploaded_report" },
  waste_report: { domain: "operations", subdomain: "waste.spoilage", artifactType: "report", authority: "uploaded_report" },
  waste_recycling: { domain: "operations", subdomain: "waste.recycling", artifactType: "report", authority: "uploaded_report" },
  supplier_evaluation: { domain: "procurement", subdomain: "procurement.supplier", artifactType: "evaluation", authority: "uploaded_report" },
  supplier_invoice: { domain: "procurement", subdomain: "procurement.invoice", artifactType: "invoice", authority: "uploaded_report" },
  recipe: { domain: "culinary", subdomain: "culinary.recipe", artifactType: "recipe", authority: "corporate_manual" },
  food_bible: { domain: "culinary", subdomain: "culinary.food_bible", artifactType: "specification", authority: "corporate_manual" },
  preventive_maintenance: { domain: "asset", subdomain: "asset.maintenance", artifactType: "log", authority: "uploaded_report" },
  training_manual: { domain: "hr", subdomain: "brand.training", artifactType: "training_material", authority: "corporate_manual" },
  corporate_manual: { domain: "brand", subdomain: "brand.manual", artifactType: "policy_manual", authority: "corporate_manual" },
  other: { domain: "unknown", subdomain: null, artifactType: "unknown", authority: "uploaded_report" },
};

const KNOWLEDGE_DOMAIN_READINESS = [
  { domain: "operations", label: "Operations", productionScored: true },
  { domain: "food_safety", label: "Food Safety", productionScored: false },
  { domain: "finance", label: "Finance", productionScored: false },
  { domain: "procurement", label: "Procurement", productionScored: false },
  { domain: "culinary", label: "Culinary", productionScored: false },
  { domain: "brand", label: "Brand", productionScored: false },
];

export function mapReportTypeToKnowledge(reportType = "") {
  const key = String(reportType || "other");
  return REPORT_TYPE_KNOWLEDGE[key] || REPORT_TYPE_KNOWLEDGE.other;
}

export function assessDomainReadinessPlaceholders({ fileInventory = {} }: { fileInventory?: Record<string, number> } = {}) {
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
