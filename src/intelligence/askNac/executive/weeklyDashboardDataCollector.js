/**
 * Collect all data for weekly dashboard XLSX — priority: facts, coverage, manual, branch, operator memory.
 */

import { branchDisplayName } from "../../../dashboard/utils/rangeState";
import { fetchCashUpRangeAggregationViaRpc } from "../vault/vaultCashUpRangeRpc";
import { getVaultFacts, getVaultCoverage } from "../vault/vaultQueryTools";
import { getFoodicsTopItems } from "../foodics/foodicsQueryTools";
import { getBatchForExportPeriod, getBatchSalesItems } from "../../../lib/foodicsApi";
import { IMPORT_TYPE } from "../../../dashboard/config/foodicsImportTypes";
import { aggregateSalesItemsByName } from "../../../dashboard/engines/executiveExport/salesRollup";
import { fetchBranchMemory } from "./branchMemory";
import { fetchOperatorMemory } from "./operatorMemory";
import { assessPeriodCoverage } from "../coverage/coverageAwareness";
import { resolveAnalyticalConfidence } from "../confidence/analyticalConfidence";

function addDays(iso, days) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function sumGoogleReviewStars(facts = []) {
  const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const fact of facts) {
    const key = fact.metricKey || fact.metric_key;
    const match = String(key || "").match(/^google_review_(\d)$/);
    if (match) counts[Number(match[1])] += Number(fact.metricValue ?? fact.metric_value) || 0;
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const weighted = Object.entries(counts).reduce((acc, [star, n]) => acc + Number(star) * n, 0);
  return {
    counts,
    totalReviews: total,
    averageStars: total > 0 ? Math.round((weighted / total) * 100) / 100 : null,
  };
}

function extractLogbookCommentary(facts = []) {
  return facts
    .filter((f) => f.dimensions?.text_value && String(f.dimensions.text_value).trim().length > 8)
    .slice(0, 8)
    .map((f) => ({
      metricKey: f.metricKey || f.metric_key,
      text: String(f.dimensions.text_value).trim(),
      periodEnd: f.periodEnd || f.period_end,
      source: "ask_nac_structured_facts",
    }));
}

async function loadLeastProducts(supabase, { branch, startDate, endDate, profile, limit = 5 }) {
  const batch = await getBatchForExportPeriod(
    IMPORT_TYPE.WAITER_PRODUCT_SALES,
    branch,
    startDate,
    endDate,
    profile,
  );
  if (!batch?.id) {
    return { items: [], source: null, missing: true };
  }
  const rawItems = await getBatchSalesItems(batch.id);
  const aggregated = aggregateSalesItemsByName(rawItems, { executiveOnly: true });
  const sorted = [...aggregated]
    .filter((row) => (Number(row.net_sales) || 0) > 0 || (Number(row.quantity) || 0) > 0)
    .sort((a, b) => (Number(a.net_sales) || 0) - (Number(b.net_sales) || 0));
  const items = sorted.slice(0, limit).map((row, index) => ({
    rank: index + 1,
    itemName: row.item_name || row.matched_menu_item_name || row.raw_item_name || "Unknown",
    netSales: Math.round((Number(row.net_sales) || 0) * 100) / 100,
    quantity: Number(row.quantity) || 0,
  }));
  return {
    items,
    source: `Foodics import · ${batch.source_file_name || batch.id} · ${batch.period_start} – ${batch.period_end}`,
    missing: false,
    freshness: batch.uploaded_at || batch.created_at || null,
  };
}

function registerSource(registry, entry) {
  registry.push({
    section: entry.section || "",
    metric: entry.metric || "",
    value: entry.value ?? "",
    sourceType: entry.sourceType || "system_data",
    confidence: entry.confidence || "",
    freshness: entry.freshness || "",
    notes: entry.notes || "",
  });
}

export async function collectWeeklyDashboardData(
  supabase,
  {
    branch,
    branchLabel,
    vaultPeriod,
    manualInputs = {},
    profile = null,
  } = {},
) {
  const label = branchLabel || branchDisplayName(branch);
  const startDate = vaultPeriod.startDate;
  const endDate = vaultPeriod.endDate;
  const ninetyStart = addDays(endDate, -89);
  const sourceRegistry = [];

  const [
    weekAggregation,
    ninetyAggregation,
    googleFactsResult,
    logbookFactsResult,
    coverageResult,
    branchMemoryResult,
    operatorMemoryResult,
    topItemsResult,
    leastProductsResult,
  ] = await Promise.all([
    fetchCashUpRangeAggregationViaRpc(supabase, {
      branch,
      startDate,
      endDate,
      includeDailyBreakdown: true,
    }).catch((err) => ({ dayCount: 0, error: err.message, dailyBreakdown: [] })),
    fetchCashUpRangeAggregationViaRpc(supabase, {
      branch,
      startDate: ninetyStart,
      endDate,
      includeDailyBreakdown: true,
    }).catch((err) => ({ dayCount: 0, error: err.message, dailyBreakdown: [] })),
    getVaultFacts(supabase, {
      branch,
      startDate,
      endDate,
      metricKeys: ["google_review_1", "google_review_2", "google_review_3", "google_review_4", "google_review_5"],
    }).catch(() => ({ facts: [] })),
    getVaultFacts(supabase, {
      branch,
      startDate,
      endDate,
      reportType: "daily_logbook",
    }).catch(() => ({ facts: [] })),
    getVaultCoverage(supabase, { branch, startDate, endDate, slim: true }).catch(() => ({ coverage: [] })),
    fetchBranchMemory(supabase, { branch }),
    fetchOperatorMemory(supabase, { branch }),
    getFoodicsTopItems(supabase, {
      branch,
      profile,
      foodicsPeriod: { startDate, endDate, label: vaultPeriod.periodLabel },
      topLimit: 10,
    }).catch(() => ({ topItems: [], missingBatch: true })),
    loadLeastProducts(supabase, { branch, startDate, endDate, profile, limit: 5 }),
  ]);

  const coverageAssessment = assessPeriodCoverage({
    requestedPeriod: { ...vaultPeriod, label: vaultPeriod.periodLabel },
    aggregation: weekAggregation,
  });
  const confidenceResult = resolveAnalyticalConfidence(coverageAssessment);
  const googleReviews = sumGoogleReviewStars(googleFactsResult.facts || []);
  const logbookNotes = extractLogbookCommentary(logbookFactsResult.facts || []);
  const covers = manualInputs.seven_rooms_covers;

  registerSource(sourceRegistry, {
    section: "Sales Performance",
    metric: "Total sales",
    value: weekAggregation.totalSales,
    sourceType: weekAggregation.totalSales != null ? "system_data" : "missing",
    confidence: coverageAssessment.confidence,
    freshness: weekAggregation.salesCoverageEnd || endDate,
    notes: "Vault cash-up structured facts via get_vault_cash_up_range_aggregate",
  });
  registerSource(sourceRegistry, {
    section: "Guest Performance",
    metric: "Cash-up guests",
    value: weekAggregation.totalGuests,
    sourceType: weekAggregation.totalGuests != null ? "system_data" : "missing",
    confidence: coverageAssessment.confidence,
    freshness: weekAggregation.salesCoverageEnd || endDate,
    notes: "Vault cash-up guest_count aggregation",
  });
  registerSource(sourceRegistry, {
    section: "Guest Performance",
    metric: "7Rooms covers",
    value: covers ?? "",
    sourceType: covers != null ? "user_provided" : "missing",
    confidence: covers != null ? "high" : "none",
    freshness: covers != null ? new Date().toISOString().slice(0, 10) : "",
    notes: covers != null ? "ask_nac_manual_inputs · this reporting period only" : "Awaiting operator input",
  });
  registerSource(sourceRegistry, {
    section: "Google Review Performance",
    metric: "Review count (logbook)",
    value: googleReviews.totalReviews,
    sourceType: googleReviews.totalReviews > 0 ? "system_data" : "missing",
    confidence: googleReviews.totalReviews > 0 ? "medium" : "none",
    freshness: endDate,
    notes: "Vault daily_logbook google_review_* structured facts",
  });
  registerSource(sourceRegistry, {
    section: "Top Products",
    metric: "Top 10 items",
    value: topItemsResult.topItems?.length || 0,
    sourceType: topItemsResult.missingBatch ? "missing" : "system_data",
    confidence: topItemsResult.missingBatch ? "none" : "medium",
    freshness: topItemsResult.batch?.uploaded_at || "",
    notes: topItemsResult.batchCoverage || "No Foodics product sales import for this week",
  });
  registerSource(sourceRegistry, {
    section: "Least Products",
    metric: "Bottom 5 items",
    value: leastProductsResult.items?.length || 0,
    sourceType: leastProductsResult.missing ? "missing" : "system_data",
    confidence: leastProductsResult.missing ? "none" : "medium",
    freshness: leastProductsResult.freshness || "",
    notes: leastProductsResult.source || "No Foodics product sales import for this week",
  });

  (branchMemoryResult.memories || []).slice(0, 5).forEach((m) => {
    registerSource(sourceRegistry, {
      section: "Operational Commentary",
      metric: `Branch memory · ${m.category}`,
      value: m.fact,
      sourceType: "branch_memory",
      confidence: "low",
      freshness: "",
      notes: "ask_nac_branch_memory",
    });
  });
  (operatorMemoryResult.memories || []).slice(0, 5).forEach((m) => {
    registerSource(sourceRegistry, {
      section: "Operational Commentary",
      metric: `Operator knowledge · ${m.category}`,
      value: m.fact,
      sourceType: "operator_memory",
      confidence: "medium",
      freshness: m.createdAt || "",
      notes: "ask_nac_operator_memory",
    });
  });

  const deliveryPlatforms = weekAggregation.deliveryPlatformBreakdown || {};
  const platformRows = Object.entries(deliveryPlatforms).map(([platform, stats]) => ({
    platform,
    sales: stats?.sales ?? stats?.totalSales ?? null,
    orders: stats?.orders ?? stats?.totalOrders ?? null,
  }));

  const executiveSummaryLines = [];
  if (weekAggregation.dayCount > 0) {
    executiveSummaryLines.push(
      `${label} uploaded ${weekAggregation.dayCount} cash-up day(s) for ${vaultPeriod.periodLabel}.`,
    );
  } else {
    executiveSummaryLines.push(`Limited vault coverage for ${vaultPeriod.periodLabel} — treat figures as provisional.`);
  }
  if (weekAggregation.totalSales != null) {
    executiveSummaryLines.push(`Total sales: ${Number(weekAggregation.totalSales).toLocaleString()} SAR.`);
  }
  if (covers != null) {
    executiveSummaryLines.push(`7Rooms covers (${covers}) supplied manually for this week.`);
  }
  executiveSummaryLines.push(`Overall confidence: ${confidenceResult.level || coverageAssessment.confidence}.`);

  const operationalCommentary = [
    ...logbookNotes.map((n) => n.text),
    ...(branchMemoryResult.memories || []).slice(0, 3).map((m) => `[Branch · ${m.category}] ${m.fact}`),
    ...(operatorMemoryResult.memories || []).slice(0, 3).map((m) => `[Operator · ${m.category}] ${m.fact}`),
  ];

  return {
    meta: {
      branch,
      branchLabel: label,
      periodLabel: vaultPeriod.periodLabel,
      startDate,
      endDate,
      generatedAt: new Date().toISOString(),
      generatedAtLabel: new Date().toLocaleString("en-GB", { timeZone: "Asia/Riyadh" }),
    },
    weekAggregation,
    ninetyAggregation,
    manualInputs,
    googleReviews,
    topProducts: topItemsResult.topItems || [],
    leastProducts: leastProductsResult.items || [],
    deliveryPlatforms: platformRows,
    logbookNotes,
    coverage: coverageResult.coverage || [],
    coverageAssessment,
    confidenceResult,
    branchMemories: branchMemoryResult.memories || [],
    operatorMemories: operatorMemoryResult.memories || [],
    executiveSummaryLines,
    operationalCommentary,
    sourceRegistry,
    sources: [
      { name: "get_vault_cash_up_range_aggregate", detail: "weekly + 90-day sales aggregation" },
      { name: "ask_nac_structured_facts", detail: "Google reviews + logbook commentary" },
      { name: "ask_nac_data_coverage", detail: "coverage registry" },
      { name: "ask_nac_manual_inputs", detail: "period-specific manual values" },
      { name: "ask_nac_branch_memory", detail: "branch operational context" },
      { name: "ask_nac_operator_memory", detail: "operator-taught knowledge" },
      ...(topItemsResult.sources || []),
    ],
  };
}
