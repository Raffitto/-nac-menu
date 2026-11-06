/**
 * Admin catalogue integrity. Classifies only. Does not merge products or write.
 */

import { areUnitsCompatible } from "../inventory/inventoryIntelligence";
import { catalogueIdentityId } from "./catalogueIdentity";

export const CATALOGUE_SEVERITY = Object.freeze({
  CRITICAL: "CRITICAL",
  WARNING: "WARNING",
  INFORMATIONAL: "INFORMATIONAL",
});

function finding(severity, code, message, extras = {}) {
  return { severity, code, message, source: "catalogue", ...extras };
}

function priceAmount(value) {
  const match = String(value ?? "").replace(/,/g, "").match(/(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : null;
}

function sameIdentityRows(items) {
  const groups = new Map();
  for (const item of items || []) {
    const id = catalogueIdentityId(item);
    if (!id) continue;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(item);
  }
  return groups;
}

export function scanCatalogueIntegrity({
  menuItems = [],
  recipes = [],
  foodicsMappings = null,
  allergenItemIds = null,
  conversions = [],
} = {}) {
  const findings = [];
  const knownIds = new Set((menuItems || []).map((item) => item.id).filter(Boolean));
  findings.push(finding(
    CATALOGUE_SEVERITY.INFORMATIONAL,
    "network_catalogue_id_absent",
    "No network-wide catalogue id exists. placement_group_id links sections, and a branch clone receives a new group id.",
  ));

  for (const [catalogueId, rows] of sameIdentityRows(menuItems).entries()) {
    const prices = [...new Set(rows.map((row) => priceAmount(row.price)).filter((n) => n != null))];
    if (prices.length > 1) {
      findings.push(finding(
        CATALOGUE_SEVERITY.CRITICAL,
        "conflicting_shared_price",
        `Canonical product ${catalogueId} has different current prices: ${prices.join(", ")}. Branch prices were not changed.`,
        { catalogueId, itemIds: rows.map((row) => row.id) },
      ));
    }
  }

  const active = (menuItems || []).filter((item) => item.active !== false);
  for (const item of active) {
    if (!catalogueIdentityId(item)) {
      findings.push(finding(
        CATALOGUE_SEVERITY.WARNING,
        "unlinked_placement",
        `${item.name_en || item.id} has no placement group. It was not merged by name.`,
        { itemId: item.id },
      ));
    }
    const calories = item.calories;
    if (calories != null && (String(calories).trim() === "" || String(calories).trim() === "-")) {
      findings.push(finding(
        CATALOGUE_SEVERITY.WARNING,
        "missing_calories",
        `${item.name_en || item.id} has no calorie value.`,
        { itemId: item.id },
      ));
    }
    if (item.branch_id === "hettin" && item.guest_visible === true) {
      findings.push(finding(
        CATALOGUE_SEVERITY.CRITICAL,
        "hettin_guest_visible",
        "A Hettin placement is marked guest-visible. Hettin stays hidden until the owner activates it.",
        { itemId: item.id },
      ));
    }
  }

  const recipeIds = new Set();
  for (const recipe of recipes || []) {
    if (!recipe.menu_item_id) {
      findings.push(finding(
        CATALOGUE_SEVERITY.INFORMATIONAL,
        "recipe_without_menu_link",
        `${recipe.name || recipe.id} has no menu placement link.`,
        { recipeId: recipe.id },
      ));
      continue;
    }
    recipeIds.add(recipe.menu_item_id);
    if (!knownIds.has(recipe.menu_item_id)) {
      findings.push(finding(
        CATALOGUE_SEVERITY.CRITICAL,
        "orphaned_recipe",
        `${recipe.name || recipe.id} points at missing menu placement ${recipe.menu_item_id}.`,
        { recipeId: recipe.id, itemId: recipe.menu_item_id },
      ));
    }
  }

  if (Array.isArray(allergenItemIds)) {
    const covered = new Set(allergenItemIds);
    for (const item of active) {
      if (recipeIds.has(item.id) && !covered.has(item.id)) {
        findings.push(finding(
          CATALOGUE_SEVERITY.WARNING,
          "missing_approved_allergens",
          `${item.name_en || item.id} has a recipe link and no allergen rows.`,
          { itemId: item.id },
        ));
      }
    }
  }

  if (Array.isArray(foodicsMappings)) {
    const byKey = new Map();
    for (const row of foodicsMappings) {
      const key = row.normalized_key || row.foodics_product_id || row.id;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(row);
      if (row.menu_item_id && !knownIds.has(row.menu_item_id)) {
        findings.push(finding(
          CATALOGUE_SEVERITY.CRITICAL,
          "orphaned_foodics_mapping",
          `Foodics mapping “${row.foodics_name || key}” points at missing placement ${row.menu_item_id}.`,
          { mappingId: row.id, itemId: row.menu_item_id },
        ));
      }
      const confidence = Number(row.match_confidence);
      if (Number.isFinite(confidence) && confidence < 1) {
        findings.push(finding(
          CATALOGUE_SEVERITY.WARNING,
          "unverified_foodics_match",
          `Foodics mapping “${row.foodics_name || key}” is unverified. It was left for review.`,
          { mappingId: row.id },
        ));
      }
    }
    for (const [key, rows] of byKey.entries()) {
      if (rows.length > 1) {
        findings.push(finding(
          CATALOGUE_SEVERITY.CRITICAL,
          "duplicate_foodics_mapping",
          `Foodics key ${key} is mapped ${rows.length} times.`,
          { mappingIds: rows.map((row) => row.id) },
        ));
      }
    }
    const byName = new Map();
    for (const row of foodicsMappings) {
      const name = String(row.foodics_name || row.product_sku || "").trim().toLowerCase();
      if (!name) continue;
      if (!byName.has(name)) byName.set(name, []);
      byName.get(name).push(row);
    }
    for (const [name, rows] of byName.entries()) {
      const targets = [...new Set(rows.map((row) => row.menu_item_id).filter(Boolean))];
      if (targets.length > 1) {
        findings.push(finding(
          CATALOGUE_SEVERITY.WARNING,
          "conflicting_foodics_target",
          `Foodics name “${name}” points at ${targets.length} menu placements. It was left for review.`,
          { itemIds: targets },
        ));
      }
    }
  }

  for (const conversion of conversions || []) {
    const from = conversion.from_unit || conversion.from;
    const to = conversion.to_unit || conversion.to;
    let compatible = false;
    try {
      compatible = areUnitsCompatible(from, to);
    } catch {
      compatible = false;
    }
    const factor = Number(conversion.factor ?? conversion.multiplier);
    if (!compatible || (Number.isFinite(factor) && factor <= 0)) {
      findings.push(finding(
        CATALOGUE_SEVERITY.CRITICAL,
        "invalid_unit_conversion",
        `Invalid conversion ${from || "?"} → ${to || "?"}. No quantity was invented.`,
        { conversionId: conversion.id },
      ));
    }
  }

  const counts = { CRITICAL: 0, WARNING: 0, INFORMATIONAL: 0 };
  for (const row of findings) counts[row.severity] += 1;
  return { findings, counts, repairs: [] };
}
