import { buildConversionRows, getConversionOpportunities } from "../utils/foodicsConversion";
import { buildWaiterImportValidation } from "../utils/waiterImportValidation";
import {
  validateImportBatchIntegrity,
  computeOperationalTrustScore,
} from "../../platform/engines/reportTruthEngine";
import { IMPORT_MISMATCH } from "../../platform/contracts/reportTruthContract";

/**
 * Correlate imported Foodics sales with menu visibility (get_bi_dashboard top_items).
 */
export function buildSalesCorrelation({
  salesItems = [],
  topItems = [],
  previousSales = [],
  batchTotals = null,
  totalSessions = 0,
}) {
  const validation = buildWaiterImportValidation(salesItems);
  const expectedTotals = batchTotals || validation.totals;
  const importIntegrity = validateImportBatchIntegrity(salesItems, expectedTotals);

  const conversionRows = buildConversionRows(salesItems, topItems, previousSales, {
    totalSessions,
    importIntegrity,
  });
  const suppressRankings = importIntegrity.integrity_failure;
  const opportunities = suppressRankings ? null : getConversionOpportunities(conversionRows);

  const waiterMap = {};
  (salesItems || []).forEach((row) => {
    const waiter = (row.waiter_name || "Unassigned").trim() || "Unassigned";
    if (!waiterMap[waiter]) {
      waiterMap[waiter] = {
        waiter,
        quantity: 0,
        net_sales: 0,
        gross_sales: 0,
        items: 0,
      };
    }
    waiterMap[waiter].quantity += Number(row.quantity_sold) || 0;
    waiterMap[waiter].net_sales += Number(row.net_sales) || 0;
    waiterMap[waiter].gross_sales += Number(row.gross_sales) || 0;
    waiterMap[waiter].items += 1;
  });

  const waiterKpis = Object.values(waiterMap)
    .map((w) => ({
      ...w,
      avg_ticket: w.quantity > 0 ? Math.round((w.net_sales / w.quantity) * 100) / 100 : 0,
    }))
    .sort((a, b) => b.net_sales - a.net_sales);

  const addonClicks = topItems
    .flatMap((t) => [])
    .length;

  const highInterestLowSales = conversionRows
    .filter((r) => (r.item_views || r.item_impressions || 0) >= 15 && (r.quantity_sold || 0) <= 2)
    .sort((a, b) => (b.item_views || 0) - (a.item_views || 0))
    .slice(0, 8);

  const topUpsellers = waiterKpis.slice(0, 5);

  const viewedNotSold = conversionRows
    .filter((r) => (r.item_views || 0) > 10 && !(r.quantity_sold > 0))
    .slice(0, 8);

  const attachmentRate =
    !suppressRankings && conversionRows.length > 0
      ? Math.round(
          (conversionRows.filter((r) => r.quantity_sold > 0).length / conversionRows.length) * 100,
        )
      : null;

  const totalNet = validation.totals.net_sales;
  const totalQty = validation.totals.quantity;

  const operationalTrust = computeOperationalTrustScore({
    importIntegrity,
    trackingIntegrity: {
      score: totalSessions >= 50 ? 88 : totalSessions >= 15 ? 62 : 35,
    },
    sessionDensity: { score: Math.min(100, Math.round(totalSessions * 1.5)) },
    visibilityConfidence: {
      score: topItems.length >= 8 ? 75 : topItems.length >= 3 ? 50 : 30,
    },
    branchCoverage: { score: salesItems.length > 0 ? 80 : 40 },
    attributionConfidence: { score: suppressRankings ? 30 : 65 },
  });

  return {
    conversionRows,
    opportunities,
    waiterKpis,
    topUpsellers,
    highInterestLowSales: suppressRankings ? [] : highInterestLowSales,
    viewedNotSold: suppressRankings ? [] : viewedNotSold,
    attachmentRate,
    totals: { net_sales: totalNet, quantity: totalQty },
    addonClicks,
    importIntegrity,
    provisional: importIntegrity.provisional,
    suppressRankings,
    integrityMessage: importIntegrity.message || (suppressRankings ? IMPORT_MISMATCH : null),
    operationalTrust,
  };
}

/** Add-on pairs from BI dashboard payload */
export function buildAddonCorrelation(biData) {
  const pairs = biData?.top_addon_pairs || [];
  const totalClicks = pairs.reduce((a, p) => a + (Number(p.clicks) || 0), 0);
  return {
    pairs: pairs.slice(0, 10),
    totalClicks,
    topPair: pairs[0] || null,
  };
}
