import { divideDecimal, multiplyDecimal, normalizeMeasurementUnit } from "../inventoryIntelligence";
import { summarizeIngredientConsumptionWithTruth } from "../truth/ingredientConsumption";
import {
  addIsoDays,
  latestCompletedBusinessDate,
  listInclusiveIsoDates,
  riyadhYmd,
} from "../../intelligence/askNac/coverage/temporalCoverage";

const BRANCHES = ["khobar", "riyadh", "jeddah"];

export function parseConsumptionQuestion(question = "") {
  const q = String(question || "").toLowerCase();
  if (/\b(wastage|waste|breakage|broken glass|spillage)\b/.test(q)) return null;
  const asks = /\b(consum|should (we |i )?have used|theoretical|recipe coverage|incomplete recipes|unresolved conversions)\b/.test(q)
    || /\bhow much\b/.test(q);
  if (!asks) return null;
  const branch = BRANCHES.find((id) => new RegExp(`\\b${id}\\b`).test(q)) || null;
  const named = q.match(/\bhow much\s+([a-z0-9][a-z0-9 '&-]{1,40}?)\s+(should|did|would|have|khobar|riyadh|jeddah|yesterday|last|this|today|in)\b/);
  const ingredient = named ? named[1].replace(/\s+(should|have)$/, "").trim() : null;
  let period = null;
  if (/\byesterday\b/.test(q)) period = "yesterday";
  else if (/\blast week\b|\bpast week\b/.test(q)) period = "last_week";
  else if (/\btoday\b/.test(q)) period = "today";
  const topic = /\bincomplete recipes\b/.test(q)
    ? "incomplete_recipes"
    : (/\bcoverage\b/.test(q) ? "coverage" : "ingredient");
  return { ingredient, branch, period, topic };
}

/**
 * Calendar window for a consumption period, in Asia/Riyadh business dates.
 * `today` is an ISO date (already a Riyadh date) or a Date/instant (converted
 * to the Riyadh date). Never a UTC slice of the current instant.
 */
export function consumptionWindow(period, today) {
  const todayIso = today instanceof Date || typeof today === "number"
    ? riyadhYmd(new Date(today))
    : String(today || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(todayIso)) return null;
  if (period === "yesterday") {
    const day = addIsoDays(todayIso, -1);
    return { start: day, end: day, label: day };
  }
  if (period === "today") {
    return { start: todayIso, end: todayIso, label: todayIso };
  }
  if (period === "last_week") {
    const finish = addIsoDays(todayIso, -1);
    const start = addIsoDays(finish, -6);
    return { start, end: finish, label: `${start} to ${finish}` };
  }
  return null;
}

/**
 * Resolve and validate a consumption window.
 * Rules (documented in CHANGES.md, T14-T16):
 * 1. Dates are Asia/Riyadh calendar dates ("yesterday" at 01:30 AST on
 *    12 Oct is 11 Oct).
 * 2. A business day is complete only after 08:00 AST the next morning
 *    (latestCompletedBusinessDate). "today" is never complete.
 * 3. The window must also be published by canonical commerce
 *    (commerce_dataset_freshness.data_through) when that is known.
 * A window that is not fully complete is UNAVAILABLE for the requested label,
 * with the missing dates and the largest complete sub-window listed. A total is
 * never labelled with dates it does not cover.
 */
export function resolveConsumptionWindow(period, { now = new Date(), publishedThrough = null } = {}) {
  const window = consumptionWindow(period, now instanceof Date ? now : new Date(now));
  if (!window) return null;
  const latestCompleted = latestCompletedBusinessDate(now instanceof Date ? now : new Date(now));
  const caps = [latestCompleted, publishedThrough].filter(Boolean);
  const cap = caps.reduce((left, right) => (left < right ? left : right));
  const result = {
    ...window,
    requestedStart: window.start,
    requestedEnd: window.end,
    latestCompletedDate: latestCompleted,
    publishedThrough: publishedThrough || null,
    missingDates: [],
    status: "OK",
  };
  if (window.end <= cap) return result;
  const missingStart = window.start > cap ? window.start : addIsoDays(cap, 1);
  const missingDates = listInclusiveIsoDates(missingStart, window.end);
  const availableWindow = window.start <= cap ? { start: window.start, end: cap } : null;
  const notComplete = period === "today" || window.end > latestCompleted;
  const reason = notComplete
    ? `Business day ${missingDates.join(", ")} is not complete yet (a business day closes at 08:00 AST the next morning; latest complete day is ${latestCompleted}).`
    : `Canonical Foodics sales for this branch are published through ${publishedThrough}; ${missingDates.join(", ")} are not published yet.`;
  return {
    ...result,
    status: "UNAVAILABLE",
    missingDates,
    availableWindow,
    reason: `${reason}${availableWindow ? ` Ask for ${availableWindow.start} to ${availableWindow.end} for complete days.` : ""} No total is shown for ${window.label}.`,
  };
}

export function saleCountsAsSold(row) {
  const quantity = Number(row.quantity_sold);
  if (!Number.isFinite(quantity) || quantity <= 0) return false;
  if (row.is_modifier) return false;
  if (["modifier", "operational"].includes(row.semantic_class)) return false;
  return true;
}

export function scaleStoredRecipeQuantity(soldQuantity, outputQuantity, canonicalQuantity) {
  return multiplyDecimal(String(soldQuantity), divideDecimal(String(canonicalQuantity), String(outputQuantity || "1")));
}

/**
 * Compatibility adapter for callers that hold flat "recipe links"
 * ({ menuItemId, outputQuantity, canonicalQuantity, canonicalUnit } or
 * recovered { productId, ... }). Menu-id links become a one-line Food Bible
 * recipe per menu item and are computed by the canonical truth engine
 * (unit conversion, no mixed-unit sums). Product-id links are unverified
 * Foodics export evidence and never count toward a total.
 */
export function summarizeIngredientConsumption({
  ingredient = null,
  ingredients = [],
  branchId = null,
  window = null,
  sales = [],
  recipeLinks = [],
  latestSalesDate = null,
  source = null,
  salesComplete = true,
  accessDenied = false,
  recoveredEvidence = null,
} = {}) {
  const ingredientId = ingredient?.id || "ingredient";
  const firstUnit = recipeLinks.find((link) => link.menuItemId && link.canonicalUnit)?.canonicalUnit || null;
  const baseUom = ingredient?.baseUom || ingredient?.base_inventory_unit || normalizeMeasurementUnit(firstUnit) || firstUnit;
  const recipes = [];
  const versions = [];
  const lines = [];
  const byMenu = new Map();
  recipeLinks.filter((link) => link.menuItemId).forEach((link, index) => {
    if (!byMenu.has(link.menuItemId)) {
      const recipeId = `link-recipe:${link.menuItemId}`;
      byMenu.set(link.menuItemId, recipeId);
      recipes.push({ id: recipeId, name: link.menuItemId, menu_item_id: link.menuItemId, output_quantity: link.outputQuantity || "1", active: true });
      versions.push({ id: `${recipeId}:v`, recipe_id: recipeId, status: "active" });
    }
    lines.push({
      id: `link-line:${index}`,
      recipe_version_id: `${byMenu.get(link.menuItemId)}:v`,
      ingredient_id: ingredientId,
      quantity: link.canonicalQuantity,
      unit: link.canonicalUnit,
    });
  });
  const exportLinks = recipeLinks.filter((link) => link.productId && !link.menuItemId).map((link) => ({
    productId: link.productId,
    product: link.product || null,
    quantityPerUnit: link.canonicalQuantity,
    unit: link.canonicalUnit,
  }));
  return summarizeIngredientConsumptionWithTruth({
    ingredient: ingredient ? { ...ingredient, id: ingredientId } : null,
    ingredients: ingredients.length ? ingredients : null,
    branchId,
    window,
    salesRows: sales,
    graphInput: {
      recipes,
      versions,
      lines,
      ingredients: ingredient ? [{ id: ingredientId, canonical_name: ingredient.name, base_inventory_unit: baseUom, active: true }] : [],
    },
    sales: { complete: salesComplete, source, latestSalesDate },
    recoveredEvidence: recoveredEvidence || { links: exportLinks, excluded: [] },
    accessDenied,
  });
}

export function formatConsumptionAnswer(result, todayLabel) {
  if (!result) return "No consumption calculation was run. No stock was posted.";
  const scope = [result.branchId, result.periodLabel || todayLabel].filter(Boolean).join(", ");
  if (result.status === "PARTIAL" && result.coveredSubset) {
    return [
      `${result.ingredient}: no total.`,
      scope ? `${scope}.` : null,
      result.reason,
      `Complete products only: ${result.coveredSubset.quantity} ${result.coveredSubset.unit || ""}`.trim() + " (not a total).",
      result.verification,
      "Theoretical only. No stock was posted.",
    ].filter(Boolean).join(" ");
  }
  if (result.status !== "PROVISIONAL" || result.quantity == null) {
    return `${scope ? `${scope}. ` : ""}${result.reason} No stock was posted.`;
  }
  return [
    `${result.ingredient}: ${result.quantity} ${result.unit || ""}`.trim() + `.`,
    scope ? `${scope}.` : null,
    `Coverage ${result.coverage.recipeLinkedRows} of ${result.coverage.eligibleSoldRows} sold rows link to this ingredient.`,
    result.verification,
    "Theoretical only. No stock was posted.",
  ].filter(Boolean).join(" ");
}
