#!/usr/bin/env node
/**
 * Authenticated Food Bible procurement-cost identity reconcile.
 * Persists same_operational_ingredient links only for deterministic culinary matches.
 * Does not invent cost_history rows or rewrite receipts.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const STAFF_EMAIL = process.env.SUPABASE_STAFF_EMAIL || "raffiazarian2@gmail.com";
const BRANCH_ID = "khobar";
const OUT = path.join(root, "tmp", "food-bible-2026-08-20", "procurement-cost-reconcile.json");

function loadEnvLocal() {
  const env = {};
  const envPath = path.join(root, ".env.local");
  if (!fs.existsSync(envPath)) return env;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1).replace(/^["']|["']$/g, "");
  }
  return env;
}

async function loadModules() {
  const jiti = (await import("jiti")).default;
  const load = jiti(path.join(root, "scripts"), { esmResolve: true, interopDefault: true });
  return {
    cost: load(path.join(root, "src/inventory/foodBibleProcurementCost.js")),
    graph: load(path.join(root, "src/inventory/recipeGraph.js")),
    intel: load(path.join(root, "src/inventory/inventoryIntelligence.js")),
  };
}

function getServiceRole(projectRef) {
  const out = execSync(`supabase projects api-keys --project-ref ${projectRef} -o json`, {
    encoding: "utf8",
    cwd: root,
  });
  const keys = JSON.parse(out);
  const service = keys.find((key) => key.name === "service_role" || key.id === "service_role");
  if (!service?.api_key) throw new Error("service_role key not found");
  return service.api_key;
}

async function signInStaff(url, anonKey, serviceRole) {
  const userClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const admin = createClient(url, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email: STAFF_EMAIL });
  if (error) throw error;
  const { error: otpError } = await userClient.auth.verifyOtp({
    token_hash: data?.properties?.hashed_token,
    type: "magiclink",
  });
  if (otpError) throw otpError;
  return userClient;
}

async function fetchAll(client, table, select) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client.from(table).select(select).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data || []));
    if ((data || []).length < 1000) break;
  }
  return rows;
}

async function main() {
  const env = loadEnvLocal();
  const url = env.REACT_APP_SUPABASE_URL;
  const anon = env.REACT_APP_SUPABASE_ANON_KEY;
  const projectRef = url.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];
  const client = await signInStaff(url, anon, getServiceRole(projectRef));
  const { data: userData } = await client.auth.getUser();
  const userId = userData?.user?.id;
  const mods = await loadModules();

  const ingredients = await fetchAll(client, "inventory_ingredients", "*");
  const history = await fetchAll(client, "inventory_ingredient_cost_history", "*");
  const receipts = await fetchAll(client, "inventory_purchase_receipt_lines", "*");
  const invoices = await fetchAll(client, "inventory_invoice_lines", "id,ingredient_id,original_description,normalized_description,unit_price,canonical_unit,pack_quantity,pack_size,pack_unit,review_status");
  const catalogue = await fetchAll(client, "inventory_supplier_catalogue_items", "*");
  const poLines = await fetchAll(client, "inventory_purchase_order_lines", "id,ingredient_id,requested_quantity,requested_unit,expected_unit_cost,canonical_unit,notes");
  const baselines = await fetchAll(client, "inventory_approved_cost_baselines", "id,ingredient_id");
  const relatedBefore = await fetchAll(client, "inventory_related_items", "*");
  const recipes = await fetchAll(client, "inventory_recipes", "*");
  const versions = await fetchAll(client, "inventory_recipe_versions", "*");
  const lines = await fetchAll(client, "inventory_recipe_version_lines", "*");
  const menuItems = await fetchAll(client, "menu_items", "id,name_en,price,active,branch_id");

  const culinary = ingredients.filter((row) => String(row.description || "").includes("Food Bible"));
  const beforeCost = mods.cost.buildCostByCanonicalId({
    canonicalIngredients: culinary,
    historyRows: history,
    related: relatedBefore,
    asOf: new Date().toISOString(),
  });

  const identities = mods.cost.collectProcurementIdentities({
    history,
    receipts,
    invoices,
    catalogue,
    purchaseOrders: poLines,
    ingredients,
  });
  const plan = mods.cost.reconcileProcurementToCanonical({
    identities,
    canonicalIngredients: culinary,
    existingRelated: relatedBefore,
  });

  const persisted = [];
  for (const row of plan.newlyMapped) {
    if (!row.identity.ingredientId || row.identity.ingredientId === row.canonicalId) continue;
    const { data: existing } = await client.from("inventory_related_items").select("id")
      .eq("branch_id", BRANCH_ID)
      .eq("ingredient_id", row.canonicalId)
      .eq("related_ingredient_id", row.identity.ingredientId)
      .eq("relationship_type", "same_operational_ingredient")
      .maybeSingle();
    if (existing?.id) {
      persisted.push({ ...row, created: false });
      continue;
    }
    const insert = await client.from("inventory_related_items").insert({
      branch_id: BRANCH_ID,
      ingredient_id: row.canonicalId,
      related_ingredient_id: row.identity.ingredientId,
      relationship_type: "same_operational_ingredient",
      notes: JSON.stringify({
        reason: row.reason,
        descriptions: row.identity.descriptions || [],
        sources: row.identity.sources || [],
      }),
      created_by: userId,
      active: true,
    }).select("id").single();
    if (insert.error) throw new Error(insert.error.message);
    persisted.push({ ...row, created: true, id: insert.data.id });
  }

  const relatedAfter = await fetchAll(client, "inventory_related_items", "*");
  const afterCost = mods.cost.buildCostByCanonicalId({
    canonicalIngredients: culinary,
    historyRows: history,
    related: relatedAfter,
    asOf: new Date().toISOString(),
  });
  const second = mods.cost.reconcileProcurementToCanonical({
    identities,
    canonicalIngredients: culinary,
    existingRelated: relatedAfter,
  });

  const conversions = [];
  const blockedConversions = [];
  for (const row of [...receipts, ...catalogue]) {
    const target = ingredients.find((item) => item.id === row.ingredient_id)?.base_inventory_unit;
    const result = mods.cost.normalizePurchaseToCanonicalUnitCost({
      unitCostCanonical: row.unit_cost_canonical || row.last_purchase_price,
      canonicalUnit: row.canonical_unit || row.purchase_unit,
      unitPrice: row.unit_price || row.last_purchase_price,
      purchaseQuantity: row.original_quantity || row.pack_quantity || 1,
      purchaseUnit: row.original_unit || row.purchase_unit,
      packQuantity: row.pack_quantity,
      packSize: row.pack_size,
      packUnit: row.pack_unit,
      conversionFactor: row.conversion_factor,
      targetUnit: target || row.canonical_unit || row.purchase_unit,
    });
    const label = row.original_description || row.original_product_name || row.ingredient_id;
    if (result.ok) conversions.push({ label, ...result });
    else blockedConversions.push({ label, ...result });
  }

  const recipesById = Object.fromEntries(recipes.map((row) => [row.id, {
    id: row.id,
    outputQuantity: row.output_quantity,
    outputUnit: row.output_unit,
    active: row.active,
    name: row.name,
    menuItemId: row.menu_item_id,
  }]));
  const versionsByRecipeId = {};
  for (const version of versions) {
    const bucket = versionsByRecipeId[version.recipe_id] || [];
    bucket.push({
      id: version.id,
      status: version.status,
      versionNumber: version.version_number,
      effectiveFrom: version.effective_from,
      effectiveTo: version.effective_to,
      outputQuantity: version.output_quantity,
      outputUnit: version.output_unit,
    });
    versionsByRecipeId[version.recipe_id] = bucket;
  }
  const linesByVersion = {};
  for (const line of lines) {
    const bucket = linesByVersion[line.recipe_version_id] || [];
    bucket.push({
      ingredientId: line.ingredient_id,
      subRecipeId: line.sub_recipe_id,
      quantity: line.quantity,
      unit: line.unit,
      name: ingredients.find((item) => item.id === line.ingredient_id)?.canonical_name
        || recipes.find((item) => item.id === line.sub_recipe_id)?.name,
    });
    linesByVersion[line.recipe_version_id] = bucket;
  }
  const linesByRecipeId = {};
  for (const recipe of recipes) {
    const version = mods.graph.resolveRecipeVersionForDate(versionsByRecipeId[recipe.id] || [], null)
      || (versionsByRecipeId[recipe.id] || []).find((entry) => entry.status !== "draft");
    linesByRecipeId[recipe.id] = version ? (linesByVersion[version.id] || []) : [];
    if (version) linesByRecipeId[version.id] = linesByVersion[version.id] || [];
  }

  const costByIngredientId = afterCost;
  const fbActive = recipes.filter((row) => String(row.internal_name || "").startsWith("fb:20260820:") && row.active);
  const classified = fbActive.map((recipe) => {
    const priced = mods.cost.costFoodBibleRecipe({
      recipeId: recipe.id,
      recipesById,
      versionsByRecipeId,
      linesByRecipeId,
      costByIngredientId,
      sellingPrice: menuItems.find((item) => item.id === recipe.menu_item_id)?.price,
    });
    return { name: recipe.name, ...priced };
  });

  const examples = {};
  const exampleMatchers = [
    { key: "Big NAC", pattern: /big\s*nac/i },
    { key: "King Prawn Rendang", pattern: /prawn rendang/i },
    { key: "Watermelon & Cucumber", pattern: /watermelon/i },
    { key: "Pan Seared Seabass", pattern: /sea\s*bass creole/i },
  ];
  for (const { key, pattern } of exampleMatchers) {
    const recipe = recipes.find((row) => row.active && pattern.test(row.name));
    if (!recipe) {
      examples[key] = { ok: false, reason: "NO_RECIPE" };
      continue;
    }
    const live = menuItems.find((item) => item.id === recipe.menu_item_id);
    const priced = mods.cost.costFoodBibleRecipe({
      recipeId: recipe.id,
      recipesById,
      versionsByRecipeId,
      linesByRecipeId,
      costByIngredientId,
      sellingPrice: live?.price,
    });
    const appleBircher = recipes.find((row) => /apple bircher/i.test(row.name));
      examples[key] = {
      recipeName: recipe.name,
      versionId: priced.versionId,
      sellingPrice: live?.price || null,
      liveName: live?.name_en || null,
      state: priced.state,
      total: priced.total,
      knownSubtotal: priced.knownSubtotal,
      coveragePct: priced.coveragePct,
      foodCostPct: priced.foodCostPct,
      missing: (priced.missing || []).map((item) => item.name || item.ingredientId || item.code),
      expanded: (priced.expandedLines || []).map((line) => ({
        name: ingredients.find((item) => item.id === line.ingredientId)?.canonical_name || line.name,
        quantity: line.quantity,
        unit: line.unit,
        costed: Boolean(costByIngredientId[line.ingredientId]),
      })),
      appleBircherActive: appleBircher?.active === true,
    };
  }

  const julyProof = mods.cost.resolveEffectiveCost({
    ingredientId: history[0]?.ingredient_id,
    asOf: "2026-07-10T12:00:00+03:00",
    historyRows: history,
  });
  const laterProof = mods.cost.resolveEffectiveCost({
    ingredientId: history[0]?.ingredient_id,
    asOf: "2026-07-22T12:00:00+03:00",
    historyRows: history,
  });

  const report = {
    authenticatedAs: userData?.user?.email,
    sources: {
      history: history.length,
      receipts: receipts.length,
      invoices: invoices.length,
      catalogue: catalogue.length,
      purchaseOrders: poLines.length,
      relatedItems: relatedAfter.length,
      approvedBaselines: baselines.length,
    },
    identities: {
      total: plan.total,
      names: identities.map((row) => ({
        name: row.name,
        descriptions: row.descriptions,
        sources: row.sources,
      })),
      alreadyMapped: plan.alreadyMapped.length,
      newlyMapped: persisted.filter((row) => row.created).length,
      reusedLinks: persisted.filter((row) => row.created === false).length,
      unresolved: plan.unresolved.length,
      excluded: plan.results.filter((row) => row.status === "excluded").length,
      review: plan.review,
    },
    culinaryWithCostBefore: Object.keys(beforeCost).length,
    culinaryWithCostAfter: Object.keys(afterCost).length,
    culinaryStillMissing: culinary.filter((row) => !afterCost[row.id]).map((row) => row.canonical_name),
    conversions: conversions.slice(0, 20),
    blockedConversions: blockedConversions.slice(0, 20),
    recipes: {
      fully: classified.filter((row) => row.state === "fully costed").length,
      partial: classified.filter((row) => row.state === "partially costed").length,
      uncosted: classified.filter((row) => row.state === "uncosted").length,
    },
    examples,
    historicalProof: { july10: julyProof, july22: laterProof },
    idempotency: { secondPassNew: second.newlyMapped.length },
    appleBircher: recipes.find((row) => /apple bircher/i.test(row.name)) || null,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
