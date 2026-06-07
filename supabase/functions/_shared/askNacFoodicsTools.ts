/**
 * Foodics query tools for Ask NAC Edge — Supabase direct, no React imports.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  DEFAULT_IMPORT_TYPE,
  type FoodicsPeriod,
  parseFoodicsComparePeriods,
  parseFoodicsPeriodFromQuestion,
} from "./askNacPeriodFallback.ts";

export { DEFAULT_IMPORT_TYPE };

const BRANCH_NAMES: Record<string, string> = {
  khobar: "Khobar",
  riyadh: "Riyadh",
  jeddah: "Jeddah",
};

export function branchDisplayName(branch: string | null | undefined): string {
  if (!branch) return "Network (all branches)";
  const id = String(branch).toLowerCase();
  return BRANCH_NAMES[id] || String(branch);
}

type FoodicsBatch = {
  id: string;
  branch_id: string;
  period_start: string;
  period_end: string;
  source_file_name?: string;
  uploaded_at?: string;
};

type SalesItemRow = Record<string, unknown>;

function resolveBranch(context: Record<string, unknown> = {}): string | null {
  const branchMention = context.branchMention as string | null | undefined;
  const filters = context.filters as { branch?: string } | undefined;
  const profile = context.profile as { branchScope?: string; allBranches?: boolean } | undefined;
  if (profile?.branchScope && !profile.allBranches) return profile.branchScope;
  return branchMention || filters?.branch || (context.branch as string | null) || null;
}

function itemDisplayName(row: SalesItemRow) {
  return String(row.matched_menu_item_name || row.raw_item_name || row.item_name || "Unknown").trim();
}

/** Simple executive rollup by item display name. */
export function aggregateSalesItemsByName(rows: SalesItemRow[] = []) {
  const map = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const name = itemDisplayName(row);
    const key = name.toLowerCase();
    if (!key) continue;
    if (!map.has(key)) {
      map.set(key, {
        item_name: name,
        quantity: 0,
        net_sales: 0,
        gross_sales: 0,
        category: row.analytics_category || row.category || null,
        matched_menu_item_name: row.matched_menu_item_name || null,
      });
    }
    const agg = map.get(key)!;
    agg.quantity = (Number(agg.quantity) || 0) + (Number(row.quantity_sold) || 0);
    agg.net_sales = (Number(agg.net_sales) || 0) + (Number(row.net_sales) || 0);
    agg.gross_sales = (Number(agg.gross_sales) || 0) + (Number(row.gross_sales) || 0);
  }
  return [...map.values()];
}

export async function getBatchForExportPeriod(
  supabase: SupabaseClient,
  importType: string,
  branchId: string | null,
  startDate: string | null,
  endDate: string | null,
): Promise<FoodicsBatch | null> {
  let query = supabase.from("foodics_import_batches").select("*").eq("import_type", importType);
  if (branchId) query = query.eq("branch_id", String(branchId).toLowerCase());
  if (startDate && endDate) {
    query = query.lte("period_start", endDate).gte("period_end", startDate);
  }
  const { data, error } = await query.order("uploaded_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as FoodicsBatch) || null;
}

export async function getBatchSalesItems(supabase: SupabaseClient, batchId: string) {
  const { data, error } = await supabase
    .from("foodics_sales_items")
    .select("*")
    .eq("batch_id", batchId)
    .order("quantity_sold", { ascending: false });
  if (error) throw new Error(error.message);
  return (data || []) as SalesItemRow[];
}

function batchCoverageNote(batch: FoodicsBatch | null) {
  if (!batch) return null;
  return `Foodics import ${batch.source_file_name || batch.id} · ${batch.period_start} to ${batch.period_end} · ${branchDisplayName(batch.branch_id)}`;
}

function rankItems(
  items: Record<string, unknown>[],
  rankingBasis = "net_sales",
  limit = 10,
) {
  const key = rankingBasis === "quantity" ? "quantity" : "net_sales";
  return [...items]
    .sort((a, b) => (Number(b[key]) || 0) - (Number(a[key]) || 0))
    .slice(0, limit)
    .map((row, index) => ({
      rank: index + 1,
      itemName: String(row.item_name || itemDisplayName(row)),
      netSales: Math.round((Number(row.net_sales) || 0) * 100) / 100,
      quantity: Number(row.quantity) || 0,
      category: (row.category as string) || null,
    }));
}

function sumTotals(items: Record<string, unknown>[] = []) {
  return items.reduce(
    (acc, row) => ({
      netSales: acc.netSales + (Number(row.net_sales ?? row.netSales) || 0),
      grossSales: acc.grossSales + (Number(row.gross_sales ?? row.grossSales) || 0),
      quantity: acc.quantity + (Number(row.quantity_sold ?? row.quantity) || 0),
    }),
    { netSales: 0, grossSales: 0, quantity: 0 },
  );
}

function buildFoodicsToolBase({
  batch,
  branch,
  period,
  rankingBasis,
  limit,
}: {
  batch: FoodicsBatch | null;
  branch: string | null;
  period: FoodicsPeriod | null | undefined;
  rankingBasis: string;
  limit: number;
}) {
  const branchLabel = branch ? branchDisplayName(branch) : branchDisplayName(batch?.branch_id);
  return {
    branch,
    branchLabel,
    periodLabel: period?.label || `${period?.startDate || ""} – ${period?.endDate || ""}`,
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
    sources: batch ? [{ name: "foodics_sales_items", detail: batchCoverageNote(batch) }] : [],
    warnings: [] as string[],
  };
}

async function loadBatchWithItems(
  supabase: SupabaseClient,
  { branch, startDate, endDate }: { branch: string | null; startDate: string; endDate: string },
) {
  const batch = await getBatchForExportPeriod(
    supabase,
    DEFAULT_IMPORT_TYPE,
    branch,
    startDate,
    endDate,
  );
  if (!batch?.id) return { batch: null, items: [] as SalesItemRow[], aggregated: [] as Record<string, unknown>[] };
  const rawItems = await getBatchSalesItems(supabase, batch.id);
  const aggregated = aggregateSalesItemsByName(rawItems);
  return { batch, items: rawItems, aggregated };
}

export async function getFoodicsSalesSummary(supabase: SupabaseClient, context: Record<string, unknown> = {}) {
  const branch = resolveBranch(context);
  const period = (context.foodicsPeriod as FoodicsPeriod) ||
    parseFoodicsPeriodFromQuestion(String(context.question || "")) ||
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
  });
  const base = buildFoodicsToolBase({ batch, branch, period, rankingBasis: "net_sales", limit: 0 });

  if (!batch) return { ...base, missingBatch: true, period };

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

export async function getFoodicsTopItems(supabase: SupabaseClient, context: Record<string, unknown> = {}) {
  const branch = resolveBranch(context);
  const period = (context.foodicsPeriod as FoodicsPeriod) ||
    parseFoodicsPeriodFromQuestion(String(context.question || "")) ||
    null;
  const rankingBasis = String(context.rankingBasis || "net_sales");
  const limit = Number(context.topLimit) || 10;

  if (!period?.startDate) {
    return { ...buildFoodicsToolBase({ batch: null, branch, period, rankingBasis, limit }), missingPeriod: true };
  }

  const { batch, aggregated } = await loadBatchWithItems(supabase, {
    branch,
    startDate: period.startDate,
    endDate: period.endDate,
  });
  const base = buildFoodicsToolBase({ batch, branch, period, rankingBasis, limit });
  if (!batch) return { ...base, missingBatch: true, period, topItems: [] };

  return {
    ...base,
    topItems: rankItems(aggregated, rankingBasis, limit),
    rankingLabel: rankingBasis === "quantity" ? "quantity sold" : "net sales",
  };
}

export async function compareFoodicsTopItems(supabase: SupabaseClient, context: Record<string, unknown> = {}) {
  const branch = resolveBranch(context);
  const compare = (context.foodicsCompare as ReturnType<typeof parseFoodicsComparePeriods>) ||
    parseFoodicsComparePeriods(String(context.question || ""));
  const rankingBasis = String(context.rankingBasis || "net_sales");
  const limit = Number(context.topLimit) || 10;

  const [currentRes, previousRes] = await Promise.all([
    loadBatchWithItems(supabase, {
      branch,
      startDate: compare.current.startDate,
      endDate: compare.current.endDate,
    }),
    loadBatchWithItems(supabase, {
      branch,
      startDate: compare.previous.startDate,
      endDate: compare.previous.endDate,
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

export async function getFoodicsCategorySales(supabase: SupabaseClient, context: Record<string, unknown> = {}) {
  const branch = resolveBranch(context);
  const period = (context.foodicsPeriod as FoodicsPeriod) ||
    parseFoodicsPeriodFromQuestion(String(context.question || "")) ||
    null;

  if (!period?.startDate) {
    return { ...buildFoodicsToolBase({ batch: null, branch, period, rankingBasis: "net_sales", limit: 10 }), missingPeriod: true };
  }

  const { batch } = await loadBatchWithItems(supabase, {
    branch,
    startDate: period.startDate,
    endDate: period.endDate,
  });
  const base = buildFoodicsToolBase({ batch, branch, period, rankingBasis: "net_sales", limit: 10 });
  if (!batch) return { ...base, missingBatch: true, categories: [] };

  const rawItems = await getBatchSalesItems(supabase, batch.id);
  const catMap = new Map<string, { category: string; netSales: number; quantity: number }>();
  for (const row of rawItems) {
    const cat = String(row.analytics_category || row.category || "Uncategorized").trim() || "Uncategorized";
    if (!catMap.has(cat)) catMap.set(cat, { category: cat, netSales: 0, quantity: 0 });
    const entry = catMap.get(cat)!;
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

  return { ...base, categories, topCategory: categories[0] || null };
}

export async function getFoodicsBranchSalesComparison(
  supabase: SupabaseClient,
  context: Record<string, unknown> = {},
) {
  const period = (context.foodicsPeriod as FoodicsPeriod) ||
    parseFoodicsPeriodFromQuestion(String(context.question || "")) ||
    null;

  if (!period?.startDate) return { missingPeriod: true, branches: [] };

  const { data, error } = await supabase
    .from("foodics_import_batches")
    .select("*")
    .eq("import_type", DEFAULT_IMPORT_TYPE)
    .lte("period_start", period.endDate)
    .gte("period_end", period.startDate)
    .order("uploaded_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);

  const matching = (data || []) as FoodicsBatch[];
  const branches = [];
  for (const batch of matching) {
    const items = await getBatchSalesItems(supabase, batch.id);
    const aggregated = aggregateSalesItemsByName(items);
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
