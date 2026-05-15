/** Item behavior psychology + confidence + visual efficiency */

export const BEHAVIOR = {
  VISUAL_SELLER: "Visual Seller",
  DISCOVERY_SELLER: "Discovery Seller",
  WAITER_DRIVEN: "Waiter-Driven Seller",
  HABIT_ORDER: "Habit Order",
  MENU_TRAP: "Menu Trap",
  HIDDEN_OPPORTUNITY: "Hidden Opportunity",
  EARLY_SIGNAL: "Early Signal",
};

export function getImpressionSignalStrength(impressions) {
  const imp = Number(impressions) || 0;
  if (imp < 30) return { label: "Very early signal", level: "very_low" };
  if (imp < 100) return { label: "Early signal", level: "low" };
  if (imp < 300) return { label: "Moderate confidence", level: "medium" };
  return { label: "Strong signal", level: "high" };
}

export function getOrderSignalStrength(orders) {
  const o = Number(orders) || 0;
  if (o < 5) return { label: "Low confidence", level: "low" };
  if (o < 20) return { label: "Medium confidence", level: "medium" };
  return { label: "High confidence", level: "high" };
}

export function prefixSignal(label, text) {
  if (!label || label === "Strong signal") return text;
  return `${label}: ${text}`;
}

/** 0–100: card/photo sells without needing modal opens */
export function computeVisualEfficiency(row = {}) {
  const imp = Number(row.item_impressions ?? row.impressions ?? row.item_views) || 0;
  const opens = Number(row.item_modal_opens ?? row.item_opens) || 0;
  const orders = Number(row.quantity_sold ?? row.orders) || 0;
  const revPerImp = Number(row.revenue_per_view) || 0;
  const openRate = imp > 0 ? opens / imp : 1;
  const convRate = imp > 0 ? Math.min(orders, imp) / imp : 0;

  if (imp < 10) {
    return { score: null, explanation: "Not enough impressions to score visual efficiency yet." };
  }

  const visualBonus = openRate < 0.12 && orders >= 3 ? 28 : openRate < 0.22 && orders >= 2 ? 16 : 0;
  const score = Math.min(
    100,
    Math.round(
      Math.min(32, imp * 0.12) +
        Math.min(28, convRate * 100 * 0.28) +
        Math.min(18, revPerImp * 3.5) +
        visualBonus,
    ),
  );

  let explanation = "Guests often need more detail before ordering.";
  if (score >= 72) {
    explanation = "The card itself sells the item — strong visibility with minimal need for extra detail.";
  } else if (score >= 48) {
    explanation = "Moderate visual pull — the photo builds partial confidence on its own.";
  }

  return { score, explanation };
}

export function classifyItemBehavior(row = {}) {
  const imp = Number(row.item_impressions ?? row.impressions ?? row.item_views) || 0;
  const opens = Number(row.item_modal_opens ?? row.item_opens) || 0;
  const orders = Number(row.quantity_sold ?? row.orders) || 0;
  const rate = Number(row.impression_conversion_pct ?? row.menu_conversion_pct ?? row.conversion_rate) || 0;
  const deep = imp > 0 ? (opens / imp) * 100 : 0;

  const impSignal = getImpressionSignalStrength(imp);
  const orderSignal = getOrderSignalStrength(orders);
  const visualEfficiency = computeVisualEfficiency(row);

  let behaviorType = BEHAVIOR.EARLY_SIGNAL;
  let suggestion = "Continue collecting visibility and sales data before making major changes.";

  if (imp < 30 || (imp < 50 && orders < 5)) {
    behaviorType = BEHAVIOR.EARLY_SIGNAL;
    suggestion = "Sample size is still small — monitor before repositioning or repricing.";
  } else if (imp < 12 && orders >= 10) {
    behaviorType = orders >= 20 ? BEHAVIOR.HABIT_ORDER : BEHAVIOR.HIDDEN_OPPORTUNITY;
    suggestion =
      behaviorType === BEHAVIOR.HABIT_ORDER
        ? "Guests order habitually with little menu browsing — protect availability and table mention."
        : "Strong sales with low visibility — feature higher in category and hero slots.";
  } else if (imp < 15 && orders >= 8 && opens < 3) {
    behaviorType = BEHAVIOR.WAITER_DRIVEN;
    suggestion = "Sales outpace menu discovery — train staff recommendations and improve card placement.";
  } else if (imp >= 20 && deep < 12 && orders >= 5 && rate >= 5) {
    behaviorType = BEHAVIOR.VISUAL_SELLER;
    suggestion = "Photo and card layout build confidence — guests order without opening details often.";
  } else if (imp >= 15 && deep >= 12 && orders >= 5 && rate >= 6) {
    behaviorType = BEHAVIOR.DISCOVERY_SELLER;
    suggestion = "Guests investigate and still order — strong discovery-to-sale path; keep quality consistent.";
  } else if (imp >= 25 && rate < 5 && orders < Math.max(3, imp * 0.04)) {
    behaviorType = BEHAVIOR.MENU_TRAP;
    suggestion = "Attracts attention but underperforms in sales — review price, photo, and description.";
  } else if (imp >= 15 && opens >= 10 && rate < 5) {
    behaviorType = BEHAVIOR.MENU_TRAP;
    suggestion = "Strong deep interest but weak sales — friction in price, portion, or expectations.";
  } else if (orders > imp && imp > 0 && orders >= 8) {
    behaviorType = deep < 8 ? BEHAVIOR.WAITER_DRIVEN : BEHAVIOR.HABIT_ORDER;
    suggestion =
      behaviorType === BEHAVIOR.WAITER_DRIVEN
        ? "Orders exceed passive visibility — likely staff-led or repeat guest behavior."
        : "Repeat or habitual ordering — item may not need heavy menu promotion.";
  } else if (imp > 0 && orders === 0) {
    behaviorType = BEHAVIOR.MENU_TRAP;
    suggestion = "Visible on the menu but no matching sales — test offer, photo, or placement.";
  } else if (imp >= 20 && rate >= 10) {
    behaviorType = deep >= 10 ? BEHAVIOR.DISCOVERY_SELLER : BEHAVIOR.VISUAL_SELLER;
    suggestion = "Healthy visibility-to-sales efficiency — maintain placement and quality.";
  }

  const statusLabel = prefixSignal(impSignal.label, behaviorType);

  return {
    behavior_type: behaviorType,
    status: statusLabel,
    suggestion: prefixSignal(impSignal.label, suggestion),
    signal_strength: impSignal.label,
    order_confidence: orderSignal.label,
    visual_efficiency_score: visualEfficiency.score,
    visual_efficiency_note: visualEfficiency.explanation,
    confidence_combined: `${impSignal.label} · ${orderSignal.label}`,
  };
}

export function buildExportCommentary(row) {
  const b = row.behavior_type || row.status;
  const ve = row.visual_efficiency_score;
  const name = row.item_name || "Item";
  if (b === BEHAVIOR.VISUAL_SELLER && ve != null && ve >= 65) {
    return `${name} shows strong visual efficiency: guests see the item, rarely need extra detail, and still order well.`;
  }
  if (b === BEHAVIOR.MENU_TRAP) {
    return `${row.signal_strength || "Signal"}: ${name} attracts attention but has not converted strongly in this period.`;
  }
  if (b === BEHAVIOR.HIDDEN_OPPORTUNITY) {
    return `${name} sells well with limited visibility — consider elevating placement in the menu.`;
  }
  return row.visual_efficiency_note || row.suggestion || "";
}
