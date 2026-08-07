import { normalizeText } from "./inventoryIntelligence";
import { classificationDefault, INVENTORY_CLASSIFICATIONS } from "./inventoryControls";

export const CANONICAL_UNITS = Object.freeze([
  { value: "each", label: "Each (pieces, cartons, items)" },
  { value: "gram", label: "Gram" },
  { value: "kilogram", label: "Kilogram" },
  { value: "millilitre", label: "Millilitre" },
  { value: "litre", label: "Litre" },
]);

export const SUGGESTED_CATEGORIES = Object.freeze([
  "Dairy",
  "Produce",
  "Protein",
  "Dry goods",
  "Beverages",
  "Oils & fats",
  "Spices",
  "Packaging",
  "Other",
]);

export const INVENTORY_INGREDIENT_WRITE_ROLES = new Set([
  "ceo",
  "super_admin",
  "ops_manager",
  "branch_manager",
  "cost_controller",
]);

export const INVENTORY_NETWORK_INGREDIENT_ROLES = new Set([
  "ceo",
  "super_admin",
  "ops_manager",
]);

const DUPLICATE_NAME_MESSAGE =
  "An ingredient with this name already exists. Use a different name or reactivate the existing one.";

export function unitLabel(value) {
  return CANONICAL_UNITS.find((unit) => unit.value === value)?.label || value || "—";
}

export function trimIngredientName(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function validateIngredientForm(form, { allowUnitChange = true } = {}) {
  const canonicalName = trimIngredientName(form.canonicalName);
  if (!canonicalName) {
    return { ok: false, message: "Ingredient name is required." };
  }
  if (!form.category?.trim()) {
    return { ok: false, message: "Choose a category." };
  }
  if (!form.baseInventoryUnit) {
    return { ok: false, message: "Choose a base unit." };
  }
  if (!CANONICAL_UNITS.some((unit) => unit.value === form.baseInventoryUnit)) {
    return { ok: false, message: "Choose a valid base unit." };
  }
  if (!INVENTORY_CLASSIFICATIONS.some(({ value }) => value === (form.inventoryClassification || "food_ingredient"))) {
    return { ok: false, message: "Choose a valid inventory classification." };
  }
  if (!allowUnitChange && form.baseInventoryUnit !== form.originalBaseUnit) {
    return {
      ok: false,
      message: "Base unit cannot be changed because this ingredient already has purchase or stock history.",
    };
  }
  return { ok: true, canonicalName };
}

export function mapIngredientRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    canonicalName: row.canonical_name,
    normalizedSearchName: row.normalized_search_name,
    category: row.category,
    baseInventoryUnit: row.base_inventory_unit,
    inventoryClassification: row.inventory_classification || "other",
    recipeCostEligible: row.recipe_cost_eligible === true,
    legitimateZeroCost: row.legitimate_zero_cost === true,
    description: row.description,
    scope: row.scope,
    branchId: row.branch_id,
    active: row.active !== false,
    updatedAt: row.updated_at,
    createdAt: row.created_at,
  };
}

export function buildIngredientPayload(form, { branchId, scope = "branch" }) {
  const canonicalName = trimIngredientName(form.canonicalName);
  return {
    canonicalName,
    normalizedSearchName: normalizeText(canonicalName),
    category: form.category?.trim() || null,
    baseInventoryUnit: form.baseInventoryUnit,
    inventoryClassification: form.inventoryClassification || "food_ingredient",
    recipeCostEligible: form.recipeCostEligible !== false,
    legitimateZeroCost: form.legitimateZeroCost === true,
    description: form.notes?.trim() || null,
    branchId: scope === "network" ? null : branchId,
    scope,
    active: form.active !== false,
  };
}

export function duplicateNameMessage(existingName) {
  if (!existingName) return DUPLICATE_NAME_MESSAGE;
  return `${DUPLICATE_NAME_MESSAGE} Existing: "${existingName}".`;
}

export function friendlyIngredientError(error, fallback = "Something went wrong. Please try again.") {
  const raw = error?.message || String(error || "");
  if (!raw) return fallback;
  if (/duplicate key|inventory_ingredients_.*name|unique constraint/i.test(raw)) {
    return DUPLICATE_NAME_MESSAGE;
  }
  if (/permission|access denied|row-level security|42501/i.test(raw)) {
    return "You don't have permission to change ingredients.";
  }
  if (/network|fetch|timeout/i.test(raw)) {
    return "Connection issue. Check your internet and try again.";
  }
  return raw.length > 140 ? fallback : raw;
}

export function filterIngredients(ingredients, { search = "", category = "all", status = "all" }) {
  const query = normalizeText(search);
  return ingredients.filter((ingredient) => {
    if (status === "active" && !ingredient.active) return false;
    if (status === "inactive" && ingredient.active) return false;
    if (category !== "all" && (ingredient.category || "Other") !== category) return false;
    if (!query) return true;
    const haystack = normalizeText(
      [ingredient.canonicalName, ingredient.category, ingredient.description].filter(Boolean).join(" "),
    );
    return haystack.includes(query);
  });
}

export function collectCategoryOptions(ingredients) {
  const values = new Set(SUGGESTED_CATEGORIES);
  for (const ingredient of ingredients) {
    if (ingredient.category) values.add(ingredient.category);
  }
  return [...values].sort((left, right) => left.localeCompare(right));
}

export function canManageBranchIngredients(access, branchId) {
  if (!access?.vaultRole || !INVENTORY_INGREDIENT_WRITE_ROLES.has(access.vaultRole)) return false;
  if (INVENTORY_NETWORK_INGREDIENT_ROLES.has(access.vaultRole)) return true;
  if (access.branchIds?.includes(branchId)) return true;
  return access.primaryBranchId === branchId;
}

export function canManageNetworkIngredients(access) {
  return Boolean(
    access?.vaultRole
      && INVENTORY_INGREDIENT_WRITE_ROLES.has(access.vaultRole)
      && INVENTORY_NETWORK_INGREDIENT_ROLES.has(access.vaultRole),
  );
}

export function formatIngredientTimestamp(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-GB", {
    timeZone: "Asia/Riyadh",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export const EMPTY_INGREDIENT_FORM = Object.freeze({
  canonicalName: "",
  category: "",
  baseInventoryUnit: "each",
  inventoryClassification: "food_ingredient",
  recipeCostEligible: classificationDefault("food_ingredient"),
  legitimateZeroCost: false,
  notes: "",
  scope: "branch",
  active: true,
  originalBaseUnit: "each",
});
