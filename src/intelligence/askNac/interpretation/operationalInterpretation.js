/**
 * Assistant-GM operational interpretation — explains what numbers mean, not just what they are.
 */

function pctChange(current, previous) {
  const c = Number(current);
  const p = Number(previous);
  if (!Number.isFinite(c) || !Number.isFinite(p) || p === 0) return null;
  return ((c - p) / p) * 100;
}

function direction(current, previous, thresholdPct = 2) {
  const change = pctChange(current, previous);
  if (change == null) return "unknown";
  if (Math.abs(change) < thresholdPct) return "stable";
  return change > 0 ? "up" : "down";
}

/**
 * Derive traffic vs spend interpretation from period-over-period aggregates.
 *
 * @param {{ totalSales?: number|null, totalGuests?: number|null, averageSpend?: number|null, totalDeliverySales?: number|null }} current
 * @param {typeof current} previous
 * @returns {string|null}
 */
export function deriveTrafficSpendInterpretation(current = {}, previous = {}) {
  const salesDir = direction(current.totalSales, previous.totalSales);
  const guestsDir = direction(current.totalGuests, previous.totalGuests);
  const spendDir = direction(current.averageSpend, previous.averageSpend);
  const deliveryDir = direction(current.totalDeliverySales, previous.totalDeliverySales);

  if (salesDir === "down" && guestsDir === "stable" && spendDir === "down") {
    return "The issue appears spend-driven, not traffic-driven — guest count held but average spend fell.";
  }
  if (salesDir === "down" && guestsDir === "down" && spendDir === "stable") {
    return "The issue appears traffic-driven — fewer guests with stable average spend.";
  }
  if (salesDir === "down" && guestsDir === "down" && spendDir === "down") {
    return "Both traffic and ticket size softened — fewer guests and lower average spend.";
  }
  if (salesDir === "up" && guestsDir === "stable" && spendDir === "up") {
    return "Growth looks spend-driven — average spend improved without a guest-count lift.";
  }
  if (salesDir === "stable" && guestsDir === "up" && spendDir === "down") {
    return "More guests came through, but average spend dropped — traffic up, ticket size down.";
  }
  if (salesDir === "down" && deliveryDir === "up") {
    return "Delivery helped offset weaker dine-in performance during the comparison window.";
  }
  if (salesDir === "up" && deliveryDir === "down") {
    return "Dine-in strength carried the period while delivery softened.";
  }
  return null;
}

/**
 * Build a short recommended action from interpretation context.
 */
export function deriveRecommendedAction(interpretation = null) {
  if (!interpretation) return null;
  if (/spend-driven/i.test(interpretation)) {
    return "Review upsell execution, add-on placement, and premium item mix before blaming traffic.";
  }
  if (/traffic-driven/i.test(interpretation)) {
    return "Focus on traffic drivers — reservations, walk-in conversion, and local demand signals.";
  }
  if (/ticket size/i.test(interpretation)) {
    return "Check average check trends by daypart and whether discounting increased.";
  }
  if (/delivery helped offset/i.test(interpretation)) {
    return "Protect delivery SLA and platform promos while addressing dine-in softness.";
  }
  return null;
}
