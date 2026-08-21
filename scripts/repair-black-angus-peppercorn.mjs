#!/usr/bin/env node
/** Targeted Black Angus + Peppercorn Sauce source repair. Does not re-ingest the Food Bible. */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { parseFoodBiblePdfExtract, sourceIngredientKey } from "../src/inventory/foodBibleSourceCardParser.js";
import { normalizeText } from "../src/inventory/inventoryIntelligence.js";

const require = createRequire(import.meta.url);
const pdfjs = require("pdfjs-dist/legacy/build/pdf.js");
pdfjs.GlobalWorkerOptions.workerSrc = require.resolve("pdfjs-dist/legacy/build/pdf.worker.js");
const PDF = "/Users/raffiazarian/Desktop/Work/Nac/Nac menu updated 20 aug 2026/Black Angus, black peppercorn.pdf";
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

function loadEnv() {
  const env = {};
  for (const line of fs.readFileSync(path.join(root, ".env.local"), "utf8").split("\n")) {
    if (!line.trim() || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    env[line.slice(0, eq)] = line.slice(eq + 1).replace(/^["']|["']$/g, "");
  }
  return env;
}

async function extractPdf(file) {
  const data = new Uint8Array(fs.readFileSync(file));
  const doc = await pdfjs.getDocument({ data, verbosity: 0 }).promise;
  const pages = [];
  for (let page = 1; page <= doc.numPages; page += 1) {
    const pdfPage = await doc.getPage(page);
    const text = (await pdfPage.getTextContent()).items.map((item) => item.str).join("\n");
    pages.push({ page, text });
  }
  return { fileName: path.basename(file), pages };
}

async function ensureIngredient(admin, ingredients, name, unit) {
  const key = sourceIngredientKey(name);
  const existing = ingredients.find((item) => sourceIngredientKey(item.canonical_name) === key);
  if (existing) return existing;
  const { data, error } = await admin.from("inventory_ingredients").insert({
    canonical_name: name,
    normalized_search_name: normalizeText(name),
    base_inventory_unit: unit,
    purchasing_unit: null,
    yield_percentage: 100,
    scope: "network",
    active: true,
    allergen_metadata: {},
  }).select("id,canonical_name,base_inventory_unit").single();
  if (error) throw error;
  ingredients.push(data);
  return data;
}

async function insertVersionedLines(admin, recipe, previous, documentation, inserts) {
  const nextNumber = (previous?.version_number || 0) + 1;
  const { data: next, error: versionError } = await admin.from("inventory_recipe_versions").insert({
    recipe_id: recipe.id,
    version_number: nextNumber,
    effective_from: new Date().toISOString(),
    status: "draft",
    documentation,
  }).select("id").single();
  if (versionError) throw versionError;
  if (inserts.length) {
    const { error } = await admin.from("inventory_recipe_version_lines").insert(inserts.map((row, sort) => ({
      recipe_version_id: next.id,
      ingredient_id: row.ingredient_id,
      sub_recipe_id: row.sub_recipe_id,
      quantity: row.quantity,
      unit: row.unit,
      canonical_quantity: row.quantity,
      canonical_unit: row.unit,
      yield_waste_factor: 1,
      preparation_note: row.note || null,
      is_optional: false,
      waste_percentage: 0,
      sort_order: sort,
    })));
    if (error) throw error;
  }
  return next;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const env = loadEnv();
  const raw = await extractPdf(PDF);
  const cards = parseFoodBiblePdfExtract(raw);
  const angusCard = cards.find((card) => /black angus/i.test(card.title));
  const sauceCard = cards.find((card) => /peppercorn sauce/i.test(card.title));
  if (!angusCard || !sauceCard) throw new Error("Could not parse Black Angus source cards");
  const url = env.REACT_APP_SUPABASE_URL;
  const projectRef = new URL(url).hostname.split(".")[0];
  const keys = JSON.parse(execSync(`supabase projects api-keys --project-ref ${projectRef} -o json`, { encoding: "utf8", cwd: root }));
  const admin = createClient(url, keys.find((key) => key.name === "service_role" || key.id === "service_role").api_key, { auth: { persistSession: false } });
  const { data: recipes } = await admin.from("inventory_recipes").select("id,name,recipe_type");
  const { data: ingredients } = await admin.from("inventory_ingredients").select("id,canonical_name,base_inventory_unit");
  const ingredientRows = ingredients || [];
  const angus = recipes.find((row) => sourceIngredientKey(row.name) === sourceIngredientKey(angusCard.title));
  const sauce = recipes.find((row) => sourceIngredientKey(row.name) === sourceIngredientKey(sauceCard.title));
  const { data: versions } = await admin.from("inventory_recipe_versions").select("id,recipe_id,version_number,status,documentation").order("version_number", { ascending: false });
  const working = (recipeId) => {
    const list = (versions || []).filter((row) => row.recipe_id === recipeId);
    return list.find((row) => row.status === "draft") || list[0];
  };
  const angusMethod = [
    "1. Warm peppercorn sauce in a saucepan, keep warm for service",
    "1. Take the sirloin out of the fridge and leave at the room temperature for 5 min. Season each side with table salt. Cook on the plancha to asked temperature and let rest on a tray for 3 min",
    "2. Slice the steak in 3mm slices and place in the middle of the plate. Add the hot peppercorn sauce and top up with chopped chives and few micro herbs",
  ].join("\n");
  const sauceMethod = (sauceCard.method || []).join("\n");
  const report = {
    angus: { ...angusCard, recipeId: angus?.id },
    sauce: { ...sauceCard, recipeId: sauce?.id, unresolved: sauceCard.unresolvedIngredients },
  };
  if (!apply) {
    console.log(JSON.stringify({
      angusLines: angusCard.ingredients,
      sauceLines: sauceCard.ingredients,
      unresolved: sauceCard.unresolvedIngredients,
      yield: { angus: angusCard.yieldRaw, sauce: sauceCard.yieldRaw, sauceUnit: sauceCard.yieldUnit },
      meta: { angus: { prep: angusCard.prepTime, cook: angusCard.cookTime, allergens: angusCard.allergens, section: angusCard.menuSection } },
    }, null, 2));
    return;
  }
  const sauceVersion = working(sauce.id);
  const angusVersion = working(angus.id);
  const cream = await ensureIngredient(admin, ingredientRows, "Double cream", "millilitre");
  const shallots = await ensureIngredient(admin, ingredientRows, "Shallots", "gram");
  const peppercorn = await ensureIngredient(admin, ingredientRows, "Black peppercorn", "gram");
  const butter = await ensureIngredient(admin, ingredientRows, "Butter", "gram");
  const steak = await ensureIngredient(admin, ingredientRows, "Black Angus steak", "gram");
  const oil = await ensureIngredient(admin, ingredientRows, "Oil cooking", "millilitre");
  const salt = await ensureIngredient(admin, ingredientRows, "Table salt", "gram");
  const pepper = await ensureIngredient(admin, ingredientRows, "Black pepper", "gram");
  await insertVersionedLines(admin, sauce, sauceVersion, {
      ...(sauceVersion.documentation || {}),
      preparationMethod: sauceMethod,
      utensils: sauceCard.utensils,
      allergens: sauceCard.allergens,
      prepTime: sauceCard.prepTime || "",
      cookTime: sauceCard.cookTime,
      menuSection: sauceCard.menuSection,
      sourceYieldRaw: sauceCard.yieldRaw,
      sourceDataNeedsReview: true,
      unresolvedSourceLines: sauceCard.unresolvedIngredients || [],
      yieldDerivation: "explicit_source_yield",
    }, [
    { ingredient_id: cream.id, sub_recipe_id: null, quantity: 4000, unit: "millilitre" },
    { ingredient_id: shallots.id, sub_recipe_id: null, quantity: 330, unit: "gram" },
    { ingredient_id: peppercorn.id, sub_recipe_id: null, quantity: 20, unit: "gram" },
    { ingredient_id: butter.id, sub_recipe_id: null, quantity: 50, unit: "gram" },
  ]);
  await admin.from("inventory_recipes").update({
    output_quantity: sauceCard.yieldQuantity,
    output_unit: sauceCard.yieldUnit,
  }).eq("id", sauce.id);

  await insertVersionedLines(admin, angus, angusVersion, {
      ...(angusVersion.documentation || {}),
      preparationMethod: angusMethod,
      platingInstructions: "",
      utensils: angusCard.utensils,
      allergens: angusCard.allergens,
      prepTime: "",
      cookTime: angusCard.cookTime,
      menuSection: angusCard.menuSection,
      sourceYieldRaw: angusCard.yieldRaw,
      sourceDataNeedsReview: false,
      unresolvedSourceLines: [],
    }, [
    { ingredient_id: null, sub_recipe_id: sauce.id, quantity: 75, unit: "gram" },
    { ingredient_id: steak.id, sub_recipe_id: null, quantity: 150, unit: "gram" },
    { ingredient_id: oil.id, sub_recipe_id: null, quantity: 10, unit: "millilitre" },
    { ingredient_id: salt.id, sub_recipe_id: null, quantity: 3, unit: "gram" },
    { ingredient_id: pepper.id, sub_recipe_id: null, quantity: 10, unit: "gram" },
  ]);
  await admin.from("inventory_recipes").update({
    output_quantity: 1,
    output_unit: "each",
  }).eq("id", angus.id);
  console.log(JSON.stringify({ applied: true, angus: angus.id, sauce: sauce.id }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
