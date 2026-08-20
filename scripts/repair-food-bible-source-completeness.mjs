#!/usr/bin/env node
/**
 * Targeted 20 Aug source → canonical line + photograph repair.
 * Additive, versioned, idempotent. Never overwrites structured recipes.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { parseFoodBiblePdfExtract, sourceIngredientKey } from "../src/inventory/foodBibleSourceCardParser.js";
import { normalizeText } from "../src/inventory/inventoryIntelligence.js";
import {
  classifyRepairEligibility,
  resolveSourceLine,
} from "../src/inventory/foodBibleSourceRepair.js";

const require = createRequire(import.meta.url);
const pdfjs = require("pdfjs-dist/legacy/build/pdf.js");
pdfjs.GlobalWorkerOptions.workerSrc = require.resolve("pdfjs-dist/legacy/build/pdf.worker.js");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RAW = path.join(root, "tmp/food-bible-2026-08-20/raw");
const REPORT = path.join(root, "tmp/food-bible-2026-08-20/source-completeness-repair.json");
const PHOTO_DIR = path.join(root, "tmp/food-bible-2026-08-20/photos");
const SOURCE_PDF_DIR = "/Users/raffiazarian/Desktop/Work/Nac/Nac menu updated 20 aug 2026";
const CANONICAL_UNITS = new Set(["each", "gram", "kilogram", "millilitre", "litre"]);

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

function crc32(buffer) {
  return zlib.crc32(buffer) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type);
  const payload = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(payload));
  return Buffer.concat([length, payload, crc]);
}

function encodePng(width, height, rgb) {
  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * stride] = 0;
    rgb.copy(raw, y * stride + 1, y * width * 3, (y + 1) * width * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function rgbFromPdfImage(img) {
  const { width, height, kind, data } = img;
  const rgb = Buffer.alloc(width * height * 3);
  if (kind === 2) {
    Buffer.from(data).copy(rgb);
    return rgb;
  }
  if (kind === 3) {
    const src = Buffer.from(data);
    for (let i = 0, j = 0; i < src.length; i += 4, j += 3) {
      rgb[j] = src[i];
      rgb[j + 1] = src[i + 1];
      rgb[j + 2] = src[i + 2];
    }
    return rgb;
  }
  return null;
}

async function pageImages(pdfPath, pageNumber) {
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const doc = await pdfjs.getDocument({ data, verbosity: 0 }).promise;
  if (pageNumber < 1 || pageNumber > doc.numPages) return [];
  const page = await doc.getPage(pageNumber);
  const ops = await page.getOperatorList();
  const seen = new Set();
  const images = [];
  for (let i = 0; i < ops.fnArray.length; i += 1) {
    if (ops.fnArray[i] !== pdfjs.OPS.paintImageXObject) continue;
    const name = ops.argsArray[i]?.[0];
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const img = await page.objs.get(name);
    if (!img?.width || !img?.height || !img.data) continue;
    images.push({
      name,
      width: img.width,
      height: img.height,
      kind: img.kind,
      area: img.width * img.height,
      rgb: rgbFromPdfImage(img),
    });
  }
  await doc.destroy();
  return images.filter((image) => image.rgb);
}

function pickDishPhoto(images, brandingSizes) {
  const unique = [];
  const dimSeen = new Set();
  for (const image of [...images].sort((a, b) => b.area - a.area)) {
    const dim = `${image.width}x${image.height}`;
    if (dimSeen.has(dim)) continue;
    dimSeen.add(dim);
    unique.push(image);
  }
  const candidates = unique.filter((image) => {
    const dim = `${image.width}x${image.height}`;
    if (brandingSizes.has(dim)) return false;
    return image.width >= 400 && image.height >= 280;
  });
  return candidates[0] || null;
}

async function brandingSizeSet(pdfDir, files) {
  const freq = new Map();
  for (const file of files) {
    const pdfPath = path.join(pdfDir, file);
    if (!fs.existsSync(pdfPath)) continue;
    try {
      const images = await pageImages(pdfPath, 1);
      const dims = new Set(images.map((image) => `${image.width}x${image.height}`));
      for (const dim of dims) freq.set(dim, (freq.get(dim) || 0) + 1);
    } catch {
      /* skip unreadable PDF */
    }
  }
  const branding = new Set();
  for (const [dim, count] of freq.entries()) {
    const [w, h] = dim.split("x").map(Number);
    if (count >= 8 && w * h < 280000) branding.add(dim);
  }
  return branding;
}

async function adminClient(env) {
  const url = env.REACT_APP_SUPABASE_URL;
  const projectRef = new URL(url).hostname.split(".")[0];
  const keys = JSON.parse(execSync(`supabase projects api-keys --project-ref ${projectRef} -o json`, {
    encoding: "utf8",
    cwd: root,
  }));
  const service = keys.find((key) => key.name === "service_role" || key.id === "service_role")?.api_key;
  return createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
}

function siblingKeys(card, cards) {
  return cards
    .filter((entry) => entry.sourceFile === card.sourceFile)
    .map((entry) => sourceIngredientKey(entry.title))
    .filter(Boolean);
}

function documentationPatch(card, version, photoMeta) {
  const existing = version.documentation || {};
  const method = (card.method || []).join("\n");
  const plating = (card.method || []).length > 1 ? card.method.slice(1).join("\n") : existing.platingInstructions || "";
  return {
    ...existing,
    preparationMethod: existing.preparationMethod || method,
    platingInstructions: existing.platingInstructions || plating,
    utensils: existing.utensils || card.utensils || "",
    allergens: existing.allergens || card.allergens || "",
    prepTime: existing.prepTime || card.prepTime || "",
    cookTime: existing.cookTime || card.cookTime || "",
    menuSection: existing.menuSection || card.menuSection || "",
    sourceDocument: {
      ...(existing.sourceDocument || {}),
      file: card.sourceFile,
      pages: card.sourceLocator || [],
      importedFrom: "food-bible-2026-08-20",
    },
    ...(photoMeta ? { sourcePhotograph: photoMeta } : {}),
  };
}

async function ensureIngredient(admin, ingredients, plan, created) {
  const key = sourceIngredientKey(plan.canonicalName);
  const existing = ingredients.find((item) => sourceIngredientKey(item.canonical_name) === key);
  if (existing) return existing;
  const unit = CANONICAL_UNITS.has(plan.unitHint) ? plan.unitHint : "gram";
  const { data, error } = await admin.from("inventory_ingredients").insert({
    canonical_name: plan.canonicalName,
    normalized_search_name: normalizeText(plan.canonicalName),
    category: null,
    base_inventory_unit: unit,
    purchasing_unit: null,
    yield_percentage: 100,
    scope: "network",
    branch_id: null,
    allergen_metadata: {},
    active: true,
  }).select("id,canonical_name,base_inventory_unit").single();
  if (error) {
    const { data: raced } = await admin.from("inventory_ingredients")
      .select("id,canonical_name,base_inventory_unit")
      .eq("normalized_search_name", normalizeText(plan.canonicalName))
      .eq("scope", "network")
      .maybeSingle();
    if (raced) {
      ingredients.push(raced);
      return raced;
    }
    throw error;
  }
  ingredients.push(data);
  created.push({ id: data.id, canonicalName: data.canonical_name });
  return data;
}

function matchRecipeByTitle(card, recipes) {
  return (recipes || []).find((row) => sourceIngredientKey(row.name) === sourceIngredientKey(card.title)) || null;
}

function matchRecipeBySourceFile(fileName, recipes) {
  const fileKey = sourceIngredientKey(String(fileName || "").replace(/\.(pdf|json)$/i, ""));
  if (!fileKey) return null;
  const matches = (recipes || []).filter((row) => {
    const key = sourceIngredientKey(row.name);
    return key && key.length >= 8 && (
      key === fileKey
      || fileKey.startsWith(`${key} `)
      || fileKey.startsWith(key)
    );
  });
  return matches.length === 1 ? matches[0] : null;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const photosOnly = process.argv.includes("--photos-only");
  const env = loadEnvLocal();
  const cards = sourceCards();
  const report = {
    sourceCards: cards.length,
    apply,
    eligible: [],
    fullyRecovered: [],
    partiallyRecovered: [],
    incompleteSource: [],
    untouched: [],
    createdIngredients: [],
    unresolvedIdentities: [],
    photos: { discovered: 0, attached: 0, alreadyAttached: 0, none: [] },
    lineCountBefore: 0,
    lineCountAfter: 0,
    appliedLineInserts: 0,
  };
  if (!env.REACT_APP_SUPABASE_URL) {
    fs.writeFileSync(REPORT, JSON.stringify({ ...report, error: "no supabase env" }, null, 2));
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  const admin = await adminClient(env);
  const { data: recipes } = await admin.from("inventory_recipes").select("id,name,internal_name,recipe_type,active,hero_image_path");
  const { data: ingredients } = await admin.from("inventory_ingredients").select("id,canonical_name,base_inventory_unit,normalized_search_name,scope");
  const ingredientRows = ingredients || [];
  const { data: versions } = await admin.from("inventory_recipe_versions").select("id,recipe_id,version_number,status,documentation").order("version_number", { ascending: false });
  const versionByRecipe = new Map();
  const versionsByRecipe = new Map();
  for (const version of versions || []) {
    if (!versionsByRecipe.has(version.recipe_id)) versionsByRecipe.set(version.recipe_id, []);
    versionsByRecipe.get(version.recipe_id).push(version);
  }
  for (const [recipeId, list] of versionsByRecipe.entries()) {
    versionByRecipe.set(recipeId, list.find((version) => version.status === "draft") || list[0]);
  }
  const { data: lines } = await admin.from("inventory_recipe_version_lines").select("id,recipe_version_id");
  const lineCount = new Map();
  for (const line of lines || []) lineCount.set(line.recipe_version_id, (lineCount.get(line.recipe_version_id) || 0) + 1);
  report.lineCountBefore = (lines || []).length;

  const recipeIndex = recipes || [];
  const mappedCards = [];

  for (const card of cards) {
    const recipe = matchRecipeByTitle(card, recipeIndex);
    const qtyRows = (card.ingredients || []).filter((row) => row.sourceQuantity != null && row.sourceName);
    const version = recipe ? versionByRecipe.get(recipe.id) : null;
    const existing = version ? (lineCount.get(version.id) || 0) : 0;
    const eligibility = classifyRepairEligibility({ recipe, existingLineCount: existing, qtyRows });
    mappedCards.push({ card, recipe, version, existing, qtyRows, eligibility });
    if (!qtyRows.length) {
      report.incompleteSource.push({ title: card.title, file: card.sourceFile, reason: "source_lacks_quantities" });
      continue;
    }
    if (!eligibility.eligible) {
      report.untouched.push({
        title: card.title,
        recipe: recipe?.name || null,
        reason: eligibility.reason,
        existing,
        source: qtyRows.length,
      });
    }
  }

  if (!photosOnly) {
    const repairedIds = new Set();
    for (const entry of mappedCards) {
      if (!entry.eligibility.eligible) continue;
      if (repairedIds.has(entry.recipe.id)) continue;
      repairedIds.add(entry.recipe.id);
      const siblings = siblingKeys(entry.card, cards);
      const planned = [];
      const unresolved = [];
      for (const row of entry.qtyRows) {
        if (!CANONICAL_UNITS.has(row.sourceUnit)) {
          unresolved.push({ sourceName: row.sourceName, reason: "unsupported_unit", unit: row.sourceUnit });
          continue;
        }
        const resolution = resolveSourceLine({
          sourceName: row.sourceName,
          recipes: recipeIndex.map((item) => ({ ...item, recipeType: item.recipe_type })),
          ingredients: ingredientRows,
          selfRecipeId: entry.recipe.id,
          siblingComponentKeys: siblings,
        });
        if (resolution.kind === "create_ingredient") {
          planned.push({
            ...row,
            resolution,
            create: true,
          });
          continue;
        }
        if (resolution.kind === "ingredient" || resolution.kind === "component") {
          planned.push({ ...row, resolution });
          continue;
        }
        unresolved.push({ sourceName: row.sourceName, reason: resolution.reason, suggestedComponent: resolution.suggestedComponent || null });
      }
      report.eligible.push({
        title: entry.card.title,
        recipe: entry.recipe.name,
        recipeId: entry.recipe.id,
        sourceLines: entry.qtyRows.length,
        unresolved: unresolved.map((row) => row.sourceName),
      });
      const bucket = unresolved.length ? report.partiallyRecovered : report.fullyRecovered;
      bucket.push({
        title: entry.card.title,
        recipe: entry.recipe.name,
        recipeId: entry.recipe.id,
        planned: planned.length,
        unresolved,
      });
      for (const item of unresolved) {
        report.unresolvedIdentities.push({
          recipe: entry.recipe.name,
          sourceName: item.sourceName,
          reason: item.reason,
        });
      }
      if (!apply || !entry.version) continue;
      const liveCount = lineCount.get(entry.version.id) || 0;
      if (liveCount > 0) continue;

      const inserts = [];
      for (const row of planned) {
        let ingredientId = null;
        let subRecipeId = null;
        if (row.resolution.kind === "create_ingredient") {
          const created = await ensureIngredient(admin, ingredientRows, {
            canonicalName: row.resolution.canonicalName,
            unitHint: row.sourceUnit,
          }, report.createdIngredients);
          ingredientId = created.id;
        } else if (row.resolution.kind === "ingredient") {
          ingredientId = row.resolution.ingredient.id;
        } else if (row.resolution.kind === "component") {
          subRecipeId = row.resolution.recipe.id;
        }
        if (!ingredientId && !subRecipeId) continue;
        inserts.push({
          ingredient_id: ingredientId,
          sub_recipe_id: subRecipeId,
          quantity: row.sourceQuantity,
          unit: row.sourceUnit,
          canonical_quantity: row.sourceQuantity,
          canonical_unit: row.sourceUnit,
          yield_waste_factor: 1,
          preparation_note: row.notes || null,
          is_optional: false,
          waste_percentage: 0,
        });
      }
      if (!inserts.length) continue;

      const { error: lineError } = await admin.from("inventory_recipe_version_lines").insert(
        inserts.map((row, sort) => ({
          ...row,
          recipe_version_id: entry.version.id,
          sort_order: sort,
        })),
      );
      if (lineError) throw lineError;
      await admin.from("inventory_recipe_versions").update({
        documentation: documentationPatch(entry.card, entry.version, null),
        updated_at: new Date().toISOString(),
      }).eq("id", entry.version.id);
      lineCount.set(entry.version.id, inserts.length);
      versionByRecipe.set(entry.recipe.id, {
        ...entry.version,
        documentation: documentationPatch(entry.card, entry.version, null),
      });
      report.appliedLineInserts += inserts.length;
    }
  }

  const pdfFiles = fs.existsSync(SOURCE_PDF_DIR)
    ? fs.readdirSync(SOURCE_PDF_DIR).filter((file) => file.toLowerCase().endsWith(".pdf"))
    : [];
  const branding = pdfFiles.length ? await brandingSizeSet(SOURCE_PDF_DIR, pdfFiles) : new Set();
  fs.mkdirSync(PHOTO_DIR, { recursive: true });

  const photoTargets = mappedCards.map((entry) => ({
    ...entry,
    recipe: entry.recipe || matchRecipeBySourceFile(entry.card.sourceFile, recipeIndex),
  })).filter((entry) => entry.recipe);
  for (const entry of photoTargets) {
    const pdfPath = path.join(SOURCE_PDF_DIR, entry.card.sourceFile);
    if (!fs.existsSync(pdfPath)) {
      report.photos.none.push({ recipe: entry.recipe.name, reason: "source_pdf_missing" });
      continue;
    }
    const page = entry.card.sourceLocator?.[0] || 1;
    let images = [];
    try {
      images = await pageImages(pdfPath, page);
    } catch (error) {
      report.photos.none.push({ recipe: entry.recipe.name, reason: `extract_failed:${error.message}` });
      continue;
    }
    const photo = pickDishPhoto(images, branding);
    if (!photo) {
      report.photos.none.push({ recipe: entry.recipe.name, reason: "no_source_photograph", page });
      continue;
    }
    report.photos.discovered += 1;
    if (entry.recipe.hero_image_path) {
      report.photos.alreadyAttached += 1;
      continue;
    }
    const png = encodePng(photo.width, photo.height, photo.rgb);
    const storagePath = `food-bible/recipes/${entry.recipe.id}.png`;
    const localPath = path.join(PHOTO_DIR, `${entry.recipe.id}.png`);
    fs.writeFileSync(localPath, png);
    if (!apply && !photosOnly) continue;
    const upload = await admin.storage.from("menu-images").upload(storagePath, png, {
      contentType: "image/png",
      upsert: true,
    });
    if (upload.error) throw upload.error;
    const photoMeta = {
      file: entry.card.sourceFile,
      page,
      object: photo.name,
      width: photo.width,
      height: photo.height,
      storagePath,
    };
    await admin.from("inventory_recipes").update({ hero_image_path: storagePath }).eq("id", entry.recipe.id);
    const currentVersion = versionByRecipe.get(entry.recipe.id);
    if (currentVersion) {
      await admin.from("inventory_recipe_versions").update({
        documentation: documentationPatch(entry.card, currentVersion, photoMeta),
      }).eq("id", currentVersion.id);
    }
    entry.recipe.hero_image_path = storagePath;
    report.photos.attached += 1;
  }

  const { count } = await admin.from("inventory_recipe_version_lines").select("id", { count: "exact", head: true });
  report.lineCountAfter = count || report.lineCountBefore + report.appliedLineInserts;
  fs.mkdirSync(path.dirname(REPORT), { recursive: true });
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    sourceCards: report.sourceCards,
    eligible: report.eligible.length,
    fullyRecovered: report.fullyRecovered.length,
    partiallyRecovered: report.partiallyRecovered.length,
    incompleteSource: report.incompleteSource.length,
    untouched: report.untouched.length,
    createdIngredients: report.createdIngredients.length,
    photosDiscovered: report.photos.discovered,
    photosAttached: report.photos.attached,
    photosNone: report.photos.none.length,
    appliedLineInserts: report.appliedLineInserts,
    apply,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
