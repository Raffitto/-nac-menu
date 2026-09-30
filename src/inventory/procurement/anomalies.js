import { ANOMALY } from "./contracts";
import { PACK_STATUS } from "./contracts";
import { MAPPING_STATE } from "./contracts";
import { DUPLICATE_STATE } from "./contracts";

const SPIKE_RATIO = 1.25;
const DROP_RATIO = 0.75;

export function detectProcurementAnomalies({
  line = {},
  pack = {},
  mapping = {},
  duplicate = {},
  previousUnitCost = null,
  header = {},
} = {}) {
  const warnings = [];
  const staffSafe = "Warnings are data-quality flags. They do not accuse suppliers or staff.";

  if (pack.status === PACK_STATUS.PACK_CONVERSION_REQUIRED) {
    warnings.push({ code: ANOMALY.PACK_CONVERSION_REQUIRED, message: pack.reason || "Pack conversion required" });
  }
  if (pack.status === PACK_STATUS.IMPOSSIBLE_UNIT_CONVERSION) {
    warnings.push({ code: ANOMALY.IMPOSSIBLE_UNIT_CONVERSION, message: pack.reason });
  }
  if (mapping.state === MAPPING_STATE.AMBIGUOUS) {
    warnings.push({ code: ANOMALY.AMBIGUOUS_MAPPING, message: "More than one plausible ingredient match" });
  }
  if (mapping.state === MAPPING_STATE.NEEDS_REVIEW && !mapping.ingredientId) {
    warnings.push({ code: ANOMALY.UNKNOWN_INGREDIENT, message: "No deterministic ingredient mapping" });
  }
  if (duplicate.state === DUPLICATE_STATE.POSSIBLE_DUPLICATE || duplicate.state === DUPLICATE_STATE.CONFIRMED_DUPLICATE) {
    warnings.push({ code: ANOMALY.DUPLICATE_INVOICE, message: duplicate.reason, mayPost: false });
  }
  if (line.unitPrice == null && line.unit_price == null && line.lineTotal == null && line.line_total == null) {
    warnings.push({ code: ANOMALY.MISSING_PRICE, message: "Line has no price" });
  }
  if (line.originalQuantity == null && line.original_quantity == null && line.quantity == null) {
    warnings.push({ code: ANOMALY.MISSING_QUANTITY, message: "Line has no quantity" });
  }

  const current = Number(line.unitCost || line.canonical_unit_cost);
  const previous = Number(previousUnitCost);
  if (Number.isFinite(current) && Number.isFinite(previous) && previous > 0) {
    if (current / previous >= SPIKE_RATIO) {
      warnings.push({ code: ANOMALY.PRICE_SPIKE, message: `Unit cost rose versus last purchase (${previous} → ${current})` });
    } else if (current / previous <= DROP_RATIO) {
      warnings.push({ code: ANOMALY.PRICE_DROP, message: `Unit cost fell versus last purchase (${previous} → ${current})` });
    }
  }

  const lineTotal = Number(line.lineTotal ?? line.line_total);
  const qty = Number(line.originalQuantity ?? line.original_quantity);
  const unitPrice = Number(line.unitPrice ?? line.unit_price);
  if (Number.isFinite(lineTotal) && Number.isFinite(qty) && Number.isFinite(unitPrice)) {
    const expected = qty * unitPrice;
    if (expected && Math.abs(expected - lineTotal) / expected > 0.02) {
      warnings.push({ code: ANOMALY.LINE_TOTAL_MISMATCH, message: "Qty × unit price does not match line total" });
    }
  }

  const headerTotal = Number(header.total);
  const headerSub = Number(header.subtotal);
  const headerTax = Number(header.tax);
  if (Number.isFinite(headerTotal) && Number.isFinite(headerSub) && Number.isFinite(headerTax)) {
    if (Math.abs(headerSub + headerTax - headerTotal) > 0.05) {
      warnings.push({ code: ANOMALY.INVOICE_TOTAL_MISMATCH, message: "Header subtotal + tax does not match total" });
    }
  }

  return { warnings, staffSafe };
}
