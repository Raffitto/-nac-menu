import { ACTUAL_COVERAGE, READINESS, VARIANCE_STATUS } from "./contracts";
import { computeTheoreticalFoodCost, resolveCanonicalCost, summarizeCostClasses } from "./costTruth";
import {
  classifyVarianceReasons,
  computeTheoreticalLedger,
  computeVariance,
  resolveActualConsumption,
} from "./consumption";
import { classifyIngredientIdentities } from "./identity";
import { buildRecipeGraph } from "./recipeGraph";
import { resolveRecipeLineUom, summarizeUomCoverage } from "./uom";

export {
  ACTUAL_COVERAGE,
  CONVERSION_STATUS,
  COST_CLASS,
  COST_METHOD,
  GRAPH_STATUS,
  IDENTITY_CONFIDENCE,
  READINESS,
  SOURCE_SYSTEM,
  THEORETICAL_LEDGER_CONTRACT,
  VARIANCE_REASON,
  VARIANCE_SIGN,
  VARIANCE_STATUS,
  YIELD_STATUS,
  theoreticalConsumedQuantity,
} from "./contracts";
export {
  clipSalesPeriod,
  reconcileSalesSources,
  selectSalesSource,
  SALES_SOURCE,
} from "./salesSource";
export { classifyIngredientIdentities, resolveCanonicalIngredient } from "./identity";
export { normalizeRecipeUnit, resolveRecipeLineUom, summarizeUomCoverage } from "./uom";
export {
  buildRecipeGraph,
  expandRecipeToIngredients,
  resolveMenuItemRecipe,
  selectAnalyticalVersion,
} from "./recipeGraph";
export {
  classifyMissingCost,
  computeTheoreticalFoodCost,
  resolveCanonicalCost,
  summarizeCostClasses,
} from "./costTruth";
export {
  aggregateSalesDrivers,
  classifyVarianceReasons,
  computeTheoreticalLedger,
  computeVariance,
  resolveActualConsumption,
} from "./consumption";

function readinessFromPct(pct, { readyAt = 0.95, partialAt = 0.01 } = {}) {
  if (pct == null) return READINESS.UNAVAILABLE;
  if (pct >= readyAt) return READINESS.READY;
  if (pct >= partialAt) return READINESS.PARTIAL;
  return READINESS.BLOCKED;
}

export function summarizeInventoryTruthReadiness({
  identity,
  uom,
  recipeGraph,
  theoretical,
  cost,
  actual,
  variance,
} = {}) {
  const recipeOk = (recipeGraph?.issues || []).filter((issue) => issue.code !== "YIELD_UNKNOWN").length === 0;
  return {
    recipeCoverage: readinessFromPct(theoretical?.coverage?.recipeCoveragePct),
    ingredientIdentityHealth: readinessFromPct(
      identity && identity.identities?.length
        ? 1 - ((identity.ambiguousCount || 0) / identity.identities.length)
        : null,
    ),
    uomHealth: readinessFromPct(uom?.coveragePct ?? theoretical?.coverage?.uomCoveragePct),
    costCoverage: readinessFromPct(cost?.coveragePct),
    theoreticalConsumptionReadiness: theoretical?.coverage
      ? readinessFromPct(theoretical.coverage.recipeCoveragePct)
      : READINESS.UNAVAILABLE,
    actualConsumptionReadiness: actual?.actualCoverageStatus === ACTUAL_COVERAGE.AVAILABLE
      ? READINESS.READY
      : actual?.actualCoverageStatus === ACTUAL_COVERAGE.PARTIAL
        ? READINESS.PARTIAL
        : READINESS.UNAVAILABLE,
    varianceReadiness: variance?.status === VARIANCE_STATUS.VALID
      ? READINESS.READY
      : READINESS.UNAVAILABLE,
    recipeGraphIntegrity: recipeOk ? READINESS.READY : READINESS.PARTIAL,
  };
}

export function exploreIngredient(canonicalIngredientId, { theoretical, identities, graph } = {}) {
  const identity = (identities?.identities || []).find((row) => row.canonicalIngredientId === canonicalIngredientId)
    || theoretical?.rows?.find((row) => row.canonicalIngredientId === canonicalIngredientId)
    || null;
  const ledger = theoretical?.rows?.find((row) => row.canonicalIngredientId === canonicalIngredientId) || null;
  const consumers = [];
  if (graph) {
    for (const [recipeId, node] of graph.recipeIndex.entries()) {
      const uses = (node.lines || []).some((line) => (line.ingredient_id || line.ingredientId) === canonicalIngredientId);
      if (!uses) continue;
      consumers.push({
        recipeId,
        recipeName: node.recipe?.name,
        recipeType: node.recipe?.recipe_type || node.recipe?.recipeType,
        menuItemId: node.recipe?.menu_item_id || node.recipe?.menuItemId,
      });
    }
  }
  return {
    identity,
    cost: ledger?.cost || identity?.cost || null,
    recipes: ledger?.recipes || consumers.filter((row) => row.recipeType === "menu_item" || !row.recipeType),
    subRecipes: consumers.filter((row) => row.recipeType === "sub_recipe" || row.recipeType === "preparation"),
    menuItems: ledger?.menuItems || [],
    theoreticalConsumption: ledger?.quantityTheoreticallyConsumed ?? null,
    actualConsumption: null,
    variance: null,
    coverage: theoretical?.coverage || null,
    traces: ledger?.traces || [],
    integrityIssues: [
      ...(identity?.identityIssues || []),
      ...(ledger?.conversionStatus && ledger.conversionStatus !== "EXACT" && ledger.conversionStatus !== "CONVERTED"
        ? [ledger.conversionStatus]
        : []),
    ],
  };
}

export function runInventoryTruthEngine({
  ingredients = [],
  recipes = [],
  versions = [],
  lines = [],
  catalogueItems = [],
  costStateByIngredientId = {},
  costHistoryByIngredientId = {},
  salesRows = [],
  movements = [],
  stockCounts = [],
  movementPresence = null,
  postedCountPresence = null,
  salesSource = null,
  salesCoverage = null,
  branchId = null,
  periodStart = null,
  periodEnd = null,
} = {}) {
  const identity = classifyIngredientIdentities({ ingredients, catalogueItems });
  const graph = buildRecipeGraph({ recipes, versions, lines, ingredients });
  const resolvedCosts = ingredients.map((ingredient) => {
    const cost = resolveCanonicalCost(ingredient, {
      costState: costStateByIngredientId[ingredient.id],
      costHistory: costHistoryByIngredientId[ingredient.id] || [],
      catalogueItems: (catalogueItems || []).filter((item) => (item.ingredientId || item.ingredient_id) === ingredient.id),
    });
    return { ingredientId: ingredient.id, ...cost };
  });
  const costByIngredientId = Object.fromEntries(resolvedCosts.map((row) => [row.ingredientId, row]));
  const theoretical = computeTheoreticalLedger({
    salesRows,
    graph,
    graphAt: (asOf) => buildRecipeGraph({ recipes, versions, lines, ingredients, asOf }),
    identities: identity.identities,
    costByIngredientId,
    periodStart,
    periodEnd,
    branchId,
  });
  const foodCost = computeTheoreticalFoodCost(theoretical.rows, costByIngredientId);
  const actual = resolveActualConsumption({
    movements,
    stockCounts,
    periodStart,
    periodEnd,
    movementPresence,
    postedCountPresence,
  });
  if (salesSource) theoretical.source = salesSource;
  if (salesCoverage) theoretical.salesCoverage = salesCoverage;
  const variance = computeVariance({
    theoreticalQuantity: null,
    actualQuantity: actual.actualConsumption,
    actualCoverageStatus: actual.actualCoverageStatus,
  });
  const costSummary = summarizeCostClasses(resolvedCosts);
  const reasons = classifyVarianceReasons({
    theoretical,
    actual,
    identity,
    cost: costSummary,
  });
  const graphUomLines = [];
  for (const node of graph.recipeIndex.values()) {
    for (const line of node.lines || []) {
      if (!(line.ingredient_id || line.ingredientId)) continue;
      const ingredient = graph.ingredientById.get(line.ingredient_id || line.ingredientId);
      graphUomLines.push({
        conversionStatus: resolveRecipeLineUom({
          quantity: line.quantity,
          unit: line.unit,
          baseUom: ingredient?.baseInventoryUnit || ingredient?.base_inventory_unit,
        }).conversionStatus,
      });
    }
  }
  const uom = summarizeUomCoverage(graphUomLines);
  const readiness = summarizeInventoryTruthReadiness({
    identity,
    uom,
    recipeGraph: graph,
    theoretical,
    cost: costSummary,
    actual,
    variance,
  });

  return {
    identity,
    graph,
    uom,
    costs: resolvedCosts,
    costSummary,
    theoretical,
    foodCost,
    actual,
    variance,
    reasons,
    readiness,
    period: { branchId, start: periodStart, end: periodEnd },
  };
}

export function traceIngredientQuantity(canonicalIngredientId, engineResult) {
  const row = engineResult?.theoretical?.rows?.find((entry) => entry.canonicalIngredientId === canonicalIngredientId);
  if (!row) {
    return {
      ingredientId: canonicalIngredientId,
      quantity: null,
      explanation: "No theoretical consumption for this ingredient in the selected sales period.",
      traces: [],
    };
  }
  return {
    ingredientId: canonicalIngredientId,
    displayName: row.displayName,
    quantity: row.quantityTheoreticallyConsumed,
    baseUom: row.baseUom,
    explanation: `${row.displayName} theoretical consumption is ${row.quantityTheoreticallyConsumed} ${row.baseUom || ""}`.trim(),
    traces: row.traces,
    menuItems: row.menuItems,
    recipes: row.recipes,
    sourceSalesPeriod: engineResult.period,
  };
}
