import { divideDecimal } from "../inventoryIntelligence";
import { COST_PROVENANCE } from "./contracts";
import { PACK_STATUS } from "./contracts";

/**
 * Canonical food cost is ex-VAT / normalized base quantity.
 * Missing price or quantity stays UNKNOWN — never zero.
 */
export function normalizePurchaseCost({
  exVatLineValue = null,
  lineTotal = null,
  taxAmount = null,
  normalizedQuantity = null,
  normalizedUnit = null,
  packStatus = PACK_STATUS.OK,
} = {}) {
  if (packStatus && packStatus !== PACK_STATUS.OK) {
    return {
      value: null,
      unit: normalizedUnit,
      status: packStatus,
      provenance: COST_PROVENANCE.PACK_ASSUMED,
    };
  }

  const exVat = resolveExVat({ exVatLineValue, lineTotal, taxAmount });
  if (exVat == null) {
    return { value: null, unit: normalizedUnit, status: "MISSING_PRICE", provenance: COST_PROVENANCE.UNKNOWN };
  }
  if (normalizedQuantity == null || normalizedQuantity === "" || Number(normalizedQuantity) === 0) {
    return { value: null, unit: normalizedUnit, status: "MISSING_QUANTITY", provenance: COST_PROVENANCE.UNKNOWN };
  }

  return {
    value: divideDecimal(exVat, String(normalizedQuantity), 8),
    unit: normalizedUnit,
    exVatValue: String(exVat),
    normalizedQuantity: String(normalizedQuantity),
    status: "OK",
    provenance: COST_PROVENANCE.EXPLICIT_PACK,
    basis: "ex_vat",
  };
}

function resolveExVat({ exVatLineValue, lineTotal, taxAmount }) {
  if (exVatLineValue != null && exVatLineValue !== "") return String(exVatLineValue);
  if (lineTotal == null || lineTotal === "") return null;
  if (taxAmount == null || taxAmount === "") return String(lineTotal);
  try {
    return String(Number(String(lineTotal).replace(/,/g, "")) - Number(String(taxAmount).replace(/,/g, "")));
  } catch {
    return null;
  }
}

export function weightedAverageCost(purchases = []) {
  let valueSum = 0;
  let qtySum = 0;
  for (const row of purchases) {
    const qty = Number(row.normalizedQuantity);
    const unitCost = Number(row.unitCost ?? row.canonicalUnitCost);
    if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(unitCost)) continue;
    valueSum += unitCost * qty;
    qtySum += qty;
  }
  if (!qtySum) {
    return { value: null, status: "UNKNOWN", method: "weighted_average" };
  }
  return {
    value: String(valueSum / qtySum),
    quantity: String(qtySum),
    status: "OK",
    method: "weighted_average",
  };
}
