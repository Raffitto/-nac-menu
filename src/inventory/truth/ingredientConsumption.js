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
 *   reasonCodes: PARTIAL_RECIPE_COVERAGE and/or PUBLICATION_UNVERIFIED.
 *   lowerBound ("at least X", not a total) only when publication is confirmed.
 *   unitCoverage: share of units sold whose use of the ingredient is known.
 *   uncoveredProducts: one entry per product, ranked by units sold.
 * - UNAVAILABLE: no total can be stated (quantity null, reason non-empty).
 * postsStock is always false. Nothing here writes.
 */

import { addDecimal, compareDecimal, subtractDecimal } from "../inventoryIntelligence";
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

const RIYADH_OFFSET_MS = 3 * 60 * 60 * 1000;

/** Asia/Riyadh (fixed UTC+3, no DST) date and time of a full timestamp, or null for date-only values. */
function riyadhDateTime(value) {
  const raw = String(value || "");
  if (!raw.includes("T")) return null;
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) return null;
  const iso = new Date(ms + RIYADH_OFFSET_MS).toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16), atMidnight: iso.slice(11, 23) === "00:00:00.000" };
}

function saleDate(row) {
  return row.business_date || row.sold_on || row.order_date || row.period_start || null;
}

/** Reason codes on a PARTIAL answer: which fix unblocks the total (D1.2 R6b). */
export const PARTIAL_REASON = Object.freeze({
  RECIPE_COVERAGE: "PARTIAL_RECIPE_COVERAGE",
  PUBLICATION_UNVERIFIED: "PUBLICATION_UNVERIFIED",
});

function sumDecimal(...lists) {
  return lists.flat().reduce((total, value) => addDecimal(total, String(value)), "0");
}

function maxDecimal(a, b) {
  return compareDecimal(a, b) >= 0 ? a : b;
}

function percentOf(part, whole) {
  const p = Number(part);
  const w = Number(whole);
  if (!Number.isFinite(p) || !Number.isFinite(w) || w <= 0) return null;
  return Math.round((p / w) * 1000) / 10;
}

function unitCoverage(coverage) {
  if (coverage.sharePercent == null) return "";
  return `Recipe use of this ingredient is known for ${coverage.unitsCounted} of ${coverage.unitsSold} units sold (${coverage.sharePercent}%).`;
}

/** Uncovered products, one entry per product, largest units sold first (D1.2 R6d). */
function rankByUnitsSold(items) {
  const byKey = new Map();
  for (const item of items) {
    const key = item.menuItemId || `name:${item.product}`;
    const current = byKey.get(key);
    if (current) current.soldQuantity = addDecimal(current.soldQuantity, item.soldQuantity);
    else byKey.set(key, { ...item, soldQuantity: String(item.soldQuantity) });
  }
  return [...byKey.values()].sort((a, b) => compareDecimal(b.soldQuantity, a.soldQuantity)
    || String(a.product).localeCompare(String(b.product)));
}

function productNameFor(rows, menuItemId) {
  const row = rows.find((sale) => sale.matched_menu_item_id === menuItemId);
  return row?.display_name || row?.raw_item_name || row?.item_name || "Unnamed product";
}

function businessDayClose(date) {
  return Date.parse(`${date}T23:59:59.999+03:00`);
}

/**
 * Explicit Food Bible flag (inventory_recipe_versions.documentation.noTrackedIngredients
 * === true) on every recipe version applied to this menu item's sale days. Never
 * inferred from names (D1.2 R6c).
 */
function flaggedNoTrackedIngredients({ graphInput, menuItemId, salesRows }) {
  const recipeIds = new Set((graphInput?.recipes || [])
    .filter((recipe) => (recipe.menu_item_id || recipe.menuItemId) === menuItemId && recipe.active !== false)
    .map((recipe) => recipe.id));
  if (!recipeIds.size) return false;
  const dates = [...new Set(salesRows
    .filter((row) => row.matched_menu_item_id === menuItemId && Number(row.quantity_sold) > 0)
    .map(saleDate)
    .filter(Boolean))];
  if (!dates.length) return false;
  const versions = (graphInput?.versions || []).filter((version) => recipeIds.has(version.recipe_id)
    && ["active", "retired"].includes(version.status || "active"));
  return dates.every((date) => {
    const at = businessDayClose(date);
    const applied = versions.filter((version) => {
      const fromRaw = version.effective_from || version.effectiveFrom;
      const toRaw = version.effective_to || version.effectiveTo;
      const from = fromRaw ? Date.parse(fromRaw) : -Infinity;
      const to = toRaw ? Date.parse(toRaw) : Infinity;
      return !Number.isNaN(from) && !Number.isNaN(to) && from <= at && at < to;
    });
    return applied.length > 0 && applied.every((version) => {
      const doc = version.documentation || {};
      return doc.noTrackedIngredients === true || doc.no_tracked_ingredients === true;
    });
  });
}

/**
 * Recipe versions that start or end inside a business day on which a relevant
 * product was sold (Oracle D1.1 R4). Sales carry no time of day, so the version
 * active at business-day close is applied to the whole day; this is disclosed.
 */
export function versionChangesWithinSaleDays({ graphInput, salesRows = [], menuItemIds = [] }) {
  const recipes = graphInput?.recipes || [];
  const versions = graphInput?.versions || [];
  const lines = graphInput?.lines || [];
  const versionRecipe = new Map(versions.map((version) => [version.id, version.recipe_id]));
  const children = new Map();
  for (const line of lines) {
    const parent = versionRecipe.get(line.recipe_version_id || line.recipeVersionId);
    const child = line.sub_recipe_id || line.subRecipeId;
    if (!parent || !child) continue;
    if (!children.has(parent)) children.set(parent, new Set());
    children.get(parent).add(child);
  }
  const wanted = new Set(menuItemIds.filter(Boolean));
  const datesByRecipe = new Map();
  const visit = (recipeId, dates, seen = new Set()) => {
    if (!recipeId || seen.has(recipeId)) return;
    seen.add(recipeId);
    if (!datesByRecipe.has(recipeId)) datesByRecipe.set(recipeId, new Set());
    for (const date of dates) datesByRecipe.get(recipeId).add(date);
    for (const child of children.get(recipeId) || []) visit(child, dates, seen);
  };
  for (const recipe of recipes) {
    const menuItemId = recipe.menu_item_id || recipe.menuItemId;
    if (!menuItemId || !wanted.has(menuItemId)) continue;
    const dates = new Set(salesRows
      .filter((row) => row.matched_menu_item_id === menuItemId && Number(row.quantity_sold) > 0)
      .map(saleDate)
      .filter(Boolean));
    if (dates.size) visit(recipe.id, dates);
  }
  const recipeName = new Map(recipes.map((recipe) => [recipe.id, recipe.name || recipe.id]));
  const out = [];
  const seenKeys = new Set();
  for (const version of versions) {
    const dates = datesByRecipe.get(version.recipe_id);
    if (!dates) continue;
    for (const bound of [version.effective_from || version.effectiveFrom, version.effective_to || version.effectiveTo]) {
      const at = riyadhDateTime(bound);
      if (!at || at.atMidnight || !dates.has(at.date)) continue;
      const key = `${version.recipe_id}|${at.date}|${at.time}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      out.push({ recipeId: version.recipe_id, recipeName: recipeName.get(version.recipe_id), businessDate: at.date, changedAt: `${at.time} AST` });
    }
  }
  return out.sort((a, b) => `${a.businessDate}${a.recipeName}`.localeCompare(`${b.businessDate}${b.recipeName}`));
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

  const versionChanges = versionChangesWithinSaleDays({
    graphInput,
    salesRows: eligible,
    menuItemIds: [
      ...contributions.map((item) => item.menuItemId),
      ...ledger.partialSales.map((driver) => driver.menuItemId),
    ],
  });
  common.versionChangesWithinDay = versionChanges;
  const versionNote = versionChanges.length
    ? ` ${versionChanges.map((change) => `The recipe for ${change.recipeName} changed during business day ${change.businessDate} (at ${change.changedAt}); the version active at the close of that day is applied to all of that day's sales, because sales carry no time of day.`).join(" ")}`
    : "";

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
  // Sold products with no active Food Bible recipe: their use of this ingredient is unknown (R6).
  // Covered products whose recipe expands to no ingredients at all count only when the
  // Food Bible explicitly flags them "no tracked ingredients" (D1.2 R6c); never inferred.
  const ingredientBearing = new Set(ledger.rows.flatMap((entry) => (entry.menuItems || []).map((item) => item.menuItemId)));
  const notCovered = new Set([
    ...(ledger.uncoveredSales || []).map((driver) => driver.menuItemId),
    ...ledger.partialSales.map((driver) => driver.menuItemId),
  ].filter(Boolean));
  const noTrackedIngredientItems = [];
  const emptyUnflagged = [];
  for (const [menuItemId, sold] of netByMenuItem.entries()) {
    if (compareDecimal(sold, "0") <= 0 || notCovered.has(menuItemId) || ingredientBearing.has(menuItemId)) continue;
    const product = productNameFor(eligible, menuItemId);
    const entry = { product, menuItemId, soldQuantity: sold };
    if (flaggedNoTrackedIngredients({ graphInput, menuItemId, salesRows: eligible })) {
      noTrackedIngredientItems.push({ ...entry, noTrackedIngredients: true });
    } else {
      emptyUnflagged.push({ ...entry, reason: "recipe_has_no_ingredients_unflagged" });
    }
  }
  const uncoveredProducts = rankByUnitsSold([
    ...(ledger.uncoveredSales || [])
      .filter((driver) => compareDecimal(String(driver.soldQuantity || "0"), "0") > 0)
      .map((driver) => ({
        product: driver.displayName || "Unnamed product",
        menuItemId: driver.menuItemId || null,
        soldQuantity: String(driver.soldQuantity),
        reason: driver.menuItemId ? "no_active_recipe" : "no_menu_item_match",
      })),
    ...emptyUnflagged,
  ]);
  common.uncoveredProducts = uncoveredProducts;
  common.noTrackedIngredientItems = noTrackedIngredientItems;

  // Share of units sold whose use of this ingredient is known (D1.2 R6a).
  const unitsSold = sumDecimal(positive.map((sale) => String(sale.quantity_sold)), eligible.filter((sale) => Number(sale.quantity_sold) < 0).map((sale) => String(sale.quantity_sold)));
  const unitsUnknown = sumDecimal([
    ...uncoveredProducts.map((item) => item.soldQuantity),
    ...excluded.filter((item) => item.source === EVIDENCE_SOURCE.FOOD_BIBLE_MENU_LINK).map((item) => String(item.soldQuantity || "0")),
  ]);
  const unitsCounted = maxDecimal(subtractDecimal(unitsSold, unitsUnknown), "0");
  common.unitCoverage = {
    unitsSold,
    unitsCounted,
    sharePercent: percentOf(unitsCounted, unitsSold),
    label: "Share of units sold whose recipe use of this ingredient is known.",
  };

  const publicationUnverified = sales.publicationVerified === false;
  const recipeCoverageGap = excluded.length > 0 || unverifiedEvidence.length > 0 || uncoveredProducts.length > 0;

  if (recipeCoverageGap || publicationUnverified) {
    const reasonCodes = [
      ...(recipeCoverageGap ? [PARTIAL_REASON.RECIPE_COVERAGE] : []),
      ...(publicationUnverified ? [PARTIAL_REASON.PUBLICATION_UNVERIFIED] : []),
    ];
    const uncoveredNames = [...new Set(uncoveredProducts.map((item) => item.product))];
    const missing = [
      ...excluded.map((item) => `${item.product} (${item.reason})`),
      ...[...new Set(unverifiedEvidence.map((item) => item.product))].map((name) => `${name} (unverified export only)`),
      ...uncoveredProducts.slice(0, 8).map((item) => `${item.soldQuantity} sold of ${item.product} (${item.reason === "recipe_has_no_ingredients_unflagged"
        ? "recipe has no ingredients and is not flagged as no tracked ingredients"
        : "no active Food Bible recipe"})`),
      ...(uncoveredNames.length > 8 ? [`${uncoveredNames.length - 8} more products with no active Food Bible recipe`] : []),
    ];
    const parts = [];
    if (missing.length) parts.push(`${missing.join(", ")} also may use ${ingredient.name} and could not be counted.`);
    if (publicationUnverified) {
      parts.push(`Canonical Foodics publication for ${window.label} could not be confirmed (${sales.publicationNote || "no freshness record"}), so the sales read may be incomplete.`);
    }
    // "At least X" is a true lower bound only when the sales read is known complete:
    // refunds are netted and over-refunds refused, and every counted contribution is
    // positive, so uncounted products can only add. With publication unconfirmed,
    // unread refund rows could lower it, so no lower bound is stated.
    const lowerBound = publicationUnverified
      ? null
      : {
        quantity: subset,
        unit,
        label: `At least ${subset} ${unit || ""}`.trim() + ". A lower bound from complete Food Bible products only; this is not a total.",
      };
    const coverageNote = ` ${unitCoverage(common.unitCoverage)}`;
    return {
      ...common,
      status: CONSUMPTION_STATUS.PARTIAL,
      quantity: null,
      unit,
      reasonCodes,
      lowerBound,
      lowerBoundWithheld: lowerBound ? null : "Publication is unconfirmed, so unread refund rows could lower the covered figure; no lower bound is stated.",
      coveredSubset: { quantity: subset, unit, products: productList, label: "Complete Food Bible products only. This is not a total." },
      reason: `Not a total: ${parts.join(" ")}${coverageNote}${versionNote}`,
    };
  }
  return {
    ...common,
    status: CONSUMPTION_STATUS.PROVISIONAL,
    quantity: subset,
    unit,
    reasonCodes: [],
    products: productList,
    reason: `Computed by the Inventory Truth recipe engine: dated recipe versions per sale day, nested sub-recipes, and unit conversion to the ingredient base unit. Every sold product in the period has an active Food Bible recipe.${noTrackedIngredientItems.length ? ` ${noTrackedIngredientItems.map((item) => item.product).join(", ")} ${noTrackedIngredientItems.length === 1 ? "is" : "are"} flagged in the Food Bible as having no tracked ingredients.` : ""}${versionNote}`,
  };
}
