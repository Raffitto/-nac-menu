import { buildConversionRows, getConversionOpportunities } from "../utils/foodicsConversion";

/**
 * Correlate imported Foodics sales with menu visibility (get_bi_dashboard top_items).
 */
export function buildSalesCorrelation({ salesItems = [], topItems = [], previousSales = [] }) {
  const conversionRows = buildConversionRows(salesItems, topItems, previousSales);
  const opportunities = getConversionOpportunities(conversionRows);

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
    conversionRows.length > 0
      ? Math.round(
          (conversionRows.filter((r) => r.quantity_sold > 0).length / conversionRows.length) * 100,
        )
      : 0;

  const totalNet = conversionRows.reduce((a, r) => a + (Number(r.net_sales) || 0), 0);
  const totalQty = conversionRows.reduce((a, r) => a + (Number(r.quantity_sold) || 0), 0);

  return {
    conversionRows,
    opportunities,
    waiterKpis,
    topUpsellers,
    highInterestLowSales,
    viewedNotSold,
    attachmentRate,
    totals: { net_sales: totalNet, quantity: totalQty },
    addonClicks,
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
