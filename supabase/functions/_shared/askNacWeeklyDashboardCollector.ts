/**
 * Weekly dashboard data collector (Edge) — structured facts, coverage, manual inputs, memories.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { branchDisplayName } from "./askNacFoodicsTools.ts";
import { getFoodicsTopItems, getBatchForExportPeriod, getBatchSalesItems, DEFAULT_IMPORT_TYPE } from "./askNacFoodicsTools.ts";
import { fetchCashUpRangeAggregationViaRpc } from "./askNacCashUpRangeRpc.ts";
import { getVaultFacts, getVaultCoverage } from "./askNacVaultTools.ts";
import { assessPeriodCoverage } from "./coverageAwareness.ts";
import { resolveAnalyticalConfidence } from "./analyticalConfidence.ts";
import { fetchBranchMemory } from "./askNacBranchMemory.ts";
import { fetchOperatorMemory } from "./askNacExecutiveMemory.ts";

function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function sumGoogleReviewStars(facts: { metricKey?: string; metric_key?: string; metricValue?: number; metric_value?: number }[] = []) {
  const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const fact of facts) {
    const key = fact.metricKey || fact.metric_key;
    const match = String(key || "").match(/^google_review_(\d)$/);
    if (match) counts[Number(match[1])] += Number(fact.metricValue ?? fact.metric_value) || 0;
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const weighted = Object.entries(counts).reduce((acc, [star, n]) => acc + Number(star) * n, 0);
  return { counts, totalReviews: total, averageStars: total > 0 ? Math.round((weighted / total) * 100) / 100 : null };
}

function registerSource(registry: Record<string, unknown>[], entry: Record<string, unknown>) {
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
  supabase: SupabaseClient,
  {
    branch,
    branchLabel,
    vaultPeriod,
    manualInputs = {},
    profile = null,
  }: {
    branch: string;
    branchLabel?: string;
    vaultPeriod: { startDate: string; endDate: string; periodLabel: string };
    manualInputs?: Record<string, unknown>;
    profile?: Record<string, unknown> | null;
  },
) {
  const label = branchLabel || branchDisplayName(branch);
  const { startDate, endDate } = vaultPeriod;
  const ninetyStart = addDays(endDate, -89);
  const sourceRegistry: Record<string, unknown>[] = [];

  const [
    weekAggregation,
    ninetyAggregation,
    googleFactsResult,
    logbookFactsResult,
    coverageResult,
    branchMemoryResult,
    operatorMemoryResult,
    topItemsResult,
  ] = await Promise.all([
    fetchCashUpRangeAggregationViaRpc(supabase, { branch, startDate, endDate, includeDailyBreakdown: true }).catch((err) => ({ dayCount: 0, error: err.message, dailyBreakdown: [] })),
    fetchCashUpRangeAggregationViaRpc(supabase, { branch, startDate: ninetyStart, endDate, includeDailyBreakdown: true }).catch((err) => ({ dayCount: 0, error: err.message, dailyBreakdown: [] })),
    getVaultFacts(supabase, { branch, startDate, endDate, metricKeys: ["google_review_1", "google_review_2", "google_review_3", "google_review_4", "google_review_5"] }).catch(() => ({ facts: [] })),
    getVaultFacts(supabase, { branch, startDate, endDate, reportType: "daily_logbook" }).catch(() => ({ facts: [] })),
    getVaultCoverage(supabase, { branch, startDate, endDate, slim: true }).catch(() => ({ coverage: [] })),
    fetchBranchMemory(supabase, { branch }),
    fetchOperatorMemory(supabase, { branch }),
    getFoodicsTopItems(supabase, { branch, profile, foodicsPeriod: { startDate, endDate, label: vaultPeriod.periodLabel }, topLimit: 10 }).catch(() => ({ topItems: [], missingBatch: true })),
  ]);

  let leastProducts: { rank: number; itemName: string; netSales: number; quantity: number }[] = [];
  let leastSource = "";
  let leastMissing = true;
  let leastFreshness = "";
  try {
    const batch = await getBatchForExportPeriod(supabase, DEFAULT_IMPORT_TYPE, branch, startDate, endDate);
    if (batch?.id) {
      const rawItems = await getBatchSalesItems(supabase, batch.id);
      const byName = new Map<string, { net_sales: number; quantity: number; item_name: string }>();
      for (const row of rawItems || []) {
        const name = String(row.matched_menu_item_name || row.raw_item_name || row.item_name || "Unknown").trim();
        const prev = byName.get(name) || { net_sales: 0, quantity: 0, item_name: name };
        prev.net_sales += Number(row.net_sales) || 0;
        prev.quantity += Number(row.quantity_sold ?? row.quantity) || 0;
        byName.set(name, prev);
      }
      leastProducts = [...byName.values()]
        .filter((r) => r.net_sales > 0)
        .sort((a, b) => a.net_sales - b.net_sales)
        .slice(0, 5)
        .map((row, index) => ({
          rank: index + 1,
          itemName: row.item_name,
          netSales: Math.round(row.net_sales * 100) / 100,
          quantity: row.quantity,
        }));
      leastMissing = false;
      leastSource = `Foodics import · ${batch.source_file_name || batch.id}`;
      leastFreshness = batch.uploaded_at || "";
    }
  } catch {
    leastProducts = [];
  }

  const coverageAssessment = assessPeriodCoverage({
    requestedPeriod: { ...vaultPeriod, label: vaultPeriod.periodLabel },
    aggregation: weekAggregation,
  });
  const confidenceResult = resolveAnalyticalConfidence(coverageAssessment);
  const googleReviews = sumGoogleReviewStars((googleFactsResult.facts || []) as { metricKey?: string; metric_key?: string; metricValue?: number; metric_value?: number }[]);
  const covers = manualInputs.seven_rooms_covers;

  registerSource(sourceRegistry, {
    section: "Sales Performance",
    metric: "Total sales",
    value: weekAggregation.totalSales,
    sourceType: weekAggregation.totalSales != null ? "system_data" : "missing",
    confidence: coverageAssessment.confidence,
    freshness: weekAggregation.salesCoverageEnd || endDate,
    notes: "Vault cash-up via get_vault_cash_up_range_aggregate",
  });
  registerSource(sourceRegistry, {
    section: "Guest Performance",
    metric: "7Rooms covers",
    value: covers ?? "",
    sourceType: covers != null ? "user_provided" : "missing",
    confidence: covers != null ? "high" : "none",
    freshness: covers != null ? new Date().toISOString().slice(0, 10) : "",
    notes: "ask_nac_manual_inputs · this reporting period only",
  });
  registerSource(sourceRegistry, {
    section: "Top Products",
    metric: "Top 10 items",
    value: (topItemsResult as { topItems?: unknown[] }).topItems?.length || 0,
    sourceType: (topItemsResult as { missingBatch?: boolean }).missingBatch ? "missing" : "system_data",
    confidence: (topItemsResult as { missingBatch?: boolean }).missingBatch ? "none" : "medium",
    notes: (topItemsResult as { batchCoverage?: string }).batchCoverage || "No Foodics import for this week",
  });
  registerSource(sourceRegistry, {
    section: "Least Products",
    metric: "Bottom 5 items",
    value: leastProducts.length,
    sourceType: leastMissing ? "missing" : "system_data",
    confidence: leastMissing ? "none" : "medium",
    freshness: leastFreshness,
    notes: leastSource || "No Foodics import for this week",
  });

  const logbookNotes = ((logbookFactsResult.facts || []) as { dimensions?: { text_value?: string }; metricKey?: string; metric_key?: string; periodEnd?: string; period_end?: string }[])
    .filter((f) => f.dimensions?.text_value && String(f.dimensions.text_value).trim().length > 8)
    .slice(0, 8)
    .map((f) => String(f.dimensions?.text_value).trim());

  const deliveryPlatforms = Object.entries((weekAggregation.deliveryPlatformBreakdown || {}) as Record<string, { sales?: number; totalSales?: number; orders?: number; totalOrders?: number }>)
    .map(([platform, stats]) => ({
      platform,
      sales: stats?.sales ?? stats?.totalSales ?? null,
      orders: stats?.orders ?? stats?.totalOrders ?? null,
    }));

  const executiveSummaryLines = [];
  if (Number(weekAggregation.dayCount) > 0) {
    executiveSummaryLines.push(`${label} uploaded ${weekAggregation.dayCount} cash-up day(s) for ${vaultPeriod.periodLabel}.`);
  } else {
    executiveSummaryLines.push(`Limited vault coverage for ${vaultPeriod.periodLabel}.`);
  }
  if (weekAggregation.totalSales != null) {
    executiveSummaryLines.push(`Total sales: ${Number(weekAggregation.totalSales).toLocaleString()} SAR.`);
  }
  if (covers != null) executiveSummaryLines.push(`7Rooms covers (${covers}) supplied manually for this week.`);
  executiveSummaryLines.push(`Overall confidence: ${confidenceResult.level || coverageAssessment.confidence}.`);

  const operationalCommentary = [
    ...logbookNotes,
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
    topProducts: (topItemsResult as { topItems?: unknown[] }).topItems || [],
    leastProducts,
    deliveryPlatforms,
    coverage: coverageResult.coverage || [],
    coverageAssessment,
    confidenceResult,
    branchMemories: branchMemoryResult.memories || [],
    operatorMemories: operatorMemoryResult.memories || [],
    executiveSummaryLines,
    operationalCommentary,
    sourceRegistry,
    sources: [
      { name: "get_vault_cash_up_range_aggregate", detail: "weekly + 90-day aggregation" },
      { name: "ask_nac_structured_facts", detail: "Google reviews + logbook" },
      { name: "ask_nac_data_coverage", detail: "coverage registry" },
      { name: "ask_nac_manual_inputs", detail: "period manual values" },
    ],
  };
}
