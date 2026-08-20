/**
 * Deterministic parser for 20 Aug NAC Food Bible PDF text extracts.
 * Does not invent quantities. Two layouts are supported:
 *   1. Interleaved (name → unit → qty → note) as in Big NAC
 *   2. Column-split (qty/unit stream then ingredient names) as in Quinoa
 */

import { normalizeText } from "./inventoryIntelligence.js";

const UNIT_ALIASES = {
  g: "gram",
  gr: "gram",
  gram: "gram",
  grams: "gram",
  kg: "kilogram",
  kilogram: "kilogram",
  ml: "millilitre",
  millilitre: "millilitre",
  l: "litre",
  litre: "litre",
  pc: "each",
  pcs: "each",
  piece: "each",
  pieces: "each",
  each: "each",
  unit: "each",
  leaves: "each",
  leaf: "each",
};

const SKIP_LINES = new Set([
  "utensils used",
  "allergens",
  "allergens:",
  "menu section",
  "prep time",
  "cooking time",
  "yield",
  "unit",
  "notes",
  "ingredients",
  "method",
  "to serve",
  "critical control",
  "n/a",
  "na",
]);

const METHOD_START = /^\d+\.\s+/;
const QTY = /^(?:\d+(?:[.,]\d+)?|\d+\s*x\s*\d+(?:[.,]\d+)?)$/i;
const CRITICAL_NOISE = /all our products are produced|store food at correct|keep raw and cooked|when food is prepped|frequently wash hands|cook food to at least|always label|keep foods covered/i;

function linesOf(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function isSkip(line) {
  return SKIP_LINES.has(line.toLowerCase().replace(/:$/, ""));
}

function canonicalUnit(value) {
  const key = String(value || "").toLowerCase().replace(/\.$/, "");
  return UNIT_ALIASES[key] || null;
}

function parseQuantity(value) {
  const raw = String(value || "").replace(",", ".");
  const times = raw.match(/^(\d+)\s*x\s*(\d+(?:\.\d+)?)$/i);
  if (times) return Number(times[1]) * Number(times[2]);
  const num = Number(raw);
  return Number.isFinite(num) ? num : null;
}

function isNoise(line) {
  return CRITICAL_NOISE.test(line);
}

function titleFromPage(text) {
  const lines = linesOf(text);
  const blocked = new Set(["big nac"]);
  const candidates = lines.filter((line) => (
    line === line.toUpperCase()
    && /[A-Z]/.test(line)
    && line.length > 3
    && !isSkip(line)
    && !canonicalUnit(line)
    && parseQuantity(line) == null
    && !isNoise(line)
  ));
  if (candidates.length) {
    return candidates.sort((a, b) => b.length - a.length)[0];
  }
  return lines.find((line) => blocked.has(line.toLowerCase()) || (line.length > 3 && !isSkip(line))) || "";
}

function metaFromCover(text) {
  const lines = linesOf(text);
  const idx = (label) => lines.findIndex((line) => line.toLowerCase() === label);
  const after = (label) => {
    const at = idx(label);
    if (at < 0) return "";
    for (let i = at + 1; i < Math.min(lines.length, at + 4); i += 1) {
      if (!isSkip(lines[i]) && !isNoise(lines[i])) return lines[i];
    }
    return "";
  };
  const allergenIdx = lines.findIndex((line) => /^allergens:?$/i.test(line));
  let allergens = "";
  if (allergenIdx >= 0) {
    const next = lines[allergenIdx + 1] || "";
    allergens = /^n\/?a$/i.test(next) ? "N/A" : next;
  }
  const utensilsIdx = lines.findIndex((line) => /^utensils used$/i.test(line));
  let utensils = "";
  if (utensilsIdx >= 0) {
    utensils = lines.slice(utensilsIdx + 1).find((line) => !isSkip(line) && !isNoise(line) && line !== titleFromPage(text)) || "";
  }
  return {
    utensils,
    allergens,
    menuSection: after("menu section"),
    prepTime: after("prep time"),
    cookTime: after("cooking time"),
    yieldRaw: after("yield") || lines.find((line) => /\d+\s*(pax|batch|portion)/i.test(line)) || "",
  };
}

function methodFromPages(pages) {
  const steps = [];
  for (const page of pages) {
    for (const line of linesOf(page.text)) {
      if (METHOD_START.test(line) && !CRITICAL_NOISE.test(line)) steps.push(line);
    }
  }
  return steps;
}

const NAME_SKIP = /^(base|salads|mains|minutes?|rice cooker|sauce pan.*|mixing bowl.*|gastro tray.*|table top.*|plancha.*|\d+\s*minutes?)$/i;

function looksLikeIngredientName(line) {
  if (!line || isSkip(line) || isNoise(line) || canonicalUnit(line) || parseQuantity(line) != null) return false;
  if (METHOD_START.test(line) || NAME_SKIP.test(line)) return false;
  if (/^\d+\s*(pax|batch)/i.test(line)) return false;
  return true;
}

function extractNames(lines) {
  const names = [];
  let inList = false;
  for (const line of lines) {
    if (/^ingredients$/i.test(line) || /^to serve$/i.test(line)) {
      inList = true;
      continue;
    }
    if (/^method$/i.test(line) || /^critical control$/i.test(line)) continue;
    if (!inList) continue;
    if (!looksLikeIngredientName(line)) continue;
    if (line === line.toUpperCase() && line.split(" ").length >= 2) continue;
    names.push(line);
  }
  return names;
}

function extractQtyUnits(lines) {
  const rows = [];
  let pendingUnit = null;
  let pendingQty = null;
  let pendingNote = "";
  const flush = () => {
    if (pendingQty == null) return;
    rows.push({
      quantity: pendingQty,
      unit: pendingUnit || "each",
      notes: pendingNote,
    });
    pendingUnit = null;
    pendingQty = null;
    pendingNote = "";
  };
  for (const line of lines) {
    if (isNoise(line) || METHOD_START.test(line) || isSkip(line)) {
      flush();
      continue;
    }
    const unit = canonicalUnit(line);
    const qty = parseQuantity(line);
    if (unit) {
      if (pendingQty != null) flush();
      pendingUnit = unit;
      continue;
    }
    if (qty != null) {
      if (pendingQty != null) flush();
      pendingQty = qty;
      continue;
    }
    if (pendingQty != null) {
      pendingNote = pendingNote ? `${pendingNote}; ${line}` : line;
      flush();
    }
  }
  flush();
  return rows;
}

function parseInterleaved(lines) {
  const rows = [];
  let i = 0;
  const start = lines.findIndex((line) => /^ingredients$/i.test(line));
  i = start >= 0 ? start + 1 : 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^method$/i.test(line) || /^critical control$/i.test(line) || isNoise(line) || METHOD_START.test(line)) break;
    if (isSkip(line) || NAME_SKIP.test(line) || canonicalUnit(line) || parseQuantity(line) != null) {
      i += 1;
      continue;
    }
    const name = line;
    let unit = null;
    let quantity = null;
    let notes = "";
    let j = i + 1;
    while (j < lines.length && j <= i + 5) {
      const next = lines[j];
      if (canonicalUnit(next) && !unit) {
        unit = canonicalUnit(next);
        j += 1;
        continue;
      }
      if (parseQuantity(next) != null && quantity == null) {
        quantity = parseQuantity(next);
        j += 1;
        continue;
      }
      if (quantity != null && !isSkip(next) && !canonicalUnit(next) && parseQuantity(next) == null && !METHOD_START.test(next) && !isNoise(next) && !/^ingredients$/i.test(next)) {
        const looksLikeName = next === next.toUpperCase() && next.length > 8;
        if (looksLikeName) break;
        notes = next;
        j += 1;
        break;
      }
      break;
    }
    if (name && quantity != null) {
      rows.push({
        sourceName: name,
        sourceQuantity: quantity,
        sourceUnit: unit || "each",
        notes,
        alignment: "INTERLEAVED",
      });
      i = j;
      continue;
    }
    i += 1;
  }
  return rows;
}

function parseColumnSplit(lines) {
  const names = extractNames(lines);
  const qtys = extractQtyUnits(lines);
  if (!names.length || !qtys.length) return [];
  const count = Math.min(names.length, qtys.length);
  if (count < 2) return [];
  return names.slice(0, count).map((name, index) => ({
    sourceName: name,
    sourceQuantity: qtys[index].quantity,
    sourceUnit: qtys[index].unit,
    notes: qtys[index].notes || "",
    alignment: "COLUMN_ZIP",
  }));
}

function score(rows) {
  return rows.filter((row) => row.sourceName && row.sourceQuantity != null).length;
}

export function parseFoodBibleCard(pages = []) {
  const cover = pages[0]?.text || "";
  const allLines = pages.flatMap((page) => linesOf(page.text));
  const interleaved = parseInterleaved(allLines);
  const column = parseColumnSplit(allLines);
  const ingredients = score(column) > score(interleaved) ? column : interleaved;
  const meta = metaFromCover(cover);
  const method = methodFromPages(pages);
  const title = titleFromPage(cover) || titleFromPage(pages.map((page) => page.text).join("\n"));
  const yieldMatch = String(meta.yieldRaw || "").match(/(\d+(?:\.\d+)?)\s*(pax|batch|portion|portions)?/i);
  return {
    title,
    recipeKind: /base|batch/i.test(meta.menuSection || "") || /cooking|dressing|batch/i.test(title)
      ? "preparation"
      : "finished",
    utensils: meta.utensils,
    allergens: meta.allergens,
    menuSection: meta.menuSection,
    prepTime: meta.prepTime,
    cookTime: meta.cookTime,
    yieldRaw: meta.yieldRaw,
    yieldQuantity: yieldMatch ? Number(yieldMatch[1]) : null,
    yieldUnit: /batch/i.test(meta.yieldRaw || "") ? "each" : "each",
    ingredients,
    method,
    sourceLocator: pages.map((page) => page.page).filter(Boolean),
  };
}

export function parseFoodBiblePdfExtract(raw) {
  const pages = raw?.pages || [];
  const cards = [];
  let current = [];
  const flush = () => {
    if (!current.length) return;
    const card = parseFoodBibleCard(current);
    if (card.title) cards.push(card);
    current = [];
  };
  for (const page of pages) {
    const titleish = titleFromPage(page.text || "");
    const looksCover = /utensils used/i.test(page.text || "") || (titleish && titleish === titleish.toUpperCase() && titleish.length > 8);
    if (current.length && looksCover && /utensils used/i.test(page.text || "")) flush();
    current.push(page);
  }
  flush();
  return cards;
}

export function sourceIngredientKey(name) {
  return normalizeText(name);
}

export function mapSourceUnit(unit) {
  return canonicalUnit(unit) || null;
}
