/** Item behavior psychology + confidence + visual efficiency */

export const BEHAVIOR = {
  VISUAL_SELLER: "Visual Seller",
  DISCOVERY_SELLER: "Discovery Seller",
  WAITER_DRIVEN: "Waiter-Driven Seller",
  HABIT_ORDER: "Habit Order",
  MENU_TRAP: "Menu Trap",
  HIDDEN_OPPORTUNITY: "Hidden Opportunity",
  NEEDS_EXPLANATION: "Needs Explanation",
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
  const avgDur = Number(row.avg_visible_duration_ms) || (
    row.impression_sessions > 0 ? (row.visible_duration_ms || 0) / row.impression_sessions : 0
  );

  const impSignal = getImpressionSignalStrength(imp);
  const orderSignal = getOrderSignalStrength(orders);
  const visualEfficiency = computeVisualEfficiency(row);
  const hasImpressions = imp > 0 || row.hasImpressionData;

  let behaviorType = BEHAVIOR.EARLY_SIGNAL;
  let suggestion = "Continue collecting visibility and sales data before making major changes.";
  let reason = "Insufficient sample for a firm classification.";
  let false_positive_risk = "high";
  let recommended_action = suggestion;

  if (!hasImpressions && orders > 0) {
    behaviorType = BEHAVIOR.EARLY_SIGNAL;
    reason = "Visibility data still collecting — POS sales exist but impressions are not yet reliable.";
    suggestion = "Keep the guest menu live; avoid repositioning until impression data matures.";
    false_positive_risk = "high";
  } else if (imp < 30 || (imp < 50 && orders < 5)) {
    behaviorType = BEHAVIOR.EARLY_SIGNAL;
    reason = impSignal.label;
    suggestion = "Sample size is still small — monitor before repositioning or repricing.";
    false_positive_risk = "high";
  } else if (imp >= 15 && opens >= 10 && orders < 5 && avgDur >= 3500) {
    behaviorType = BEHAVIOR.NEEDS_EXPLANATION;
    reason = "High deep interest and visible time without matching sales.";
    suggestion = "Clarify description, portion, or price — guests investigate but hesitate to order.";
    false_positive_risk = orderSignal.level === "low" ? "medium" : "low";
  } else if (imp < 12 && orders >= 10) {
    behaviorType = orders >= 20 ? BEHAVIOR.HABIT_ORDER : BEHAVIOR.HIDDEN_OPPORTUNITY;
    reason = "Sales exceed passive menu visibility.";
    suggestion =
      behaviorType === BEHAVIOR.HABIT_ORDER
        ? "Habitual ordering — protect availability and table mention."
        : "Strong sales with low visibility — feature higher in category and hero slots.";
    false_positive_risk = "low";
  } else if (imp < 15 && orders >= 8 && opens < 3) {
    behaviorType = BEHAVIOR.WAITER_DRIVEN;
    reason = "Orders outpace menu discovery with minimal opens.";
    suggestion = "Train staff recommendations and improve card placement.";
    false_positive_risk = "low";
  } else if (imp >= 20 && deep < 12 && orders >= 5 && rate >= 5) {
    behaviorType = BEHAVIOR.VISUAL_SELLER;
    reason = "Low modal-open rate with healthy sales — card/photo builds confidence.";
    suggestion = "Photo and card layout sell the item — guests order without opening details often.";
    false_positive_risk = "low";
  } else if (imp >= 15 && deep >= 12 && orders >= 5 && rate >= 6) {
    behaviorType = BEHAVIOR.DISCOVERY_SELLER;
    reason = "Guests investigate and still order.";
    suggestion = "Strong discovery-to-sale path; keep quality and description consistent.";
    false_positive_risk = "low";
  } else if (imp >= 30 && rate < 5 && orders < Math.max(3, imp * 0.04)) {
    behaviorType = BEHAVIOR.MENU_TRAP;
    reason = "Meaningful impressions with weak sales conversion.";
    suggestion = "Attracts attention but underperforms — review price, photo, and description.";
    false_positive_risk = orderSignal.level === "low" ? "high" : "medium";
  } else if (imp >= 20 && opens >= 8 && rate < 5 && orders < 5) {
    behaviorType = BEHAVIOR.MENU_TRAP;
    reason = "Strong deep interest but weak sales in this period.";
    suggestion = "Friction in price, portion, or expectations — test offer or staff prompt.";
    false_positive_risk = "medium";
  } else if (orders > imp && imp > 0 && orders >= 8) {
    behaviorType = deep < 8 ? BEHAVIOR.WAITER_DRIVEN : BEHAVIOR.HABIT_ORDER;
    reason = "Orders exceed passive visibility — staff or repeat behavior likely.";
    suggestion =
      behaviorType === BEHAVIOR.WAITER_DRIVEN
        ? "Staff-led or repeat guest behavior — not a visibility failure."
        : "Repeat ordering — may not need heavy menu promotion.";
    false_positive_risk = "low";
  } else if (imp >= 15 && orders === 0 && impSignal.level !== "very_low") {
    behaviorType = BEHAVIOR.MENU_TRAP;
    reason = "Visible on menu with no matching Foodics sales.";
    suggestion = "Test offer, photo, or placement — confirm Foodics mapping.";
    false_positive_risk = "high";
  } else if (imp >= 20 && rate >= 10) {
    behaviorType = deep >= 10 ? BEHAVIOR.DISCOVERY_SELLER : BEHAVIOR.VISUAL_SELLER;
    reason = "Healthy visibility-to-sales efficiency.";
    suggestion = "Maintain placement and quality.";
    false_positive_risk = "low";
  } else {
    false_positive_risk = "medium";
  }

  recommended_action = suggestion;
  const confidence = `${impSignal.label} · ${orderSignal.label}`;
  const statusLabel = prefixSignal(impSignal.label, behaviorType);

  return {
    behavior_type: behaviorType,
    status: statusLabel,
    suggestion: prefixSignal(impSignal.label, suggestion),
    reason,
    confidence,
    false_positive_risk,
    recommended_action,
    signal_strength: impSignal.label,
    order_confidence: orderSignal.label,
    visual_efficiency_score: visualEfficiency.score,
    visual_efficiency_note: visualEfficiency.explanation,
    confidence_combined: confidence,
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
  if (b === BEHAVIOR.NEEDS_EXPLANATION) {
    return `${name} draws deep interest — guests may need clearer explanation before ordering.`;
  }
  return row.visual_efficiency_note || row.suggestion || row.reason || "";
}
