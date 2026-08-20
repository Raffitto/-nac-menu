#!/usr/bin/env node
/**
 * Targeted 20 Aug source → canonical line repair.
 * Does not invent quantities. Does not write speculative menu links.
 * Keep generated reports under tmp/.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { parseFoodBiblePdfExtract, sourceIngredientKey } from "../src/inventory/foodBibleSourceCardParser.js";
import { normalizeText } from "../src/inventory/inventoryIntelligence.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RAW = path.join(root, "tmp/food-bible-2026-08-20/raw");
const REPORT = path.join(root, "tmp/food-bible-2026-08-20/source-completeness-repair.json");

function loadEnvLocal() {
  const env = {};
  const envPath = path.join(root, ".env.local");
  if (!fs.existsSync(envPath)) return env;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1).replace(/^["']|["']$/g, "");
  }
  return env;
}

function sourceCards() {
  if (!fs.existsSync(RAW)) return [];
  const cards = [];
  for (const name of fs.readdirSync(RAW).filter((file) => file.endsWith(".json"))) {
    const raw = JSON.parse(fs.readFileSync(path.join(RAW, name), "utf8"));
    for (const card of parseFoodBiblePdfExtract(raw)) {
      cards.push({ ...card, sourceFile: raw.fileName || name });
    }
  }
  return cards;
}

function matchName(a, b) {
  const left = sourceIngredientKey(a);
  const right = sourceIngredientKey(b);
  return left && right && (left === right || left.startsWith(right) || right.startsWith(left));
}

async function main() {
  const apply = process.argv.includes("--apply");
  const env = loadEnvLocal();
  const cards = sourceCards();
  const report = {
    sourceCards: cards.length,
    sourceWithQuantities: cards.filter((card) => card.ingredients.some((row) => row.sourceQuantity != null)).length,
    apply,
    recovered: [],
    incompleteSource: [],
    skipped: [],
  };
  if (!env.REACT_APP_SUPABASE_URL) {
    fs.writeFileSync(REPORT, JSON.stringify({ ...report, error: "no supabase env" }, null, 2));
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  const url = env.REACT_APP_SUPABASE_URL;
  const projectRef = new URL(url).hostname.split(".")[0];
  const keys = JSON.parse(execSync(`supabase projects api-keys --project-ref ${projectRef} -o json`, { encoding: "utf8", cwd: root }));
  const service = keys.find((key) => key.name === "service_role" || key.id === "service_role")?.api_key;
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: recipes } = await admin.from("inventory_recipes").select("id,name,internal_name,recipe_type,active");
  const { data: ingredients } = await admin.from("inventory_ingredients").select("id,canonical_name,base_inventory_unit");
  const { data: versions } = await admin.from("inventory_recipe_versions").select("id,recipe_id,version_number,status,documentation").order("version_number", { ascending: false });
  const versionByRecipe = new Map();
  for (const version of versions || []) {
    if (!versionByRecipe.has(version.recipe_id)) versionByRecipe.set(version.recipe_id, version);
  }
  const { data: lines } = await admin.from("inventory_recipe_version_lines").select("id,recipe_version_id,ingredient_id,sub_recipe_id,quantity,unit");
  const lineCount = new Map();
  for (const line of lines || []) lineCount.set(line.recipe_version_id, (lineCount.get(line.recipe_version_id) || 0) + 1);

  for (const card of cards) {
    const recipe = (recipes || []).find((row) => sourceIngredientKey(row.name) === sourceIngredientKey(card.title));
    const qtyRows = card.ingredients.filter((row) => row.sourceQuantity != null && row.sourceName);
    if (!qtyRows.length) {
      report.incompleteSource.push({ title: card.title, file: card.sourceFile, reason: "source has no aligned quantities" });
      continue;
    }
    if (!recipe) {
      report.skipped.push({ title: card.title, file: card.sourceFile, reason: "no canonical recipe title match" });
      continue;
    }
    const version = versionByRecipe.get(recipe.id);
    const existing = version ? (lineCount.get(version.id) || 0) : 0;
    if (existing > 0) {
      report.skipped.push({ title: card.title, recipe: recipe.name, existing, source: qtyRows.length, reason: "canonical already has lines" });
      continue;
    }
    const planned = qtyRows.map((row) => {
      const ingredient = (ingredients || []).find((item) => matchName(item.canonical_name, row.sourceName));
      const component = (recipes || []).find((item) => item.recipe_type === "preparation" && matchName(item.name, row.sourceName));
      return {
        sourceName: row.sourceName,
        quantity: row.sourceQuantity,
        unit: row.sourceUnit,
        notes: row.notes,
        ingredientId: ingredient?.id || null,
        subRecipeId: component && !ingredient ? component.id : null,
      };
    });
    const unresolved = planned.filter((row) => !row.ingredientId && !row.subRecipeId);
    report.recovered.push({
      title: card.title,
      recipe: recipe.name,
      recipeId: recipe.id,
      existing,
      sourceLines: qtyRows.length,
      unresolved: unresolved.map((row) => row.sourceName),
      planned: planned.filter((row) => row.ingredientId || row.subRecipeId),
    });
    if (!apply || !planned.some((row) => row.ingredientId || row.subRecipeId) || !version) continue;
    let sort = 0;
    for (const row of planned) {
      if (!row.ingredientId && !row.subRecipeId) continue;
      await admin.from("inventory_recipe_version_lines").insert({
        recipe_version_id: version.id,
        ingredient_id: row.ingredientId,
        sub_recipe_id: row.subRecipeId,
        quantity: row.quantity,
        unit: row.unit,
        canonical_quantity: row.quantity,
        canonical_unit: row.unit,
        yield_waste_factor: 1,
        preparation_note: row.notes || null,
        sort_order: sort,
      });
      sort += 1;
    }
    const documentation = {
      ...(version.documentation || {}),
      preparationMethod: (card.method || []).join("\n"),
      utensils: card.utensils,
      allergens: card.allergens,
      prepTime: card.prepTime,
      cookTime: card.cookTime,
      menuSection: card.menuSection,
    };
    await admin.from("inventory_recipe_versions").update({ documentation }).eq("id", version.id);
  }
  fs.mkdirSync(path.dirname(REPORT), { recursive: true });
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    sourceCards: report.sourceCards,
    recovered: report.recovered.length,
    skipped: report.skipped.length,
    apply,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
