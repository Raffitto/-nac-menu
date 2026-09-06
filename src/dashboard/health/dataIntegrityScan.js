/**
 * Diagnostic integrity scan — classify, do not block production data.
 */

export const INTEGRITY_SEVERITY = Object.freeze({
  ERROR: "ERROR",
  WARNING: "WARNING",
  INFO: "INFO",
});

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
  for (const row of issues) {
    if (counts[row.severity] != null) counts[row.severity] += 1;
  }
  return { issues, counts, total: issues.length };
}
