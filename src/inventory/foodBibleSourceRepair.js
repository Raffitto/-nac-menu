import { sourceIngredientKey } from "./foodBibleSourceCardParser.js";

const EQUIPMENT = /\b(pans?|trays?|spatulas?|bowls?|whisks?|cookers?|containers?|plancha|presser|gastro|mandoline|mixers?|mizers?|ovens?|papers?|boards?|utensils?|absorbed|adhesif|adhesive|blender|gloves?|cling film|knives|knife)\b/i;

const COMPONENT_ALIASES = {
  quinoa: "quinoa cooking",
  "lemon confit dressing": "lemon confit dressing",
  "confit baby tomatoes": "confit cherry tomatoes",
};

const PROTECTED_TITLES = [
  "big nac",
  "watermelon cucumber feta pine nuts balsamic dressing",
  "prawn rendang grilled lemon",
  "sea bass creole with pepper cream sauce",
  "pan seared seabass",
  "apple bircher muesli",
];

export function isEquipmentName(name) {
  return EQUIPMENT.test(String(name || ""));
}

export function isProtectedRecipeTitle(name) {
  const key = sourceIngredientKey(name);
  return PROTECTED_TITLES.some((title) => key === title || key.startsWith(title));
}

export function isCulinaryIngredientName(name) {
  const key = sourceIngredientKey(name);
  if (!key || isEquipmentName(key)) return false;
  if (key.split(" ").length > 8) return false;
  return true;
}

function findByKey(items, getName, key) {
  return (items || []).find((item) => sourceIngredientKey(getName(item)) === key) || null;
}

export function resolveSourceLine({
  sourceName,
  recipes = [],
  ingredients = [],
  selfRecipeId = null,
  siblingComponentKeys = [],
}) {
  const key = sourceIngredientKey(sourceName);
  if (!key) return { kind: "unresolved", reason: "empty_name" };
  if (isEquipmentName(key)) return { kind: "unresolved", reason: "equipment" };

  const aliasKey = COMPONENT_ALIASES[key];
  const componentKey = aliasKey || key;
  const component = (recipes || []).find((recipe) => {
    if (recipe.id === selfRecipeId) return false;
    const type = recipe.recipeType || recipe.recipe_type;
    if (type !== "preparation" && type !== "sub_recipe") return false;
    return sourceIngredientKey(recipe.name) === componentKey;
  });
  if (component) {
    const exactComponent = sourceIngredientKey(component.name) === key;
    if (exactComponent) {
      return { kind: "component", recipe: component, alias: false };
    }
    if (aliasKey && siblingComponentKeys.includes(componentKey)) {
      return { kind: "component", recipe: component, alias: true };
    }
  }

  if (aliasKey && !siblingComponentKeys.includes(componentKey)) {
    return { kind: "unresolved", reason: "component_identity_uncertain", suggestedComponent: aliasKey };
  }

  const ingredient = findByKey(ingredients, (item) => item.canonicalName || item.canonical_name, key);
  if (ingredient) return { kind: "ingredient", ingredient };

  if (isCulinaryIngredientName(sourceName)) {
    return { kind: "create_ingredient", canonicalName: sourceName.trim(), unitHint: null };
  }
  return { kind: "unresolved", reason: "not_culinary" };
}

export function classifyRepairEligibility({
  recipe,
  existingLineCount,
  qtyRows,
}) {
  if (!recipe) return { eligible: false, reason: "no_canonical_recipe" };
  if (isProtectedRecipeTitle(recipe.name)) return { eligible: false, reason: "protected_structured_recipe" };
  if (existingLineCount > 0) return { eligible: false, reason: "canonical_already_has_lines" };
  if (!qtyRows?.length) return { eligible: false, reason: "source_lacks_quantities" };
  const culinary = qtyRows.filter((row) => isCulinaryIngredientName(row.sourceName));
  if (culinary.length < 2) return { eligible: false, reason: "low_confidence_alignment" };
  return { eligible: true, reason: "zero_line_high_confidence" };
}
