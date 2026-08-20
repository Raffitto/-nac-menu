#!/usr/bin/env node
/**
 * Extract and preview-reconcile the 20 Aug 2026 Food Bible package.
 * Writes untracked tmp artifacts only. Does not mutate production.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const DEFAULT_SOURCE =
  "/Users/raffiazarian/Desktop/Work/Nac/Nac menu updated 20 aug 2026";
const OUT_DIR = path.join(root, "tmp", "food-bible-2026-08-20");

async function loadModules() {
  const jiti = (await import("jiti")).default;
  const load = jiti(path.join(root, "scripts"), { esmResolve: true, interopDefault: true });
  return {
    extract: load(path.join(root, "src/inventory/foodBiblePdfExtract.js")),
    reconcile: load(path.join(root, "src/inventory/recipeMenuReconcile.js")),
    pdf: load(path.join(root, "src/inventory/recipePdfExport.js")),
    intel: load(path.join(root, "src/inventory/inventoryIntelligence.js")),
  };
}

async function extractPdfPages(filePath) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.js");
  const data = new Uint8Array(fs.readFileSync(filePath));
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i += 1) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const text = content.items.map((item) => item.str || "").join("\n");
    pages.push({ page: i, text });
  }
  return pages;
}

function loadEnvLocal() {
  const envPath = path.join(root, ".env.local");
  if (!fs.existsSync(envPath)) return {};
  const env = {};
  for (const line of fs.readFileSync(envPath, "utf8").split(/\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1).replace(/^["']|["']$/g, "");
  }
  return env;
}

async function fetchTable(env, table, query) {
  const url = env.REACT_APP_SUPABASE_URL;
  const key = env.REACT_APP_SUPABASE_ANON_KEY;
  if (!url || !key) return { rows: [], error: "MISSING_SUPABASE_ENV" };
  const endpoint = `${url.replace(/\/$/, "")}/rest/v1/${table}?${query}`;
  const res = await fetch(endpoint, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) return { rows: [], error: `${table}_${res.status}` };
  return { rows: await res.json(), error: null };
}

async function main() {
  const sourceDir = process.argv[2] || DEFAULT_SOURCE;
  if (!fs.existsSync(sourceDir)) {
    throw new Error(`Source package not found: ${sourceDir}`);
  }
  fs.mkdirSync(path.join(OUT_DIR, "raw"), { recursive: true });
  const env = loadEnvLocal();
  const { extract, reconcile, pdf, intel } = await loadModules();

  const live = await fetchTable(
    env,
    "menu_items",
    "select=id,name_en,name_ar,price,active,sold_out,hidden_until,branch_id,section_id,placement_group_id,sort_order&branch_id=eq.khobar&order=name_en.asc",
  );
  const liveItems = (live.rows || []).map((row) => ({
    id: row.id,
    name: row.name_en,
    name_en: row.name_en,
    name_ar: row.name_ar,
    price: row.price,
    active: row.active !== false,
    sold_out: row.sold_out === true,
    hidden_until: row.hidden_until,
    branch_id: row.branch_id,
    section_id: row.section_id,
    placement_group_id: row.placement_group_id,
    sort_order: row.sort_order,
  }));
  const ingredients = await fetchTable(
    env,
    "inventory_ingredients",
    "select=id,canonical_name,normalized_search_name,active,base_inventory_unit&or=(branch_id.is.null,branch_id.eq.khobar)&order=canonical_name.asc",
  );
  const existingRecipes = await fetchTable(
    env,
    "inventory_recipes",
    "select=id,name,normalized_name,recipe_type,active,menu_item_id,branch_id&or=(branch_id.is.null,branch_id.eq.khobar)&order=name.asc",
  );

  const pdfs = fs
    .readdirSync(sourceDir)
    .filter((name) => name.toLowerCase().endsWith(".pdf") && !name.startsWith("."))
    .sort();

  const files = [];
  for (const fileName of pdfs) {
    const sourcePath = path.join(sourceDir, fileName);
    const buf = fs.readFileSync(sourcePath);
    const sha256 = crypto.createHash("sha256").update(buf).digest("hex");
    const pages = await extractPdfPages(sourcePath);
    const rawText = pages.map((p) => `===== PAGE ${p.page} =====\n${p.text}`).join("\n");
    const slug = fileName.replace(/\.pdf$/i, "").replace(/[^\w]+/g, "_").slice(0, 80);
    fs.writeFileSync(path.join(OUT_DIR, "raw", `${slug}.txt`), rawText);
    fs.writeFileSync(path.join(OUT_DIR, "raw", `${slug}.json`), JSON.stringify({ fileName, sha256, pages }, null, 2));
    files.push({
      fileName,
      sourceFile: fileName,
      sourcePath,
      sha256,
      pages,
      rawText,
    });
  }

  const preview = extract.buildFoodBibleCohortPreview({ files, menuItems: liveItems });
  const report = reconcile.reconcileRecipesToLiveMenu({
    liveItems,
    recipes: preview.recipes,
    importDate: "2026-08-20",
    brand: "NAC",
  });

  const dbByName = new Map(
    (ingredients.rows || []).map((row) => [intel.normalizeText(row.canonical_name), row]),
  );
  const parsedIngredientNames = [...new Set(
    (preview.recipes || []).flatMap((recipe) =>
      (recipe.ksaIngredients || recipe.ingredients || []).map((ing) => ing.ksaOperationalName || ing.sourceName).filter(Boolean),
    ),
  )];
  const ingredientMatches = parsedIngredientNames.map((name) => {
    const key = intel.normalizeText(name);
    const hit = dbByName.get(key);
    return { name, matched: Boolean(hit), ingredientId: hit?.id || null };
  });
  const unitBlockers = (preview.recipes || []).flatMap((recipe) =>
    (recipe.issues || []).filter((issue) => ["AMBIGUOUS_UNIT", "MISSING_QUANTITY", "UNKNOWN_CONVERSION"].includes(issue.code)),
  );

  const snapshots = (preview.recipes || []).map((recipe) => {
    const rec = report.recipeRows.find((row) => row.recipeTitle === (recipe.ksaOperationalTitle || recipe.sourceTitle));
    return pdf.snapshotFromExtractedRecipe(recipe, {
      operationallyActive: rec?.operationallyActive === true,
      importDate: "2026-08-20",
    });
  });
  const foodBible = pdf.currentFoodBibleSnapshots(snapshots);
  const sampleNames = ["Big NAC", "Prawn Rendang", "Watermelon", "Sea Bass", "Conchiglie", "Brownie", "Apple Bircher"];
  const sampleSnapshots = snapshots.filter((snapshot) =>
    sampleNames.some((name) => snapshot.name.toLowerCase().includes(name.toLowerCase())),
  );
  fs.writeFileSync(
    path.join(OUT_DIR, "sample-food-bible.pdf"),
    Buffer.from(pdf.recipesPdfBytes(foodBible, { title: "NAC Food Bible" })),
  );
  if (sampleSnapshots.length) {
    fs.writeFileSync(
      path.join(OUT_DIR, "sample-selected-recipes.pdf"),
      Buffer.from(pdf.recipesPdfBytes(sampleSnapshots, { title: "Selected recipes" })),
    );
  }

  const summary = {
    sourceDir,
    pdfCount: pdfs.length,
    parsedRecipeCount: preview.recipes.length,
    rejectedTitleCount: preview.rejectedTitles.length,
    liveMenuFetchError: live.error,
    liveItemCount: liveItems.length,
    liveActiveCount: liveItems.filter((item) => item.active !== false && !item.sold_out).length,
    ingredientFetchError: ingredients.error,
    canonicalIngredientCount: (ingredients.rows || []).length,
    parsedIngredientNames: parsedIngredientNames.length,
    unresolvedIngredientMatches: ingredientMatches.filter((row) => !row.matched).length,
    existingRecipeCount: (existingRecipes.rows || []).length,
    unitBlockers: unitBlockers.length,
    foodBibleSnapshotCount: foodBible.length,
    appleBircher: report.appleBircher,
    ...report.summary,
  };

  fs.writeFileSync(path.join(OUT_DIR, "parse-preview.json"), JSON.stringify(preview, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "reconciliation.json"), JSON.stringify({ summary, ...report, ingredientMatches }, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "SUMMARY.md"), [
    "# Food Bible 20 Aug 2026 ingest preview",
    "",
    "Production was not mutated. Canonical PDF samples were generated from parsed recipe data, not the imported PDFs.",
    "",
    ...Object.entries(summary).map(([k, v]) => `- **${k}**: ${typeof v === "object" ? JSON.stringify(v) : v}`),
    "",
  ].join("\n"));
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
