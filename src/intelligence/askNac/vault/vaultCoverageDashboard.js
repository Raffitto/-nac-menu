/**
 * Data coverage dashboard — branch readiness scores across operational sources.
 */

export const COVERAGE_CATEGORIES = [
  { key: "daily_logbook", label: "Daily Reports", reportTypes: ["daily_logbook"], weight: 1.2 },
  { key: "weekly", label: "Weekly Reports", reportTypes: ["weekly_sales_overview", "gm_report"], weight: 1 },
  { key: "monthly", label: "Monthly Reports", reportTypes: ["pnl", "budget", "forecast"], weight: 1 },
  { key: "foodics", label: "Foodics", reportTypes: ["foodics_export"], weight: 0.8 },
  { key: "reviews", label: "Reviews", reportTypes: ["daily_logbook"], metricKeys: ["google_review_1", "google_review_2", "google_review_3", "google_review_4", "google_review_5"], weight: 0.9 },
  { key: "reception", label: "Reception", reportTypes: ["reception_daily_report"], weight: 1 },
  { key: "audits", label: "Audits", reportTypes: ["ccm_reconciliation", "audit_report"], weight: 0.9 },
  { key: "pnl", label: "P&L", reportTypes: ["pnl"], weight: 1.1 },
  { key: "cash_up", label: "Cash Ups", reportTypes: ["cash_up"], weight: 1 },
];

export const VAULT_BRANCH_IDS = ["khobar", "riyadh", "jeddah"];

function readinessScore(status) {
  if (status === "ready") return 1;
  if (status === "partial") return 0.6;
  if (status === "stale") return 0.3;
  if (status === "registered") return 0.1;
  return 0;
}

function categoryCoverageRows(coverageRows = [], category) {
  return coverageRows.filter((row) => category.reportTypes.includes(row.report_type));
}

export function computeBranchCoverageSummary(coverageRows = [], factsSummary = {}) {
  const byBranch = {};

  for (const branchId of VAULT_BRANCH_IDS) {
    const branchRows = coverageRows.filter((r) => r.branch_id === branchId);
    const categories = COVERAGE_CATEGORIES.map((category) => {
      const rows = categoryCoverageRows(branchRows, category);
      const readyCount = rows.filter((r) => r.readiness_status === "ready").length;
      const partialCount = rows.filter((r) => r.readiness_status === "partial").length;
      const totalFacts = rows.reduce((sum, r) => sum + (r.fact_count || 0), 0);
      const avgReadiness =
        rows.length > 0
          ? rows.reduce((sum, r) => sum + readinessScore(r.readiness_status), 0) / rows.length
          : 0;

      let score = avgReadiness;
      if (category.metricKeys?.length && factsSummary[branchId]) {
        const metricHits = category.metricKeys.filter((k) =>
          (factsSummary[branchId][k] || 0) > 0,
        ).length;
        score = Math.max(score, metricHits / category.metricKeys.length);
      }

      return {
        key: category.key,
        label: category.label,
        fileCount: rows.length,
        readyCount,
        partialCount,
        factCount: totalFacts,
        score: Math.round(score * 100),
        status: score >= 0.75 ? "good" : score >= 0.4 ? "partial" : "missing",
      };
    });

    const weighted =
      categories.reduce((sum, c) => {
        const cat = COVERAGE_CATEGORIES.find((x) => x.key === c.key);
        return sum + c.score * (cat?.weight || 1);
      }, 0) / categories.reduce((sum, c) => sum + (COVERAGE_CATEGORIES.find((x) => x.key === c.key)?.weight || 1), 0);

    byBranch[branchId] = {
      branchId,
      overallScore: Math.round(weighted),
      categories,
      totalFiles: branchRows.length,
      lastIngestedAt: branchRows.reduce((latest, row) => {
        if (!row.last_ingested_at) return latest;
        if (!latest) return row.last_ingested_at;
        return row.last_ingested_at > latest ? row.last_ingested_at : latest;
      }, null),
    };
  }

  return byBranch;
}

export async function fetchCoverageDashboardData(supabase) {
  if (!supabase) return { branches: {}, error: "Supabase not configured" };

  const { data: coverage, error: coverageError } = await supabase
    .from("ask_nac_data_coverage")
    .select("branch_id,report_type,readiness_status,fact_count,last_ingested_at,period_start,period_end")
    .eq("brand_wide", false);

  if (coverageError) {
    return { branches: {}, error: coverageError.message };
  }

  const { data: facts } = await supabase
    .from("ask_nac_structured_facts")
    .select("branch_id,metric_key")
    .in("branch_id", VAULT_BRANCH_IDS);

  const factsSummary = {};
  (facts || []).forEach((row) => {
    if (!factsSummary[row.branch_id]) factsSummary[row.branch_id] = {};
    factsSummary[row.branch_id][row.metric_key] =
      (factsSummary[row.branch_id][row.metric_key] || 0) + 1;
  });

  return {
    branches: computeBranchCoverageSummary(coverage || [], factsSummary),
    error: null,
  };
}
