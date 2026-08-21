/**
 * Generate kitchen recipe PDFs from canonical NAC OS recipe data.
 * Imported PDFs are provenance only — exports always use current snapshots.
 */

import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

function slug(value) {
  return String(value || "recipe")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || "recipe";
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
  const archived = row?.kind === "archived" || row?.guestStatus === "archived" || (row?.operationallyActive === false && row?.kind !== "menu_item");
  const live = row?.guestStatus === "live" && row?.kind === "menu_item";
  return {
    brand,
    name: row?.displayName || row?.name || "Untitled recipe",
    nameAr: row?.displayNameAr || row?.nameAr || "",
    category: row?.categoryName || "",
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
    ingredients: (lines || []).filter((line) => line.ingredientId || line.subRecipeId).map((line) => ({
      name: lineDisplayName(line, ingredientById, recipeById),
      quantity: line.quantity,
      unit: line.unit,
      isComponent: Boolean(line.subRecipeId),
      note: line.preparationNote || "",
    })),
    method: documentation?.preparationMethod || documentation?.cookingInstructions || "",
    plating: documentation?.platingInstructions || "",
    storage: documentation?.storageInstructions || "",
    allergens: documentation?.allergens || documentation?.qualityCheckpoints || "",
    utensils: documentation?.utensils || documentation?.equipmentNotes || "",
    imageDataUrl,
    sourceDocument: documentation?.sourceDocument || null,
  };
}

export function snapshotFromExtractedRecipe(recipe, extra = {}) {
  const ingredients = recipe.ksaIngredients || recipe.ingredients || [];
  return {
    brand: extra.brand || "NAC",
    name: recipe.ksaOperationalTitle || recipe.sourceTitle || "Untitled recipe",
    nameAr: "",
    category: recipe.menuSection || recipe.recipeKind || "",
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
      note: ing.notes || "",
    })),
    method: Array.isArray(recipe.method) ? recipe.method.join("\n") : (recipe.method || ""),
    plating: "",
    storage: "",
    allergens: "",
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
  const encoded = typeof btoa === "function"
    ? btoa(binary)
    : Buffer.from(buffer).toString("base64");
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
    "Food Bible recipe",
    snapshot.name,
    snapshot.category,
    snapshot.yieldQuantity ? `Yield ${snapshot.yieldQuantity} ${snapshot.yieldUnit || ""}`.trim() : "",
    snapshot.portionSize ? `Portion ${snapshot.portionSize} ${snapshot.portionUnit || ""}`.trim() : "",
    snapshot.versionNumber ? `Version ${snapshot.versionNumber}` : "",
    snapshot.effectiveFrom ? `Effective ${String(snapshot.effectiveFrom).slice(0, 10)}` : "",
    ...(snapshot.ingredients || []).map((ing) => `${ing.name} — ${ing.quantity ?? ""} ${ing.unit || ""}`.trim()),
    snapshot.method,
    snapshot.plating,
    snapshot.storage,
  ];
  return lines.filter(Boolean).join("\n");
}

function drawRecipe(doc, snapshot, startY) {
  const margin = 48;
  const pageW = doc.internal.pageSize.getWidth();
  let y = startY;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(20, 90, 90);
  doc.text(`${snapshot.brand || "NAC"}  ·  Recipe card`, margin, y);
  y += 18;
  doc.setFontSize(18);
  doc.setTextColor(20, 20, 20);
  doc.text(String(snapshot.name || "Untitled recipe"), margin, y, { maxWidth: pageW - margin * 2 });
  y += 22;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(90, 90, 90);
  const meta = [
    snapshot.category,
    snapshot.recipeType === "preparation" ? "Prepared component" : "Menu item recipe",
    snapshot.operationallyActive ? "Current menu" : "Archived / not on current menu",
    snapshot.yieldQuantity ? `Yield: ${snapshot.yieldQuantity} ${snapshot.yieldUnit || ""}`.trim() : null,
    snapshot.portionSize ? `Portion: ${snapshot.portionSize} ${snapshot.portionUnit || ""}`.trim() : null,
    snapshot.portionCount ? `Portions: ${snapshot.portionCount}` : null,
    snapshot.versionNumber ? `Version ${snapshot.versionNumber}` : null,
    snapshot.effectiveFrom ? `Effective ${String(snapshot.effectiveFrom).slice(0, 10)}` : null,
    snapshot.generatedAt ? `Generated ${String(snapshot.generatedAt).slice(0, 10)}` : null,
  ].filter(Boolean);
  doc.text(meta.join("   ·   "), margin, y, { maxWidth: pageW - margin * 2 });
  y += 16;
  if (snapshot.imageDataUrl) {
    try {
      const imgW = 180;
      const imgH = 120;
      const format = /image\/png/i.test(snapshot.imageDataUrl) ? "PNG" : "JPEG";
      doc.addImage(snapshot.imageDataUrl, format, pageW - margin - imgW, startY, imgW, imgH);
      y = Math.max(y, startY + imgH + 12);
    } catch {
      /* skip unreadable images */
    }
  }

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [["Component", "Quantity", "Unit", "Notes"]],
    body: (snapshot.ingredients || []).length
      ? snapshot.ingredients.map((ing) => [
        `${ing.name}${ing.isComponent ? " (component)" : ""}`,
        ing.quantity == null || ing.quantity === "" ? "—" : String(ing.quantity),
        ing.unit || "—",
        ing.note || "",
      ])
      : [["No ingredients recorded", "—", "—", ""]],
    styles: { fontSize: 9, cellPadding: 5 },
    headStyles: { fillColor: [20, 90, 90], textColor: 255 },
  });
  y = (doc.lastAutoTable?.finalY || y) + 16;

  const blocks = [
    ["Method", snapshot.method],
    ["Plating", snapshot.plating],
    ["Storage / prep notes", snapshot.storage],
    ["Allergens / quality", snapshot.allergens],
  ].filter(([, text]) => text && String(text).trim());

  for (const [title, text] of blocks) {
    if (y > doc.internal.pageSize.getHeight() - 80) {
      doc.addPage();
      y = 48;
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(20, 90, 90);
    doc.text(title, margin, y);
    y += 14;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(30, 30, 30);
    const wrapped = doc.splitTextToSize(String(text), pageW - margin * 2);
    doc.text(wrapped, margin, y);
    y += wrapped.length * 13 + 10;
  }
  return y;
}

export function renderRecipesPdf(snapshots = [], { title = "NAC Food Bible" } = {}) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const list = snapshots.length ? snapshots : [{ name: "No recipes selected", ingredients: [], brand: "NAC" }];
  list.forEach((snapshot, index) => {
    if (index > 0) doc.addPage();
    if (index === 0 && snapshots.length > 1) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(20);
      doc.text(title, 48, 56);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(90, 90, 90);
      doc.text(`${snapshots.length} current recipes  ·  generated ${new Date().toISOString().slice(0, 10)}`, 48, 74);
      drawRecipe(doc, snapshot, 100);
    } else {
      drawRecipe(doc, snapshot, 48);
    }
  });
  return doc;
}

export function recipesPdfBytes(snapshots, options) {
  return renderRecipesPdf(snapshots, options).output("arraybuffer");
}

export function recipePdfFilename(name, { combined = false } = {}) {
  if (combined) return `nac-food-bible-${new Date().toISOString().slice(0, 10)}.pdf`;
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
