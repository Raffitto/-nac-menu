/**
 * Diagnostic integrity scan — classify, do not block production data.
 */

import { isVerificationFixture } from "../../inventory/foodBible";
import { classifyKitchenRecipeGaps, RECIPE_GAP_CLASS, recipeGapIssueCode } from "./recipeMappingClassification";

export const INTEGRITY_SEVERITY = Object.freeze({
  ERROR: "ERROR",
  WARNING: "WARNING",
  INFO: "INFO",
});

export const ACTION_BUCKET = Object.freeze({
  CRITICAL: "CRITICAL",
  NEEDS_REVIEW: "NEEDS_REVIEW",
  INFORMATIONAL: "INFORMATIONAL",
});

function actionBucketForSeverity(severity) {
  if (severity === INTEGRITY_SEVERITY.ERROR) return ACTION_BUCKET.CRITICAL;
  if (severity === INTEGRITY_SEVERITY.WARNING) return ACTION_BUCKET.NEEDS_REVIEW;
  return ACTION_BUCKET.INFORMATIONAL;
}

function issue(severity, code, message, extras = {}) {
  return { severity, code, message, ...extras };
}

export function scanMenuIdentityIssues(items = []) {
  const issues = [];
  const bySku = new Map();
  for (const item of items || []) {
    const sku = String(item.sku || item.item_sku || "").trim();
    const name = String(item.name_en || item.name || "").trim();
    if (!sku) {
      issues.push(issue(INTEGRITY_SEVERITY.INFO, "missing_sku", `${name || "Unnamed item"} has no SKU`, {
        itemId: item.id,
      }));
      continue;
    }
    if (!bySku.has(sku)) bySku.set(sku, []);
    bySku.get(sku).push(item);
  }
  for (const [sku, rows] of bySku.entries()) {
    const names = [...new Set(rows.map((r) => String(r.name_en || r.name || "").trim()).filter(Boolean))];
    if (rows.length > 1 && names.length > 1) {
      issues.push(issue(
        INTEGRITY_SEVERITY.ERROR,
        "reused_sku",
        `SKU ${sku} is used for different products: ${names.slice(0, 4).join(", ")}`,
        { sku, count: rows.length },
      ));
    } else if (rows.length > 1) {
      issues.push(issue(
        INTEGRITY_SEVERITY.WARNING,
        "duplicate_sku",
        `SKU ${sku} appears ${rows.length} times`,
        { sku, count: rows.length },
      ));
    }
  }
  return issues;
}

export function scanRecipeMappingIssues(recipes = []) {
  const issues = [];
  for (const recipe of recipes || []) {
    const name = recipe.name || recipe.recipe_name || recipe.id;
    if (recipe.missing_source_item) {
      issues.push(issue(INTEGRITY_SEVERITY.ERROR, "missing_source_item", `Recipe ${name} references a missing source item`));
    }
    if (recipe.cost == null && recipe.ingredient_cost == null && recipe.has_ingredients) {
      issues.push(issue(INTEGRITY_SEVERITY.WARNING, "missing_ingredient_cost", `Recipe ${name} has no ingredient cost`));
    }
    if (recipe.uom_mismatch) {
      issues.push(issue(INTEGRITY_SEVERITY.WARNING, "uom_mismatch", `Recipe ${name} has a unit-of-measure mismatch`));
    }
    if (recipe.inactive || recipe.legacy) {
      issues.push(issue(INTEGRITY_SEVERITY.INFO, "legacy_recipe", `Recipe ${name} is inactive/legacy`));
    }
  }
  return issues;
}

export function summarizeIntegrityIssues(issues = []) {
  const counts = { ERROR: 0, WARNING: 0, INFO: 0 };
  const actionCounts = { CRITICAL: 0, NEEDS_REVIEW: 0, INFORMATIONAL: 0 };
  for (const row of issues) {
    if (counts[row.severity] != null) counts[row.severity] += 1;
    const bucket = row.actionBucket || actionBucketForSeverity(row.severity);
    if (actionCounts[bucket] != null) actionCounts[bucket] += 1;
  }
  return { issues, counts, actionCounts, total: issues.length };
}

function normalizeName(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function scanProductIdentityIssues(items = []) {
  const issues = [...scanMenuIdentityIssues(items)];
  const byName = new Map();
  for (const item of items || []) {
    const name = normalizeName(item.name_en || item.name);
    if (!name) continue;
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(item);
  }
  for (const [name, rows] of byName.entries()) {
    const active = rows.filter((r) => r.active !== false);
    const skus = [...new Set(active.map((r) => String(r.sku || "").trim()).filter(Boolean))];
    if (active.length > 1 && skus.length > 1) {
      issues.push(issue(
        INTEGRITY_SEVERITY.ERROR,
        "one_identity_many_skus",
        `“${rows[0].name_en || name}” has ${skus.length} active SKUs`,
        { examples: skus.slice(0, 4), count: active.length, category: "product" },
      ));
    }
    const inactive = rows.filter((r) => r.active === false);
    if (active.length && inactive.length) {
      issues.push(issue(
        INTEGRITY_SEVERITY.WARNING,
        "inactive_active_collision",
        `“${rows[0].name_en || name}” has both active and inactive/legacy rows`,
        { itemIds: rows.map((r) => r.id).slice(0, 6), category: "product" },
      ));
    }
    if (active.length > 1 && skus.length <= 1) {
      const branches = [...new Set(active.map((r) => r.branch_id || r.branchId).filter(Boolean))];
      const looksVariant = /small|large|regular|portion|half|double/i.test(name);
      const kind = branches.length > 1
        ? "branch_scoped"
        : looksVariant
          ? "portion_variant"
          : "exact_duplicate";
      issues.push(issue(
        kind === "exact_duplicate" ? INTEGRITY_SEVERITY.WARNING : INTEGRITY_SEVERITY.INFO,
        kind === "exact_duplicate" ? "duplicate_active_identity" : `duplicate_identity_${kind}`,
        kind === "exact_duplicate"
          ? `Exact duplicate active identity “${rows[0].name_en || name}”`
          : kind === "branch_scoped"
            ? `Same name exists on ${branches.length} branches: “${rows[0].name_en || name}”`
            : `Portion/variant identity “${rows[0].name_en || name}”`,
        {
          itemIds: active.map((r) => r.id).slice(0, 6),
          category: "product",
          duplicateKind: kind,
        },
      ));
    }
  }
  return issues.map((row) => ({ category: row.category || "product", source: "menu_items", ...row }));
}

export function scanRecipeGraphIssues({
  recipes = [],
  versions = [],
  lines = [],
  ingredients = [],
  menuItems = [],
} = {}) {
  const issues = [...scanRecipeMappingIssues(recipes)];
  const recipeById = new Map((recipes || []).map((r) => [r.id, r]));
  const ingredientById = new Map((ingredients || []).map((i) => [i.id, i]));
  const versionsByRecipe = new Map();
  for (const version of versions || []) {
    if (!versionsByRecipe.has(version.recipe_id)) versionsByRecipe.set(version.recipe_id, []);
    versionsByRecipe.get(version.recipe_id).push(version);
  }

  const subEdges = [];
  for (const line of lines || []) {
    if (line.ingredient_id && !ingredientById.has(line.ingredient_id)) {
      issues.push(issue(
        INTEGRITY_SEVERITY.ERROR,
        "missing_ingredient",
        `Recipe line references missing ingredient ${line.ingredient_id}`,
        { evidence: [line.id || line.recipe_version_id], category: "recipe" },
      ));
    }
    if (line.sub_recipe_id && !recipeById.has(line.sub_recipe_id)) {
      issues.push(issue(
        INTEGRITY_SEVERITY.ERROR,
        "missing_sub_recipe",
        `Recipe line references missing sub-recipe ${line.sub_recipe_id}`,
        { evidence: [line.id || line.recipe_version_id], category: "recipe" },
      ));
    }
    if (line.sub_recipe_id) {
      const parentVersion = (versions || []).find((v) => v.id === line.recipe_version_id);
      if (parentVersion?.recipe_id) subEdges.push([parentVersion.recipe_id, line.sub_recipe_id]);
    }
    const qty = Number(line.quantity ?? line.qty);
    if (Number.isFinite(qty) && qty <= 0) {
      issues.push(issue(
        INTEGRITY_SEVERITY.ERROR,
        "invalid_quantity",
        `Recipe line quantity is ${qty}`,
        { evidence: [line.id || line.recipe_version_id], category: "cost" },
      ));
    }
  }

  const visited = new Set();
  const graph = new Map();
  for (const [from, to] of subEdges) {
    if (!graph.has(from)) graph.set(from, []);
    graph.get(from).push(to);
  }
  const walk = (node, stack) => {
    if (stack.has(node)) {
      issues.push(issue(
        INTEGRITY_SEVERITY.ERROR,
        "circular_sub_recipe",
        `Circular sub-recipe dependency at ${recipeById.get(node)?.name || node}`,
        { evidence: [...stack, node], category: "recipe" },
      ));
      return;
    }
    if (visited.has(node)) return;
    const next = new Set(stack);
    next.add(node);
    for (const child of graph.get(node) || []) walk(child, next);
    visited.add(node);
  };
  for (const id of graph.keys()) walk(id, new Set());

  for (const [recipeId, recipeVersions] of versionsByRecipe.entries()) {
    const active = recipeVersions.filter((v) => String(v.status || "").toLowerCase() === "active");
    if (active.length > 1) {
      issues.push(issue(
        INTEGRITY_SEVERITY.WARNING,
        "multiple_active_versions",
        `${recipeById.get(recipeId)?.name || recipeId} has ${active.length} active versions`,
        { evidence: active.map((v) => v.id), category: "recipe" },
      ));
    }
  }

  const names = new Map();
  for (const recipe of recipes || []) {
    const key = normalizeName(recipe.normalized_name || recipe.name);
    if (!key) continue;
    if (!names.has(key)) names.set(key, []);
    names.get(key).push(recipe);
  }
  for (const [, rows] of names.entries()) {
    if (rows.length > 1) {
      issues.push(issue(
        INTEGRITY_SEVERITY.WARNING,
        "duplicate_sub_recipe_identity",
        `Duplicate recipe identity “${rows[0].name}”`,
        { evidence: rows.map((r) => r.id), category: "recipe" },
      ));
    }
  }

  const mapping = classifyKitchenRecipeGaps({ menuItems, recipes });
  for (const row of mapping.rows) {
    const warning = row.class !== RECIPE_GAP_CLASS.FALSE_POSITIVE;
    issues.push(issue(
      warning ? INTEGRITY_SEVERITY.WARNING : INTEGRITY_SEVERITY.INFO,
      row.class === RECIPE_GAP_CLASS.FALSE_POSITIVE
        ? "non_kitchen_item_no_recipe"
        : recipeGapIssueCode(row.class),
      `${row.itemName}: ${row.reason}`,
      {
        itemId: row.itemId,
        category: "recipe",
        kitchenExpected: warning,
        mappingClass: row.class,
        confidence: row.confidence,
        candidates: row.candidates,
      },
    ));
  }

  for (const recipe of recipes || []) {
    if (recipe.active !== false) continue;
    const used = (lines || []).some((line) => line.sub_recipe_id === recipe.id);
    if (used) {
      issues.push(issue(
        INTEGRITY_SEVERITY.WARNING,
        "inactive_recipe_in_use",
        `Inactive recipe ${recipe.name || recipe.id} is still referenced`,
        { recipeId: recipe.id, category: "recipe" },
      ));
    }
  }

  return issues.map((row) => ({ source: "inventory_recipes", category: row.category || "recipe", ...row }));
}

export function scanCostUomIssues(ingredients = [], { costByIngredientId = {}, conversions = [] } = {}) {
  const issues = [];
  for (const ingredient of ingredients || []) {
    const name = ingredient.canonical_name || ingredient.name || ingredient.id;
    const cost = costByIngredientId[ingredient.id];
    if (cost == null && ingredient.unit_cost == null && ingredient.last_cost == null) {
      const placeholder = isVerificationFixture(name) || /INV-OCR|\[temp verify/i.test(String(name));
      const inactive = ingredient.active === false;
      const structural = /sub[-\s]?recipe|derived|structural/i.test(String(name));
      const actionable = !placeholder && !inactive && !structural;
      issues.push(issue(
        actionable ? INTEGRITY_SEVERITY.WARNING : INTEGRITY_SEVERITY.INFO,
        actionable ? "missing_ingredient_cost" : placeholder
          ? "ocr_cost_placeholder"
          : inactive
            ? "inactive_ingredient_no_cost"
            : "structural_ingredient_no_cost",
        `${name} has no recorded cost`,
        { ingredientId: ingredient.id, category: "cost", actionable },
      ));
    } else if (Number(cost ?? ingredient.unit_cost ?? ingredient.last_cost) === 0) {
      issues.push(issue(
        INTEGRITY_SEVERITY.WARNING,
        "zero_cost_suspicious",
        `${name} has zero cost`,
        { ingredientId: ingredient.id, category: "cost" },
      ));
    }
    if (!ingredient.base_inventory_unit && !ingredient.baseInventoryUnit) {
      issues.push(issue(
        INTEGRITY_SEVERITY.ERROR,
        "missing_uom",
        `${name} has no base inventory unit`,
        { ingredientId: ingredient.id, category: "cost" },
      ));
    }
  }
  for (const conversion of conversions || []) {
    const factor = Number(conversion.factor || conversion.multiplier);
    if (Number.isFinite(factor) && factor <= 0) {
      issues.push(issue(
        INTEGRITY_SEVERITY.ERROR,
        "impossible_conversion",
        `Impossible UOM conversion ${conversion.from_unit || conversion.from} → ${conversion.to_unit || conversion.to}`,
        { evidence: [conversion.id], category: "cost" },
      ));
    }
  }
  return issues.map((row) => ({ source: "inventory_ingredients", ...row }));
}

export function scanInventorySalesMapping({
  salesProducts = [],
  menuItems = [],
  recipes = [],
  inventoryItems = null,
} = {}) {
  const issues = [];
  const capabilityGaps = [];
  const menuNames = new Set((menuItems || []).map((i) => normalizeName(i.name_en || i.name)).filter(Boolean));
  const recipeMenuIds = new Set((recipes || []).map((r) => r.menu_item_id).filter(Boolean));
  for (const product of salesProducts || []) {
    const name = normalizeName(product.name || product.product_name || product.name_en);
    if (name && !menuNames.has(name) && !recipeMenuIds.has(product.menu_item_id)) {
      issues.push(issue(
        INTEGRITY_SEVERITY.WARNING,
        "sales_without_menu_identity",
        `${product.name || product.product_name || product.id} sold without a canonical menu identity`,
        { evidence: [product.id], category: "mapping" },
      ));
    }
  }
  if (!Array.isArray(inventoryItems)) {
    capabilityGaps.push({
      category: "mapping",
      code: "inventory_identity_unmapped",
      message: "Inventory deduction identities are not queryable in this scan yet — no automatic mapping table is loaded.",
    });
  }
  return {
    issues: issues.map((row) => ({ source: "sales_mapping", ...row })),
    capabilityGaps,
  };
}

export function groupIntegrityIssues(issues = []) {
  const groups = new Map();
  for (const row of issues || []) {
    const key = `${row.category || "other"}:${row.severity}:${row.code}`;
    if (!groups.has(key)) {
      groups.set(key, {
        category: row.category || "other",
        severity: row.severity,
        code: row.code,
        count: 0,
        source: row.source || "",
        examples: [],
      });
    }
    const group = groups.get(key);
    group.count += 1;
    if (group.examples.length < 3) group.examples.push(row.message);
  }
  return [...groups.values()].sort((a, b) => {
    const rank = { ERROR: 0, WARNING: 1, INFO: 2 };
    return (rank[a.severity] - rank[b.severity]) || b.count - a.count;
  });
}

export function scanIntegrityBundle(input = {}) {
  const menuItems = input.menuItems || [];
  const skuPresent = menuItems.some((item) => item.sku != null || item.item_sku != null);
  const product = scanProductIdentityIssues(menuItems);
  const recipe = scanRecipeGraphIssues(input);
  const cost = scanCostUomIssues(input.ingredients || [], input);
  const mapping = scanInventorySalesMapping(input);
  const skuIssues = skuPresent ? product : product.filter((row) => !["missing_sku", "reused_sku", "duplicate_sku", "one_identity_many_skus"].includes(row.code));
  const issues = [...skuIssues, ...recipe, ...cost, ...mapping.issues];
  const summary = summarizeIntegrityIssues(issues);
  const extraGaps = skuPresent ? [] : [{
    category: "product",
    code: "sku_column_unavailable",
    message: "menu_items has no SKU column in this environment — SKU reuse checks are a capability gap.",
  }];
  const recipeMapping = classifyKitchenRecipeGaps({
    menuItems,
    recipes: input.recipes || [],
  });
  return {
    ...summary,
    groups: groupIntegrityIssues(issues),
    actionCounts: summary.actionCounts,
    capabilityGaps: [...extraGaps, ...mapping.capabilityGaps],
    recipeMapping,
    scannedAt: input.scannedAt || new Date().toISOString(),
    sources: ["menu_items", "inventory_recipes", "inventory_ingredients"],
  };
}
