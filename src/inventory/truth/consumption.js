import {
  addDecimal,
  compareDecimal,
  divideDecimal,
  subtractDecimal,
} from "../inventoryIntelligence";
import {
  ACTUAL_COVERAGE,
  CONVERSION_STATUS,
  GRAPH_STATUS,
  SOURCE_SYSTEM,
  VARIANCE_REASON,
  VARIANCE_SIGN,
  VARIANCE_STATUS,
} from "./contracts";
import { resolveCanonicalCost } from "./costTruth";
import { resolveCanonicalIngredient } from "./identity";
import {
  expandRecipeToIngredients,
  issueIngredientScope,
  resolveMenuItemRecipe,
} from "./recipeGraph";
import { summarizeUomCoverage } from "./uom";

export function aggregateSalesDrivers(salesRows = []) {
  const byKey = new Map();
  for (const row of salesRows || []) {
    const menuItemId = row.matched_menu_item_id || row.matchedMenuItemId || row.menu_item_id || null;
    const name = row.matched_menu_item_name || row.raw_item_name || row.normalized_item_name || row.name || "";
    const saleAt = row.business_date || row.sold_on || row.order_date || row.sold_at || row.period_start || null;
    const key = `${menuItemId || `name:${String(name).toLowerCase()}`}|${saleAt || ""}`;
    const qty = row.quantity_sold ?? row.quantitySold ?? row.quantity ?? 0;
    const revenue = row.net_sales ?? row.netSales ?? row.gross_sales ?? null;
    const current = byKey.get(key) || {
      menuItemId,
      displayName: name,
      soldQuantity: "0",
      soldRows: 0,
      mappedRevenue: null,
      branchId: row.branch_id || row.branchId || null,
      periodStart: row.period_start || row.periodStart || null,
      periodEnd: row.period_end || row.periodEnd || null,
      saleAt,
    };
    current.soldQuantity = addDecimal(current.soldQuantity, String(qty || 0));
    current.soldRows += 1;
    if (revenue != null && revenue !== "") {
      current.mappedRevenue = current.mappedRevenue == null
        ? String(revenue)
        : addDecimal(current.mappedRevenue, String(revenue));
    }
    byKey.set(key, current);
  }
  return [...byKey.values()];
}

export function computeTheoreticalLedger({
  salesRows = [],
  graph,
  graphAt = null,
  identities = [],
  costByIngredientId = {},
  periodStart = null,
  periodEnd = null,
  branchId = null,
} = {}) {
  const drivers = aggregateSalesDrivers(salesRows);
  const identityById = new Map((identities || []).map((row) => [row.canonicalIngredientId, row]));
  const ledger = new Map();
  const uncovered = [];
  const partial = [];
  const uomLines = [];
  const recipeIssues = [];
  let coveredRows = 0;
  let uncoveredRows = 0;
  let partialRows = 0;
  let coveredQty = "0";
  let uncoveredQty = "0";
  let partialQty = "0";
  let coveredRevenue = null;
  let uncoveredRevenue = null;
  let partialRevenue = null;

  const addRevenue = (current, add) => {
    if (add == null) return current;
    return current == null ? String(add) : addDecimal(current, String(add));
  };

  for (const driver of drivers) {
    const activeGraph = typeof graphAt === "function" && driver.saleAt
      ? graphAt(driver.saleAt)
      : graph;
    const resolved = driver.menuItemId
      ? resolveMenuItemRecipe(activeGraph, driver.menuItemId)
      : { recipe: null, status: GRAPH_STATUS.MISSING_RECIPE, candidates: [] };
    const node = resolved.recipe && activeGraph?.recipeIndex?.get(resolved.recipe.id);
    const usable = Boolean(resolved.recipe && node && node.versionStatus === GRAPH_STATUS.OK);
    if (!usable) {
      const reason = !resolved.recipe
        ? resolved.status
        : (node?.versionStatus || GRAPH_STATUS.MISSING_RECIPE);
      uncovered.push({ ...driver, reason });
      uncoveredRows += driver.soldRows;
      uncoveredQty = addDecimal(uncoveredQty, driver.soldQuantity);
      uncoveredRevenue = addRevenue(uncoveredRevenue, driver.mappedRevenue);
      recipeIssues.push({
        code: reason,
        menuItemId: driver.menuItemId,
        displayName: driver.displayName,
        recipeId: resolved.recipe?.id,
        recipeName: resolved.recipe?.name,
      });
      continue;
    }

    const expansion = expandRecipeToIngredients({
      recipeId: resolved.recipe.id,
      outputNeeded: driver.soldQuantity,
      graph: activeGraph,
    });
    recipeIssues.push(...expansion.issues.map((issue) => ({
      ...issue,
      menuItemId: issue.menuItemId || driver.menuItemId,
    })));
    // A driver whose expansion has any issue is PARTIAL, never "covered".
    const blocking = expansion.issues.filter((issue) => issueIngredientScope(issue) !== undefined);
    const isPartial = blocking.length > 0;
    const affectedIngredientIds = new Set(
      blocking.map((issue) => issueIngredientScope(issue)).filter(Boolean),
    );
    if (isPartial) {
      for (const entry of expansion.ingredients.values()) affectedIngredientIds.add(entry.ingredientId);
      partial.push({
        ...driver,
        recipeId: resolved.recipe.id,
        recipeName: resolved.recipe.name || resolved.recipe.id,
        issues: blocking,
        // opaque: part of the recipe tree is unknown, so any ingredient may be missing.
        opaque: blocking.some((issue) => issueIngredientScope(issue) === null),
        affectedIngredientIds: [...affectedIngredientIds],
      });
      partialRows += driver.soldRows;
      partialQty = addDecimal(partialQty, driver.soldQuantity);
      partialRevenue = addRevenue(partialRevenue, driver.mappedRevenue);
    } else {
      coveredRows += driver.soldRows;
      coveredQty = addDecimal(coveredQty, driver.soldQuantity);
      coveredRevenue = addRevenue(coveredRevenue, driver.mappedRevenue);
    }

    const ensureRow = (ingredientId, entry = {}) => {
      const identity = identityById.get(ingredientId) || resolveCanonicalIngredient(
        activeGraph.ingredientById.get(ingredientId) || { id: ingredientId },
      );
      const current = ledger.get(ingredientId) || {
        ...identity,
        quantityTheoreticallyConsumed: "0",
        coveredSubsetQuantity: "0",
        completeness: "COMPLETE",
        partialMenuItems: [],
        baseUom: entry.baseUom || null,
        conversionStatus: entry.conversionStatus || null,
        menuItems: [],
        recipes: [],
        traces: [],
        cost: costByIngredientId[ingredientId] || null,
      };
      if (!current.baseUom && entry.baseUom) current.baseUom = entry.baseUom;
      ledger.set(ingredientId, current);
      return current;
    };

    for (const entry of expansion.ingredients.values()) {
      uomLines.push({ conversionStatus: entry.conversionStatus });
      const current = ensureRow(entry.ingredientId, entry);
      if (!isPartial) {
        current.coveredSubsetQuantity = addDecimal(current.coveredSubsetQuantity, entry.quantityBase);
      }
      current.menuItems.push({
        menuItemId: driver.menuItemId,
        displayName: driver.displayName,
        soldQuantity: driver.soldQuantity,
        contribution: entry.quantityBase,
        complete: !isPartial,
      });
      for (const trace of entry.traces) {
        current.recipes.push(...trace.path.map((step) => ({
          recipeId: step.recipeId,
          recipeName: step.recipeName,
        })));
        current.traces.push({
          ...trace,
          soldMenuItemId: driver.menuItemId,
          soldMenuItemName: driver.displayName,
          soldQuantity: driver.soldQuantity,
          sourceSalesPeriod: { start: periodStart || driver.periodStart, end: periodEnd || driver.periodEnd },
          branchId: branchId || driver.branchId,
        });
      }
    }
    if (isPartial) {
      for (const ingredientId of affectedIngredientIds) {
        const current = ensureRow(ingredientId);
        current.completeness = "PARTIAL";
        current.partialMenuItems.push({
          menuItemId: driver.menuItemId,
          displayName: driver.displayName,
          recipeId: resolved.recipe.id,
          issues: blocking.map((issue) => issue.code),
        });
      }
    }
  }

  const rows = [...ledger.values()].map((row) => ({
    ...row,
    // A total is never a partial sum: an ingredient touched by a partial driver has no total.
    quantityTheoreticallyConsumed: row.completeness === "PARTIAL" ? null : row.coveredSubsetQuantity,
    recipes: [...new Map(row.recipes.map((recipe) => [recipe.recipeId, recipe])).values()],
    cost: row.cost || resolveCanonicalCost(graph.ingredientById.get(row.canonicalIngredientId) || {}),
  }));

  const soldRows = coveredRows + uncoveredRows + partialRows;
  const soldQty = addDecimal(addDecimal(coveredQty, uncoveredQty), partialQty);
  const uom = summarizeUomCoverage(uomLines);
  const identityCovered = rows.filter((row) => row.canonicalIngredientId).length;
  return {
    rows,
    uncoveredSales: uncovered,
    partialSales: partial,
    coverage: {
      soldItemRows: soldRows,
      soldQuantity: soldQty,
      recipeCoveredSoldRows: coveredRows,
      recipeUncoveredSoldRows: uncoveredRows,
      recipePartialSoldRows: partialRows,
      recipeOpaquePartialSoldRows: partial.filter((row) => row.opaque).reduce((sum, row) => sum + row.soldRows, 0),
      mappedRevenue: coveredRevenue,
      partialRevenue,
      unmappedRevenue: uncoveredRevenue,
      recipeCoveragePct: soldRows ? coveredRows / soldRows : null,
      uomCoveragePct: uom.coveragePct,
      ingredientIdentityCoveragePct: rows.length ? identityCovered / rows.length : null,
      uom,
    },
    recipeIssues,
    period: { start: periodStart, end: periodEnd, branchId },
    source: SOURCE_SYSTEM.FOODICS_SALES,
  };
}

const UNTRUSTED_MOVEMENT_TYPES = new Set(["unknown", "probe", ""]);

function trustworthyMovements(movements = []) {
  return (movements || []).filter((row) => {
    const type = String(row.movement_type || row.movementType || "").toLowerCase();
    return type && !UNTRUSTED_MOVEMENT_TYPES.has(type);
  });
}

function movementTypesPresent(movements = []) {
  return [...new Set((movements || []).map((row) => row.movement_type || row.movementType).filter(Boolean))];
}

export function resolveActualConsumption({
  movements = [],
  stockCounts = [],
  periodStart = null,
  periodEnd = null,
  movementPresence = null,
  postedCountPresence = null,
} = {}) {
  const postedCounts = (stockCounts || []).filter((row) => {
    const status = String(row.status || "").toLowerCase();
    return status === "posted" || status === "approved";
  });
  const trusted = trustworthyMovements(movements);
  const types = movementTypesPresent(trusted);
  const emptyLedger = !trusted.length && !postedCounts.length;
  const presencePresent = movementPresence === "present" || postedCountPresence === "present";
  const presenceEmpty = movementPresence === "empty" && postedCountPresence === "empty";
  if (emptyLedger && presencePresent) {
    return {
      actualConsumption: null,
      actualUom: null,
      actualSource: null,
      actualStart: periodStart,
      actualEnd: periodEnd,
      actualCoverageStatus: ACTUAL_COVERAGE.UNAVAILABLE,
      missingMovementTypes: [
        "opening_balance",
        "purchase_receipt",
        "transfer_in",
        "transfer_out",
        "wastage",
        "physical_count_adjustment",
      ],
      note: "Posted counts or movements exist in the ledger, but no period-scoped actual consumption equation is loaded. Actual consumption is unavailable.",
    };
  }
  if (emptyLedger || presenceEmpty) {
    return {
      actualConsumption: null,
      actualUom: null,
      actualSource: null,
      actualStart: periodStart,
      actualEnd: periodEnd,
      actualCoverageStatus: ACTUAL_COVERAGE.UNAVAILABLE,
      missingMovementTypes: [
        "opening_balance",
        "purchase_receipt",
        "transfer_in",
        "transfer_out",
        "wastage",
        "physical_count_adjustment",
      ],
      note: "No posted stock counts or inventory movements exist. Actual consumption is unavailable.",
    };
  }

  if (types.includes("sale_consumption") && !postedCounts.length) {
    return {
      actualConsumption: null,
      actualUom: null,
      actualSource: SOURCE_SYSTEM.MOVEMENTS,
      actualStart: periodStart,
      actualEnd: periodEnd,
      actualCoverageStatus: ACTUAL_COVERAGE.UNAVAILABLE,
      missingMovementTypes: ["physical_count_adjustment"],
      note: "sale_consumption movements are POS-linked theoretical depletions, not independent actuals. Variance would be circular.",
    };
  }

  if (!postedCounts.length) {
    return {
      actualConsumption: null,
      actualUom: null,
      actualSource: SOURCE_SYSTEM.MOVEMENTS,
      actualStart: periodStart,
      actualEnd: periodEnd,
      actualCoverageStatus: ACTUAL_COVERAGE.PARTIAL,
      missingMovementTypes: ["physical_count_adjustment"],
      note: "Movements exist but posted opening/closing counts do not. Actual consumption is not computable.",
    };
  }

  return {
    actualConsumption: null,
    actualUom: null,
    actualSource: SOURCE_SYSTEM.STOCK_COUNTS,
    actualStart: periodStart,
    actualEnd: periodEnd,
    actualCoverageStatus: ACTUAL_COVERAGE.PARTIAL,
    missingMovementTypes: [],
    note: "Posted counts exist but a closed count-to-count consumption equation is not implemented until both period endpoints and supporting movements are complete.",
  };
}

export function computeVariance({
  theoreticalQuantity = null,
  actualQuantity = null,
  theoreticalUom = null,
  actualUom = null,
  actualCoverageStatus = ACTUAL_COVERAGE.UNAVAILABLE,
} = {}) {
  if (actualCoverageStatus !== ACTUAL_COVERAGE.AVAILABLE || actualQuantity == null) {
    return {
      varianceQuantity: null,
      variancePercent: null,
      signConvention: VARIANCE_SIGN,
      status: VARIANCE_STATUS.NOT_COMPUTABLE,
    };
  }
  if (theoreticalQuantity == null) {
    return {
      varianceQuantity: null,
      variancePercent: null,
      signConvention: VARIANCE_SIGN,
      status: VARIANCE_STATUS.NOT_COMPUTABLE,
    };
  }
  if (theoreticalUom && actualUom && theoreticalUom !== actualUom) {
    return {
      varianceQuantity: null,
      variancePercent: null,
      signConvention: VARIANCE_SIGN,
      status: VARIANCE_STATUS.UOM_INCOMPATIBLE,
    };
  }
  if (compareDecimal(String(theoreticalQuantity), "0") === 0) {
    return {
      varianceQuantity: subtractDecimal(String(actualQuantity), String(theoreticalQuantity)),
      variancePercent: null,
      signConvention: VARIANCE_SIGN,
      status: VARIANCE_STATUS.ZERO_THEORETICAL_DENOMINATOR,
    };
  }
  const varianceQuantity = subtractDecimal(String(actualQuantity), String(theoreticalQuantity));
  return {
    varianceQuantity,
    variancePercent: divideDecimal(varianceQuantity, String(theoreticalQuantity)),
    signConvention: VARIANCE_SIGN,
    status: VARIANCE_STATUS.VALID,
  };
}

export function classifyVarianceReasons({
  theoretical,
  actual,
  identity,
  cost,
} = {}) {
  const reasons = [];
  const push = (code) => {
    if (!reasons.includes(code)) reasons.push(code);
  };
  for (const issue of theoretical?.recipeIssues || []) {
    if (issue.code === GRAPH_STATUS.MISSING_RECIPE) push(VARIANCE_REASON.MISSING_RECIPE);
    if (issue.code === GRAPH_STATUS.MISSING_SUB_RECIPE) push(VARIANCE_REASON.MISSING_SUB_RECIPE);
    if (issue.code === GRAPH_STATUS.LEGACY_RECIPE) push(VARIANCE_REASON.LEGACY_RECIPE_CONTAMINATION);
    if (issue.code === CONVERSION_STATUS.MISSING_CONVERSION || issue.code === CONVERSION_STATUS.INCOMPATIBLE || issue.code === CONVERSION_STATUS.UNKNOWN) {
      push(VARIANCE_REASON.UOM_CONVERSION_MISSING);
    }
    if (issue.code === GRAPH_STATUS.INVALID_QUANTITY) push(VARIANCE_REASON.RECIPE_QUANTITY_SUSPECT);
  }
  if ((theoretical?.coverage?.recipeUncoveredSoldRows || 0) > 0) push(VARIANCE_REASON.SALES_MAPPING_GAP);
  if ((theoretical?.coverage?.recipePartialSoldRows || 0) > 0) push(VARIANCE_REASON.SALES_MAPPING_GAP);
  if (actual?.actualCoverageStatus === ACTUAL_COVERAGE.UNAVAILABLE || actual?.actualCoverageStatus === ACTUAL_COVERAGE.PARTIAL) {
    push(VARIANCE_REASON.STOCK_COUNT_GAP);
    if (actual.actualCoverageStatus === ACTUAL_COVERAGE.PARTIAL) push(VARIANCE_REASON.ACTUAL_SOURCE_PARTIAL);
  }
  if ((actual?.missingMovementTypes || []).includes("wastage")) push(VARIANCE_REASON.WASTE_NOT_CAPTURED);
  if ((actual?.missingMovementTypes || []).includes("transfer_in") || (actual?.missingMovementTypes || []).includes("transfer_out")) {
    push(VARIANCE_REASON.TRANSFER_COVERAGE_GAP);
  }
  if ((actual?.missingMovementTypes || []).includes("physical_count_adjustment") || (actual?.missingMovementTypes || []).includes("manual_adjustment")) {
    push(VARIANCE_REASON.ADJUSTMENT_COVERAGE_GAP);
  }
  if ((actual?.missingMovementTypes || []).includes("production_out")) push(VARIANCE_REASON.PRODUCTION_DEDUCTION_MISSING);
  if (identity?.ambiguousCount) push(VARIANCE_REASON.DUPLICATE_INGREDIENT_IDENTITY);
  if (cost?.actionableMissing) push(VARIANCE_REASON.COST_MISSING);
  if ((theoretical?.recipeIssues || []).some((issue) => issue.code === "YIELD_UNKNOWN")) {
    push(VARIANCE_REASON.YIELD_UNKNOWN);
  }
  return reasons;
}
