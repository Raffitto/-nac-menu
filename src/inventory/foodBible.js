import { classifyMenuItem } from "../dashboard/config/menuOperationalTaxonomy";
import { normalizeText } from "./inventoryIntelligence";
import { areUnitsCompatible, normalizeUnit } from "./inventoryIntelligence";
import {
  CANONICAL_UNITS,
  canManageBranchIngredients,
  canManageNetworkIngredients,
  formatIngredientTimestamp,
} from "./ingredientMaster";

export const RECIPE_TYPES = Object.freeze([
  { value: "menu_item", label: "Menu item recipe" },
  { value: "preparation", label: "Prepared component" },
  { value: "direct_stock", label: "Stock / direct item" },
]);

export const READINESS = Object.freeze({
  MISSING: "missing",
  DRAFT: "draft",
  READY: "ready",
  NEEDS_ATTENTION: "needs_attention",
});

export const READINESS_LABELS = Object.freeze({
  missing: "Missing recipe",
  draft: "In progress",
  ready: "Complete",
  needs_attention: "Needs attention",
});

export const CATALOGUE_SCOPES = Object.freeze({
  KITCHEN: "kitchen",
  COMPONENTS: "components",
  DRINKS: "drinks",
  ARCHIVED: "archived",
  ALL: "all",
});

const NON_KITCHEN_CATEGORY = /drink|beverage|coffee|espresso|soft\s*drink|barista|add-?ons?|extras/i;

export const DEFAULT_DOCUMENTATION = Object.freeze({
  preparationMethod: "",
  cookingInstructions: "",
  platingInstructions: "",
  storageInstructions: "",
  shelfLifeValue: "",
  shelfLifeUnit: "hours",
  equipmentNotes: "",
  qualityCheckpoints: "",
  internalNotes: "",
});

export const STAGE_PRESETS = Object.freeze([
  "Sauce",
  "Batter",
  "Filling",
  "Garnish",
  "Assembly",
  "Plating",
]);

export function recipeTypeLabel(value) {
  if (value === "sub_recipe") return "Prepared component";
  return RECIPE_TYPES.find((type) => type.value === value)?.label || value;
}

export function normalizeRecipeType(value) {
  if (value === "sub_recipe") return "preparation";
  return value;
}

export function isVerificationFixture(...values) {
  return values.some((value) => /\[temp verify/i.test(String(value || "")));
}

export function requiresKitchenRecipe({ name, categoryName } = {}) {
  if (isVerificationFixture(name, categoryName)) return false;
  const classified = classifyMenuItem(name, categoryName);
  if (classified.beverageTier) return false;
  if (NON_KITCHEN_CATEGORY.test(String(categoryName || ""))) return false;
  return true;
}

export function menuIdentityKey(item) {
  if (!item) return null;
  if (item.placement_group_id) return `pg:${item.placement_group_id}`;
  const name = normalizeText(item.name_en);
  if (name) return `name:${name}`;
  return `id:${item.id}`;
}

export function guestMenuStatus(item) {
  if (!item) return "unknown";
  if (!item.active) return "hidden";
  if (item.sold_out) return "sold_out";
  if (item.hidden_until && new Date(item.hidden_until) > new Date()) return "hidden";
  return "live";
}

export function guestMenuStatusLabel(status) {
  if (status === "live") return "Live";
  if (status === "hidden") return "Hidden";
  if (status === "sold_out") return "Sold out";
  return "Unknown";
}

export function dedupeMenuItems(items = []) {
  const groups = new Map();
  for (const item of items) {
    const key = menuIdentityKey(item);
    if (!key) continue;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        identityKey: key,
        primaryItem: item,
        placements: [item],
        placementGroupId: item.placement_group_id || null,
      });
      continue;
    }
    existing.placements.push(item);
    if ((item.sort_order ?? 0) < (existing.primaryItem.sort_order ?? 0)) {
      existing.primaryItem = item;
    }
    if (!existing.placementGroupId && item.placement_group_id) {
      existing.placementGroupId = item.placement_group_id;
    }
  }
  return [...groups.values()];
}

export function placementLabels(placements = [], sectionById = {}) {
  const labels = [];
  const seen = new Set();
  for (const item of placements) {
    const label = sectionById[item.section_id]?.name_en || item.section_name_en;
    if (!label || seen.has(label)) continue;
    seen.add(label);
    labels.push(label);
  }
  return labels;
}

function recipeNameKeys(recipe) {
  return [...new Set([
    recipe.normalizedName,
    recipe.name,
    recipe.nameEn,
  ].map((value) => normalizeText(value)).filter(Boolean))];
}

export function findRecipeForMenuIdentity(recipes = [], identity) {
  if (!identity) return null;
  const usable = recipes.filter((recipe) => (
    recipe.active
    && !isVerificationFixture(recipe.name, recipe.internalName, recipe.nameEn)
  ));
  const linked = usable.find((recipe) => {
    if (recipe.placementGroupId && identity.placementGroupId) {
      return recipe.placementGroupId === identity.placementGroupId;
    }
    return recipe.menuItemId === identity.primaryItem.id
      || identity.placements.some((item) => item.id === recipe.menuItemId);
  });
  if (linked) return linked;

  const identityName = normalizeText(identity.primaryItem?.name_en);
  if (!identityName) return null;
  return usable.find((recipe) => {
    if (recipe.recipeType === "preparation") return false;
    return recipeNameKeys(recipe).includes(identityName);
  }) || null;
}

export function mapRecipeRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    normalizedName: row.normalized_name,
    nameEn: row.name_en,
    nameAr: row.name_ar,
    internalName: row.internal_name,
    recipeType: normalizeRecipeType(row.recipe_type),
    menuItemId: row.menu_item_id,
    placementGroupId: row.placement_group_id,
    branchId: row.branch_id,
    scope: row.branch_id ? "branch" : "network",
    outputQuantity: row.output_quantity,
    outputUnit: row.output_unit,
    portionCount: row.portion_count,
    portionSize: row.portion_size,
    portionUnit: row.portion_unit,
    active: row.active !== false,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

export function mapVersionRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    recipeId: row.recipe_id,
    versionNumber: row.version_number,
    status: row.status,
    yieldPercentage: row.yield_percentage,
    documentation: { ...DEFAULT_DOCUMENTATION, ...(row.documentation || {}) },
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

export function mapStageRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    recipeVersionId: row.recipe_version_id,
    name: row.name,
    sortOrder: row.sort_order ?? 0,
  };
}

export function mapLineRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    recipeVersionId: row.recipe_version_id,
    ingredientId: row.ingredient_id,
    subRecipeId: row.sub_recipe_id,
    quantity: row.quantity,
    unit: row.unit,
    canonicalQuantity: row.canonical_quantity,
    canonicalUnit: row.canonical_unit,
    wastePercentage: row.waste_percentage ?? 0,
    yieldWasteFactor: row.yield_waste_factor,
    preparationNote: row.preparation_note || "",
    isOptional: row.is_optional === true,
    stageId: row.stage_id,
    sortOrder: row.sort_order ?? 0,
    lineType: row.ingredient_id ? "ingredient" : "component",
  };
}

export function yieldSummary(recipe) {
  if (!recipe?.outputQuantity) return "—";
  const unit = CANONICAL_UNITS.find((entry) => entry.value === recipe.outputUnit)?.label || recipe.outputUnit;
  let summary = `${recipe.outputQuantity} ${unit}`;
  if (recipe.portionCount) {
    summary += ` · ${recipe.portionCount} portions`;
    if (recipe.portionSize && recipe.portionUnit) {
      summary += ` (${recipe.portionSize} ${recipe.portionUnit} each)`;
    }
  }
  return summary;
}

function hasInstructions(documentation = {}) {
  return Boolean(
    documentation.preparationMethod?.trim()
      || documentation.cookingInstructions?.trim()
      || documentation.platingInstructions?.trim(),
  );
}

function lineIssues(line, { ingredientById, recipeById, recipeId }) {
  const issues = [];
  if (!line.quantity || Number(line.quantity) <= 0) issues.push("invalid_quantity");
  if (line.wastePercentage != null && (Number(line.wastePercentage) < 0 || Number(line.wastePercentage) > 100)) {
    issues.push("invalid_waste");
  }
  if (line.ingredientId) {
    const ingredient = ingredientById.get(line.ingredientId);
    if (!ingredient) issues.push("broken_ingredient");
    else if (!ingredient.active) issues.push("inactive_ingredient");
    else if (line.unit && !areUnitsCompatible(line.unit, ingredient.baseInventoryUnit)) {
      issues.push("incompatible_unit");
    }
  }
  if (line.subRecipeId) {
    if (line.subRecipeId === recipeId) issues.push("self_reference");
    const component = recipeById.get(line.subRecipeId);
    if (!component) issues.push("broken_component");
    else if (!component.active) issues.push("inactive_component");
  }
  if (!line.ingredientId && !line.subRecipeId) issues.push("empty_line");
  return issues;
}

export function detectRecipeCycle(recipeId, lines, adjacency) {
  if (!recipeId) return false;
  const graph = adjacency || buildRecipeAdjacency(lines);
  const visited = new Set();
  const stack = [recipeId];
  while (stack.length) {
    const current = stack.pop();
    if (!current) continue;
    for (const next of graph.get(current) || []) {
      if (next === recipeId) return true;
      if (visited.has(next)) continue;
      visited.add(next);
      stack.push(next);
    }
  }
  return false;
}

export function buildRecipeAdjacency(allLinesByRecipeId) {
  const graph = new Map();
  for (const [parentId, lines] of Object.entries(allLinesByRecipeId || {})) {
    const children = (lines || [])
      .map((line) => line.subRecipeId || line.sub_recipe_id)
      .filter(Boolean);
    graph.set(parentId, children);
  }
  return graph;
}

export function wouldCreateCycle(recipeId, subRecipeId, allLinesByRecipeId) {
  if (!recipeId || !subRecipeId) return false;
  if (recipeId === subRecipeId) return true;
  const graph = buildRecipeAdjacency(allLinesByRecipeId);
  const stack = [subRecipeId];
  const visited = new Set();
  while (stack.length) {
    const current = stack.pop();
    if (current === recipeId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const next of graph.get(current) || []) stack.push(next);
  }
  const draftLines = (allLinesByRecipeId[recipeId] || []).map((line) => ({
    subRecipeId: line.subRecipeId || line.sub_recipe_id,
  }));
  draftLines.push({ subRecipeId });
  return detectRecipeCycle(recipeId, draftLines, buildRecipeAdjacency({
    ...allLinesByRecipeId,
    [recipeId]: draftLines,
  }));
}

export function deriveRecipeReadiness({
  recipe,
  version,
  lines = [],
  ingredientById = new Map(),
  recipeById = new Map(),
  menuItem = null,
  cycleDetected = false,
  catalogueMode = false,
  lineCount = 0,
}) {
  const checklist = [];
  const issues = [];

  if (!recipe) {
    return {
      readiness: READINESS.MISSING,
      checklist,
      issues: ["missing_recipe"],
    };
  }

  checklist.push({
    id: "name",
    label: "Recipe name entered",
    complete: Boolean(recipe.name?.trim()),
    requiredForReady: true,
  });

  if (recipe.recipeType === "menu_item" || recipe.recipeType === "direct_stock") {
    checklist.push({
      id: "menu_item",
      label: "Menu item linked",
      complete: Boolean(recipe.menuItemId),
      requiredForReady: true,
    });
    if (recipe.menuItemId && !menuItem) issues.push("broken_menu_link");
    if (menuItem && !menuItem.active && recipe.recipeType === "menu_item") {
      issues.push("inactive_menu_item");
    }
  }

  checklist.push({
    id: "yield",
    label: "Batch yield entered",
    complete: Boolean(recipe.outputQuantity && Number(recipe.outputQuantity) > 0 && recipe.outputUnit),
    requiredForReady: true,
  });

  checklist.push({
    id: "portion",
    label: "Portion defined",
    complete: Boolean(
      (recipe.portionCount && Number(recipe.portionCount) > 0)
        || (recipe.portionSize && Number(recipe.portionSize) > 0 && recipe.portionUnit),
    ),
    requiredForReady: true,
  });

  const validLines = catalogueMode
    ? (Number(lineCount) > 0 ? [{ ingredientId: "present" }] : [])
    : lines.filter((line) => line.ingredientId || line.subRecipeId);
  checklist.push({
    id: "lines",
    label: "Ingredients or components added",
    complete: validLines.length > 0,
    requiredForReady: true,
  });

  checklist.push({
    id: "instructions",
    label: "Instructions added",
    complete: hasInstructions(version?.documentation),
    requiredForReady: true,
  });

  if (!catalogueMode) {
    for (const line of validLines) {
      issues.push(...lineIssues(line, { ingredientById, recipeById, recipeId: recipe.id }));
    }
  }

  if (!catalogueMode && recipe.recipeType === "direct_stock") {
    const ingredientLines = validLines.filter((line) => line.ingredientId);
    if (ingredientLines.length !== 1) issues.push("direct_stock_line_count");
  }

  if (cycleDetected) issues.push("circular_component");

  const hasAttention = issues.some((issue) => [
    "inactive_ingredient",
    "inactive_component",
    "incompatible_unit",
    "broken_menu_link",
    "broken_ingredient",
    "broken_component",
    "self_reference",
    "circular_component",
    "direct_stock_line_count",
  ].includes(issue));

  const ready = checklist.filter((item) => item.requiredForReady).every((item) => item.complete)
    && validLines.length > 0
    && !hasAttention
    && !issues.includes("invalid_quantity")
    && !issues.includes("invalid_waste");

  if (hasAttention) {
    return { readiness: READINESS.NEEDS_ATTENTION, checklist, issues };
  }
  if (ready) {
    return { readiness: READINESS.READY, checklist, issues };
  }
  if (version || validLines.length || recipe.name) {
    return { readiness: READINESS.DRAFT, checklist, issues };
  }
  return { readiness: READINESS.MISSING, checklist, issues };
}

export function isLiveKitchenRow(row) {
  if (!row || row.kind !== "menu_item") return false;
  if (row.isVerificationFixture) return false;
  if (row.requiresKitchenRecipe === false) return false;
  if (row.guestStatus && row.guestStatus !== "live") return false;
  return true;
}

export function buildFoodBibleSummary(rows = []) {
  const menuRows = rows.filter((row) => row.kind === "menu_item");
  const kitchen = rows.filter(isLiveKitchenRow);
  const complete = kitchen.filter((row) => row.readiness === READINESS.READY).length;
  const inProgress = kitchen.filter((row) => row.readiness === READINESS.DRAFT).length;
  const missing = kitchen.filter((row) => row.readiness === READINESS.MISSING).length;
  const needsAttention = kitchen.filter((row) => row.readiness === READINESS.NEEDS_ATTENTION).length;
  const mapped = kitchen.filter((row) => Boolean(row.recipeId)).length;
  const incomplete = inProgress + needsAttention;
  const coveragePct = kitchen.length ? Math.round((mapped / kitchen.length) * 100) : 0;
  const fullyCosted = kitchen.filter((row) => row.cost?.profitabilityAvailable && row.costTrustStatus === "TRUSTED").length;
  const partiallyCosted = kitchen.filter((row) => (
    row.cost?.profitabilityAvailable
    && row.costTrustStatus
    && row.costTrustStatus !== "TRUSTED"
    && row.costTrustStatus !== "UNRELIABLE"
  )).length;
  const uncosted = kitchen.length - fullyCosted - partiallyCosted;
  const costCoveragePct = kitchen.length ? Math.round((fullyCosted / kitchen.length) * 100) : 0;
  return {
    totalMenuItems: kitchen.length,
    liveKitchenItems: kitchen.length,
    uniqueLiveKitchenItems: kitchen.length,
    complete,
    inProgress,
    incomplete,
    missing,
    needsAttention,
    mapped,
    coveragePct,
    placementCount: menuRows.reduce((sum, row) => sum + (row.placements?.length || 1), 0),
    uniqueIdentityCount: menuRows.length,
    preparedComponentCount: rows.filter((row) => row.kind === "component" && !row.isVerificationFixture).length,
    drinkCount: menuRows.filter((row) => row.requiresKitchenRecipe === false && !row.isVerificationFixture).length,
    fullyCosted,
    partiallyCosted,
    uncosted,
    costCoveragePct,
  };
}

export function foodBibleCostCell(row) {
  if (row?.cost?.profitabilityAvailable && row.cost.costPerSoldPortion != null) {
    return {
      trust: null,
      portion: row.cost.costPerSoldPortion,
      label: "Costed",
    };
  }
  return {
    trust: "Not costed",
    portion: null,
    label: "Missing cost",
  };
}

export function filterFoodBibleRows(rows, {
  search = "",
  readiness = "all",
  menuVisibility = "all",
  category = "all",
  recipeType = "all",
  catalogue = CATALOGUE_SCOPES.KITCHEN,
}) {
  const query = normalizeText(search);
  return rows.filter((row) => {
    if (row.isVerificationFixture) return false;
    if (readiness !== "all" && row.readiness !== readiness) return false;
    if (recipeType !== "all" && row.recipeType !== recipeType) return false;
    if (category !== "all" && row.categoryName !== category) return false;
    if (catalogue === CATALOGUE_SCOPES.KITCHEN && !isLiveKitchenRow(row)) return false;
    if (catalogue === CATALOGUE_SCOPES.COMPONENTS && row.kind !== "component") return false;
    if (catalogue === CATALOGUE_SCOPES.DRINKS && (row.kind !== "menu_item" || row.requiresKitchenRecipe !== false || row.guestStatus === "hidden")) return false;
    if (catalogue === CATALOGUE_SCOPES.ARCHIVED) {
      const archived = row.kind === "archived" || row.guestStatus === "hidden" || row.operationallyActive === false;
      if (!archived) return false;
    }
    if (catalogue === CATALOGUE_SCOPES.ALL && row.kind === "archived") return false;
    if (menuVisibility === "active" && row.guestStatus !== "live") return false;
    if (menuVisibility === "hidden" && row.guestStatus !== "hidden") return false;
    if (menuVisibility === "sold_out" && row.guestStatus !== "sold_out") return false;
    if (menuVisibility === "archived") {
      const archived = row.kind === "archived" || row.guestStatus === "hidden" || row.operationallyActive === false;
      if (!archived) return false;
    }
    if (!query) return true;
    const haystack = normalizeText([
      row.displayName,
      row.displayNameAr,
      row.recipeName,
      row.internalName,
      row.categoryName,
      row.placementSummary,
    ].filter(Boolean).join(" "));
    return haystack.includes(query);
  });
}

export function duplicateLineWarning(lines, candidate) {
  return lines.some((line) => {
    if (line === candidate) return false;
    const sameIngredient = candidate.ingredientId && line.ingredientId === candidate.ingredientId;
    const sameComponent = candidate.subRecipeId && line.subRecipeId === candidate.subRecipeId;
    if (!sameIngredient && !sameComponent) return false;
    const noteA = normalizeText(line.preparationNote || "");
    const noteB = normalizeText(candidate.preparationNote || "");
    return noteA === noteB;
  });
}

export function validateRecipeDraft(form, lines = []) {
  if (!form.name?.trim()) return { ok: false, message: "Recipe name is required." };
  if (!form.recipeType) return { ok: false, message: "Choose a recipe type." };
  if (!form.outputQuantity || Number(form.outputQuantity) <= 0) {
    return { ok: false, message: "Enter a batch yield greater than zero." };
  }
  if (!form.outputUnit) return { ok: false, message: "Choose a yield unit." };
  if ((form.recipeType === "menu_item" || form.recipeType === "direct_stock") && !form.menuItemId) {
    return { ok: false, message: "Link a menu item for this recipe type." };
  }
  for (const line of lines) {
    if (!line.ingredientId && !line.subRecipeId) continue;
    if (!line.quantity || Number(line.quantity) <= 0) {
      return { ok: false, message: "Each ingredient line needs a quantity greater than zero." };
    }
    if (line.wastePercentage != null && (Number(line.wastePercentage) < 0 || Number(line.wastePercentage) > 100)) {
      return { ok: false, message: "Waste must be between 0% and 100%." };
    }
  }
  return { ok: true, name: form.name.trim() };
}

export function computeCanonicalLine(line, ingredientById) {
  const ingredient = ingredientById.get(line.ingredientId);
  const targetUnit = ingredient?.baseInventoryUnit || line.unit;
  if (!line.unit || !targetUnit) {
    throw new Error("Choose a unit for this line.");
  }
  if (!areUnitsCompatible(line.unit, targetUnit)) {
    throw new Error("This unit is not compatible with the ingredient base unit yet.");
  }
  let canonicalQuantity = line.quantity;
  if (normalizeUnit(line.unit) !== normalizeUnit(targetUnit)) {
    const from = normalizeUnit(line.unit);
    const to = normalizeUnit(targetUnit);
    const factors = { gram: 1, kilogram: 1000, millilitre: 1, litre: 1000, each: 1 };
    canonicalQuantity = String(
      (Number(line.quantity) * factors[from]) / factors[to],
    );
  }
  const wasteFactor = 1 + (Number(line.wastePercentage || 0) / 100);
  return {
    canonicalQuantity,
    canonicalUnit: targetUnit,
    yieldWasteFactor: wasteFactor,
  };
}

export function canManageBranchRecipes(access, branchId) {
  return canManageBranchIngredients(access, branchId);
}

export function canManageNetworkRecipes(access) {
  return canManageNetworkIngredients(access);
}

export function friendlyRecipeError(error, fallback = "Something went wrong. Please try again.") {
  const raw = error?.message || String(error || "");
  if (!raw) return fallback;
  if (/permission|access denied|row-level security|42501/i.test(raw)) {
    return "You don't have permission to change recipes.";
  }
  if (/circular|cycle|self reference/i.test(raw)) {
    return "This component would create a circular recipe dependency.";
  }
  if (/duplicate|unique constraint/i.test(raw)) {
    return "A recipe already exists for this menu item.";
  }
  return raw.length > 160 ? fallback : raw;
}

export { formatIngredientTimestamp as formatRecipeTimestamp };
