/**
 * Canonical NAC Food Bible / Recipe Book PDF export.
 *
 * IMPORTANT:
 * - Imported PDFs are provenance only; exports use canonical recipe records.
 * - Prepared components stay explicit component rows. Their raw ingredients are
 *   never flattened into the parent recipe. Components may be exported as their
 *   own following pages when requested by the caller.
 * - `mode: recipe_book` is the polished kitchen publication.
 * - `mode: food_bible` may include operational provenance/status metadata.
 */

import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

const NAC_BEIGE = [211, 177, 155];
const NAC_TAN = [239, 188, 128];
const INK = [20, 20, 20];
const MUTED = [92, 88, 82];
const GRID = [80, 75, 68];

function slug(value) {
  return String(value || "recipe")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || "recipe";
}

function valueOrDash(value) {
  return value == null || value === "" ? "—" : String(value);
}

function cleanText(value) {
  return String(value || "").replace(/\r/g, "").trim();
}

function splitMethod(value) {
  return cleanText(value)
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function lineDisplayName(line, ingredientById = new Map(), recipeById = new Map()) {
  if (line?.name) return line.name;
  if (line?.subRecipeId) return recipeById.get(line.subRecipeId)?.name || "Prepared component";
  if (line?.ingredientId) return ingredientById.get(line.ingredientId)?.canonicalName || "Ingredient";
  return "Unspecified line";
}

export function snapshotFromRecipeRecord({
  row,
  lines = [],
  documentation = {},
  version = null,
  ingredientById = new Map(),
  recipeById = new Map(),
  brand = "NAC",
  generatedAt = new Date().toISOString(),
  imageDataUrl = null,
} = {}) {
  const archived = row?.kind === "archived"
    || row?.guestStatus === "archived"
    || (row?.operationallyActive === false && row?.kind !== "menu_item");
  const live = row?.guestStatus === "live" && row?.kind === "menu_item";
  const ingredients = (lines || [])
    .filter((line) => line.ingredientId || line.subRecipeId)
    .map((line) => ({
      id: line.id || line.clientId || null,
      ingredientId: line.ingredientId || null,
      subRecipeId: line.subRecipeId || null,
      name: lineDisplayName(line, ingredientById, recipeById),
      quantity: line.quantity,
      unit: line.unit,
      isComponent: Boolean(line.subRecipeId),
      note: line.preparationNote || "",
    }));

  return {
    brand,
    recipeId: row?.recipeId || row?.id || null,
    name: row?.displayName || row?.name || "Untitled recipe",
    nameAr: row?.displayNameAr || row?.nameAr || "",
    category: row?.categoryName || documentation?.menuSection || "",
    sourceSection: documentation?.menuSection || row?.categoryName || "",
    recipeType: row?.recipeType || "menu_item",
    operationallyActive: live,
    archived: archived || row?.kind === "archived",
    yieldQuantity: row?.outputQuantity ?? version?.outputQuantity ?? "",
    yieldUnit: row?.outputUnit || version?.outputUnit || "",
    portionCount: row?.portionCount ?? version?.portionCount ?? "",
    portionSize: row?.portionSize ?? version?.portionSize ?? "",
    portionUnit: row?.portionUnit || version?.portionUnit || "",
    versionNumber: version?.versionNumber || null,
    effectiveFrom: version?.effectiveFrom || null,
    generatedAt,
    ingredients,
    method: documentation?.preparationMethod || documentation?.cookingInstructions || "",
    plating: documentation?.platingInstructions || "",
    storage: documentation?.storageInstructions || "",
    criticalControl: documentation?.qualityCheckpoints || "",
    allergens: documentation?.allergens || "",
    utensils: documentation?.utensils || documentation?.equipmentNotes || "",
    prepTime: documentation?.prepTime || "",
    cookTime: documentation?.cookTime || "",
    imageDataUrl,
    sourceDocument: documentation?.sourceDocument || null,
    sourceDataNeedsReview: Boolean(documentation?.sourceDataNeedsReview),
  };
}

export function snapshotFromExtractedRecipe(recipe, extra = {}) {
  const ingredients = recipe.ksaIngredients || recipe.ingredients || [];
  return {
    brand: extra.brand || "NAC",
    recipeId: extra.recipeId || null,
    name: recipe.ksaOperationalTitle || recipe.sourceTitle || "Untitled recipe",
    nameAr: "",
    category: recipe.menuSection || recipe.recipeKind || "",
    sourceSection: recipe.menuSection || "",
    recipeType: recipe.recipeKind === "prep" ? "preparation" : "menu_item",
    operationallyActive: extra.operationallyActive === true,
    archived: extra.operationallyActive !== true,
    yieldQuantity: recipe.yieldRaw || "",
    yieldUnit: "",
    portionCount: "",
    portionSize: "",
    portionUnit: "",
    versionNumber: extra.versionNumber || 1,
    effectiveFrom: extra.effectiveFrom || extra.importDate || null,
    generatedAt: extra.generatedAt || new Date().toISOString(),
    ingredients: ingredients.map((ing) => ({
      name: ing.ksaOperationalName || ing.sourceName,
      quantity: ing.sourceQuantity ?? ing.canonicalQuantity,
      unit: ing.sourceUnit || ing.canonicalUnit,
      isComponent: Boolean(ing.subRecipe),
      subRecipeId: ing.subRecipeId || null,
      note: ing.notes || "",
    })),
    method: Array.isArray(recipe.method) ? recipe.method.join("\n") : (recipe.method || ""),
    plating: recipe.plating || "",
    storage: recipe.storage || "",
    criticalControl: recipe.criticalControl || "",
    allergens: recipe.allergens || "",
    utensils: recipe.utensils || "",
    prepTime: recipe.prepTime || "",
    cookTime: recipe.cookTime || "",
    sourceDocument: recipe.sourceFile || null,
    imageDataUrl: extra.imageDataUrl || null,
  };
}

export function menuImagePublicUrl(path, supabaseUrl = process.env.REACT_APP_SUPABASE_URL) {
  if (!path) return "";
  if (/^https?:/i.test(path)) return path;
  if (!supabaseUrl) return "";
  return `${supabaseUrl.replace(/\/$/, "")}/storage/v1/object/public/menu-images/${path}`;
}

export async function fetchHeroImageDataUrl(path, fetcher = fetch) {
  const url = menuImagePublicUrl(path);
  if (!url || typeof fetcher !== "function") return null;
  const response = await fetcher(url);
  if (!response?.ok) return null;
  const buffer = new Uint8Array(await response.arrayBuffer());
  const binary = Array.from(buffer, (byte) => String.fromCharCode(byte)).join("");
  const contentType = response.headers?.get?.("content-type") || "image/png";
  const encoded = typeof btoa === "function" ? btoa(binary) : Buffer.from(buffer).toString("base64");
  return `data:${contentType};base64,${encoded}`;
}

export function flattenRecipeTree(rootId, linesByRecipeId = {}) {
  const ordered = [];
  const seen = new Set();
  const walk = (id) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    ordered.push(id);
    for (const line of linesByRecipeId[id] || []) {
      if (line.subRecipeId) walk(line.subRecipeId);
    }
  };
  walk(rootId);
  return ordered;
}

export function flattenSelectedRecipeTrees(rootIds = [], linesByRecipeId = {}) {
  const ordered = [];
  const seen = new Set();
  for (const rootId of rootIds) {
    for (const id of flattenRecipeTree(rootId, linesByRecipeId)) {
      if (seen.has(id)) continue;
      seen.add(id);
      ordered.push(id);
    }
  }
  return ordered;
}

export function currentFoodBibleSnapshots(snapshots = []) {
  return snapshots.filter((snapshot) => snapshot.operationallyActive && !snapshot.archived);
}

export function recipePdfPlaintext(snapshot) {
  const lines = [
    snapshot.brand || "NAC",
    snapshot.recipeType === "preparation" ? "Prepared component" : "Food Bible recipe",
    snapshot.name,
    snapshot.category,
    snapshot.yieldQuantity ? `Yield ${snapshot.yieldQuantity} ${snapshot.yieldUnit || ""}`.trim() : "",
    ...(snapshot.ingredients || []).map((ing) => `${ing.name}${ing.isComponent ? " (component)" : ""} — ${ing.quantity ?? ""} ${ing.unit || ""}`.trim()),
    snapshot.method,
    snapshot.plating,
    snapshot.storage,
    snapshot.criticalControl,
  ];
  return lines.filter(Boolean).join("\n");
}

function drawLogo(doc, pageW, top = 34) {
  doc.setTextColor(...INK);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(34);
  doc.text("NAC", pageW / 2, top + 24, { align: "center" });
}

function drawTitleBand(doc, snapshot, margin, pageW, y) {
  doc.setFillColor(...NAC_BEIGE);
  doc.rect(margin, y, pageW - margin * 2, 28, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(...INK);
  const title = String(snapshot.name || "Untitled recipe").toUpperCase();
  doc.text(title, pageW / 2, y + 19, { align: "center", maxWidth: pageW - margin * 2 - 20 });
  return y + 38;
}

function drawHero(doc, snapshot, margin, pageW, y) {
  const w = pageW - margin * 2;
  const h = 150;
  if (snapshot.imageDataUrl) {
    try {
      const format = /image\/png/i.test(snapshot.imageDataUrl) ? "PNG" : "JPEG";
      doc.addImage(snapshot.imageDataUrl, format, margin, y, w, h, undefined, "FAST");
      return y + h + 10;
    } catch {
      // Fall through to subtle placeholder; never invent imagery.
    }
  }
  doc.setFillColor(244, 241, 235);
  doc.rect(margin, y, w, h, "F");
  doc.setTextColor(...MUTED);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text("No source photograph", pageW / 2, y + h / 2, { align: "center" });
  return y + h + 10;
}

function drawInfo(doc, snapshot, margin, pageW, y, mode) {
  const leftW = (pageW - margin * 2) * 0.65;
  const rightX = margin + leftW + 14;
  const labelW = 84;
  const rows = [
    ["Utensils Used", snapshot.utensils || "—"],
    ["Menu Section", snapshot.sourceSection || snapshot.category || "—"],
    ["Prep Time", snapshot.prepTime || "—"],
    ["Cook Time", snapshot.cookTime || "—"],
    ["Yield", `${valueOrDash(snapshot.yieldQuantity)} ${snapshot.yieldUnit || ""}`.trim()],
  ];

  doc.setFontSize(8.5);
  rows.forEach(([label, value], i) => {
    const ry = y + i * 17;
    doc.setDrawColor(...GRID);
    doc.rect(margin, ry, labelW, 17);
    doc.rect(margin + labelW, ry, leftW - labelW, 17);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...INK);
    doc.text(label, margin + 4, ry + 11);
    doc.setFont("helvetica", "normal");
    doc.text(String(value), margin + labelW + 5, ry + 11, { maxWidth: leftW - labelW - 8 });
  });

  doc.setFillColor(...NAC_TAN);
  doc.rect(rightX, y, 62, 22, "F");
  doc.setDrawColor(...GRID);
  doc.rect(rightX, y, 62, 22);
  doc.rect(rightX + 62, y, pageW - margin - (rightX + 62), 22);
  doc.setFont("helvetica", "bold");
  doc.text("Allergens:", rightX + 4, y + 14);
  doc.setFont("helvetica", "normal");
  doc.text(snapshot.allergens || "—", rightX + 67, y + 14, {
    maxWidth: pageW - margin - rightX - 72,
  });

  if (mode === "food_bible") {
    const meta = [
      snapshot.recipeType === "preparation" ? "Prepared component" : "Menu item recipe",
      snapshot.versionNumber ? `Version ${snapshot.versionNumber}` : null,
      snapshot.sourceDataNeedsReview ? "Source data needs review" : null,
    ].filter(Boolean).join(" · ");
    if (meta) {
      doc.setFontSize(7.5);
      doc.setTextColor(...MUTED);
      doc.text(meta, rightX, y + 40, { maxWidth: pageW - margin - rightX });
    }
  }
  return y + Math.max(rows.length * 17, 54) + 8;
}

function drawIngredients(doc, snapshot, margin, y) {
  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    theme: "grid",
    head: [["Ingredients", "Unit", "1 Batch", "Notes"]],
    body: (snapshot.ingredients || []).length
      ? snapshot.ingredients.map((ing) => [
        `${ing.name}${ing.isComponent ? "  ↗ component" : ""}`,
        ing.unit || "—",
        valueOrDash(ing.quantity),
        ing.note || "",
      ])
      : [["No ingredients recorded", "—", "—", ""]],
    styles: {
      font: "helvetica",
      fontSize: 8.2,
      textColor: INK,
      cellPadding: 3.2,
      lineColor: GRID,
      lineWidth: 0.6,
    },
    headStyles: {
      fillColor: NAC_BEIGE,
      textColor: INK,
      fontStyle: "bold",
    },
    columnStyles: {
      0: { cellWidth: 210 },
      1: { cellWidth: 70, halign: "center" },
      2: { cellWidth: 76, halign: "center" },
      3: { cellWidth: "auto" },
    },
  });
  return (doc.lastAutoTable?.finalY || y) + 10;
}

function ensureRoom(doc, y, required = 80) {
  const bottom = doc.internal.pageSize.getHeight() - 40;
  if (y + required <= bottom) return y;
  doc.addPage();
  return 42;
}

function drawTextBand(doc, title, text, margin, pageW, y) {
  if (!cleanText(text)) return y;
  y = ensureRoom(doc, y, 66);
  doc.setFillColor(...NAC_BEIGE);
  doc.rect(margin, y, pageW - margin * 2, 18, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...INK);
  doc.text(title, pageW / 2, y + 12, { align: "center" });
  y += 25;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.7);
  const lines = splitMethod(text);
  for (const line of lines) {
    y = ensureRoom(doc, y, 24);
    const wrapped = doc.splitTextToSize(line, pageW - margin * 2);
    doc.text(wrapped, margin + 2, y);
    y += wrapped.length * 10.5 + 2;
  }
  return y + 6;
}

function drawRecipe(doc, snapshot, { mode = "recipe_book" } = {}) {
  const margin = 28;
  const pageW = doc.internal.pageSize.getWidth();
  drawLogo(doc, pageW, 26);
  let y = 78;
  y = drawTitleBand(doc, snapshot, margin, pageW, y);
  y = drawHero(doc, snapshot, margin, pageW, y);
  y = drawInfo(doc, snapshot, margin, pageW, y, mode);
  y = drawIngredients(doc, snapshot, margin, y);
  y = drawTextBand(doc, "Method", snapshot.method, margin, pageW, y);
  y = drawTextBand(doc, "To Serve", snapshot.plating, margin, pageW, y);
  y = drawTextBand(doc, "Storage / Prep", snapshot.storage, margin, pageW, y);
  y = drawTextBand(doc, "Critical Control", snapshot.criticalControl, margin, pageW, y);

  if (mode === "food_bible" && snapshot.sourceDocument) {
    y = ensureRoom(doc, y, 30);
    doc.setFontSize(7);
    doc.setTextColor(...MUTED);
    const source = typeof snapshot.sourceDocument === "string"
      ? snapshot.sourceDocument
      : snapshot.sourceDocument.file || "Source document recorded";
    doc.text(`Source: ${source}`, margin, y);
  }
}

export function renderRecipesPdf(snapshots = [], {
  title = "NAC Recipe Book",
  mode = "recipe_book",
} = {}) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const list = snapshots.length ? snapshots : [{ name: "No recipes selected", ingredients: [], brand: "NAC" }];

  if (list.length > 1) {
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    drawLogo(doc, pageW, 110);
    doc.setFillColor(...NAC_BEIGE);
    doc.rect(50, 210, pageW - 100, 54, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(23);
    doc.setTextColor(...INK);
    doc.text(title, pageW / 2, 245, { align: "center" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(...MUTED);
    doc.text(`${list.length} recipes`, pageW / 2, 292, { align: "center" });
    doc.text(`Generated ${new Date().toISOString().slice(0, 10)}`, pageW / 2, pageH - 70, { align: "center" });
  } else {
    // jsPDF starts with one page; single export uses it directly.
  }

  list.forEach((snapshot, index) => {
    if (list.length > 1 || index > 0) doc.addPage();
    drawRecipe(doc, snapshot, { mode });
  });
  return doc;
}

export function recipesPdfBytes(snapshots, options) {
  return renderRecipesPdf(snapshots, options).output("arraybuffer");
}

export function recipePdfFilename(name, { combined = false, mode = "recipe_book" } = {}) {
  if (combined) {
    const stem = mode === "food_bible" ? "nac-food-bible" : "nac-recipe-book";
    return `${stem}-${new Date().toISOString().slice(0, 10)}.pdf`;
  }
  return `${slug(name)}-recipe.pdf`;
}

export function triggerPdfDownload(bytes, filename) {
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
