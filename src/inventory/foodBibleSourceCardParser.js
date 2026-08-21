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

const TOOL_LINE = /griddle|knife|board|bowl|whisk|spatula|plancha|saucepan|tray|mandoline|mixer|pan\b|container|presser/i;
const ALLERGEN_LINE = /dairy|gluten|egg|nuts?|sulphit|seafood|sesame|mustard|celery|soya|lupin|mollusc|\bn\/?a\b/i;
const SECTION_LINE = /^(mains?|salads?|main bases?|bases?|brunch|dessert|breakfast|starters?|sides?)$/i;
const TIME_LINE = /^(?:(?:\d+\s*(?:to|-)\s*)?\d+\s*(?:min|minutes)|n\/?a)$/i;
const YIELD_LINE = /^\d+(?:[.,]\d+)?\s*(pax|batch|portions?|g|gr|grams?|kg|ml|l)\b/i;

function parseYieldRaw(raw) {
  const text = String(raw || "").trim();
  const match = text.match(/^(\d+(?:[.,]\d+)?)\s*(pax|batch|portions?|g|gr|grams?|kg|ml|l)?/i);
  if (!match) return { yieldRaw: text, yieldQuantity: null, yieldUnit: "each" };
  const quantity = Number(String(match[1]).replace(",", "."));
  const unitKey = String(match[2] || "").toLowerCase();
  const yieldUnit = !unitKey || /pax|batch|portion/.test(unitKey)
    ? "each"
    : canonicalUnit(unitKey) || "each";
  return { yieldRaw: text, yieldQuantity: Number.isFinite(quantity) ? quantity : null, yieldUnit };
}

function metaFromCover(text) {
  const lines = linesOf(text);
  const title = titleFromPage(text);
  const values = [];
  for (const line of lines) {
    if (!line || line === title || isSkip(line) || isNoise(line) || /^ingredients$/i.test(line) || METHOD_START.test(line) || /^\d+\./.test(line)) continue;
    if (line === line.toUpperCase() && /[A-Z]/.test(line) && line.length > 12) continue;
    if (values.length && /\/\s*$/.test(values[values.length - 1]) && ALLERGEN_LINE.test(line)) {
      values[values.length - 1] = `${values[values.length - 1]} ${line}`.replace(/\s+/g, " ");
      continue;
    }
    values.push(line);
  }
  const utensils = values.find((line) => TOOL_LINE.test(line)) || "";
  const allergensRaw = values.find((line) => ALLERGEN_LINE.test(line) && !TOOL_LINE.test(line)) || "";
  const allergens = /^n\/?a$/i.test(allergensRaw) ? "N/A" : allergensRaw;
  const menuSection = values.find((line) => SECTION_LINE.test(line)) || "";
  const times = values.filter((line) => TIME_LINE.test(line));
  const yieldCandidate = values.find((line) => YIELD_LINE.test(line) && !TIME_LINE.test(line) && !/^1\s*batch$/i.test(line)) || "";
  let prepTime = "";
  let cookTime = "";
  if (times.length >= 2) {
    prepTime = /^n\/?a$/i.test(times[0]) ? "" : times[0];
    cookTime = /^n\/?a$/i.test(times[1]) ? "" : times[1];
  } else if (times.length === 1 && !/^n\/?a$/i.test(times[0])) {
    cookTime = times[0];
  }
  return {
    utensils,
    allergens,
    menuSection,
    prepTime,
    cookTime,
    yieldRaw: yieldCandidate,
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

const NAME_SKIP = /^(base|salads|mains|minutes?|notes?|rice cooker|sauce pan.*|mixing bowl.*|gastro tray.*|table top.*|plancha.*|\d+\s*minutes?)$/i;

function looksLikeIngredientName(line) {
  if (!line || isSkip(line) || isNoise(line) || canonicalUnit(line) || parseQuantity(line) != null) return false;
  if (METHOD_START.test(line) || NAME_SKIP.test(line) || /^\d+\./.test(line)) return false;
  if (/^powder$/i.test(line)) return false;
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
    if (/^method$/i.test(line)) {
      inList = false;
      continue;
    }
    if (!inList) continue;
    if (/^\d+\./.test(line) || METHOD_START.test(line)) continue;
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
    if (isNoise(line) || METHOD_START.test(line) || isSkip(line) || /^\d+\./.test(line) || /^powder$/i.test(line)) {
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
      if (looksLikeIngredientName(line) && !/^(leaves|whole|sliced.*)$/i.test(line)) {
        flush();
        continue;
      }
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
  const start = 0;
  i = start;
  while (i < lines.length) {
    const line = lines[i];
    if (/^method$/i.test(line) || /^critical control$/i.test(line) || isNoise(line) || METHOD_START.test(line) || /^to serve$/i.test(line)) {
      i += 1;
      continue;
    }
    if (isSkip(line) || NAME_SKIP.test(line) || canonicalUnit(line) || parseQuantity(line) != null || /^ingredients$/i.test(line)) {
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
        if (looksLikeName || (looksLikeIngredientName(next) && next.split(/\s+/).length >= 2)) break;
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
  if (!names.length || !qtys.length) return { rows: [], unresolved: [] };
  const count = Math.min(names.length, qtys.length);
  if (count < 2 && names.length < 2) return { rows: [], unresolved: names.map((name) => ({ sourceName: name })) };
  const rows = names.slice(0, count).map((name, index) => ({
    sourceName: name,
    sourceQuantity: qtys[index].quantity,
    sourceUnit: qtys[index].unit,
    notes: qtys[index].notes || "",
    alignment: "COLUMN_ZIP",
  }));
  const unresolved = names.slice(count).map((name) => ({ sourceName: name, sourceQuantity: null, sourceUnit: null, alignment: "UNRESOLVED" }));
  return { rows, unresolved };
}

function mergeIngredientRows(columnRows, interleavedRows) {
  const out = [];
  const seen = new Set();
  for (const row of [...columnRows, ...interleavedRows]) {
    const key = sourceIngredientKey(row.sourceName);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function score(rows) {
  return rows.filter((row) => row.sourceName && row.sourceQuantity != null).length;
}

export function parseFoodBibleCard(pages = []) {
  const cover = pages[0]?.text || "";
  const allLines = pages.flatMap((page) => linesOf(page.text));
  const interleaved = parseInterleaved(allLines);
  const column = parseColumnSplit(allLines);
  const primary = score(column.rows) >= score(interleaved) ? column.rows : interleaved;
  const ingredients = mergeIngredientRows(primary, score(column.rows) >= score(interleaved) ? interleaved : column.rows);
  const unresolvedIngredients = column.unresolved || [];
  const meta = metaFromCover(cover);
  const method = methodFromPages(pages);
  const title = titleFromPage(cover) || titleFromPage(pages.map((page) => page.text).join("\n"));
  const yieldInfo = parseYieldRaw(meta.yieldRaw);
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
    yieldRaw: yieldInfo.yieldRaw,
    yieldQuantity: yieldInfo.yieldQuantity,
    yieldUnit: yieldInfo.yieldUnit,
    ingredients,
    unresolvedIngredients,
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
