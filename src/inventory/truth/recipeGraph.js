import {
  addDecimal,
  compareDecimal,
  divideDecimal,
  multiplyDecimal,
} from "../inventoryIntelligence";
import { CONVERSION_STATUS, GRAPH_STATUS, YIELD_STATUS } from "./contracts";
import { resolveRecipeLineUom } from "./uom";
import { analyticalRecipeLines } from "./recipeLineKind";
import { recipeYield, versionCoversTimestamp } from "./recipeValidityContract";

function recipeName(recipe) {
  return recipe?.name || recipe?.nameEn || recipe?.name_en || recipe?.id || null;
}

function lineQuantity(line) {
  if (line?.quantity == null || line.quantity === "") return null;
  return String(line.quantity);
}

function addIngredientEntry(target, entry) {
  const current = target.get(entry.ingredientId);
  if (!current) {
    target.set(entry.ingredientId, {
      ingredientId: entry.ingredientId,
      quantityBase: entry.quantityBase,
      baseUom: entry.baseUom,
      conversionStatus: entry.conversionStatus,
      traces: [...entry.traces],
    });
    return;
  }
  current.quantityBase = addDecimal(current.quantityBase, entry.quantityBase);
  current.traces.push(...entry.traces);
  if (current.conversionStatus !== entry.conversionStatus) {
    current.conversionStatus = CONVERSION_STATUS.UNKNOWN;
  }
}

export function selectAnalyticalVersion(versions = [], { asOf = null } = {}) {
  const dated = (versions || []).filter((version) => versionCoversTimestamp(version, asOf));
  if (asOf) {
    if (dated.length > 1) {
      return { version: null, status: GRAPH_STATUS.MULTIPLE_ACTIVE_VERSIONS, candidates: dated };
    }
    if (dated.length === 1) {
      return { version: dated[0], status: GRAPH_STATUS.OK, candidates: dated };
    }
    return { version: null, status: GRAPH_STATUS.INACTIVE_VERSION, candidates: versions };
  }
  const active = (versions || []).filter((version) => String(version.status || "").toLowerCase() === "active");
  const drafts = (versions || []).filter((version) => String(version.status || "").toLowerCase() === "draft");
  const retired = (versions || []).filter((version) => String(version.status || "").toLowerCase() === "retired");
  if (active.length > 1) {
    return { version: null, status: GRAPH_STATUS.MULTIPLE_ACTIVE_VERSIONS, candidates: active };
  }
  if (active.length === 1) {
    return { version: active[0], status: GRAPH_STATUS.OK, candidates: active };
  }
  if (retired.length && !drafts.length) {
    return { version: null, status: GRAPH_STATUS.LEGACY_RECIPE, candidates: retired };
  }
  if (versions.length) {
    return { version: null, status: GRAPH_STATUS.INACTIVE_VERSION, candidates: versions };
  }
  return { version: null, status: GRAPH_STATUS.MISSING_RECIPE, candidates: [] };
}

export function buildRecipeGraph({ recipes = [], versions = [], lines = [], ingredients = [], asOf = null } = {}) {
  const recipeById = new Map((recipes || []).map((recipe) => [recipe.id, recipe]));
  const ingredientById = new Map((ingredients || []).map((ingredient) => [ingredient.id, ingredient]));
  const versionsByRecipe = new Map();
  for (const version of versions || []) {
    if (!versionsByRecipe.has(version.recipe_id)) versionsByRecipe.set(version.recipe_id, []);
    versionsByRecipe.get(version.recipe_id).push(version);
  }
  const linesByVersion = new Map();
  for (const line of lines || []) {
    const key = line.recipe_version_id || line.recipeVersionId;
    if (!key) continue;
    if (!linesByVersion.has(key)) linesByVersion.set(key, []);
    linesByVersion.get(key).push(line);
  }

  const recipeIndex = new Map();
  const issues = [];
  for (const recipe of recipes || []) {
    const selected = selectAnalyticalVersion(versionsByRecipe.get(recipe.id) || [], { asOf });
    if (selected.status !== GRAPH_STATUS.OK) {
      issues.push({
        code: selected.status,
        recipeId: recipe.id,
        recipeName: recipeName(recipe),
        evidence: (selected.candidates || []).map((version) => version.id),
      });
    }
    recipeIndex.set(recipe.id, {
      recipe,
      version: selected.version,
      versionStatus: selected.status,
      lines: selected.version
        ? analyticalRecipeLines(linesByVersion.get(selected.version.id) || [], ingredientById)
        : [],
    });
  }

  const recipesByMenuItem = new Map();
  for (const recipe of recipes || []) {
    const menuItemId = recipe.menu_item_id || recipe.menuItemId;
    if (!menuItemId || recipe.active === false) continue;
    if (!recipesByMenuItem.has(menuItemId)) recipesByMenuItem.set(menuItemId, []);
    recipesByMenuItem.get(menuItemId).push(recipe);
  }

  return {
    recipeById,
    ingredientById,
    recipeIndex,
    recipesByMenuItem,
    issues,
  };
}

function yieldStatusForVersion(version) {
  const raw = version?.yield_percentage ?? version?.yieldPercentage;
  if (raw == null) return YIELD_STATUS.UNKNOWN;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return YIELD_STATUS.UNKNOWN;
  if (value === 100) return YIELD_STATUS.UNKNOWN;
  return YIELD_STATUS.SOURCE_BACKED;
}

export function expandRecipeToIngredients({
  recipeId,
  outputNeeded = "1",
  graph,
  visiting = new Set(),
  path = [],
} = {}) {
  const empty = { ingredients: new Map(), issues: [], traces: [], yieldStatus: YIELD_STATUS.UNKNOWN };
  if (!recipeId || !graph) {
    return { ...empty, issues: [{ code: GRAPH_STATUS.MISSING_RECIPE, recipeId }] };
  }
  if (visiting.has(recipeId)) {
    return {
      ...empty,
      issues: [{ code: GRAPH_STATUS.CIRCULAR, recipeId, path: [...path, recipeId] }],
    };
  }

  const node = graph.recipeIndex.get(recipeId);
  if (!node) {
    return { ...empty, issues: [{ code: GRAPH_STATUS.MISSING_SUB_RECIPE, recipeId }] };
  }
  if (node.recipe?.active === false) {
    return {
      ...empty,
      issues: [{ code: GRAPH_STATUS.LEGACY_RECIPE, recipeId, recipeName: recipeName(node.recipe) }],
    };
  }
  if (node.versionStatus !== GRAPH_STATUS.OK) {
    return { ...empty, issues: [{ code: node.versionStatus, recipeId, recipeName: recipeName(node.recipe) }] };
  }

  const outputQty = node.recipe.output_quantity ?? node.recipe.outputQuantity ?? "1";
  if (outputQty == null || compareDecimal(String(outputQty), "0") <= 0) {
    return { ...empty, issues: [{ code: GRAPH_STATUS.INVALID_QUANTITY, recipeId }] };
  }

  const yieldStatus = yieldStatusForVersion(node.version);
  let scale = divideDecimal(String(outputNeeded), String(outputQty));
  if (yieldStatus === YIELD_STATUS.SOURCE_BACKED) {
    const yieldPct = node.version.yield_percentage ?? node.version.yieldPercentage;
    scale = divideDecimal(scale, divideDecimal(String(yieldPct), "100"));
  }

  const nextVisit = new Set(visiting);
  nextVisit.add(recipeId);
  const ingredients = new Map();
  const issues = [];
  const traces = [];

  for (const line of analyticalRecipeLines(node.lines || [], graph.ingredientById) ) {
    const qty = lineQuantity(line);
    if (qty == null) {
      issues.push({ code: GRAPH_STATUS.MISSING_QUANTITY, recipeId, lineId: line.id });
      continue;
    }
    if (compareDecimal(qty, "0") <= 0) {
      issues.push({ code: GRAPH_STATUS.INVALID_QUANTITY, recipeId, lineId: line.id, quantity: qty });
      continue;
    }

    const ingredientId = line.ingredient_id || line.ingredientId;
    const subRecipeId = line.sub_recipe_id || line.subRecipeId;
    const required = multiplyDecimal(qty, scale);
    const step = {
      recipeId,
      recipeName: recipeName(node.recipe),
      lineId: line.id,
      lineQuantity: qty,
      unit: line.unit,
      scale,
      required,
    };

    if (subRecipeId) {
      const nestedNode = graph.recipeIndex.get(subRecipeId);
      const nestedYield = recipeYield(nestedNode?.recipe, nestedNode?.version);
      let nestedNeeded = required;
      if (nestedYield.unit) {
        const converted = resolveRecipeLineUom({
          quantity: required,
          unit: line.unit,
          baseUom: nestedYield.unit,
          verifiedConversionFactor: line.verified_conversion_factor || line.verifiedConversionFactor || null,
        });
        if (converted.conversionStatus !== CONVERSION_STATUS.EXACT && converted.conversionStatus !== CONVERSION_STATUS.CONVERTED) {
          issues.push({
            code: GRAPH_STATUS.INVALID_SUBRECIPE_VERSION_OR_UNIT,
            recipeId,
            lineId: line.id,
            unit: line.unit,
            reason: "sub_recipe_yield_uom",
          });
          continue;
        }
        nestedNeeded = converted.quantityBase;
      }
      const nested = expandRecipeToIngredients({
        recipeId: subRecipeId,
        outputNeeded: nestedNeeded,
        graph,
        visiting: nextVisit,
        path: [...path, recipeId],
      });
      issues.push(...nested.issues);
      for (const nestedEntry of nested.ingredients.values()) {
        addIngredientEntry(ingredients, {
          ...nestedEntry,
          traces: nestedEntry.traces.map((trace) => ({ ...trace, path: [step, ...trace.path] })),
        });
      }
      continue;
    }

    if (!ingredientId) {
      issues.push({ code: GRAPH_STATUS.MISSING_QUANTITY, recipeId, lineId: line.id, reason: "empty_line" });
      continue;
    }

    const ingredient = graph.ingredientById.get(ingredientId);
    const resolved = resolveRecipeLineUom({
      quantity: required,
      unit: line.unit,
      baseUom: ingredient?.baseInventoryUnit || ingredient?.base_inventory_unit || line.canonical_unit,
      verifiedConversionFactor: line.verified_conversion_factor || null,
    });
    if (resolved.conversionStatus !== CONVERSION_STATUS.EXACT && resolved.conversionStatus !== CONVERSION_STATUS.CONVERTED) {
      issues.push({
        code: resolved.conversionStatus,
        recipeId,
        ingredientId,
        lineId: line.id,
        unit: line.unit,
      });
    }
    const contribution = resolved.quantityBase;
    const trace = {
      ingredientId,
      path: [step],
      contributionBaseQty: contribution,
      conversionStatus: resolved.conversionStatus,
      baseUom: resolved.baseUom,
      uomOriginal: resolved.uomOriginal,
    };
    traces.push(trace);
    if (contribution == null) continue;
    addIngredientEntry(ingredients, {
      ingredientId,
      quantityBase: contribution,
      baseUom: resolved.baseUom,
      conversionStatus: resolved.conversionStatus,
      traces: [trace],
    });
  }

  return {
    ingredients,
    issues,
    traces,
    yieldStatus,
  };
}

export function resolveMenuItemRecipe(graph, menuItemId, { namedCandidates = [] } = {}) {
  const linked = graph.recipesByMenuItem.get(menuItemId) || [];
  const active = linked.filter((recipe) => recipe.active !== false);
  if (active.length > 1) {
    return { recipe: null, status: GRAPH_STATUS.AMBIGUOUS_RECIPE, candidates: active };
  }
  if (active.length === 1) return { recipe: active[0], status: GRAPH_STATUS.OK, candidates: active };
  if (namedCandidates.length === 1) return { recipe: namedCandidates[0], status: GRAPH_STATUS.OK, candidates: namedCandidates };
  if (namedCandidates.length > 1) {
    return { recipe: null, status: GRAPH_STATUS.AMBIGUOUS_RECIPE, candidates: namedCandidates };
  }
  return { recipe: null, status: GRAPH_STATUS.MISSING_RECIPE, candidates: [] };
}
