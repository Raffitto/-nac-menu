/**
 * Ask NAC theoretical consumption for one ingredient, computed by the canonical
 * Inventory Truth engine (buildRecipeGraph + computeTheoreticalLedger with a
 * per-sale-day graphAt). This is a summariser over truth/, not a second engine.
 *
 * Status contract:
 * - PROVISIONAL: every sold product that uses the ingredient expanded completely
 *   from Food Bible recipes. quantity is in the ingredient's base unit.
 * - PARTIAL: some products are complete, but at least one sold product is
 *   incomplete, conflicted, or only has unverified export evidence for this
 *   ingredient. quantity is null; coveredSubset carries the complete part only.
 * - UNAVAILABLE: no total can be stated (quantity null, reason non-empty).
 * postsStock is always false. Nothing here writes.
 */

import { addDecimal, compareDecimal } from "../inventoryIntelligence";
import { CONVERSION_STATUS } from "./contracts";
import { computeTheoreticalLedger } from "./consumption";
import { buildRecipeGraph } from "./recipeGraph";

/** Provenance of a consumption link. Export links never count toward a total. */
export const EVIDENCE_SOURCE = Object.freeze({
  FOOD_BIBLE_MENU_LINK: "FOOD_BIBLE_MENU_LINK",
  FOODICS_EXPORT_UNVERIFIED: "FOODICS_EXPORT_UNVERIFIED",
});

export const CONSUMPTION_STATUS = Object.freeze({
  PROVISIONAL: "PROVISIONAL",
  PARTIAL: "PARTIAL",
  UNAVAILABLE: "UNAVAILABLE",
});

const UNIT_ISSUE_CODES = new Set([
  CONVERSION_STATUS.INCOMPATIBLE,
  CONVERSION_STATUS.UNKNOWN,
  CONVERSION_STATUS.MISSING_CONVERSION,
]);

function unavailable(base, reason, extra = {}) {
  return {
    ...base,
    status: CONSUMPTION_STATUS.UNAVAILABLE,
    postsStock: false,
    quantity: null,
    unit: null,
    reason,
    ...extra,
  };
}

export function isModifierRow(row) {
  if (row?.is_modifier) return true;
  return ["modifier", "operational"].includes(row?.semantic_class);
}

function memoizedGraphAt(graphInput) {
  const cache = new Map();
  return (asOf) => {
    const key = String(asOf || "");
    if (!cache.has(key)) cache.set(key, buildRecipeGraph({ ...graphInput, asOf }));
    return cache.get(key);
  };
}

/**
 * @param {object} p
 * @param {{id:string,name:string}} p.ingredient
 * @param {Array} [p.ingredients] all name matches (ambiguity guard)
 * @param {{start,end,label,status?,reason?,missingDates?}} p.window
 * @param {Array} p.salesRows mapped sales rows (sales positive, refunds negative)
 * @param {{recipes,versions,lines,ingredients}} p.graphInput Food Bible rows
 * @param {object} [p.sales] read diagnostics: complete, source, latestSalesDate,
 *   droppedRows, refunds, orderStatusVerified, unsplittableRows, reason
 * @param {{links:Array, excluded:Array}} [p.recoveredEvidence]
 */
export function summarizeIngredientConsumptionWithTruth({
  ingredient = null,
  ingredients = null,
  branchId = null,
  window = null,
  salesRows = [],
  graphInput = { recipes: [], versions: [], lines: [], ingredients: [] },
  sales = {},
  recoveredEvidence = { links: [], excluded: [] },
  accessDenied = false,
} = {}) {
  const base = {
    branchId,
    periodLabel: window?.label || null,
    ingredient: ingredient?.name || null,
    source: sales.source || null,
    postsStock: false,
    droppedRows: sales.droppedRows || { total: 0, byReason: {} },
  };
  if (accessDenied) return unavailable(base, "This account cannot read that branch.");
  if (!branchId || !window) return unavailable(base, "Name the branch and the day or week.");
  if (window.status === CONSUMPTION_STATUS.UNAVAILABLE) {
    return unavailable(base, window.reason, { missingDates: window.missingDates || [], availableWindow: window.availableWindow || null });
  }
  const matches = ingredients || (ingredient ? [ingredient] : []);
  if (matches.length > 1) {
    return unavailable(base, `More than one ingredient matches. Choose one: ${matches.map((item) => item.name).join(", ")}.`);
  }
  if (!ingredient) return unavailable(base, "No single ingredient was named.");
  if (sales.complete === false) {
    return unavailable(base, `The sales read stopped before the period was finished (incomplete sales read). ${sales.reason || ""} No total is shown.`.replace(/\s+/g, " ").trim());
  }
  if (sales.orderStatusVerified === false) {
    return unavailable(base, "Order status could not be read, so void or returned orders cannot be excluded. No total is shown.");
  }
  if ((sales.unsplittableRows || 0) > 0) {
    return unavailable(base, `${sales.unsplittableRows} legacy import rows span dates outside ${window.label}; a multi-day import cannot be split by day. No total is shown.`);
  }

  const eligible = [];
  let modifierRows = 0;
  let unattributedRefunds = sales.refunds?.unnetted || 0;
  for (const row of salesRows || []) {
    if (isModifierRow(row)) { modifierRows += 1; continue; }
    const quantity = Number(row.quantity_sold);
    if (!Number.isFinite(quantity) || quantity === 0) continue;
    if (quantity < 0 && !row.matched_menu_item_id) { unattributedRefunds += 1; continue; }
    eligible.push(row);
  }
  if (unattributedRefunds > 0) {
    return unavailable(base, `${unattributedRefunds} refund or return rows in ${window.label} cannot be matched to a sold item, so refunds are not netted. No total is shown.`);
  }
  const positive = eligible.filter((row) => Number(row.quantity_sold) > 0);
  if (!positive.length) {
    const through = sales.latestSalesDate
      ? ` Canonical Foodics sales for this branch are published through ${sales.latestSalesDate}.`
      : "";
    return unavailable(base, `No completed sales rows fall in ${window.label}.${through}`, {
      coverage: { eligibleSoldRows: 0, recipeLinkedRows: 0 },
    });
  }
  const netByMenuItem = new Map();
  for (const row of eligible) {
    if (!row.matched_menu_item_id) continue;
    netByMenuItem.set(row.matched_menu_item_id, addDecimal(netByMenuItem.get(row.matched_menu_item_id) || "0", String(row.quantity_sold)));
  }
  const overRefunded = [...netByMenuItem.entries()].filter(([, qty]) => compareDecimal(qty, "0") < 0);
  if (overRefunded.length) {
    return unavailable(base, `Refunds exceed sales in ${window.label} for ${overRefunded.length} item(s); the original sales fall outside the window, so refunds cannot be netted here.`);
  }

  const graph = buildRecipeGraph(graphInput);
  const ledger = computeTheoreticalLedger({
    salesRows: eligible,
    graph,
    graphAt: memoizedGraphAt(graphInput),
    periodStart: window.start,
    periodEnd: window.end,
    branchId,
  });
  const row = ledger.rows.find((entry) => entry.canonicalIngredientId === ingredient.id) || null;

  const excluded = [];
  for (const driver of ledger.partialSales) {
    const relevant = driver.opaque || driver.affectedIngredientIds.includes(ingredient.id);
    if (!relevant) continue;
    const unitIssue = driver.issues.find((issue) => issue.ingredientId === ingredient.id && UNIT_ISSUE_CODES.has(issue.code));
    excluded.push({
      product: driver.displayName,
      menuItemId: driver.menuItemId,
      recipeId: driver.recipeId,
      soldQuantity: driver.soldQuantity,
      reason: unitIssue ? "incompatible_units" : "incomplete",
      issues: driver.issues.map((issue) => issue.code),
      source: EVIDENCE_SOURCE.FOOD_BIBLE_MENU_LINK,
    });
  }
  // Recovered export evidence is only consulted for products the Food Bible does not cover.
  const coveredMenuItems = new Set([
    ...(row?.menuItems || []).map((item) => item.menuItemId),
    ...ledger.partialSales.map((driver) => driver.menuItemId),
  ].filter(Boolean));
  const uncoveredProductIds = new Set(eligible
    .filter((sale) => !sale.matched_menu_item_id || !coveredMenuItems.has(sale.matched_menu_item_id))
    .map((sale) => sale.foodics_product_id)
    .filter(Boolean));
  for (const item of recoveredEvidence?.excluded || []) {
    if (!uncoveredProductIds.has(item.productId)) continue;
    excluded.push({ ...item, source: EVIDENCE_SOURCE.FOODICS_EXPORT_UNVERIFIED });
  }
  const unverifiedEvidence = (recoveredEvidence?.links || [])
    .filter((link) => uncoveredProductIds.has(link.productId))
    .map((link) => ({ ...link, source: EVIDENCE_SOURCE.FOODICS_EXPORT_UNVERIFIED, countsTowardTotal: false }));

  const contributions = (row?.menuItems || []).filter((item) => item.complete);
  const links = contributions.map((item) => ({
    product: item.displayName,
    menuItemId: item.menuItemId,
    soldQuantity: item.soldQuantity,
    contribution: item.contribution,
    source: EVIDENCE_SOURCE.FOOD_BIBLE_MENU_LINK,
    verification: "FOOD_BIBLE",
  }));
  let subset = "0";
  const products = {};
  for (const item of contributions) {
    subset = addDecimal(subset, item.contribution);
    const name = item.displayName || "Unnamed product";
    products[name] = addDecimal(products[name] || "0", item.contribution);
  }
  const unit = row?.baseUom || null;
  const recipeLinkedRows = eligible.filter((sale) => contributions.some((item) => item.menuItemId === sale.matched_menu_item_id)).length;
  const coverage = { eligibleSoldRows: positive.length, recipeLinkedRows };
  const coverageDetail = {
    ...coverage,
    refundRowsNetted: eligible.length - positive.length,
    modifierRowsExcluded: modifierRows,
    recipeUncoveredSoldRows: ledger.coverage.recipeUncoveredSoldRows,
    recipePartialSoldRows: ledger.coverage.recipePartialSoldRows,
    droppedRows: base.droppedRows,
  };
  const exportUsed = unverifiedEvidence.length > 0 || excluded.some((item) => item.source === EVIDENCE_SOURCE.FOODICS_EXPORT_UNVERIFIED);
  const verification = exportUsed
    ? "Food Bible recipe links are counted. Foodics recipe-export links are unverified evidence and are listed, not counted."
    : "Food Bible recipe linked by menu id. The recipe is not verified against a Foodics recipe export.";
  const productList = Object.entries(products).slice(0, 8).map(([name, amount]) => ({ name, amount }));
  const common = {
    ...base,
    links,
    excluded,
    unverifiedEvidence,
    coverage,
    coverageDetail,
    verification,
    cost: null,
    source: EVIDENCE_SOURCE.FOOD_BIBLE_MENU_LINK,
    salesSource: sales.source || null,
    engine: "inventory_truth",
  };

  const incompatible = excluded.filter((item) => item.reason === "incompatible_units");
  if (incompatible.length) {
    return unavailable(common, `${ingredient.name} has incompatible units in the recipe for ${incompatible.map((item) => item.product).join(", ")}; units are never summed across dimensions. No total is shown.`);
  }
  if (!contributions.length) {
    const why = excluded.length
      ? `Sold products that may use ${ingredient.name} are incomplete or conflicted: ${excluded.map((item) => `${item.product} (${item.reason})`).join(", ")}.`
      : unverifiedEvidence.length
        ? `Only unverified Foodics export links mention ${ingredient.name} (${[...new Set(unverifiedEvidence.map((item) => item.product))].join(", ")}); they are not counted.`
        : `${positive.length} sold rows are in this period, and none are linked by menu id to an active recipe that uses ${ingredient.name}.`;
    return unavailable(common, `${why} No total is shown.`);
  }
  if (excluded.length || unverifiedEvidence.length) {
    const missing = [
      ...excluded.map((item) => `${item.product} (${item.reason})`),
      ...[...new Set(unverifiedEvidence.map((item) => item.product))].map((name) => `${name} (unverified export only)`),
    ];
    return {
      ...common,
      status: CONSUMPTION_STATUS.PARTIAL,
      quantity: null,
      unit,
      coveredSubset: { quantity: subset, unit, products: productList, label: "Complete Food Bible products only. This is not a total." },
      reason: `Not a total: ${missing.join(", ")} also may use ${ingredient.name} and could not be counted.`,
    };
  }
  const uncoveredNote = ledger.coverage.recipeUncoveredSoldRows
    ? ` ${ledger.coverage.recipeUncoveredSoldRows} sold rows have no active Food Bible recipe; their use of ${ingredient.name} is unknown.`
    : "";
  return {
    ...common,
    status: CONSUMPTION_STATUS.PROVISIONAL,
    quantity: subset,
    unit,
    products: productList,
    reason: `Computed by the Inventory Truth recipe engine: dated recipe versions per sale day, nested sub-recipes, and unit conversion to the ingredient base unit.${uncoveredNote}`,
  };
}
