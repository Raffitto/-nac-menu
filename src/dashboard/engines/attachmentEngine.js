import { normalizeFoodicsName } from "../utils/foodicsNameNormalize";
import { ATTACHMENT_EXPECTATIONS } from "../config/attachmentThresholds";
import { rankAttachmentOpportunities } from "./operationalImportance";

function norm(s) {
  return normalizeFoodicsName(s);
}

function matchesAny(name, patterns) {
  const n = norm(name);
  if (!n) return false;
  return patterns.some((p) => n.includes(norm(p)));
}

function isModifierRow(row) {
  return (
    row.is_modifier === true ||
    row.track_as_modifier === true ||
    row.import_status === "paid_modifier" ||
    ["modifier", "sauce_condiment", "addon"].includes(row.semantic_class) ||
    ["modifier", "sauce_condiment", "addon"].includes(row.foodics_class)
  );
}

function rowLabel(row) {
  return (row.matched_menu_item_name || row.raw_item_name || "").trim();
}

function aggregateQty(rows) {
  return (rows || []).reduce((a, r) => a + (Number(r.quantity_sold) || 0), 0);
}

function aggregateRevenue(rows) {
  return (rows || []).reduce((a, r) => a + (Number(r.net_sales) || 0), 0);
}

/**
 * Rule-based attachment pairs from imported sales + menu click pairs.
 */
export function buildAttachmentIntelligence({
  salesItems = [],
  addonPairs = [],
  expectations = ATTACHMENT_EXPECTATIONS,
}) {
  const menuRows = (salesItems || []).filter((r) => !isModifierRow(r));
  const modifierRows = (salesItems || []).filter((r) => isModifierRow(r));

  const pairs = expectations.map((rule) => {
    const parentRows = menuRows.filter((r) => matchesAny(rowLabel(r), rule.parentPatterns));
    const modifierRowsHit = modifierRows.filter((r) => matchesAny(rowLabel(r), rule.modifierPatterns));
    const parentOrders = aggregateQty(parentRows);
    const attachedOrders = aggregateQty(modifierRowsHit);
    const attachmentRate = parentOrders > 0 ? Math.round((attachedOrders / parentOrders) * 1000) / 10 : 0;
    const attachmentRevenue = aggregateRevenue(modifierRowsHit);
    const gap = Math.max(0, rule.expectedPct - attachmentRate);
    const avgModPrice = attachedOrders > 0 ? attachmentRevenue / attachedOrders : 8;
    const estimatedLostRevenue = Math.round(((gap / 100) * parentOrders * avgModPrice) / 10) * 10;
    const opportunityScore = Math.min(100, Math.round(gap * 2 + (parentOrders > 50 ? 15 : 0)));

    const topParents = Object.entries(
      parentRows.reduce((m, r) => {
        const k = rowLabel(r);
        m[k] = (m[k] || 0) + (Number(r.quantity_sold) || 0);
        return m;
      }, {}),
    )
      .map(([name, qty]) => ({ name, qty }))
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 5);

    return {
      ...rule,
      parentOrders,
      attachedOrders,
      attachmentRate,
      attachmentRevenue,
      gap,
      estimatedLostRevenue,
      opportunityScore,
      underperforming: attachmentRate < rule.expectedPct * 0.65 && parentOrders >= 8,
      heat: attachmentRate >= rule.expectedPct ? "good" : attachmentRate >= rule.expectedPct * 0.65 ? "warn" : "critical",
      topParents,
    };
  });

  const clickPairs = (addonPairs || []).map((p) => ({
    parent: p.item || p.parent || "Unknown",
    modifier: p.addon || p.modifier || "Unknown",
    clicks: Number(p.clicks) || 0,
  }));

  const modifierLeaderboard = Object.values(
    modifierRows.reduce((m, r) => {
      const k = rowLabel(r);
      if (!m[k]) m[k] = { name: k, quantity: 0, revenue: 0, semantic_class: r.semantic_class };
      m[k].quantity += Number(r.quantity_sold) || 0;
      m[k].revenue += Number(r.net_sales) || 0;
      return m;
    }, {}),
  )
    .map((mod) => {
      const bestParent = pairs
        .filter((p) => matchesAny(mod.name, p.modifierPatterns))
        .sort((a, b) => b.parentOrders - a.parentOrders)[0];
      const parentOrders = bestParent?.parentOrders || 0;
      const rate = parentOrders > 0 ? Math.round((mod.quantity / parentOrders) * 1000) / 10 : 0;
      return {
        ...mod,
        attachmentRate: rate,
        topParent: bestParent?.topParents?.[0]?.name || "—",
      };
    })
    .sort((a, b) => b.revenue - a.revenue);

  const missedUpsells = rankAttachmentOpportunities(pairs.filter((p) => p.underperforming));

  const topAttachments = [...pairs]
    .filter((p) => p.attachedOrders > 0)
    .sort((a, b) => b.attachmentRate - a.attachmentRate)
    .slice(0, 8);

  return {
    pairs,
    topAttachments,
    missedUpsells,
    modifierLeaderboard,
    clickPairs: clickPairs.sort((a, b) => b.clicks - a.clicks).slice(0, 12),
    totals: {
      parentOrders: aggregateQty(menuRows),
      modifierOrders: aggregateQty(modifierRows),
      modifierRevenue: aggregateRevenue(modifierRows),
    },
  };
}
