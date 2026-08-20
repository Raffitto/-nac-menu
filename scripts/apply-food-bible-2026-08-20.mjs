#!/usr/bin/env node
/**
 * Authenticated canonical apply of the 20 Aug 2026 Food Bible package.
 * Uses staff session (RLS intact). Service role is only used to mint that session.
 * Does not mutate Netlify. Does not commit secrets.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const SOURCE_DIR = "/Users/raffiazarian/Desktop/Work/Nac/Nac menu updated 20 aug 2026";
const OUT_DIR = path.join(root, "tmp", "food-bible-2026-08-20");
const STAFF_EMAIL = process.env.SUPABASE_STAFF_EMAIL || "raffiazarian2@gmail.com";
const BRANCH_ID = "khobar";

function loadEnvLocal() {
  const envPath = path.join(root, ".env.local");
  const env = {};
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
    extract: load(path.join(root, "src/inventory/foodBiblePdfExtract.js")),
    reconcile: load(path.join(root, "src/inventory/recipeMenuReconcile.js")),
    apply: load(path.join(root, "src/inventory/foodBibleCanonicalApply.js")),
    coverage: load(path.join(root, "src/inventory/foodBibleKitchenCoverage.js")),
    graph: load(path.join(root, "src/inventory/recipeGraph.js")),
    pdf: load(path.join(root, "src/inventory/recipePdfExport.js")),
    foodBible: load(path.join(root, "src/inventory/foodBible.js")),
    intel: load(path.join(root, "src/inventory/inventoryIntelligence.js")),
    cost: load(path.join(root, "src/inventory/foodBibleCostReconcile.js")),
  };
}

function getServiceRole(projectRef) {
  const out = execSync(`supabase projects api-keys --project-ref ${projectRef} -o json`, {
    encoding: "utf8",
    cwd: root,
  });
  const keys = JSON.parse(out);
  const service = keys.find((key) => key.name === "service_role" || key.id === "service_role");
  if (!service?.api_key) throw new Error("service_role key not found via Supabase CLI");
  return service.api_key;
}

async function signInStaff(url, anonKey, serviceRole) {
  const password = process.env.SUPABASE_STAFF_PASSWORD;
  const userClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  if (password) {
    const { data, error } = await userClient.auth.signInWithPassword({ email: STAFF_EMAIL, password });
    if (error) throw error;
    return userClient;
  }
  const admin = createClient(url, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: STAFF_EMAIL,
  });
  if (error) throw error;
  const tokenHash = data?.properties?.hashed_token;
  if (!tokenHash) throw new Error("Magic-link token missing");
  const { error: otpError } = await userClient.auth.verifyOtp({
    token_hash: tokenHash,
    type: "magiclink",
  });
  if (otpError) throw otpError;
  return userClient;
}

async function extractPdfPages(filePath) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.js");
  const data = new Uint8Array(fs.readFileSync(filePath));
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i += 1) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    pages.push({ page: i, text: content.items.map((item) => item.str || "").join("\n") });
  }
  return pages;
}

async function fetchAll(client, table, select, extra = (query) => query) {
  const pageSize = 1000;
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const query = extra(client.from(table).select(select).range(from, from + pageSize - 1));
    const { data, error } = await query;
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data || []));
    if ((data || []).length < pageSize) break;
  }
  return rows;
}

async function unwrap(result, context) {
  if (result.error) throw new Error(`${context}: ${result.error.message}`);
  return result.data;
}

function mapIngredient(row) {
  return {
    id: row.id,
    canonicalName: row.canonical_name,
    normalizedSearchName: row.normalized_search_name,
    description: row.description,
    baseInventoryUnit: row.base_inventory_unit,
    active: row.active !== false,
  };
}

async function main() {
  const env = loadEnvLocal();
  const url = env.REACT_APP_SUPABASE_URL;
  const anon = env.REACT_APP_SUPABASE_ANON_KEY;
  if (!url || !anon) throw new Error("Missing REACT_APP_SUPABASE_URL / ANON_KEY in .env.local");
  const projectRef = url.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];
  const serviceRole = getServiceRole(projectRef);
  const client = await signInStaff(url, anon, serviceRole);
  const { data: userData } = await client.auth.getUser();
  const userId = userData?.user?.id;
  const email = userData?.user?.email;
  if (!userId) throw new Error("Authenticated user id missing");

  const mods = await loadModules();
  const pdfs = fs.readdirSync(SOURCE_DIR).filter((name) => name.toLowerCase().endsWith(".pdf") && !name.startsWith(".")).sort();
  const files = [];
  for (const fileName of pdfs) {
    const sourcePath = path.join(SOURCE_DIR, fileName);
    const buf = fs.readFileSync(sourcePath);
    files.push({
      fileName,
      sourceFile: fileName,
      sourcePath,
      sha256: crypto.createHash("sha256").update(buf).digest("hex"),
      pages: await extractPdfPages(sourcePath),
    });
  }
  const preview = mods.extract.buildFoodBibleCohortPreview({ files, menuItems: [] });
  const issueSummary = mods.coverage.summarizeParseIssues(preview.recipes);

  const menuItems = await fetchAll(client, "menu_items", "id,name_en,name_ar,price,active,sold_out,hidden_until,branch_id,section_id,placement_group_id,sort_order", (q) => q.eq("branch_id", BRANCH_ID));
  const sections = await fetchAll(client, "sections", "id,name_en,category_id,branch_id", (q) => q.eq("branch_id", BRANCH_ID));
  const categories = await fetchAll(client, "categories", "id,name_en,branch_id", (q) => q.eq("branch_id", BRANCH_ID));
  const sectionById = Object.fromEntries(sections.map((row) => [row.id, row]));
  const categoryById = Object.fromEntries(categories.map((row) => [row.id, row.name_en]));
  const liveItems = menuItems.map((row) => ({
    ...row,
    name: row.name_en,
    sectionName: sectionById[row.section_id]?.name_en || "",
    categoryName: categoryById[sectionById[row.section_id]?.category_id] || "",
  }));
  const report = mods.reconcile.reconcileRecipesToLiveMenu({
    liveItems,
    recipes: preview.recipes,
    importDate: "2026-08-20",
    brand: "NAC",
  });
  const coverage = mods.coverage.kitchenRecipeCoverage(
    report.liveRows.map((row) => {
      const item = liveItems.find((live) => live.id === row.liveId);
      return { ...row, sectionName: item?.sectionName, categoryName: item?.categoryName };
    }),
  );

  let ingredientRows = (await fetchAll(client, "inventory_ingredients", "*")).map(mapIngredient);
  const existingRecipes = (await fetchAll(client, "inventory_recipes", "*")).map((row) => ({
    ...row,
    internalName: row.internal_name,
    importKey: row.internal_name,
    fingerprint: row.documentation?.fingerprint || null,
    documentation: {},
  }));
  // documentation lives on versions; fetch later if needed
  const versionRows = await fetchAll(client, "inventory_recipe_versions", "id,recipe_id,version_number,status,documentation,effective_from,effective_to");
  const versionsByRecipe = new Map();
  for (const version of versionRows) {
    const bucket = versionsByRecipe.get(version.recipe_id) || [];
    bucket.push(version);
    versionsByRecipe.set(version.recipe_id, bucket);
  }
  const existingWithFingerprint = existingRecipes.map((recipe) => {
    const working = (versionsByRecipe.get(recipe.id) || [])
      .slice()
      .sort((a, b) => (b.version_number || 0) - (a.version_number || 0))
      .find((version) => version.status === "active")
      || (versionsByRecipe.get(recipe.id) || [])[0];
    return {
      ...recipe,
      fingerprint: working?.documentation?.fingerprint || recipe.fingerprint,
      documentation: working?.documentation || {},
    };
  });

  let plan = mods.apply.buildApplyPlan({
    recipes: preview.recipes,
    recipeRows: report.recipeRows,
    ingredients: ingredientRows,
    existingRecipes: existingWithFingerprint,
  });

  const createdIngredients = [];
  const reusedIngredients = [];
  const ingredientIdByKey = new Map();
  for (const action of plan.ingredientActions) {
    if (action.action === "reuse" && action.ingredientId) {
      ingredientIdByKey.set(action.key, action.ingredientId);
      reusedIngredients.push(action);
      continue;
    }
    if (action.action !== "create") continue;
    if (ingredientIdByKey.has(action.key)) continue;
    const { data, error } = await client.from("inventory_ingredients").insert({
      canonical_name: action.canonicalName,
      normalized_search_name: action.key,
      description: `Food Bible aliases: ${(action.sourceNames || []).join(" | ")}`,
      category: "Other",
      base_inventory_unit: action.baseInventoryUnit,
      inventory_classification: "food_ingredient",
      recipe_cost_eligible: true,
      legitimate_zero_cost: false,
      yield_percentage: 100,
      scope: "network",
      branch_id: null,
      created_by: userId,
      active: true,
    }).select().single();
    if (error) {
      if (/duplicate|unique/i.test(error.message)) {
        const { data: existing } = await client.from("inventory_ingredients").select("*").eq("normalized_search_name", action.key).maybeSingle();
        if (existing) {
          ingredientIdByKey.set(action.key, existing.id);
          reusedIngredients.push({ ...action, action: "reuse", ingredientId: existing.id });
          continue;
        }
      }
      throw new Error(`Create ingredient ${action.canonicalName}: ${error.message}`);
    }
    ingredientIdByKey.set(action.key, data.id);
    createdIngredients.push(action);
    ingredientRows.push(mapIngredient(data));
  }

  plan = mods.apply.buildApplyPlan({
    recipes: preview.recipes,
    recipeRows: report.recipeRows,
    ingredients: ingredientRows,
    existingRecipes: existingWithFingerprint,
  });

  const ordered = [...plan.persist].sort((a, b) => Number(b.recipeType === "preparation") - Number(a.recipeType === "preparation"));
  const pending = [];
  for (const row of ordered) {
    const { data: already } = await client.from("inventory_recipes").select("*").eq("internal_name", row.importKey).maybeSingle();
    let liveFingerprint = null;
    let lineCount = 0;
    let existingHasSubRecipe = false;
    let versionDocs = [];
    if (already?.id) {
      const fetched = await client.from("inventory_recipe_versions")
        .select("id,documentation,status,version_number,output_quantity,output_unit")
        .eq("recipe_id", already.id)
        .order("version_number", { ascending: false });
      versionDocs = fetched.data || [];
      liveFingerprint = versionDocs.find((version) => version.documentation?.fingerprint)?.documentation?.fingerprint || null;
      const versionIds = versionDocs.map((version) => version.id);
      if (versionIds.length) {
        const activeIds = versionDocs.filter((version) => version.status === "active" || version.status === "retired").map((version) => version.id);
        if (activeIds.length) {
          const { data: existingLines } = await client.from("inventory_recipe_version_lines").select("id,sub_recipe_id").in("recipe_version_id", activeIds);
          lineCount = (existingLines || []).length;
          existingHasSubRecipe = (existingLines || []).some((line) => line.sub_recipe_id);
        }
      }
    }
    const existing = already
      ? {
        id: already.id,
        internalName: already.internal_name,
        fingerprint: liveFingerprint,
      }
      : existingWithFingerprint.find((recipe) => recipe.internalName === row.importKey);
    const activeVersion = (versionDocs || []).find((version) => version.status === "active");
    const decision = mods.apply.applyDecision(existing, row.fingerprint, {
      hasLines: Boolean(already) && lineCount > 0,
      plannedLineCount: row.lines.length,
      existingLineCount: lineCount,
      plannedSubRecipes: row.lines.some((line) => line.subRecipeName),
      existingHasSubRecipe,
      outputChanged: Boolean(already) && (
        String(already.output_unit || "") !== String(row.outputUnit || "")
        || Number(already.output_quantity) !== Number(row.outputQuantity)
        || (activeVersion && (
          String(activeVersion.output_unit || "") !== String(row.outputUnit || "")
          || Number(activeVersion.output_quantity) !== Number(row.outputQuantity)
        ))
      ),
    });
    let recipeId = existing?.id || already?.id || null;
    let versionId = null;
    if (decision === "create") {
      const inserted = await unwrap(await client.from("inventory_recipes").insert({
        name: row.name,
        normalized_name: mods.intel.normalizeText(row.name),
        internal_name: row.importKey,
        name_en: row.name,
        recipe_type: row.recipeType,
        menu_item_id: row.menuItemId,
        placement_group_id: row.placementGroupId,
        branch_id: null,
        output_quantity: row.outputQuantity,
        output_unit: row.outputUnit,
        portion_count: row.portionCount,
        portion_size: row.portionSize,
        portion_unit: row.portionUnit,
        active: row.active,
        created_by: userId,
        updated_by: userId,
      }).select().single(), `Create recipe ${row.name}`);
      recipeId = inserted.id;
      const version = await unwrap(await client.from("inventory_recipe_versions").insert({
        recipe_id: recipeId,
        version_number: 1,
        effective_from: mods.apply.PACKAGE_EFFECTIVE_FROM,
        status: "draft",
        output_quantity: row.outputQuantity,
        output_unit: row.outputUnit,
        portion_count: row.portionCount,
        portion_size: row.portionSize,
        portion_unit: row.portionUnit,
        documentation: { ...row.documentation, fingerprint: row.fingerprint },
        created_by: userId,
        updated_by: userId,
      }).select().single(), "Create version");
      versionId = version.id;
    } else if (decision === "new_version") {
      const prepared = await unwrap(await client.rpc("inventory_prepare_recipe_draft_version", {
        p_recipe_id: recipeId,
        p_documentation: { ...row.documentation, fingerprint: row.fingerprint },
      }), "Prepare draft version");
      versionId = prepared.id || prepared;
      await unwrap(await client.from("inventory_recipe_versions").update({
        output_quantity: row.outputQuantity,
        output_unit: row.outputUnit,
        portion_count: row.portionCount,
        portion_size: row.portionSize,
        portion_unit: row.portionUnit,
        documentation: { ...row.documentation, fingerprint: row.fingerprint },
      }).eq("id", versionId), "Update draft header");
      await unwrap(await client.from("inventory_recipes").update({
        active: row.active,
        menu_item_id: row.menuItemId,
        placement_group_id: row.placementGroupId,
        output_quantity: row.outputQuantity,
        output_unit: row.outputUnit,
        portion_count: row.portionCount,
        portion_size: row.portionSize,
        portion_unit: row.portionUnit,
        updated_by: userId,
      }).eq("id", recipeId), "Update recipe header");
    } else {
      await unwrap(await client.from("inventory_recipes").update({
        active: row.active,
        menu_item_id: row.menuItemId,
        placement_group_id: row.placementGroupId,
        updated_by: userId,
      }).eq("id", recipeId), "Refresh recipe flags");
    }
    pending.push({ ...row, recipeId, decision, versionId, wasActive: Boolean(already?.active) });
  }

  const recipeIdByPrepKey = new Map();
  const pendingById = new Map();
  for (const row of pending) {
    recipeIdByPrepKey.set(mods.apply.normalizeIngredientKey(row.name), row.recipeId);
    recipeIdByPrepKey.set(row.importKey, row.recipeId);
    pendingById.set(row.recipeId, row);
  }
  const activateOrder = [
    ...pending.filter((row) => row.recipeType === "preparation"),
    ...pending.filter((row) => row.recipeType !== "preparation"),
  ];
  const activatedPrepIds = new Set();
  let applyClockMs = Date.now();
  async function nextApplyInstant(recipeId) {
    const recipeNext = await nextEffectiveFrom(client, recipeId, mods.apply.PACKAGE_EFFECTIVE_FROM);
    applyClockMs = Math.max(applyClockMs, new Date(recipeNext).getTime()) + 1000;
    return new Date(applyClockMs).toISOString();
  }
  for (const row of activateOrder) {
    if (!row.versionId || (row.decision !== "create" && row.decision !== "new_version")) {
      if (row.recipeType === "preparation" && row.recipeId && row.wasActive) {
        activatedPrepIds.add(row.recipeId);
      }
      continue;
    }
    if (!row.lines.length) {
      await unwrap(await client.from("inventory_recipes").update({
        active: false,
        updated_by: userId,
      }).eq("id", row.recipeId), "Deactivate empty recipe");
      row.decision = `${row.decision}_empty_lines`;
      continue;
    }
    await insertLines(client, mods, row.versionId, row, ingredientIdByKey, recipeIdByPrepKey, ingredientRows, {
      pendingById,
      activatedPrepIds,
    });
    const { count: lineCount } = await client.from("inventory_recipe_version_lines").select("id", { count: "exact", head: true }).eq("recipe_version_id", row.versionId);
    if (!lineCount) {
      await unwrap(await client.from("inventory_recipes").update({
        active: false,
        updated_by: userId,
      }).eq("id", row.recipeId), "Deactivate recipe without lines");
      row.decision = `${row.decision}_no_persisted_lines`;
      continue;
    }
    try {
      await unwrap(await client.rpc("inventory_activate_recipe_version", {
        p_recipe_version_id: row.versionId,
        p_effective_from: await nextApplyInstant(row.recipeId),
        p_reason: row.decision === "create"
          ? "Food Bible 20 Aug 2026 canonical apply"
          : "Food Bible 20 Aug 2026 re-apply (content changed)",
      }), "Activate version");
      if (row.recipeType === "preparation") activatedPrepIds.add(row.recipeId);
    } catch (err) {
      row.activateError = String(err.message).slice(0, 180);
      if (/INVALID_SUBRECIPE_VERSION_OR_UNIT/.test(err.message)) {
        try {
          await unwrap(await client.rpc("inventory_activate_recipe_version", {
            p_recipe_version_id: row.versionId,
            p_effective_from: await nextApplyInstant(row.recipeId),
            p_reason: "Food Bible 20 Aug 2026 canonical apply (retry after nested version clock)",
          }), "Activate version retry");
          if (row.recipeType === "preparation") activatedPrepIds.add(row.recipeId);
          row.activateRetry = true;
          continue;
        } catch (retryErr) {
          row.activateError = String(retryErr.message).slice(0, 180);
        }
        const { data: badLines } = await client.from("inventory_recipe_version_lines").select("*").eq("recipe_version_id", row.versionId);
        for (const line of badLines || []) {
          if (!line.sub_recipe_id) continue;
          const prepName = pendingById.get(line.sub_recipe_id)?.name;
          const ingredientId = ingredientIdByKey.get(mods.apply.normalizeIngredientKey(prepName || ""));
          if (!ingredientId) continue;
          await client.from("inventory_recipe_version_lines").update({
            sub_recipe_id: null,
            ingredient_id: ingredientId,
          }).eq("id", line.id);
          row.subRecipeFallback = true;
        }
        try {
          await unwrap(await client.rpc("inventory_activate_recipe_version", {
            p_recipe_version_id: row.versionId,
            p_effective_from: await nextApplyInstant(row.recipeId),
            p_reason: "Food Bible 20 Aug 2026 canonical apply (ingredient fallback for unresolved component)",
          }), "Activate version after sub-recipe fallback");
          if (row.recipeType === "preparation") activatedPrepIds.add(row.recipeId);
          continue;
        } catch {
          // fall through to deactivate
        }
      }
      await unwrap(await client.from("inventory_recipes").update({
        active: false,
        updated_by: userId,
      }).eq("id", row.recipeId), "Deactivate recipe that failed activation");
      row.decision = `activate_failed:${String(err.message).slice(0, 80)}`;
    }
  }
  const persisted = pending;

  const recipesNow = await fetchAll(client, "inventory_recipes", "*");
  const versionsNow = await fetchAll(client, "inventory_recipe_versions", "*");
  const linesNow = await fetchAll(client, "inventory_recipe_version_lines", "*");
  const ingredientsNow = await fetchAll(client, "inventory_ingredients", "*");

  const costHistory = await fetchAll(client, "inventory_ingredient_cost_history", "ingredient_id,canonical_unit,canonical_unit_cost,effective_at,branch_id");
  let receiptLines = [];
  let aliases = [];
  let catalogue = [];
  try {
    receiptLines = await fetchAll(client, "inventory_purchase_receipt_lines", "ingredient_id,canonical_unit,unit_cost_canonical,original_description,normalized_description,created_at");
  } catch {
    receiptLines = [];
  }
  try {
    catalogue = await fetchAll(client, "inventory_supplier_catalogue_items", "id,ingredient_id,original_product_name,normalized_product_name");
  } catch {
    catalogue = [];
  }
  try {
    const aliasRows = await fetchAll(client, "inventory_supplier_item_aliases", "catalogue_item_id,original_description,normalized_description");
    const catalogueById = new Map(catalogue.map((row) => [row.id, row]));
    aliases = aliasRows.map((row) => {
      const item = catalogueById.get(row.catalogue_item_id);
      return {
        ingredient_id: item?.ingredient_id || null,
        original_description: row.original_description,
        normalized_description: row.normalized_description,
      };
    });
  } catch {
    aliases = [];
  }
  const costRows = mods.cost.collectPositiveCostRecords({
    history: costHistory,
    receiptLines,
    invoiceLines: [],
  });
  const costMap = mods.cost.matchCostHistoryToCanonical({
    costRows,
    ingredients: ingredientsNow.map(mapIngredient),
    lookupIngredients: ingredientsNow.map(mapIngredient),
    aliases,
    catalogue: catalogue.map((row) => ({
      ingredient_id: row.ingredient_id,
      item_name: row.original_product_name,
      normalized_name: row.normalized_product_name,
    })),
  });
  const costByIngredient = new Map(
    Object.entries(costMap.costByCanonicalId).map(([id, row]) => [id, { amount: row.amount, unit: row.unit }]),
  );

  const costing = { fully: 0, partial: 0, uncosted: 0, partialMissing: [], fullyNamed: [], examples: [] };
  const recipeById = Object.fromEntries(recipesNow.map((row) => [row.id, {
    id: row.id,
    outputQuantity: row.output_quantity,
    outputUnit: row.output_unit,
    active: row.active,
    menuItemId: row.menu_item_id,
    name: row.name,
  }]));
  const linesByVersion = {};
  for (const line of linesNow) {
    const bucket = linesByVersion[line.recipe_version_id] || [];
    bucket.push({
      ingredientId: line.ingredient_id,
      subRecipeId: line.sub_recipe_id,
      quantity: line.quantity,
      unit: line.unit,
    });
    linesByVersion[line.recipe_version_id] = bucket;
  }
  const versionsByRecipeId = {};
  for (const version of versionsNow) {
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
  const linesByRecipeId = {};
  const currentVersionByRecipe = {};
  for (const recipe of recipesNow) {
    const versions = (versionsByRecipeId[recipe.id] || [])
      .filter((version) => version.status !== "draft")
      .sort((a, b) => (b.versionNumber || 0) - (a.versionNumber || 0));
    const version = versions[0] || mods.graph.resolveRecipeVersionForDate(versionsByRecipeId[recipe.id] || [], "2026-08-20");
    currentVersionByRecipe[recipe.id] = version || null;
    linesByRecipeId[recipe.id] = version ? (linesByVersion[version.id] || []) : [];
    if (version?.id) linesByRecipeId[version.id] = linesByVersion[version.id] || [];
  }
  for (const recipe of recipesNow.filter((row) => String(row.internal_name || "").startsWith("fb:20260820:") && row.active)) {
    const expanded = mods.graph.expandRecipeToIngredients({
      recipeId: recipe.id,
      recipesById: recipeById,
      versionsByRecipeId,
      linesByRecipeId,
      businessDate: null,
      soldQuantity: 1,
    });
    const classified = mods.graph.classifyRecipeCosting({
      lines: expanded.ingredients,
      costByIngredientId: Object.fromEntries(costByIngredient),
    });
    if (classified.state === "fully costed") {
      costing.fully += 1;
      costing.fullyNamed.push({ name: recipe.name, total: classified.total });
    } else if (classified.state === "partially costed") {
      costing.partial += 1;
      costing.partialMissing.push({
        name: recipe.name,
        missing: classified.missing.slice(0, 8).map((item) => item.name || item.ingredientId || item.code),
      });
    } else costing.uncosted += 1;
  }

  const examples = [];
  for (const name of ["Big NAC", "King Prawn Rendang", "Watermelon & Cucumber", "Pan Seared Seabass"]) {
    const wanted = mods.intel.normalizeText(name);
    const matchingLive = liveItems.filter((item) => {
      const liveName = mods.intel.normalizeText(item.name_en || item.name);
      return liveName === wanted || liveName.includes(wanted) || wanted.includes(liveName);
    });
    const recipe = recipesNow.find((row) => row.active && matchingLive.some((item) => item.id === row.menu_item_id))
      || recipesNow.find((row) => row.active && new RegExp(name.replace(/[^\w]+/g, ".*"), "i").test(row.name));
    const live = matchingLive.find((item) => item.id === recipe?.menu_item_id) || matchingLive[0];
    if (!recipe) {
      examples.push({ name, ok: false, reason: "NO_APPLIED_RECIPE", liveName: live?.name_en || null });
      continue;
    }
    const consumption = mods.graph.theoreticalConsumptionForSale({
      recipeId: recipe.id,
      recipesById: recipeById,
      versionsByRecipeId,
      linesByRecipeId,
      soldQuantity: 1,
    });
    const currentVersion = currentVersionByRecipe[recipe.id];
    const direct = (currentVersion ? linesByVersion[currentVersion.id] : []).map((line) => ({
      ingredientId: line.ingredientId,
      subRecipeId: line.subRecipeId,
      name: ingredientsNow.find((ing) => ing.id === line.ingredientId)?.canonical_name
        || recipesNow.find((entry) => entry.id === line.subRecipeId)?.name
        || null,
      quantity: line.quantity,
      unit: line.unit,
    }));
    examples.push({
      name,
      ok: consumption.authoritative && consumption.lines.length > 0,
      menuItemId: live?.id || recipe.menu_item_id,
      recipeName: recipe.name,
      recipeId: recipe.id,
      versionId: consumption.versionId || currentVersion?.id,
      authoritative: consumption.authoritative,
      blockers: consumption.blockers || [],
      directLineCount: direct.length,
      directLines: direct,
      expandedLineCount: consumption.lines.length,
      lines: consumption.lines.slice(0, 16).map((line) => ({
        ingredientId: line.ingredientId,
        name: ingredientsNow.find((ing) => ing.id === line.ingredientId)?.canonical_name || null,
        quantity: line.quantity,
        unit: line.unit,
      })),
    });
  }

  // Reversible editor/versioning proof using the same draft→activate path as the UI editor.
  const verifyName = "[TEMP VERIFY] Food Bible apply check";
  const { data: existingVerify } = await client.from("inventory_recipes").select("id").eq("internal_name", "fb:temp-verify-apply-check").maybeSingle();
  let verifyId = existingVerify?.id;
  if (!verifyId) {
    const created = await unwrap(await client.from("inventory_recipes").insert({
      name: verifyName,
      normalized_name: "temp verify food bible apply check",
      internal_name: "fb:temp-verify-apply-check",
      recipe_type: "preparation",
      branch_id: null,
      output_quantity: 1,
      output_unit: "each",
      portion_count: 1,
      portion_size: 1,
      portion_unit: "each",
      active: false,
      created_by: userId,
      updated_by: userId,
    }).select().single(), "Create verify recipe");
    verifyId = created.id;
  }
  await unwrap(await client.from("inventory_recipes").update({ active: false, updated_by: userId }).eq("id", verifyId), "Keep verify recipe inactive");
  const { data: existingVerifyVersions } = await client.from("inventory_recipe_versions").select("id,status,version_number").eq("recipe_id", verifyId).order("version_number");
  const firstIngRow = ingredientsNow.find((item) => item.active !== false && item.recipe_cost_eligible !== false && item.base_inventory_unit)
    || ingredientsNow[0];
  const firstIng = firstIngRow?.id;
  const firstUnit = firstIngRow?.base_inventory_unit || "gram";
  const hasActive = (existingVerifyVersions || []).some((row) => row.status === "active");
  if (firstIng && !hasActive) {
    let v1 = (existingVerifyVersions || [])[0];
    if (!v1) {
      v1 = await unwrap(await client.from("inventory_recipe_versions").insert({
        recipe_id: verifyId,
        version_number: 1,
        effective_from: "2026-08-01T00:00:00+03:00",
        status: "draft",
        output_quantity: 1,
        output_unit: "each",
        documentation: { preparationMethod: "Verify fixture", importKey: "fb:temp-verify-apply-check" },
        created_by: userId,
        updated_by: userId,
      }).select().single(), "Verify v1 draft");
    }
    const { data: v1Lines } = await client.from("inventory_recipe_version_lines").select("id").eq("recipe_version_id", v1.id);
    if (v1Lines?.[0]?.id) {
      await unwrap(await client.from("inventory_recipe_version_lines").update({
        ingredient_id: firstIng,
        quantity: 180,
        unit: firstUnit,
        canonical_quantity: 180,
        canonical_unit: firstUnit,
      }).eq("id", v1Lines[0].id), "Fix verify v1 line");
    } else {
      await unwrap(await client.from("inventory_recipe_version_lines").insert({
        recipe_version_id: v1.id,
        ingredient_id: firstIng,
        quantity: 180,
        unit: firstUnit,
        canonical_quantity: 180,
        canonical_unit: firstUnit,
        sort_order: 0,
      }), "Verify v1 line");
    }
    await unwrap(await client.rpc("inventory_activate_recipe_version", {
      p_recipe_version_id: v1.id,
      p_effective_from: "2026-08-01T00:00:00+03:00",
      p_reason: "Temp editor proof v1",
    }), "Activate verify v1");
    const prepared = await unwrap(await client.rpc("inventory_prepare_recipe_draft_version", {
      p_recipe_id: verifyId,
      p_documentation: { preparationMethod: "Verify fixture edited", importKey: "fb:temp-verify-apply-check" },
    }), "Prepare verify v2");
    const v2Id = prepared.id || prepared;
    const { count: v2Lines } = await client.from("inventory_recipe_version_lines").select("id", { count: "exact", head: true }).eq("recipe_version_id", v2Id);
    if (!v2Lines) {
      await unwrap(await client.from("inventory_recipe_version_lines").insert({
        recipe_version_id: v2Id,
        ingredient_id: firstIng,
        quantity: 170,
        unit: firstUnit,
        canonical_quantity: 170,
        canonical_unit: firstUnit,
        sort_order: 0,
      }), "Verify v2 line");
    } else {
      await unwrap(await client.from("inventory_recipe_version_lines").update({
        quantity: 170,
        canonical_quantity: 170,
      }).eq("recipe_version_id", v2Id), "Update verify v2 qty");
    }
    await unwrap(await client.rpc("inventory_activate_recipe_version", {
      p_recipe_version_id: v2Id,
      p_effective_from: "2026-08-20T00:00:00+03:00",
      p_reason: "Temp editor proof quantity edit",
    }), "Activate verify v2");
  }
  await unwrap(await client.from("inventory_recipes").update({ active: false, updated_by: userId }).eq("id", verifyId), "Leave verify fixture inactive");
  const verifyVersions = await unwrap(await client.from("inventory_recipe_versions").select("*").eq("recipe_id", verifyId).order("version_number"), "Fetch verify versions");
  const oldV = mods.graph.resolveRecipeVersionForDate(verifyVersions.map((row) => ({
    id: row.id,
    status: row.status,
    versionNumber: row.version_number,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
  })), "2026-08-10");
  const newV = mods.graph.resolveRecipeVersionForDate(verifyVersions.map((row) => ({
    id: row.id,
    status: row.status,
    versionNumber: row.version_number,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
  })), "2026-08-21");
  const oldLines = oldV ? await unwrap(await client.from("inventory_recipe_version_lines").select("quantity").eq("recipe_version_id", oldV.id), "Old lines") : [];
  const newLines = newV ? await unwrap(await client.from("inventory_recipe_version_lines").select("quantity").eq("recipe_version_id", newV.id), "New lines") : [];
  const verifyPdfOld = mods.pdf.recipePdfPlaintext(mods.pdf.snapshotFromRecipeRecord({
    row: { displayName: verifyName, kind: "component", guestStatus: null },
    lines: [{ name: "Test ingredient", quantity: oldLines[0]?.quantity, unit: "gram", ingredientId: "x" }],
  }));
  const verifyPdfNew = mods.pdf.recipePdfPlaintext(mods.pdf.snapshotFromRecipeRecord({
    row: { displayName: verifyName, kind: "component", guestStatus: null },
    lines: [{ name: "Test ingredient", quantity: newLines[0]?.quantity, unit: "gram", ingredientId: "x" }],
  }));

  const snapshots = recipesNow.filter((row) => row.active && row.recipe_type === "menu_item" && row.menu_item_id).map((recipe) => {
    const version = currentVersionByRecipe[recipe.id];
    const lines = (version ? linesByVersion[version.id] : []).map((line) => ({
      ...line,
      name: ingredientsNow.find((ing) => ing.id === line.ingredientId)?.canonical_name
        || recipesNow.find((entry) => entry.id === line.subRecipeId)?.name
        || "Component",
    }));
    return mods.pdf.snapshotFromRecipeRecord({
      row: {
        displayName: recipe.name,
        kind: "menu_item",
        guestStatus: "live",
        categoryName: "NAC",
        outputQuantity: recipe.output_quantity,
        outputUnit: recipe.output_unit,
      },
      lines,
      version,
      documentation: (versionsNow.find((entry) => entry.id === version?.id) || {}).documentation,
    });
  });
  const bible = mods.pdf.currentFoodBibleSnapshots(snapshots);
  const individual = snapshots.find((snap) => /big nac/i.test(snap.name)) || snapshots[0];
  const selected = snapshots.filter((snap) => /big nac|rendang|watermelon|seabass|sea bass/i.test(snap.name)).slice(0, 4);
  fs.mkdirSync(path.join(OUT_DIR, "canonical-exports"), { recursive: true });
  if (individual) {
    fs.writeFileSync(path.join(OUT_DIR, "canonical-exports", "big-nac.pdf"), Buffer.from(mods.pdf.recipesPdfBytes([individual])));
  }
  if (selected.length) {
    fs.writeFileSync(path.join(OUT_DIR, "canonical-exports", "selected.pdf"), Buffer.from(mods.pdf.recipesPdfBytes(selected, { title: "Selected recipes" })));
  }
  fs.writeFileSync(path.join(OUT_DIR, "canonical-exports", "food-bible.pdf"), Buffer.from(mods.pdf.recipesPdfBytes(bible, { title: "NAC Food Bible" })));
  const seaBassSnap = snapshots.find((snap) => /sea bass|seabass/i.test(snap.name));
  if (seaBassSnap) {
    fs.writeFileSync(path.join(OUT_DIR, "canonical-exports", "sea-bass.pdf"), Buffer.from(mods.pdf.recipesPdfBytes([seaBassSnap])));
  }
  const bibleText = bible.map((snap) => snap.name).join(" | ");

  const editorCapability = {
    addLine: { attempted: false },
    changeQuantity: { attempted: false },
    removeLine: { attempted: false },
    replaceLine: { attempted: false },
  };
  const preparedEditor = await client.rpc("inventory_prepare_recipe_draft_version", {
    p_recipe_id: verifyId,
    p_documentation: { preparationMethod: "Editor capability probe", importKey: "fb:temp-verify-apply-check" },
  });
  if (preparedEditor.error) {
    editorCapability.prepareDraft = { ok: false, error: preparedEditor.error.message };
  } else {
    const draftId = preparedEditor.data.id || preparedEditor.data;
    editorCapability.prepareDraft = { ok: true, draftId };
    const secondIng = ingredientsNow.find((item) => item.id !== firstIng && item.active !== false && item.recipe_cost_eligible !== false && item.base_inventory_unit) || firstIngRow;
    const add = await client.from("inventory_recipe_version_lines").insert({
      recipe_version_id: draftId,
      ingredient_id: secondIng.id,
      quantity: 15,
      unit: secondIng.base_inventory_unit,
      canonical_quantity: 15,
      canonical_unit: secondIng.base_inventory_unit,
      sort_order: 99,
    }).select("id").single();
    editorCapability.addLine = { attempted: true, ok: !add.error, error: add.error?.message || null, id: add.data?.id || null };
    const { data: draftLines } = await client.from("inventory_recipe_version_lines").select("id,quantity").eq("recipe_version_id", draftId).limit(1);
    if (draftLines?.[0]?.id) {
      const change = await client.from("inventory_recipe_version_lines").update({
        quantity: 16,
        canonical_quantity: 16,
      }).eq("id", draftLines[0].id).select("id").single();
      editorCapability.changeQuantity = { attempted: true, ok: !change.error, error: change.error?.message || null };
      const remove = await client.from("inventory_recipe_version_lines").delete().eq("id", draftLines[0].id);
      editorCapability.removeLine = {
        attempted: true,
        ok: !remove.error,
        error: remove.error?.message || null,
        worksInProduction: !remove.error,
      };
    }
    if (add.data?.id) {
      const replaceDelete = await client.from("inventory_recipe_version_lines").delete().eq("id", add.data.id);
      editorCapability.replaceLine = {
        attempted: true,
        ok: !replaceDelete.error,
        error: replaceDelete.error?.message || null,
        note: "Replace requires delete of the previous line then insert. Delete is what fails without GRANT DELETE.",
      };
    }
    await client.from("inventory_recipes").update({ active: false, updated_by: userId }).eq("id", verifyId);
  }

  const secondPlan = mods.apply.buildApplyPlan({
    recipes: preview.recipes,
    recipeRows: report.recipeRows,
    ingredients: ingredientsNow.map(mapIngredient),
    existingRecipes: recipesNow.map((recipe) => ({
      internalName: recipe.internal_name,
      fingerprint: (versionsNow.find((version) => version.recipe_id === recipe.id) || {}).documentation?.fingerprint,
    })),
  });
  const secondDecisions = secondPlan.persist.map((row) => mods.apply.applyDecision(row.existing, row.fingerprint));

  const summary = {
    authenticatedAs: email,
    authPath: passwordSet() ? "signInWithPassword" : "magiclink-otp-via-admin-generateLink-then-user-session",
    pdfCount: pdfs.length,
    parsedRecipeCount: preview.recipes.length,
    unitIssuesAfterParser: issueSummary,
    unitIssueTotal: Object.values(issueSummary).reduce((sum, n) => sum + n, 0),
    persistedRecipes: recipesNow.filter((row) => String(row.internal_name || "").startsWith("fb:20260820:")).length,
    recipeVersionCount: versionsNow.length,
    recipeLineCount: linesNow.length,
    prepCount: recipesNow.filter((row) => row.recipe_type === "preparation" && String(row.internal_name || "").startsWith("fb:20260820:")).length,
    activeMapped: recipesNow.filter((row) => row.active && row.menu_item_id).length,
    archivedLegacy: recipesNow.filter((row) => !row.active && String(row.internal_name || "").startsWith("fb:20260820:")).length,
    appleBircher: recipesNow.find((row) => /apple bircher/i.test(row.name)),
    canonicalIngredientCount: ingredientsNow.length,
    ingredientsCreated: createdIngredients.length,
    ingredientsReused: new Set(reusedIngredients.map((row) => row.ingredientId)).size,
    unresolvedIngredients: plan.unresolvedIngredients.length,
    coverage,
    costing,
    costReconcile: {
      costRecords: costRows.length,
      historyRows: costHistory.length,
      receiptLineRows: receiptLines.length,
      invoiceLineRows: 0,
      matchedCanonical: costMap.matchedCount,
      unmatchedCostRecords: costMap.unmatchedCostCount,
      missingCanonical: costMap.missingCostCount,
      unmatchedSample: costMap.unmatchedCost.slice(0, 12),
      missingSample: costMap.missing.slice(0, 12).map((item) => item.canonicalName),
    },
    examples,
    editorProof: {
      recipe: verifyName,
      oldQty: oldLines[0]?.quantity ?? null,
      newQty: newLines[0]?.quantity ?? null,
      pdfOldHas180: verifyPdfOld.includes("180"),
      pdfNewHas170: verifyPdfNew.includes("170"),
      leftInactive: true,
    },
    editorCapability,
    pdf: {
      individual: Boolean(individual),
      individualName: individual?.name || null,
      selectedCount: selected.length,
      foodBibleCount: bible.length,
      bircherInBible: /bircher/i.test(bibleText),
      conchiglieInvented: /conchiglie/i.test(bibleText),
      seaBassPdf: Boolean(seaBassSnap),
      seaBassPdfName: seaBassSnap?.name || null,
      seaBassIngredientCount: (seaBassSnap?.ingredients || []).length,
    },
    idempotency: {
      secondPassSkipOrExisting: secondDecisions.filter((value) => value !== "create").length,
      secondPassCreate: secondDecisions.filter((value) => value === "create").length,
    },
    automaticallyResolvedAliases: report.recipeRows
      .filter((row) => row.state === "active + matched" && row.liveItem)
      .map((row) => ({
        sourceTitle: row.recipeTitle,
        liveName: row.liveItem.primary?.name_en || row.liveItem.primary?.name || row.liveItem.name_en,
      }))
      .filter((row) => row.liveName && mods.intel.normalizeText(row.sourceTitle) !== mods.intel.normalizeText(row.liveName)),
    unresolvedMenuRecipes: coverage.kitchenMissing,
    duplicateConflicts: report.recipeRows
      .filter((row) => row.state === "duplicate/version conflict")
      .map((row) => ({ title: row.recipeTitle, sourceFile: row.sourceFile })),
    firstPassDecisions: persisted.reduce((acc, row) => {
      acc[row.decision] = (acc[row.decision] || 0) + 1;
      return acc;
    }, {}),
    firstPassFailures: persisted
      .filter((row) => row.decision && row.decision !== "skip_identical" && row.decision !== "new_version" && row.decision !== "create")
      .map((row) => ({ name: row.name, decision: row.decision, planned: row.lines.length, insertSkipped: row.insertSkipped || [] })),
    seaBassGraph: persisted
      .filter((row) => /sea bass|creole pepper|shallot reduction/i.test(row.name))
      .map((row) => ({
        name: row.name,
        decision: row.decision,
        outputQuantity: row.outputQuantity,
        outputUnit: row.outputUnit,
        planned: row.lines.length,
        insertSkipped: row.insertSkipped || [],
        activateError: row.activateError || null,
        subRecipeFallback: Boolean(row.subRecipeFallback),
        activateRetry: Boolean(row.activateRetry),
      })),
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, "canonical-apply-summary.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}

function passwordSet() {
  return Boolean(process.env.SUPABASE_STAFF_PASSWORD);
}

async function nextEffectiveFrom(client, recipeId, packageFrom) {
  const { data } = await client.from("inventory_recipe_versions")
    .select("effective_from")
    .eq("recipe_id", recipeId)
    .in("status", ["active", "retired"]);
  const times = (data || []).map((row) => new Date(row.effective_from).getTime()).filter(Number.isFinite);
  const packageMs = new Date(packageFrom).getTime();
  const max = times.length ? Math.max(...times) : packageMs - 1000;
  return new Date(Math.max(max, packageMs) + 1000).toISOString();
}

async function insertLines(client, mods, versionId, row, ingredientIdByKey, recipeIdByPrepKey, ingredientRows, extra = {}) {
  const { pendingById = new Map(), activatedPrepIds = new Set() } = extra;
  await client.from("inventory_recipe_version_lines").delete().eq("recipe_version_id", versionId);
  const ingredientById = new Map(ingredientRows.map((item) => [item.id, item]));
  const skipped = [];
  for (const [index, line] of row.lines.entries()) {
    const prepId = recipeIdByPrepKey.get(line.ingredientKey)
      || recipeIdByPrepKey.get(mods.apply.normalizeIngredientKey(line.subRecipeName || ""));
    const prep = prepId ? pendingById.get(prepId) : null;
    const prepReady = Boolean(prepId && prepId !== row.recipeId && activatedPrepIds.has(prepId) && prep);
    let usedSubRecipe = false;
    if (prepReady) {
      const targetUnit = prep.outputUnit || "each";
      const converted = mods.graph.convertOrBlock(line.quantity, line.unit, targetUnit);
      if (converted.ok) {
        await unwrap(await client.from("inventory_recipe_version_lines").insert({
          recipe_version_id: versionId,
          ingredient_id: null,
          sub_recipe_id: prepId,
          quantity: converted.quantity,
          unit: targetUnit,
          canonical_quantity: converted.quantity,
          canonical_unit: targetUnit,
          preparation_note: line.note || null,
          sort_order: index,
        }), "Insert sub-recipe line");
        usedSubRecipe = true;
      }
    }
    if (usedSubRecipe) continue;
    const ingredientId = ingredientIdByKey.get(line.ingredientKey)
      || ingredientIdByKey.get(mods.apply.normalizeIngredientKey(line.subRecipeName || line.sourceName || ""));
    if (!ingredientId) {
      skipped.push({ name: line.sourceName || line.ingredientKey, reason: "NO_INGREDIENT_ID" });
      continue;
    }
    const ingredient = ingredientById.get(ingredientId);
    let canonicalQuantity = line.quantity;
    let canonicalUnit = mods.apply.mapSourceUnit(line.unit) || line.unit;
    try {
      const canonical = mods.foodBible.computeCanonicalLine({
        ingredientId,
        quantity: line.quantity,
        unit: canonicalUnit,
      }, new Map([[ingredientId, ingredient]]));
      canonicalQuantity = canonical.canonicalQuantity;
      canonicalUnit = canonical.canonicalUnit;
    } catch {
      // keep source units when conversion is not yet defined
    }
    if (!["each", "gram", "kilogram", "millilitre", "litre"].includes(canonicalUnit)) {
      skipped.push({ name: line.sourceName || line.ingredientKey, reason: `ILLEGAL_UNIT:${canonicalUnit}` });
      continue;
    }
    if (ingredient?.baseInventoryUnit && canonicalUnit !== ingredient.baseInventoryUnit) {
      const converted = mods.graph.convertOrBlock(canonicalQuantity, canonicalUnit, ingredient.baseInventoryUnit);
      if (converted.ok) {
        canonicalQuantity = converted.quantity;
        canonicalUnit = ingredient.baseInventoryUnit;
      } else {
        skipped.push({
          name: line.sourceName || line.ingredientKey,
          reason: `UNIT_MISMATCH:${canonicalUnit}->${ingredient.baseInventoryUnit}`,
        });
        continue;
      }
    }
    await unwrap(await client.from("inventory_recipe_version_lines").insert({
      recipe_version_id: versionId,
      ingredient_id: ingredientId,
      sub_recipe_id: null,
      quantity: line.quantity,
      unit: mods.apply.mapSourceUnit(line.unit) || line.unit,
      canonical_quantity: canonicalQuantity,
      canonical_unit: canonicalUnit,
      preparation_note: line.note || null,
      sort_order: index,
    }), "Insert ingredient line");
  }
  row.insertSkipped = skipped;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
