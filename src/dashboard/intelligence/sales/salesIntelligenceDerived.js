/**
 * Derived Sales Intelligence analytics — pure functions over Foodics batches + sales rows.
 * Reuses existing rollup engines; no schema changes.
 */

import { aggregateSalesItemsByName } from "../../engines/executiveExport/salesRollup";
import { buildSalesCorrelation } from "../../engines/salesCorrelationEngine";
import { buildWaiterSalesIntelligence } from "../../engines/waiterSalesEngine";
import { branchDisplayName } from "../../utils/rangeState";

function monthKey(startDate) {
  if (!startDate) return null;
  return String(startDate).slice(0, 7);
}

function sumRawTotals(rows = []) {
  return rows.reduce(
    (acc, row) => ({
      netSales: acc.netSales + (Number(row.net_sales) || 0),
      grossSales: acc.grossSales + (Number(row.gross_sales) || Number(row.net_sales) || 0),
      quantity: acc.quantity + (Number(row.quantity_sold) || 0),
    }),
    { netSales: 0, grossSales: 0, quantity: 0 },
  );
}

function rankAggregated(items, basis = "net_sales", limit = 10) {
  const key = basis === "quantity" ? "quantity" : "net_sales";
  return [...items]
    .sort((a, b) => (Number(b[key]) || 0) - (Number(a[key]) || 0))
    .slice(0, limit)
    .map((row, index) => ({
      rank: index + 1,
      name: row.item_name,
      netSales: Math.round((Number(row.net_sales) || 0) * 100) / 100,
      quantity: Number(row.quantity) || 0,
    }));
}

function buildCategories(rawItems = []) {
  const map = new Map();
  for (const row of rawItems) {
    const cat = String(row.analytics_category || row.category || "Uncategorized").trim() || "Uncategorized";
    if (!map.has(cat)) map.set(cat, { category: cat, netSales: 0, quantity: 0 });
    const entry = map.get(cat);
    entry.netSales += Number(row.net_sales) || 0;
    entry.quantity += Number(row.quantity_sold) || 0;
  }
  return [...map.values()].sort((a, b) => b.netSales - a.netSales);
}

function rankChange(currentTop, previousTop) {
  const previousNames = new Set(previousTop.map((r) => r.name.toLowerCase()));
  const currentNames = new Set(currentTop.map((r) => r.name.toLowerCase()));
  return {
    entered: currentTop.filter((r) => !previousNames.has(r.name.toLowerCase())),
    dropped: previousTop.filter((r) => !currentNames.has(r.name.toLowerCase())),
  };
}

function detectMissingMonths(batches = []) {
  const byBranch = new Map();
  for (const batch of batches) {
    const key = batch.branch_id || "unknown";
    if (!byBranch.has(key)) byBranch.set(key, new Set());
    byBranch.get(key).add(monthKey(batch.period_start));
  }

  const gaps = [];
  for (const [branchId, monthsSet] of byBranch.entries()) {
    const months = [...monthsSet].filter(Boolean).sort();
    if (months.length < 2) continue;
    const [startY, startM] = months[0].split("-").map(Number);
    const [endY, endM] = months[months.length - 1].split("-").map(Number);
    let y = startY;
    let m = startM;
    while (y < endY || (y === endY && m <= endM)) {
      const key = `${y}-${String(m).padStart(2, "0")}`;
      if (!monthsSet.has(key)) {
        gaps.push({ branchId, month: key, label: new Date(Date.UTC(y, m - 1, 1, 12)).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }) });
      }
      m += 1;
      if (m > 12) {
        m = 1;
        y += 1;
      }
    }
  }
  return gaps.slice(0, 6);
}

export function buildSalesIntelligenceDerived({
  batches = [],
  salesBatch = null,
  previousBatch = null,
  salesItems = [],
  previousSalesItems = [],
  topItems = [],
  totalSessions = 0,
}) {
  const aggregated = aggregateSalesItemsByName(salesItems, { executiveOnly: true });
  const previousAggregated = aggregateSalesItemsByName(previousSalesItems, { executiveOnly: true });
  const totals = sumRawTotals(salesItems);
  const categories = buildCategories(salesItems);
  const previousCategories = buildCategories(previousSalesItems);

  const topBySales = rankAggregated(aggregated, "net_sales", 10);
  const topByQuantity = rankAggregated(aggregated, "quantity", 10);
  const previousTopBySales = rankAggregated(previousAggregated, "net_sales", 10);
  const rankMoves = previousBatch ? rankChange(topBySales, previousTopBySales) : { entered: [], dropped: [] };

  const categoryTrend = categories.slice(0, 8).map((cat) => {
    const prev = previousCategories.find((p) => p.category === cat.category);
    const delta = prev ? cat.netSales - prev.netSales : null;
    return { ...cat, previousNetSales: prev?.netSales ?? null, delta };
  });

  const correlation = buildSalesCorrelation({ salesItems, topItems, totalSessions });
  const waiterIntel = salesItems.length ? buildWaiterSalesIntelligence(salesItems) : { waiters: [] };

  const periods = [...batches]
    .map((b) => ({
      id: b.id,
      branchId: b.branch_id,
      branchLabel: branchDisplayName(b.branch_id),
      start: b.period_start,
      end: b.period_end,
      month: monthKey(b.period_start),
      file: b.source_file_name,
      uploadedAt: b.uploaded_at,
    }))
    .sort((a, b) => String(b.start).localeCompare(String(a.start)));

  const branchCoverage = [...new Set(batches.map((b) => b.branch_id).filter(Boolean))].map((id) => ({
    id,
    label: branchDisplayName(id),
    batchCount: batches.filter((b) => b.branch_id === id).length,
  }));

  return {
    coverage: {
      periods,
      branchCoverage,
      missingMonths: detectMissingMonths(batches),
      lastUpload: salesBatch
        ? {
            file: salesBatch.source_file_name,
            uploadedAt: salesBatch.uploaded_at,
            period: `${salesBatch.period_start} → ${salesBatch.period_end}`,
            branch: branchDisplayName(salesBatch.branch_id),
          }
        : null,
    },
    overview: {
      netSales: Math.round(totals.netSales),
      grossSales: Math.round(totals.grossSales),
      quantity: totals.quantity,
      productCount: aggregated.length,
      topCategory: categories[0] || null,
      batchLabel: salesBatch ? `${salesBatch.period_start} → ${salesBatch.period_end}` : null,
      branchLabel: salesBatch ? branchDisplayName(salesBatch.branch_id) : null,
    },
    items: {
      topBySales,
      topByQuantity,
      rankMoves,
      compareLabel: previousBatch
        ? `${salesBatch?.period_start || ""} vs ${previousBatch.period_start || ""}`
        : null,
    },
    categories: {
      rows: categories.slice(0, 12),
      trend: categoryTrend,
      hasComparison: Boolean(previousBatch),
    },
    correlation,
    waiterIntel,
  };
}
