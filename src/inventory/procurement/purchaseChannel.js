/**
 * Credit supplier purchases and cash/local-market purchases both affect inventory.
 * A cash purchase must not be written as the regular supplier's new price.
 */

export const PURCHASE_CHANNEL = Object.freeze({
  SUPPLIER_CREDIT: "supplier_credit",
  CASH_MARKET: "cash_market",
});

export const CASH_REASONS = Object.freeze([
  "normal_order",
  "supplier_shortage",
  "supplier_unavailable",
  "urgent_requirement",
  "quality_rejection",
  "price_opportunity",
  "emergency_purchase",
  "other",
]);

export function supplierPriceWriteAllowed(channel) {
  return classifyPurchaseChannel({ channel }).updatesSupplierPriceHistory;
}

export function classifyPurchaseChannel({ channel = null, reason = null } = {}) {
  const normalized = String(channel || "").toLowerCase();
  if (normalized === PURCHASE_CHANNEL.CASH_MARKET || normalized === "cash") {
    return {
      channel: PURCHASE_CHANNEL.CASH_MARKET,
      reason: CASH_REASONS.includes(reason) ? reason : "other",
      updatesSupplierPriceHistory: false,
    };
  }
  return {
    channel: PURCHASE_CHANNEL.SUPPLIER_CREDIT,
    reason: reason || "normal_order",
    updatesSupplierPriceHistory: true,
  };
}

function comparable(left, right) {
  return left && right
    && left.baseUnit
    && left.baseUnit === right.baseUnit
    && Number.isFinite(Number(left.costPerBase))
    && Number.isFinite(Number(right.costPerBase));
}

export function sameSupplierPriceChange({ previous = null, next = null } = {}) {
  if (!previous || !next) return { comparable: false, reason: "missing_price" };
  if (next.channel === PURCHASE_CHANNEL.CASH_MARKET) {
    return { comparable: false, reason: "cash_market_does_not_rewrite_supplier_price" };
  }
  if (previous.supplierId !== next.supplierId) {
    return { comparable: false, reason: "different_supplier" };
  }
  if (!comparable(previous, next)) {
    return { comparable: false, reason: "units_not_comparable" };
  }
  const before = Number(previous.costPerBase);
  const after = Number(next.costPerBase);
  const delta = after - before;
  const percent = before === 0 ? null : (delta / before) * 100;
  return {
    comparable: true,
    direction: delta > 0.0001 ? "increase" : delta < -0.0001 ? "decrease" : "unchanged",
    previous: before,
    next: after,
    delta,
    percent,
    baseUnit: next.baseUnit,
  };
}

export function crossSupplierOpportunity({ current = null, alternative = null } = {}) {
  if (!comparable(current, alternative)) {
    return { comparable: false, reason: "units_not_comparable" };
  }
  if (current.costPerBase == null || alternative.costPerBase == null) {
    return { comparable: false, reason: "price_absent" };
  }
  if (
    (current.costBasis && current.costBasis !== "actual_document_price")
    || (alternative.costBasis && alternative.costBasis !== "actual_document_price")
  ) {
    return { comparable: false, reason: "not_commercial_price" };
  }
  if (current.supplierId === alternative.supplierId) {
    return { comparable: false, reason: "same_supplier" };
  }
  const delta = Number(current.costPerBase) - Number(alternative.costPerBase);
  return {
    comparable: true,
    cheaperSupplierId: delta > 0 ? alternative.supplierId : current.supplierId,
    deltaPerBase: delta,
    percent: (delta / Number(alternative.costPerBase)) * 100,
    baseUnit: current.baseUnit,
  };
}
