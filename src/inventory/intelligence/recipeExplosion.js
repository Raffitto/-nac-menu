import { addDecimal, compareDecimal, divideDecimal, multiplyDecimal, normalizeMeasurementUnit } from "../inventoryIntelligence";

/**
 * Deterministic recipe explosion.
 * Follows the verified recipe-explosion rules:
 * a menu product and an inventory item are different entities,
 * yield is applied once, and a cycle stops the walk.
 * This does not post stock.
 */

function normName(value) {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

/** Shared alias table (inventoryIntelligence.UNIT_ALIASES); unknown units such as "Batch" pass through trimmed. */
export function normUnit(value) {
  return normalizeMeasurementUnit(value) || String(value || "").trim();
}

function positive(value, label) {
  if (compareDecimal(value, "0") <= 0) throw new Error(`${label} must be positive`);
}

export function grossQuantity(net, yieldPercent) {
  positive(yieldPercent, "yield");
  return divideDecimal(net, divideDecimal(yieldPercent, "100"));
}

function batchOutput(item) {
  positive(item.storageToIngredientFactor, "conversion factor");
  return { factor: String(item.storageToIngredientFactor), unit: normUnit(item.ingredientUnit) };
}

export function resolveInventoryItem({ name, sku, inventoryId, inventoryBySku, inventoryById }) {
  if (inventoryId) {
    const item = inventoryById[inventoryId];
    if (!item) return { item: null, issue: "UNKNOWN_INVENTORY_UUID" };
    if (String(item.sku).trim() !== String(sku).trim()) return { item: null, issue: "UUID_SKU_CONFLICT" };
    return { item, issue: null };
  }
  const item = inventoryBySku[sku];
  if (!item) return { item: null, issue: "MISSING_INVENTORY_ITEM" };
  if (normName(item.name) !== normName(name)) return { item: null, issue: "PRODUCT_INVENTORY_NAME_MISMATCH" };
  return { item, issue: null };
}

function inBatchUnit(quantity, unit, item) {
  const batch = batchOutput(item);
  const given = normUnit(unit);
  if (given === batch.unit) return { quantity: String(quantity), unit: batch.unit };
  if (given === normUnit(item.storageUnit)) {
    return { quantity: multiplyDecimal(quantity, batch.factor), unit: batch.unit };
  }
  return null;
}

export function explodeRecipe({ lines = [], inventory = [], components = [], rootKey = "sale" } = {}) {
  const inventoryBySku = Object.fromEntries(inventory.map((item) => [item.sku, item]));
  const inventoryById = Object.fromEntries(inventory.filter((item) => item.id).map((item) => [item.id, item]));
  const recipes = {};
  components.forEach((row) => {
    const key = row.parentSku;
    recipes[key] = recipes[key] || [];
    recipes[key].push(row);
  });
  const totals = {};
  const paths = {};
  const issues = [];

  function addTotal(sku, unit, quantity, path, name) {
    const key = `${sku}|${unit}`;
    const next = totals[key] ? addDecimal(totals[key].quantity, quantity) : String(quantity);
    totals[key] = { sku, unit, quantity: next, name };
    paths[key] = paths[key] || [];
    paths[key].push({ path, quantity: String(quantity), name });
  }

  function walk(sku, name, quantity, unit, path, inventoryId) {
    const resolved = resolveInventoryItem({ name, sku, inventoryId, inventoryBySku, inventoryById });
    if (resolved.issue) {
      issues.push({ code: resolved.issue, sku, name, path: [...path] });
      return;
    }
    const node = `InventoryItem:${sku}`;
    if (path.includes(node)) {
      issues.push({ code: "CIRCULAR", sku, path: [...path, node] });
      return;
    }
    if (!recipes[sku]) {
      addTotal(sku, normUnit(unit), quantity, [...path, node], resolved.item.name);
      return;
    }
    const converted = inBatchUnit(quantity, unit, resolved.item);
    if (!converted) {
      issues.push({
        code: "UNIT_MISMATCH",
        sku,
        name,
        unit,
        batchUnit: batchOutput(resolved.item).unit,
        path: [...path],
      });
      return;
    }
    const scale = divideDecimal(converted.quantity, batchOutput(resolved.item).factor);
    recipes[sku].forEach((child) => {
      const gross = grossQuantity(child.quantity, child.yieldPercent);
      walk(child.childSku, child.childName, multiplyDecimal(gross, scale), child.unit, [...path, node], null);
    });
  }

  lines.forEach((line) => {
    walk(line.sku, line.name, line.quantity, line.unit, [rootKey], line.inventoryId || null);
  });

  return {
    shadow: true,
    postsStock: false,
    totals: Object.values(totals),
    paths,
    issues,
    complete: issues.length === 0,
  };
}
