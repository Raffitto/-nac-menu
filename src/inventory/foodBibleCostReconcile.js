/**
 * Match existing ingredient cost history onto canonical ingredients.
 * Never invents a cost. Missing remains unknown.
 */

import { normalizeText } from "./inventoryIntelligence";

export function costRecordKey(row) {
  return `${row.ingredient_id || row.ingredientId}::${row.canonical_unit || row.canonicalUnit || ""}`;
}

export function collectPositiveCostRecords({ history = [], receiptLines = [], invoiceLines = [] } = {}) {
  const rows = [];
  for (const row of history) {
    const amount = row.canonical_unit_cost ?? row.canonicalUnitCost;
    if (amount == null || Number(amount) <= 0) continue;
    rows.push({
      ingredient_id: row.ingredient_id || row.ingredientId,
      canonical_unit: row.canonical_unit || row.canonicalUnit,
      canonical_unit_cost: Number(amount),
      effective_at: row.effective_at || row.effectiveAt || null,
      canonical_name: row.canonical_name || row.canonicalName || null,
      source: "cost_history",
    });
  }
  for (const row of receiptLines) {
    const amount = row.unit_cost_canonical ?? row.unitCostCanonical;
    if (amount == null || Number(amount) <= 0) continue;
    rows.push({
      ingredient_id: row.ingredient_id || row.ingredientId,
      canonical_unit: row.canonical_unit || row.canonicalUnit,
      canonical_unit_cost: Number(amount),
      effective_at: row.created_at || row.effective_at || null,
      canonical_name: row.normalized_description || row.original_description || null,
      source: "purchase_receipt",
    });
  }
  for (const row of invoiceLines) {
    const amount = row.unit_price ?? row.unitPrice;
    if (amount == null || Number(amount) <= 0) continue;
    if (row.review_status && !["verified", "auto_matched", "approved"].includes(row.review_status)) continue;
    rows.push({
      ingredient_id: row.ingredient_id || row.ingredientId,
      canonical_unit: row.canonical_unit || row.canonicalUnit,
      canonical_unit_cost: Number(amount),
      effective_at: row.updated_at || row.created_at || null,
      canonical_name: row.normalized_description || row.original_description || null,
      source: "invoice_line",
    });
  }
  return rows;
}

export function matchCostHistoryToCanonical({
  costRows = [],
  ingredients = [],
  lookupIngredients = [],
  aliases = [],
  catalogue = [],
} = {}) {
  const byId = new Map(ingredients.map((item) => [item.id, item]));
  const lookupById = new Map(
    [...lookupIngredients, ...ingredients].map((item) => [item.id, item]),
  );
  const byName = new Map();
  const rememberName = (name, item) => {
    const key = normalizeText(name || "");
    if (key && item && !byName.has(key)) byName.set(key, item);
  };
  for (const item of ingredients) {
    rememberName(item.canonicalName || item.canonical_name, item);
    rememberName(item.normalizedSearchName || item.normalized_search_name, item);
    const aliasText = String(item.description || "")
      .replace(/^food bible aliases:\s*/i, "")
      .split("|")
      .map((token) => token.trim())
      .filter(Boolean);
    for (const alias of aliasText) rememberName(alias, item);
  }
  for (const row of catalogue) {
    const target = byId.get(row.ingredient_id || row.ingredientId);
    if (!target) continue;
    rememberName(row.item_name || row.name || row.canonical_name, target);
    rememberName(row.normalized_name || row.normalized_description, target);
  }
  for (const row of aliases) {
    const target = byId.get(row.ingredient_id || row.ingredientId);
    if (!target) continue;
    rememberName(row.alias_text || row.original_description || row.normalized_description || row.normalized_alias, target);
  }

  const unmatchedCost = [];
  const costByCanonicalId = new Map();
  const matched = [];

  for (const row of costRows) {
    const amount = row.canonical_unit_cost ?? row.canonicalUnitCost;
    if (amount == null || Number(amount) <= 0) continue;
    const costIngredientId = row.ingredient_id || row.ingredientId;
    const direct = byId.get(costIngredientId);
    const lookup = lookupById.get(costIngredientId);
    const named = byName.get(normalizeText(
      row.canonical_name
      || row.canonicalName
      || row.ingredient_name
      || lookup?.canonicalName
      || lookup?.canonical_name
      || "",
    ));
    const hit = direct || named;
    if (!hit) {
      unmatchedCost.push({
        ingredientId: costIngredientId || null,
        name: row.canonical_name || row.canonicalName || lookup?.canonicalName || lookup?.canonical_name || null,
        amount,
        unit: row.canonical_unit || row.canonicalUnit,
        source: row.source || null,
      });
      continue;
    }
    const existing = costByCanonicalId.get(hit.id);
    const at = row.effective_at || row.effectiveAt || "";
    if (!existing || String(at) > String(existing.effectiveAt || "")) {
      costByCanonicalId.set(hit.id, {
        ingredientId: hit.id,
        canonicalName: hit.canonicalName || hit.canonical_name,
        amount,
        unit: row.canonical_unit || row.canonicalUnit,
        effectiveAt: at,
        match: direct ? "id" : "name",
        source: row.source || null,
      });
    }
    matched.push({ costIngredientId, canonicalId: hit.id, match: direct ? "id" : "name" });
  }

  const missing = ingredients.filter((item) => !costByCanonicalId.has(item.id)).map((item) => ({
    id: item.id,
    canonicalName: item.canonicalName || item.canonical_name,
  }));

  return {
    matchedCount: costByCanonicalId.size,
    unmatchedCostCount: unmatchedCost.length,
    missingCostCount: missing.length,
    costByCanonicalId: Object.fromEntries(costByCanonicalId),
    unmatchedCost: unmatchedCost.slice(0, 40),
    missing,
    matched,
  };
}
