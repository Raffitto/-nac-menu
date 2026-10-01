import { normalizeText } from "../inventoryIntelligence";
import { interpretSupplierPack, resolvePriceRequirement } from "./receivingPolicy";

export { isOperationalReceivingLocation } from "./receivingLocation";

const WEAK_TOKENS = new Set([
  "nac", "printed", "each", "pcs", "pieces", "piece", "pack", "packs", "supplier", "item",
]);

export function distinctiveTokens(value) {
  return normalizeText(value).split(" ").filter((token) => token.length >= 4 && !WEAK_TOKENS.has(token) && !/^\d+$/.test(token));
}

export function ingredientSuggestionIsSafe(description, ingredientName) {
  const needed = distinctiveTokens(description);
  const name = normalizeText(ingredientName);
  if (!needed.length || !name) return false;
  return needed.some((token) => name.includes(token));
}

export function documentHasReceivingLocation(invoice = {}) {
  if (invoice.hasReceivingLocation === false) return false;
  if (invoice.hasReceivingLocation === true) return true;
  return Boolean(invoice.receiving_location_id || invoice.receivingLocationId);
}

/**
 * One readiness decision for a receiving document.
 * Historical OCR exceptions are not passed in; current line and treatment truth is.
 */
export function evaluateInvoiceReadiness({
  invoice = {},
  lines = [],
  ingredients = [],
  duplicateMayPost = true,
} = {}) {
  const active = (lines || []).filter((line) => line.active !== false);
  const treatment = invoice.receiving_treatment || invoice.receivingTreatment || null;
  const channel = invoice.purchase_channel || invoice.purchaseChannel || "supplier_credit";
  const actions = [];
  const warnings = [];

  if (!(invoice.supplier_id || invoice.supplierId)) actions.push("Create or match the supplier.");
  if (!treatment) actions.push("Choose how this document should be received.");
  if (!documentHasReceivingLocation(invoice)) actions.push("Choose where this delivery was received.");
  if (duplicateMayPost === false) actions.push("This document matches one that was already received.");

  const lineState = active.map((line) => {
    const ingredient = ingredients.find((item) => item.id === line.ingredient_id);
    const price = resolvePriceRequirement({ treatment, channel, line });
    const pack = interpretSupplierPack({
      description: line.original_description || line.originalDescription,
      quantity: line.original_quantity ?? line.quantity,
      learned: (line.pack_status || line.packStatus) === "verified" || line.learnedPack
        ? { status: "verified", conversionFactor: Number(line.conversion_factor || line.conversionFactor || 1) }
        : null,
    });
    const problems = [];
    if (!line.ingredient_id || !["verified", "auto_matched"].includes(line.review_status || line.reviewStatus)) {
      problems.push("Map this line to an inventory item.");
    } else if (ingredient && !ingredientSuggestionIsSafe(line.original_description || line.originalDescription, ingredient.canonical_name || ingredient.name)) {
      problems.push(`This line is linked to ${ingredient.canonical_name || ingredient.name}. Create the item that matches the supplier wording.`);
    }
    const received = Number(line.canonical_received_quantity ?? line.canonicalReceivedQuantity);
    if (!Number.isFinite(received) || received <= 0) problems.push("Enter the quantity NAC received.");
    if (!(line.canonical_unit || line.canonicalUnit)) problems.push("Choose the unit NAC counts.");
    if (pack.blocksPosting) problems.push("Confirm how NAC counts this item.");
    if (treatment && price.required && price.storedPrice == null) problems.push("Enter the price on this document.");
    return {
      lineId: line.id,
      sku: line.supplier_sku || line.supplierSku || null,
      ready: problems.length === 0,
      problems,
      price,
    };
  });

  lineState.filter((line) => !line.ready).forEach((line) => {
    actions.push(line.problems[0]);
  });

  const ready = actions.length === 0 && active.length > 0;
  return {
    ready,
    headline: ready ? "READY TO RECEIVE" : (actions.length === 1 ? "1 ACTION REMAINING" : "NOT READY"),
    summary: ready ? "All receiving checks complete." : actions[0],
    actions,
    warnings,
    lineState,
    priceRequired: lineState.some((line) => line.price.required),
    treatment,
  };
}
