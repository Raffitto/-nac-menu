/**
 * Read-only Foodics query tools for Ask NAC — existing schema only.
 */

import {
  getBatchForExportPeriod,
  getBatchSalesItems,
  getImportBatches,
} from "../../../lib/foodicsApi";
import { IMPORT_TYPE } from "../../../dashboard/config/foodicsImportTypes";
import { resolveRbacQueryBranch } from "../../../lib/rbacQueryScope";
import { branchDisplayName } from "../../../dashboard/utils/rangeState";
import { aggregateSalesItemsByName } from "../../../dashboard/engines/executiveExport/salesRollup";
import {
  parseFoodicsComparePeriods,
  parseFoodicsPeriodFromQuestion,
} from "./foodicsPeriodParser";

const DEFAULT_IMPORT_TYPE = IMPORT_TYPE.WAITER_PRODUCT_SALES;

function resolveBranch(context = {}) {
  return resolveRbacQueryBranch(context.profile, context.branchMention || context.filters?.branch);
}

function itemDisplayName(row) {
  return (row.matched_menu_item_name || row.raw_item_name || "Unknown").trim();
}

function rankItems(items, rankingBasis = "net_sales", limit = 10) {
  const key = rankingBasis === "quantity" ? "quantity" : "net_sales";
  return [...items]
    .sort((a, b) => (Number(b[key]) || 0) - (Number(a[key]) || 0))
    .slice(0, limit)
    .map((row, index) => ({
      rank: index + 1,
      itemName: row.item_name || itemDisplayName(row),
      netSales: Math.round((Number(row.net_sales) || 0) * 100) / 100,
      quantity: Number(row.quantity) || 0,
      category: row.category || row.analytics_category || null,
    }));
}

function sumTotals(items = []) {
  return items.reduce(
    (acc, row) => ({
      netSales: acc.netSales + (Number(row.net_sales ?? row.netSales) || 0),
      grossSales: acc.grossSales + (Number(row.gross_sales ?? row.grossSales) || 0),
      quantity: acc.quantity + (Number(row.quantity_sold ?? row.quantity) || 0),
    }),
    { netSales: 0, grossSales: 0, quantity: 0 },
  );
}

function batchCoverageNote(batch) {
  if (!batch) return null;
  return `Foodics import ${batch.source_file_name || batch.id} · ${batch.period_start} to ${batch.period_end} · ${branchDisplayName(batch.branch_id)}`;
}

async function loadBatchWithItems(supabase, { branch, startDate, endDate, profile }) {
  const batch = await getBatchForExportPeriod(
    DEFAULT_IMPORT_TYPE,
    branch,
    startDate,
    endDate,
    profile,
  );
  if (!batch?.id) {
    return { batch: null, items: [], aggregated: [] };
  }
  const rawItems = await getBatchSalesItems(batch.id);
  const aggregated = aggregateSalesItemsByName(rawItems, { executiveOnly: true });
  return { batch, items: rawItems, aggregated };
}

function buildFoodicsToolBase({ batch, branch, period, rankingBasis, limit }) {
  const branchLabel = branch ? branchDisplayName(branch) : branchDisplayName(batch?.branch_id) || "Branch";
  return {
    branch,
    branchLabel,
    periodLabel: period?.label || `${period?.startDate} – ${period?.endDate}`,
    startDate: period?.startDate,
    endDate: period?.endDate,
    rankingBasis,
    limit,
    batch: batch
      ? {
          id: batch.id,
          branch_id: batch.branch_id,
          period_start: batch.period_start,
          period_end: batch.period_end,
          source_file_name: batch.source_file_name,
          uploaded_at: batch.uploaded_at,
        }
      : null,
    batchCoverage: batchCoverageNote(batch),
    sources: batch
      ? [{ name: "foodics_sales_items", detail: batchCoverageNote(batch) }]
      : [],
    warnings: [],
  };
}

export async function getFoodicsSalesSummary(supabase, context = {}) {
  const branch = resolveBranch(context);
  const period =
    context.foodicsPeriod ||
    parseFoodicsPeriodFromQuestion(context.question || "") ||
    null;

  if (!period?.startDate || !period?.endDate) {
    return {
      ...buildFoodicsToolBase({ batch: null, branch, period, rankingBasis: "net_sales", limit: 0 }),
      missingPeriod: true,
    };
  }

  const { batch, aggregated } = await loadBatchWithItems(supabase, {
    branch,
    startDate: period.startDate,
    endDate: period.endDate,
    profile: context.profile,
  });

  const base = buildFoodicsToolBase({
    batch,
    branch,
    period,
    rankingBasis: "net_sales",
    limit: 0,
  });

  if (!batch) {
    return {
      ...base,
      missingBatch: true,
      period,
    };
  }

  const totals = sumTotals(aggregated);

  return {
    ...base,
    totals: {
      netSales: Math.round(totals.netSales * 100) / 100,
      grossSales: Math.round(totals.grossSales * 100) / 100,
      quantity: totals.quantity,
    },
    itemCount: aggregated.length,
  };
}

export async function getFoodicsTopItems(supabase, context = {}) {
  const branch = resolveBranch(context);
  const period =
    context.foodicsPeriod ||
    parseFoodicsPeriodFromQuestion(context.question || "") ||
    null;
  const rankingBasis = context.rankingBasis || "net_sales";
  const limit = context.topLimit || 10;

  if (!period?.startDate) {
    return { ...buildFoodicsToolBase({ batch: null, branch, period, rankingBasis, limit }), missingPeriod: true };
  }

  const { batch, aggregated } = await loadBatchWithItems(supabase, {
    branch,
    startDate: period.startDate,
    endDate: period.endDate,
    profile: context.profile,
  });

  const base = buildFoodicsToolBase({ batch, branch, period, rankingBasis, limit });

  if (!batch) {
    return { ...base, missingBatch: true, period, topItems: [] };
  }

  return {
    ...base,
    topItems: rankItems(aggregated, rankingBasis, limit),
    rankingLabel: rankingBasis === "quantity" ? "quantity sold" : "net sales",
  };
}

export async function compareFoodicsTopItems(supabase, context = {}) {
  const branch = resolveBranch(context);
  const compare =
    context.foodicsCompare ||
    parseFoodicsComparePeriods(context.question || "");
  const rankingBasis = context.rankingBasis || "net_sales";
  const limit = context.topLimit || 10;

  const [currentRes, previousRes] = await Promise.all([
    loadBatchWithItems(supabase, {
      branch,
      startDate: compare.current.startDate,
      endDate: compare.current.endDate,
      profile: context.profile,
    }),
    loadBatchWithItems(supabase, {
      branch,
      startDate: compare.previous.startDate,
      endDate: compare.previous.endDate,
      profile: context.profile,
    }),
  ]);

  const base = buildFoodicsToolBase({
    batch: currentRes.batch,
    branch,
    period: compare.current,
    rankingBasis,
    limit,
  });

  if (!currentRes.batch || !previousRes.batch) {
    return {
      ...base,
      missingBatch: true,
      compare,
      currentBatch: currentRes.batch,
      previousBatch: previousRes.batch,
      topItems: [],
    };
  }

  const currentTop = rankItems(currentRes.aggregated, rankingBasis, limit);
  const previousTop = rankItems(previousRes.aggregated, rankingBasis, limit);
  const currentNames = new Set(currentTop.map((r) => r.itemName.toLowerCase()));
  const previousNames = new Set(previousTop.map((r) => r.itemName.toLowerCase()));

  const entered = currentTop.filter((r) => !previousNames.has(r.itemName.toLowerCase()));
  const dropped = previousTop.filter((r) => !currentNames.has(r.itemName.toLowerCase()));

  return {
    ...base,
    compare,
    currentTop,
    previousTop,
    entered,
    dropped,
    previousBatchCoverage: batchCoverageNote(previousRes.batch),
    sources: [
      { name: "foodics_sales_items", detail: batchCoverageNote(currentRes.batch) },
      { name: "foodics_sales_items", detail: batchCoverageNote(previousRes.batch) },
    ],
  };
}

export async function getFoodicsCategorySales(supabase, context = {}) {
  const branch = resolveBranch(context);
  const period =
    context.foodicsPeriod ||
    parseFoodicsPeriodFromQuestion(context.question || "") ||
    null;

  if (!period?.startDate) {
    return { ...buildFoodicsToolBase({ batch: null, branch, period, rankingBasis: "net_sales", limit: 10 }), missingPeriod: true };
  }

  const { batch } = await loadBatchWithItems(supabase, {
    branch,
    startDate: period.startDate,
    endDate: period.endDate,
    profile: context.profile,
  });

  const base = buildFoodicsToolBase({ batch, branch, period, rankingBasis: "net_sales", limit: 10 });

  if (!batch) {
    return { ...base, missingBatch: true, categories: [] };
  }

  const rawItems = await getBatchSalesItems(batch.id);
  const catMap = new Map();
  for (const row of rawItems) {
    const cat = String(row.analytics_category || row.category || "Uncategorized").trim() || "Uncategorized";
    if (!catMap.has(cat)) catMap.set(cat, { category: cat, netSales: 0, quantity: 0 });
    const entry = catMap.get(cat);
    entry.netSales += Number(row.net_sales) || 0;
    entry.quantity += Number(row.quantity_sold) || 0;
  }

  const categories = [...catMap.values()]
    .sort((a, b) => b.netSales - a.netSales)
    .map((c) => ({
      category: c.category,
      netSales: Math.round(c.netSales * 100) / 100,
      quantity: c.quantity,
    }));

  return {
    ...base,
    categories,
    topCategory: categories[0] || null,
  };
}

/** Branch-level totals when multiple branch batches overlap a period label. */
export async function getFoodicsBranchSalesComparison(supabase, context = {}) {
  const period =
    context.foodicsPeriod ||
    parseFoodicsPeriodFromQuestion(context.question || "") ||
    null;

  if (!period?.startDate) {
    return { missingPeriod: true, branches: [] };
  }

  const batches = await getImportBatches(50, DEFAULT_IMPORT_TYPE, context.profile);
  const matching = (batches || []).filter(
    (b) => b.period_start <= period.endDate && b.period_end >= period.startDate,
  );

  const branches = [];
  for (const batch of matching) {
    const items = await getBatchSalesItems(batch.id);
    const aggregated = aggregateSalesItemsByName(items, { executiveOnly: true });
    const totals = sumTotals(aggregated);
    branches.push({
      branch_id: batch.branch_id,
      branchLabel: branchDisplayName(batch.branch_id),
      netSales: Math.round(totals.netSales * 100) / 100,
      quantity: totals.quantity,
      batchCoverage: batchCoverageNote(batch),
    });
  }

  branches.sort((a, b) => b.netSales - a.netSales);

  return {
    periodLabel: period.label,
    startDate: period.startDate,
    endDate: period.endDate,
    branches,
    sources: branches.map((b) => ({ name: "foodics_import_batches", detail: b.batchCoverage })),
  };
}

export async function probeFoodicsBatchForPeriod(supabase, { branch, startDate, endDate, profile }) {
  if (!startDate || !endDate) return null;
  return getBatchForExportPeriod(DEFAULT_IMPORT_TYPE, branch, startDate, endDate, profile);
}
