/**
 * Deterministic Food Bible PDF text extraction helpers.
 * Never invents quantities. Misaligned two-column layouts stay reviewable.
 */

import {
  adaptFoodBibleRecipeForKsa,
  normalizeFoodBibleText,
} from "./foodBibleKsaAdaptation";

const NOISE_LINE_RE =
  /^(utensils used\b.*|allergens?:.*|menu section|prep time|cooking time|yield|ingredients(?:\s+unit.*)?|unit(?:\s+1)?(?:\s+batch)?(?:\s+notes)?|notes|1 batch|method|to serve|critical control|all our products are produced.*|store food at.*|keep raw and.*|when food is prepped.*|frequently wash.*|cook food to.*|always label.*|keep foods covered.*|total|celery mains|alcohol\s*\/.*)$/i;

const UNIT_RE = /^(g|gr|kg|ml|l|litre|liter|pcs|pc|unit|units|pax)$/i;
const QTY_ONLY_RE = /^(g|gr|kg|ml|l|litre|liter|pcs|pc|unit|units)\s+([0-9]+(?:[.,][0-9]+)?)\b(.*)$/i;
const INLINE_ING_RE =
  /^(.+?)\s+(g|gr|kg|ml|l|litre|liter|pcs|pc|unit|units)\s+([0-9]+(?:[.,][0-9]+)?)(?:\s+(.*))?$/i;
const QTY_NUMBER_RE = /^([0-9]+(?:[.,][0-9]+)?)(?:\s*\/\s*([0-9]+))?$/;
const INGREDIENT_NOTE_RE =
  /^(chopped|sliced|diced|grated|finely|roughly|optional|to taste|2 slices|3 slices|2x |3 layers|remove |pre cooked|when reduced|\d+\s*gr\b)/i;
const ALLERGEN_LINE_RE = /^(dairy|egg|eggs|gluten|celery|sulphite|sulphites|mustard|nuts|sesame|soya|crustaceans|fish|alcohol)(\s*\/\s*(dairy|egg|eggs|gluten|celery|sulphite|sulphites|mustard|nuts|sesame|soya|crustaceans|fish|alcohol))+$/i;
const METHOD_START_RE = /^\d+\.\s+/;
const YIELD_RE = /\b((?:\d+(?:[.,]\d+)?)\s*(?:pax|kg|g|l|ml|units?))\b/i;

function parseNumber(raw) {
  if (raw == null || raw === "") return null;
  const text = String(raw).trim();
  const fraction = text.match(/^([0-9]+)\s*\/\s*([0-9]+)$/);
  if (fraction) {
    const den = Number(fraction[2]);
    if (!den) return null;
    const n = Number(fraction[1]) / den;
    return Number.isFinite(n) ? n : null;
  }
  const n = Number(text.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export function normalizeCanonicalUnit(unit, quantity) {
  const u = String(unit || "").toLowerCase();
  const q = parseNumber(quantity);
  if (q == null) {
    return { canonicalQuantity: null, canonicalUnit: null, unitConversion: "MISSING_QUANTITY" };
  }
  if (u === "g") {
    return { canonicalQuantity: q / 1000, canonicalUnit: "kg", unitConversion: "SAFE_G_TO_KG" };
  }
  if (u === "ml") {
    return { canonicalQuantity: q / 1000, canonicalUnit: "litre", unitConversion: "SAFE_ML_TO_L" };
  }
  if (u === "l" || u === "litre" || u === "liter") {
    return { canonicalQuantity: q, canonicalUnit: "litre", unitConversion: "IDENTITY" };
  }
  if (u === "kg") {
    return { canonicalQuantity: q, canonicalUnit: "kg", unitConversion: "IDENTITY" };
  }
  if (u === "pcs" || u === "pc" || u === "unit" || u === "units" || u === "pax") {
    return {
      canonicalQuantity: q,
      canonicalUnit: u === "pax" ? "pax" : "pcs",
      unitConversion: "IDENTITY",
    };
  }
  return {
    canonicalQuantity: q,
    canonicalUnit: u || null,
    unitConversion: "AMBIGUOUS_UNIT",
  };
}

function isNoiseLine(line) {
  const text = normalizeFoodBibleText(line);
  if (!text) return true;
  if (NOISE_LINE_RE.test(text)) return true;
  if (/^(fi|llet|fl)$/i.test(text)) return true;
  if (/^(celery|dairy|gluten|mustard|fish|sulphite|sulphites|alcohol)\b/i.test(text) && /[/,]/.test(text)) return true;
  if (/^allergens?:/i.test(text)) return true;
  if (ALLERGEN_LINE_RE.test(text)) return true;
  return false;
}

const FALSE_TITLE_RE =
  /^(n\/?a|none|null|nil|tbd|unknown|total|base|mains|starters|desserts|add ons|batch|unit(?:s)?)$/i;
const PURE_QTY_TITLE_RE =
  /^(?:gr|g|kg|ml|l|litre|liter|pcs?|ea|ae|unit|units|pax)?\s*\d+(?:[.,]\d+)?\s*(?:gr|g|kg|ml|l|litre|liter|pcs?|ea|ae|unit|units|pax)?$/i;

function looksLikeTitle(line) {
  const text = normalizeFoodBibleText(line);
  if (!text || text.length < 3 || text.length > 90) return false;
  if (METHOD_START_RE.test(text)) return false;
  if (UNIT_RE.test(text)) return false;
  if (QTY_ONLY_RE.test(text)) return false;
  if (INLINE_ING_RE.test(text) && /\b(g|kg|ml|l)\s+\d/i.test(text)) return false;
  if (FALSE_TITLE_RE.test(text)) return false;
  if (PURE_QTY_TITLE_RE.test(text)) return false;
  if (/^\d+(?:[.,]\d+)?\s*(?:units?|kg|g|ml|l|pax)\b/i.test(text)) return false;
  if (/^[a-z]/.test(text) && !/batch/i.test(text)) return false;
  // Titles in Food Bible are mostly uppercase / title-like.
  const letters = text.replace(/[^A-Za-z]/g, "");
  if (!letters) return false;
  const upper = letters.replace(/[^A-Z]/g, "").length;
  if (upper / letters.length >= 0.55) return true;
  const words = text.split(/[\s,/&-]+/).filter((word) => /[A-Za-z]/.test(word));
  const capped = words.filter((word) => /^[A-Z]/.test(word));
  return words.length >= 2
    && words.length <= 16
    && capped.length >= 2
    && capped.length / words.length >= 0.45;
}

function isPrepTitle(title) {
  const text = normalizeFoodBibleText(title);
  // Finished menu dishes often contain prep words ("pink sauce", "truffle mayo").
  // Prefer prep classification for short component cards / explicit batch labels.
  if (/\bbatch\b/i.test(text)) return true;
  if (/^\s*(vodka\s+)?tomato\s+sauce\s*$/i.test(text)) return true;
  const tokens = text.split(/[,\s]+/).filter(Boolean);
  if (
    tokens.length <= 3 &&
    /\b(dressing|marinade|marinate|mayonnaise|fillet|patty|dough|meringue|coulis|granola|hummus|tatziki|tzatziki|choux|reduction)\b/i.test(
      text
    )
  ) {
    return true;
  }
  // Short sauce/base/mix/mayo component titles (not long finished dish names).
  if (text.split(/[,\s]+/).length <= 5 && /\b(sauce|mayo|base|mix|cooking|confit|chips)\b/i.test(text)) {
    return true;
  }
  // Common short prep/component cards that are not finished menu products.
  if (
    text.split(/[,\s]+/).length <= 4 &&
    /^(sweet corn|grated parmesan|dulce de leche|clotted cream|mashed avocado|frosties ice cream|caramelize toast|cajun brown butter|red pepper|speculos|pistachio cream)$/i.test(
      text
    )
  ) {
    return true;
  }
  return false;
}

/**
 * Deterministic Food Bible recipe-title validation.
 * Rejects layout placeholders/quantities; never discards underlying source text.
 */
export function repairFoodBiblePdfText(text) {
  return String(text || "")
    .replace(/\nfi\s*\n+llet\b/gi, " fillet")
    .replace(/\bfi\s*\n+\s*llet\b/gi, "fillet")
    .replace(/([A-Za-z][A-Za-z ]+)\n\s*fillet\b/gi, "$1 fillet")
    .replace(/\bbrie\s*\n+\s*fl\s*\n+\s*y\b/gi, "briefly")
    .replace(/\bcling\s*\n+\s*fi\s*\n+\s*lm\b/gi, "cling film");
}

export function validateFoodBibleRecipeTitle(title, card = {}) {
  const text = normalizeFoodBibleText(title);
  const reasons = [];
  if (!text) reasons.push("EMPTY_TITLE");
  if (text && FALSE_TITLE_RE.test(text)) reasons.push("PLACEHOLDER_TITLE");
  if (text && PURE_QTY_TITLE_RE.test(text)) reasons.push("QUANTITY_AS_TITLE");
  if (text && /^\d+(?:[.,]\d+)?\s*(?:units?|kg|g|ml|l|pax)\b/i.test(text)) {
    reasons.push("QUANTITY_AS_TITLE");
  }
  if (text && /^untitled card\b/i.test(text)) reasons.push("GENERATED_PLACEHOLDER");
  if (text && !looksLikeTitle(text) && !isPrepTitle(text)) reasons.push("NOT_TITLE_LIKE");

  const hasIngredientHeader = (card.pageTexts || []).some((t) => /ingredients\b/i.test(t || ""));
  const hasMethod =
    (card.method || []).length > 0 ||
    (card.pageTexts || []).some((t) => /\bmethod\b/i.test(t || "") || /^\d+\.\s+/m.test(t || ""));
  const hasYield = Boolean(card.yieldRaw) || (card.pageTexts || []).some((t) => /\byield\b/i.test(t || ""));
  const ingredientCount = (card.ingredients || []).length;

  // A valid recipe candidate needs a title-like heading plus culinary structure.
  if (!reasons.length && ingredientCount === 0 && !hasIngredientHeader) {
    reasons.push("NO_INGREDIENT_STRUCTURE");
  }
  if (!reasons.length && !hasMethod && !hasYield && ingredientCount === 0) {
    reasons.push("NO_RECIPE_STRUCTURE");
  }

  return {
    ok: reasons.length === 0,
    title: text,
    reasons,
    structure: {
      hasIngredientHeader,
      hasMethod,
      hasYield,
      ingredientCount,
    },
  };
}

export function splitFoodBiblePages(rawText) {
  const pages = [];
  const chunks = String(rawText || "").split(/===== PAGE\s+(\d+)\s+=====/i);
  for (let i = 1; i < chunks.length; i += 2) {
    pages.push({
      page: Number(chunks[i]),
      text: chunks[i + 1] || "",
    });
  }
  if (!pages.length && String(rawText || "").trim()) {
    pages.push({ page: 1, text: String(rawText) });
  }
  return pages;
}

function extractMethodLines(lines) {
  const method = [];
  for (const line of lines) {
    const text = normalizeFoodBibleText(line);
    if (METHOD_START_RE.test(text)) method.push(text);
  }
  return method;
}

function extractIngredientSectionLines(lines) {
  const preQty = [];
  const out = [];
  const trailingNames = [];
  let inSection = false;
  let afterMethod = false;
  let seenMethod = false;
  for (const raw of lines) {
    const line = normalizeFoodBibleText(raw);
    if (!line) continue;
    if (/^ingredients\b/i.test(line)) {
      inSection = true;
      afterMethod = false;
      continue;
    }
    // These labels are layout noise and may appear before or after Ingredients.
    if (/^(to serve|critical control)\b/i.test(line)) {
      continue;
    }
    if (/^(celery|dairy|gluten|mustard|fish|sulphite|sulphites|alcohol)\b/i.test(line) && /[/,]/.test(line)) {
      continue;
    }
    if (/^(brunoise|julienne|chiffonade|dice[ds]?|minced)$/i.test(line)) {
      continue;
    }
    if (/^method\b/i.test(line)) {
      seenMethod = true;
      afterMethod = true;
      inSection = false;
      continue;
    }
    if (inSection) {
      // Keep structured ingredient rows even when notes contain verbs like "remove".
      if (QTY_ONLY_RE.test(line) || INLINE_ING_RE.test(line)) {
        out.push(raw);
        continue;
      }
      // Method steps sometimes appear before the Method label in PDF text order.
      if (METHOD_START_RE.test(line) || looksLikeProse(line)) continue;
      out.push(raw);
      continue;
    }
    if (afterMethod) {
      if (
        !looksLikeProse(line) &&
        !isNoiseLine(line) &&
        !QTY_ONLY_RE.test(line) &&
        !looksLikeTitle(line) &&
        !/^\d+(?:[.,]\d+)?\s*(?:minutes?|hours?|kg|g|l|ml|pax)\b/i.test(line) &&
        !/^(add ons|batch|bowl|small plates)\b/i.test(line) &&
        line.length <= 60
      ) {
        trailingNames.push(raw);
      }
      continue;
    }
    // Food Bible cards often print qty rows above the Ingredients label.
    if (QTY_ONLY_RE.test(line) || INLINE_ING_RE.test(line)) {
      preQty.push(raw);
    }
  }
  if (!out.length && !preQty.length && !trailingNames.length) {
    return lines.filter((raw) => {
      const line = normalizeFoodBibleText(raw);
      return QTY_ONLY_RE.test(line) || INLINE_ING_RE.test(line);
    });
  }
  return [...preQty, ...out, ...trailingNames];
}

function looksLikeOperationalText(line) {
  const text = normalizeFoodBibleText(line);
  if (!text) return false;
  if (/^(one slice|place |serve with|on the |on each|each patty|upward side)/i.test(text)) return true;
  if (text.split(/\s+/).length >= 8 && /\b(patty|plate|side|garnish|serve)\b/i.test(text)) return true;
  return false;
}

function looksLikeProse(line) {
  const text = normalizeFoodBibleText(line);
  if (!text) return false;
  if (METHOD_START_RE.test(text)) return true;
  if (text.length > 60) return true;
  const words = text.split(/\s+/);
  if (
    words.length >= 6 &&
    /\b(then|once|using|allow|bring|remove|store|deglaze|simmer|whisk|blend|add|until|continue|without|coloration|colouration)\b/i.test(
      text
    )
  ) {
    return true;
  }
  return false;
}

function extractYield(lines, pageTexts) {
  const joined = [...lines, ...pageTexts].map(normalizeFoodBibleText).join("\n");
  // Prefer values that appear after an explicit Yield label.
  const afterYield = joined.match(
    /Yield\s*(?:\n|\s)+((?:\d+(?:[.,]\d+)?)\s*(?:Pax|KG|G|L|ML|units?))/i
  );
  if (afterYield) return normalizeFoodBibleText(afterYield[1]);

  // Prep cards often print yield near the title block as "16.5 KG" / "8 pax".
  const kg = joined.match(/\b(\d+(?:[.,]\d+)?\s*KG)\b/i);
  if (kg) return normalizeFoodBibleText(kg[1]);
  const pax = joined.match(/\b(\d+\s*Pax)\b/i);
  if (pax) return normalizeFoodBibleText(pax[1]);
  return null;
}

function parseIngredientCandidates(lines, { cardTitle = null } = {}) {
  const inline = [];
  const orphanQtys = [];
  const orphanNames = [];
  const stacked = [];
  const issues = [];
  const pending = [];

  const flushStacked = () => {
    while (pending.length >= 3
      && pending[0].kind === "name"
      && pending[1].kind === "unit"
      && pending[2].kind === "qty") {
      const name = pending.shift();
      const unit = pending.shift();
      const qty = pending.shift();
      stacked.push({
        sourceName: name.sourceName,
        sourceUnit: unit.sourceUnit,
        sourceQuantity: qty.sourceQuantity,
        notes: qty.notes || "",
        sourceLine: `${name.sourceLine} | ${unit.sourceLine} | ${qty.sourceLine}`,
        alignment: "STACKED_NAME_UNIT_QTY",
      });
    }
  };

  for (const raw of lines) {
    const line = normalizeFoodBibleText(raw);
    if (!line || isNoiseLine(line)) continue;
    if (METHOD_START_RE.test(line)) continue;
    if (/^critical control|^to serve|^method$|^notes$|^1 batch$/i.test(line)) continue;

    if (INGREDIENT_NOTE_RE.test(line) && (stacked.length || inline.length)) {
      const target = stacked[stacked.length - 1] || inline[inline.length - 1];
      target.notes = [target.notes, line].filter(Boolean).join(" ");
      continue;
    }

    const qtyOnly = line.match(QTY_ONLY_RE);
    if (qtyOnly) {
      orphanQtys.push({
        sourceUnit: qtyOnly[1].toLowerCase(),
        sourceQuantity: parseNumber(qtyOnly[2]),
        notes: normalizeFoodBibleText(qtyOnly[3] || ""),
        sourceLine: line,
      });
      continue;
    }

    if (UNIT_RE.test(line)) {
      pending.push({ kind: "unit", sourceUnit: line.toLowerCase(), sourceLine: line });
      flushStacked();
      continue;
    }

    const numberOnly = line.match(QTY_NUMBER_RE);
    if (numberOnly) {
      const qty = numberOnly[2]
        ? parseNumber(`${numberOnly[1]}/${numberOnly[2]}`)
        : parseNumber(numberOnly[1]);
      pending.push({ kind: "qty", sourceQuantity: qty, notes: "", sourceLine: line });
      flushStacked();
      continue;
    }

    const inlineMatch = line.match(INLINE_ING_RE);
    if (inlineMatch) {
      const name = normalizeFoodBibleText(inlineMatch[1]);
      if (name && !isNoiseLine(name) && !looksLikeTitle(name)) {
        inline.push({
          sourceName: name,
          sourceUnit: inlineMatch[2].toLowerCase(),
          sourceQuantity: parseNumber(inlineMatch[3]),
          notes: normalizeFoodBibleText(inlineMatch[4] || ""),
          sourceLine: line,
          alignment: "INLINE",
        });
        continue;
      }
    }

    if (
      !looksLikeProse(line) &&
      !FALSE_TITLE_RE.test(line) &&
      !UNIT_RE.test(line) &&
      !/^\d/.test(line) &&
      line.length <= 80 &&
      !/^(base|mains|starters|desserts|alcohol|dairy|gluten|celery|sulphite|mustard|nuts?)$/i.test(
        line
      ) &&
      !/^\//.test(line) &&
      !/sauce pan|chopping board|thermo-cooker|plancha|spatula|whisk|strainer|gloves|bain marie|storing container/i.test(
        line
      )
    ) {
      pending.push({ kind: "name", sourceName: line, sourceLine: line });
      flushStacked();
    }
  }
  flushStacked();

  for (const token of pending) {
    if (token.kind === "name") {
      orphanNames.push({ sourceName: token.sourceName, sourceLine: token.sourceLine });
    } else if (token.kind === "qty") {
      orphanQtys.push({
        sourceUnit: null,
        sourceQuantity: token.sourceQuantity,
        notes: token.notes || "",
        sourceLine: token.sourceLine,
      });
    } else if (token.kind === "unit") {
      issues.push({
        code: "AMBIGUOUS_UNIT",
        detail: `Unpaired unit row: ${token.sourceLine}`,
        category: "parser_unpaired_unit",
      });
    }
  }

  const ingredients = [...stacked, ...inline];

  if (orphanQtys.length && orphanNames.length) {
    if (orphanQtys.length === orphanNames.length) {
      const useReverse = inline.length > 0 || stacked.length > 0;
      const orderedNames = useReverse ? [...orphanNames].reverse() : orphanNames;
      const alignment = useReverse
        ? "CANDIDATE_REVERSE_ORPHAN_PAIR"
        : "CANDIDATE_SEQUENTIAL_ORPHAN_PAIR";
      for (let i = 0; i < orphanQtys.length; i += 1) {
        const qty = orphanQtys[i];
        const name = orderedNames[i];
        ingredients.push({
          sourceName: name.sourceName,
          sourceQuantity: qty.sourceQuantity,
          sourceUnit: qty.sourceUnit,
          notes: qty.notes,
          sourceLine: `${name.sourceLine} | ${qty.sourceLine}`,
          alignment,
        });
      }
      issues.push({
        code: "SOURCE_RECIPE_INCONSISTENCY",
        detail: `Orphan quantity/name pairs require review (count=${orphanQtys.length}, alignment=${useReverse ? "reverse" : "sequential"})`,
        category: "layout_two_column",
      });
    } else {
      issues.push({
        code: "SOURCE_RECIPE_INCONSISTENCY",
        detail: `Ingredient/quantity count mismatch names=${orphanNames.length} qty=${orphanQtys.length}`,
        category: "layout_mismatch",
      });
      for (const name of orphanNames) {
        issues.push({
          code: "AMBIGUOUS_UNIT",
          detail: `Unpaired name row: ${name.sourceName}`,
          category: ingredients.length ? "leftover_column_name" : "missing_source_qty",
        });
      }
      for (const qty of orphanQtys) {
        issues.push({
          code: "AMBIGUOUS_UNIT",
          detail: `Unpaired quantity row: ${qty.sourceLine}`,
          category: "unpaired_qty",
        });
      }
    }
  } else if (orphanQtys.length && !orphanNames.length) {
    for (const qty of orphanQtys) {
      issues.push({
        code: "SOURCE_RECIPE_INCONSISTENCY",
        detail: `Quantity without ingredient name: ${qty.sourceLine}`,
        category: "qty_without_name",
      });
    }
  } else if (!orphanQtys.length && orphanNames.length) {
    for (const name of orphanNames) {
      if (looksLikeOperationalText(name.sourceName) || ingredients.length) {
        issues.push({
          code: "AMBIGUOUS_UNIT",
          detail: ingredients.length
            ? `Leftover name after structured rows: ${name.sourceName}`
            : `Operational text, not a quantity line: ${name.sourceName}`,
          category: ingredients.length ? "leftover_column_name" : "operational_text",
        });
        continue;
      }
      issues.push({
        code: "AMBIGUOUS_UNIT",
        detail: `Ingredient without quantity: ${name.sourceName}`,
        category: "missing_source_qty",
      });
    }
  }

  return { ingredients, issues };
}

function findTitleInPages(pageTexts) {
  for (const text of pageTexts) {
    for (const line of String(text).split(/\n+/)) {
      const cleaned = normalizeFoodBibleText(line);
      if (looksLikeTitle(cleaned) && cleaned === cleaned.toUpperCase()) {
        return cleaned;
      }
    }
  }
  for (const text of pageTexts) {
    for (const line of String(text).split(/\n+/)) {
      const cleaned = normalizeFoodBibleText(line);
      if (looksLikeTitle(cleaned)) return cleaned;
    }
  }
  return null;
}

/**
 * Extract recipe cards from Food Bible page texts.
 * pages: [{page, text}]
 */
export function extractFoodBibleRecipesFromPages({
  sourceFile,
  pages = [],
  sourcePath = null,
  sha256 = null,
} = {}) {
  const cards = [];
  const rejectedTitles = [];
  let current = null;

  const flush = () => {
    if (!current) return;
    const allLines = current.lines;
    const pageTexts = current.pageTexts;
    const method = extractMethodLines(allLines);
    // Also capture method prose continuations that omit leading "1."
    for (const raw of allLines) {
      const line = normalizeFoodBibleText(raw);
      if (looksLikeProse(line) && !method.includes(line) && /\b(vodka|wine|sake|deglaze|simmer|strain)\b/i.test(line)) {
        method.push(line);
      }
    }
    const ingredientLines = extractIngredientSectionLines(allLines);
    const yieldRaw = extractYield(allLines, pageTexts);

    const titleCandidates = [];
    const primary =
      current.title ||
      findTitleInPages(pageTexts) ||
      null;
    if (primary) titleCandidates.push(primary);
    for (const text of pageTexts) {
      for (const line of String(text).split(/\n+/)) {
        const cleaned = normalizeFoodBibleText(line);
        if (looksLikeTitle(cleaned) && !titleCandidates.includes(cleaned)) {
          titleCandidates.push(cleaned);
        }
      }
    }

    let title = null;
    let titleValidation = null;
    for (const candidate of titleCandidates) {
      const probeIngredients = parseIngredientCandidates(ingredientLines, {
        cardTitle: candidate,
      }).ingredients;
      const validation = validateFoodBibleRecipeTitle(candidate, {
        pageTexts,
        method,
        yieldRaw,
        ingredients: probeIngredients,
      });
      if (validation.ok) {
        title = candidate;
        titleValidation = validation;
        break;
      }
      if (!titleValidation) titleValidation = validation;
    }

    if (!title) {
      const rejectedTitle = primary || titleCandidates[0] || `UNTITLED CARD ${cards.length + rejectedTitles.length + 1}`;
      const validation =
        titleValidation ||
        validateFoodBibleRecipeTitle(rejectedTitle, {
          pageTexts,
          method,
          yieldRaw,
          ingredients: parseIngredientCandidates(ingredientLines, {
            cardTitle: rejectedTitle,
          }).ingredients,
        });
      rejectedTitles.push({
        sourceFile,
        sourcePath,
        sha256,
        rejectedTitle,
        reasons: validation.reasons,
        pages: current.pages.slice(),
        sourceLocator: `file=${sourceFile}; pages=${current.pages[0]}-${current.pages[current.pages.length - 1]}; rejectedTitle=${rejectedTitle}`,
        sourcePreserved: true,
        pageTextsPreserved: true,
      });
      current = null;
      return;
    }

    const { ingredients: rawIngredients, issues } = parseIngredientCandidates(ingredientLines, {
      cardTitle: title,
    });
    if (!yieldRaw) {
      issues.push({
        code: "MISSING_YIELD",
        detail: "No explicit yield found in source card",
      });
    }

    const ingredients = rawIngredients.map((ing) => {
      const normalized = normalizeCanonicalUnit(ing.sourceUnit, ing.sourceQuantity);
      if (normalized.unitConversion === "AMBIGUOUS_UNIT") {
        issues.push({
          code: "AMBIGUOUS_UNIT",
          detail: `Unresolved unit/quantity for ${ing.sourceName}`,
        });
      }
      return {
        ...ing,
        ...normalized,
      };
    });

    const recipeKind = isPrepTitle(title) ? "prep" : "finished";
    const sourceRecipe = {
      sourceFile,
      sourcePath,
      sha256,
      sourceMarket: "international",
      recipeKind,
      sourceTitle: title,
      menuSection: null,
      yieldRaw,
      prepTime: null,
      cookTime: null,
      method,
      ingredients,
      issues,
      pages: current.pages.slice(),
      sourceLocator: `file=${sourceFile}; pages=${current.pages[0]}-${current.pages[current.pages.length - 1]}; title=${title}`,
      titleValidation,
    };

    const adapted = adaptFoodBibleRecipeForKsa(sourceRecipe);
    const hasBlockingIssue = (adapted.issues || []).some((i) => {
      if (
        ![
          "SOURCE_RECIPE_INCONSISTENCY",
          "AMBIGUOUS_UNIT",
          "MISSING_YIELD",
          "KSA_MARKET_ADAPTATION_REQUIRED",
        ].includes(i.code)
      ) {
        return false;
      }
      if (i.code === "SOURCE_RECIPE_INCONSISTENCY" && i.ksaBlocking === false) return false;
      return true;
    });
    const hasMarketAdaptation = (adapted.adaptations || []).some(
      (a) => a.code === "KSA_MARKET_ADAPTATION_REQUIRED" || a.code === "KSA_ZERO_ALCOHOL_WINE_MAPPING"
    );
    const hasCandidateAlignment = ingredients.some(
      (i) => i.alignment && i.alignment !== "INLINE"
    );
    const trust =
      !ingredients.length || !yieldRaw || hasBlockingIssue || hasMarketAdaptation || hasCandidateAlignment
        ? "NEEDS_REVIEW"
        : "PREVIEW_CANDIDATE";

    cards.push({
      ...sourceRecipe,
      ...adapted,
      previewTrustStatus: trust,
    });
    current = null;
  };

  for (const page of pages) {
    const text = repairFoodBiblePdfText(page.text || "");
    const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
    const hasIngredientHeader = lines.some((l) => /^ingredients\b/i.test(normalizeFoodBibleText(l)));
    const title = findTitleInPages([text]);

    // New card when we see a title-ish heading or Ingredients header after a prior card.
    if (current && (hasIngredientHeader || (title && current.pages.length >= 1 && page.page > current.pages[0] + 1))) {
      // Continue same card across adjacent pages unless a clear new title appears with utensils block.
    }

    const startsNewCard =
      /Utensils Used/i.test(text) ||
      (/Menu Section/i.test(text) && /Prep Time/i.test(text));

    if (!current || startsNewCard) {
      if (current && startsNewCard) flush();
      current = {
        title: title || null,
        pages: [page.page],
        lines: [...lines],
        pageTexts: [text],
      };
    } else {
      current.pages.push(page.page);
      current.lines.push(...lines);
      current.pageTexts.push(text);
      if (!current.title && title) current.title = title;
    }
  }
  flush();

  // Deduplicate exact same title+pages
  const seen = new Set();
  const recipes = cards.filter((card) => {
    const key = `${card.sourceTitle}::${card.pages.join(",")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { recipes, rejectedTitles };
}

export function buildFoodBibleCohortPreview({ files = [], menuItems = [] } = {}) {
  const recipes = [];
  const rejectedTitles = [];
  for (const file of files) {
    const pages =
      file.pages ||
      splitFoodBiblePages(file.rawText || "").map((p) => ({
        page: p.page,
        text: p.text,
      }));
    const extracted = extractFoodBibleRecipesFromPages({
      sourceFile: file.sourceFile || file.fileName,
      sourcePath: file.sourcePath || null,
      sha256: file.sha256 || null,
      pages,
    });
    recipes.push(...extracted.recipes);
    rejectedTitles.push(...extracted.rejectedTitles);
  }

  const prepTitles = new Map();
  for (const recipe of recipes) {
    if (recipe.recipeKind === "prep") {
      prepTitles.set(normalizeFoodBibleText(recipe.ksaOperationalTitle).toLowerCase(), recipe);
    }
  }

  const dependencies = [];
  for (const recipe of recipes) {
    if (recipe.recipeKind !== "finished") continue;
    for (const ing of recipe.ksaIngredients || []) {
      const key = normalizeFoodBibleText(ing.ksaOperationalName).toLowerCase();
      for (const [prepKey, prep] of prepTitles.entries()) {
        if (key && (prepKey.includes(key) || key.includes(prepKey))) {
          dependencies.push({
            finished: recipe.ksaOperationalTitle,
            ingredient: ing.ksaOperationalName,
            prep: prep.ksaOperationalTitle,
            sourceFile: recipe.sourceFile,
          });
        }
      }
    }
  }

  function norm(s) {
    return normalizeFoodBibleText(s)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  const menuByNorm = new Map();
  for (const item of menuItems) {
    const key = norm(item.name || item.name_en);
    if (!key) continue;
    if (!menuByNorm.has(key)) menuByNorm.set(key, []);
    menuByNorm.get(key).push(item);
  }

  const menuLinks = recipes
    .filter((r) => r.recipeKind === "finished")
    .map((recipe) => {
      const key = norm(recipe.ksaOperationalTitle);
      let status = "UNRESOLVED";
      let matches = menuByNorm.get(key) || [];
      if (matches.length) status = matches.length === 1 ? "MATCHED" : "CANDIDATE";
      else {
        const cands = [];
        for (const [mn, arr] of menuByNorm.entries()) {
          const ta = new Set(key.split(" ").filter(Boolean));
          const tb = new Set(mn.split(" ").filter(Boolean));
          const inter = [...ta].filter((t) => tb.has(t));
          const menuCovered = tb.size && [...tb].every((t) => ta.has(t));
          const highOverlap = ta.size && inter.length / ta.size >= 0.7 && inter.length >= 2;
          // Deterministic candidate only: exact menu-name token coverage inside recipe title
          // (e.g. menu "Rigatoni" inside "Rigatoni, pink sauce...") or strong overlap.
          if (menuCovered || highOverlap) {
            cands.push(...arr);
          }
        }
        const uniq = [];
        const seenIds = new Set();
        for (const c of cands) {
          const id = c.id || c.name;
          if (seenIds.has(id)) continue;
          seenIds.add(id);
          uniq.push(c);
        }
        if (uniq.length) {
          status = "CANDIDATE";
          matches = uniq;
        }
      }
      return {
        sourceFile: recipe.sourceFile,
        sourceTitle: recipe.sourceTitle,
        ksaOperationalTitle: recipe.ksaOperationalTitle,
        linkStatus: status,
        menuMatches: matches.map((m) => ({
          id: m.id || null,
          name: m.name || m.name_en,
          slug: m.slug || null,
          price: m.price ?? null,
        })),
      };
    });

  const rawIngredientNames = [
    ...new Set(
      recipes.flatMap((r) =>
        (r.ingredients || []).map((i) => normalizeFoodBibleText(i.sourceName)).filter(Boolean)
      )
    ),
  ].sort();

  const adaptations = recipes.flatMap((r) =>
    (r.adaptations || []).map((a) => ({
      sourceFile: r.sourceFile,
      sourceTitle: r.sourceTitle,
      ksaOperationalTitle: r.ksaOperationalTitle,
      ...a,
    }))
  );

  const summary = {
    sourceFiles: files.length,
    recipesDiscovered: recipes.length,
    finishedRecipes: recipes.filter((r) => r.recipeKind === "finished").length,
    prepRecipes: recipes.filter((r) => r.recipeKind === "prep").length,
    rawIngredientCandidates: rawIngredientNames.length,
    vodkaTitleRenames: adaptations.filter((a) => a.rule === "VODKA_TOMATO_SAUCE_RENAME" && a.type === "RENAME").length,
    vodkaSubrecipeRenames: adaptations.filter(
      (a) => a.rule === "VODKA_TOMATO_SAUCE_RENAME" && a.type === "RENAME_SUBRECIPE_REF"
    ).length,
    spiritExclusions: adaptations.filter((a) => a.type === "EXCLUDE_SPIRIT").length,
    zeroAlcoholWineMappings: adaptations.filter((a) => a.type === "ZERO_ALCOHOL_WINE").length,
    mirinReviews: adaptations.filter((a) => a.type === "REVIEW_ALCOHOL_BEARING").length,
    sourceInconsistencies: recipes.reduce(
      (n, r) => n + (r.issues || []).filter((i) => i.code === "SOURCE_RECIPE_INCONSISTENCY").length,
      0
    ),
    needsReview: recipes.filter((r) => r.previewTrustStatus === "NEEDS_REVIEW").length,
    previewCandidates: recipes.filter((r) => r.previewTrustStatus === "PREVIEW_CANDIDATE").length,
    menuMatched: menuLinks.filter((l) => l.linkStatus === "MATCHED").length,
    menuCandidate: menuLinks.filter((l) => l.linkStatus === "CANDIDATE").length,
    menuUnresolved: menuLinks.filter((l) => l.linkStatus === "UNRESOLVED").length,
    rejectedFalseTitles: rejectedTitles.length,
    productionApply: "BLOCKED_UNTIL_REVIEW",
    salesApproval: "NOT_IN_SCOPE",
  };

  return {
    summary,
    recipes,
    rejectedTitles,
    rawIngredientNames,
    adaptations,
    dependencies,
    menuLinks,
    productionMutation: false,
  };
}
