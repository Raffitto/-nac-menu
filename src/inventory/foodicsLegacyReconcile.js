/**
 * Foodics legacy evidence reconciliation for NAC shortlist recipes.
 * Foodics is EXTERNAL LEGACY EVIDENCE only — never NAC canonical truth.
 * Preview only; never mutates production.
 */

import { normalizeText } from "./inventoryIntelligence";
import { normalizeFoodBibleText } from "./foodBibleKsaAdaptation";
import { normalizeCanonicalUnit } from "./foodBiblePdfExtract";

export const SHORTLIST_FOODICS_PRODUCTS = Object.freeze({
  RIGATONI: {
    foodBibleTitle: "RIGATONI, PINK SAUCE, BASIL, CHILI, PARMIGIANO",
    ksaOperationalTitle: "RIGATONI, PINK SAUCE, BASIL, CHILI, PARMIGIANO",
    foodicsProductSkus: ["sk-1174"],
    relatedProductSkus: ["sk-2176"], // combo containing Rigatoni lines
  },
  CAJUN_CHICKEN: {
    foodBibleTitle: "FREE RANGE GRILLED CAJUN CHICKEN, CORN, TOMATOES",
    ksaOperationalTitle: "FREE RANGE GRILLED CAJUN CHICKEN, CORN, TOMATOES",
    foodicsProductSkus: ["sk-0631"],
    relatedProductSkus: ["sk-2177"],
  },
  HALLOUMI: {
    foodBibleTitle: "HALLOUMI",
    ksaOperationalTitle: "HALLOUMI",
    foodicsProductSkus: ["sk-0628"],
    relatedProductSkus: ["sk-2125", "sk-0613"], // grilled cheese / fries — compare only
  },
  TRUFFLE_BURGER: {
    foodBibleTitle: "TRUFFLE BURGER, MONTERREY JACK, TRUFFLE MAYO",
    ksaOperationalTitle: "TRUFFLE BURGER, MONTERREY JACK, TRUFFLE MAYO",
    foodicsProductSkus: ["sk-0629"],
    relatedProductSkus: ["sk-2179"],
  },
});

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

export function parseFoodicsProductIngredientCsv(csvText = "") {
  const lines = String(csvText || "")
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.length);
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]).map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cols = parseCsvLine(line);
    const row = {};
    headers.forEach((h, idx) => {
      row[h] = cols[idx] == null ? "" : String(cols[idx]).trim();
    });
    return {
      productSku: row.product_sku || "",
      productName: row.product_name || "",
      productNameLocalized: row.product_name_localized || "",
      inventoryItemSku: row.inventory_item_sku || "",
      inventoryItemName: row.inventory_item_name || "",
      inventoryItemNameLocalized: row.inventory_item_name_localized || "",
      quantity: row.quantity === "" ? null : Number(row.quantity),
      unit: row.unit || "",
      ingredientCost: row.ingredient_cost === "" ? null : Number(row.ingredient_cost),
      externalSystem: "foodics",
    };
  });
}

export function parseFoodicsModifierCsv(csvText = "") {
  const lines = String(csvText || "")
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.length);
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]).map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cols = parseCsvLine(line);
    const row = {};
    headers.forEach((h, idx) => {
      row[h] = cols[idx] == null ? "" : String(cols[idx]).trim();
    });
    return {
      productName: row.product_name || "",
      productSku: row.product_sku || "",
      modifierName: row.modifier_name || "",
      modifierReference: row.modifier_reference || "",
      minimumOptions: Number(row.minimum_options || 0),
      maximumOptions: Number(row.maximum_options || 0),
      externalSystem: "foodics",
    };
  });
}

export function classifyFoodicsBrandScope(inventoryItemName = "", productName = "") {
  const text = `${inventoryItemName} ${productName}`;
  if (/\bSPT[-_]/i.test(text) || /\bSPT\b/.test(text)) {
    return { brandScope: "SPT", note: "Sum Plus Things — separate brand under same company" };
  }
  if (/\bNAC[-_]/i.test(text)) {
    return { brandScope: "NAC", note: "NAC-prefixed Foodics inventory/prep naming hint" };
  }
  if (/\bMT[-_]/i.test(text) || /\bSN[-_]/i.test(text) || /\bCart[-_]/i.test(text)) {
    return { brandScope: "BRAND_SCOPE_UNRESOLVED", note: "Unknown Foodics prefix — not auto-assigned" };
  }
  if (/trial only/i.test(text)) {
    return { brandScope: "BRAND_SCOPE_UNRESOLVED", note: "Trial-only Foodics naming" };
  }
  return { brandScope: "UNRESOLVED", note: "No explicit brand prefix" };
}

export function classifyFoodicsRecordType(inventoryItemName = "", unit = "") {
  const name = String(inventoryItemName || "");
  const lower = name.toLowerCase();
  if (/trial only/i.test(name)) return "OTHER";
  if (/\bSPT[-_]/i.test(name)) return "OTHER_BRAND_PREP_OR_ITEM";
  if (
    /pouch|box|cup|lid|straw|wooden spoon|sauce cup|burger box|plastic|packaging|can\b|btl\b|bottle/i.test(
      name
    )
  ) {
    return "PACKAGING";
  }
  if (/cleaning|chemical|saniti|detergent/i.test(name)) return "CLEANING_CHEMICAL";
  if (/equipment|consumable/i.test(name)) return "EQUIPMENT_CONSUMABLE";
  if (
    /^NAC-/i.test(name) ||
    /sauce|mayo|mayonnaise|dressing|marinade|cooking|mix|patty|dough|prep|batch|fillet/i.test(lower)
  ) {
    // NAC- prep-like or sauce/mix naming — still a candidate prep, not automatic purchased raw.
    if (/^NAC-/i.test(name)) return "PREP_SUBRECIPE";
  }
  if (/water|coca|coke|sprite|latte|espresso|tea|juice|soda|milk\b/i.test(lower) && /btl|can|ml/i.test(`${unit} ${name}`)) {
    return "BEVERAGE";
  }
  if (/cheese|beef|chicken|tomato|oil|butter|salt|lettuce|bun|onion|cream|pasta|basil|chilli|chili|olive|truffle paste|minced/i.test(lower)) {
    return "PURCHASED_INGREDIENT";
  }
  if (/^NAC-/i.test(name)) return "PREP_SUBRECIPE";
  return "UNRESOLVED";
}

export function deriveFoodicsReferenceUnitCost({ quantity, unit, ingredientCost }) {
  if (ingredientCost == null || Number.isNaN(Number(ingredientCost))) {
    return {
      status: "MISSING_OR_UNRELIABLE_COST",
      label: "LEGACY_FOODICS_REFERENCE",
      impliedUnitCost: null,
      impliedUnit: null,
    };
  }
  if (Number(ingredientCost) === 0) {
    return {
      status: "MISSING_OR_UNRELIABLE_COST",
      label: "LEGACY_FOODICS_REFERENCE",
      impliedUnitCost: null,
      impliedUnit: null,
      detail: "Foodics zero cost is not legitimate zero by default",
    };
  }
  if (quantity == null || !(Number(quantity) > 0) || !unit) {
    return {
      status: "MISSING_OR_UNRELIABLE_COST",
      label: "LEGACY_FOODICS_REFERENCE",
      impliedUnitCost: null,
      impliedUnit: null,
    };
  }
  const unitNorm = String(unit).toLowerCase();
  let qty = Number(quantity);
  let baseUnit = unitNorm;
  if (unitNorm === "gm" || unitNorm === "g") {
    baseUnit = "kg";
    qty = qty / 1000;
  } else if (unitNorm === "ml") {
    baseUnit = "litre";
    qty = qty / 1000;
  } else if (unitNorm === "pcs" || unitNorm === "pc") {
    baseUnit = "pcs";
  } else if (unitNorm === "kg" || unitNorm === "l" || unitNorm === "litre") {
    baseUnit = unitNorm === "l" ? "litre" : unitNorm;
  } else {
    return {
      status: "CONVERSION_REVIEW_REQUIRED",
      label: "LEGACY_FOODICS_REFERENCE",
      impliedUnitCost: null,
      impliedUnit: null,
      detail: `Unsupported Foodics unit for deterministic normalization: ${unit}`,
    };
  }
  return {
    status: "FOODICS_REFERENCE_COST",
    label: "LEGACY_FOODICS_REFERENCE",
    impliedUnitCost: Number(ingredientCost) / qty,
    impliedUnit: baseUnit,
    sourceQuantity: Number(quantity),
    sourceUnit: unit,
    sourceIngredientCost: Number(ingredientCost),
  };
}

function findRecipeByTitle(recipes = [], title = "") {
  const want = normalizeFoodBibleText(title).toUpperCase();
  return recipes.find((r) => {
    const a = normalizeFoodBibleText(r.sourceTitle || "").toUpperCase();
    const b = normalizeFoodBibleText(r.ksaOperationalTitle || "").toUpperCase();
    return a === want || b === want;
  });
}

function foodBibleLinesForShortlist(recipes = [], finishedTitle, dependencies = []) {
  const finished = findRecipeByTitle(recipes, finishedTitle);
  if (!finished) return { finished: null, preps: [], lines: [] };
  const file = finished.sourceFile;
  const sameFilePreps = recipes.filter((r) => r.sourceFile === file && r.recipeKind === "prep");

  // Pull explicit shortlist dependency preps (e.g. TOMATO SAUCE, SWEET CORN) by title.
  const depPrepTitles = (dependencies || [])
    .filter((d) => normalizeFoodBibleText(d.finished || "").toUpperCase() === finishedTitle.toUpperCase())
    .map((d) => d.prep)
    .filter(Boolean);

  const depPreps = [];
  for (const prepTitle of depPrepTitles) {
    const prep = recipes.find(
      (r) =>
        r.recipeKind === "prep" &&
        (normalizeFoodBibleText(r.sourceTitle || "").toUpperCase() ===
          normalizeFoodBibleText(prepTitle).toUpperCase() ||
          normalizeFoodBibleText(r.ksaOperationalTitle || "").toUpperCase() ===
            normalizeFoodBibleText(prepTitle).toUpperCase())
    );
    if (!prep) continue;
    // Skip weak false positives (e.g. Halloumi Za'atar → Honey Za'atar Dressing).
    if (finishedTitle === "HALLOUMI" && /honey za/i.test(prep.sourceTitle || "")) continue;
    if (!sameFilePreps.includes(prep) && !depPreps.includes(prep)) depPreps.push(prep);
  }

  const preps = [...sameFilePreps, ...depPreps];
  const lines = [];
  for (const recipe of [finished, ...preps]) {
    for (const ing of recipe.ksaIngredients || recipe.ingredients || []) {
      lines.push({
        recipeKind: recipe.recipeKind,
        recipeTitle: recipe.ksaOperationalTitle || recipe.sourceTitle,
        sourceTitle: recipe.sourceTitle,
        sourceName: ing.sourceName || ing.ksaOperationalName,
        ksaOperationalName: ing.ksaOperationalName || ing.sourceName,
        quantity: ing.sourceQuantity ?? null,
        unit: ing.sourceUnit ?? null,
        canonicalQuantity: ing.canonicalQuantity ?? null,
        canonicalUnit: ing.canonicalUnit ?? null,
        sourceFile: recipe.sourceFile,
      });
    }
  }
  return { finished, preps, lines };
}

function hasPhrase(haystack, phrase) {
  const h = ` ${normalizeText(haystack)} `;
  const p = normalizeText(phrase);
  if (!p) return false;
  return h.includes(` ${p} `);
}

function matchScore(bibleName, foodicsName) {
  const left = normalizeText(bibleName);
  const right = normalizeText(foodicsName);
  if (!left || !right) return 0;
  if (left === right) return 100;
  // Prefer precise prep aliases before broader includes.
  const aliasGroups = [
    { score: 96, names: ["cajun sauce", "nac cajun sauce", "cajun chicken sauce"], require: "sauce" },
    { score: 95, names: ["cajun chicken fillet", "nac cajun chicken", "cajun chicken"], forbid: "sauce" },
    { score: 90, names: ["truffle mayonnaise", "nac truffle mayonnaise", "truffle mayo"] },
    { score: 90, names: ["truffle salad dressing", "nac truffle salad dressing"] },
    { score: 90, names: ["sweet corn", "nac sweet corn"] },
    { score: 90, names: ["tomato sauce", "nac tomato sauce", "nac tomato sauce mix"] },
    { score: 90, names: ["rigatoni pasta", "pasta cooking rigatoni", "nac pasta cooking"] },
    { score: 88, names: ["parmigiano", "parmesan", "parmigianno", "parmesan cheese"] },
    { score: 88, names: ["minced beef", "beef minced"] },
    { score: 88, names: ["monterey jack", "monterrey jack", "monterey jack cheese"] },
    { score: 88, names: ["little gem lettuce", "lettuce baby gem", "baby gem"] },
    { score: 88, names: ["plant based burger bun", "burger bun regular", "burger bun"] },
    { score: 88, names: ["halloumi", "halloumi cheese"] },
    { score: 85, names: ["zaatar", "za atar", "zaatar spice"] },
    { score: 85, names: ["extra virgin olive oil"] },
    { score: 80, names: ["olive oil"] },
    { score: 85, names: ["unsalted butter", "butter unsalted"] },
    { score: 70, names: ["butter"] },
    { score: 85, names: ["chilli flakes", "chili flakes"] },
    { score: 80, names: ["iodized table salt", "table salt"] },
    { score: 75, names: ["sea salt", "smoked sea salt"] },
    { score: 60, names: ["salt"] },
    { score: 80, names: ["onion chives", "chives"] },
    { score: 75, names: ["tomato red", "tomatoes", "tomato"] },
  ];
  for (const group of aliasGroups) {
    if (group.require && (!left.includes(group.require) || !right.includes(group.require))) {
      // require applies to the bible/foodics pair when set on sauce-like groups
    }
    if (group.forbid && (left.includes(group.forbid) || right.includes(group.forbid))) continue;
    if (group.require) {
      const leftOk = left.includes(group.require);
      const rightOk = right.includes(group.require);
      if (!(leftOk && rightOk)) {
        // Allow bible "cajun chicken sauce" vs foodics "nac cajun sauce"
        if (!(leftOk || rightOk)) continue;
      }
    }
    const leftHit = group.names.some((g) => hasPhrase(left, g) || left === normalizeText(g));
    const rightHit = group.names.some((g) => hasPhrase(right, g) || right === normalizeText(g));
    if (leftHit && rightHit) return group.score;
  }
  if (left.includes(right) || right.includes(left)) {
    // Penalize weak substring hits like "cajun" across sauce vs chicken.
    if (left.includes("sauce") !== right.includes("sauce")) return 20;
    if (left.includes("chicken") !== right.includes("chicken") && left.includes("cajun")) return 25;
    return 55;
  }
  return 0;
}

function namesCloselyMatch(a, b) {
  return matchScore(a, b) >= 55;
}

function classifyDuplicatePair(aName, bName) {
  const a = normalizeText(aName);
  const b = normalizeText(bName);
  if (a === b) return "LIKELY_DUPLICATE";
  if (a.includes("tomato sauce") && b.includes("tomato sauce")) return "LIKELY_DUPLICATE";
  if ((a.includes("sea salt") || a.includes("table salt") || a === "salt") &&
      (b.includes("sea salt") || b.includes("table salt") || b === "salt")) {
    return "POSSIBLE_DUPLICATE";
  }
  if ((a.includes("olive oil") && b.includes("olive oil")) || (a.includes("butter") && b.includes("butter"))) {
    return "POSSIBLE_DUPLICATE";
  }
  if ((a.includes("monterey") || a.includes("provolone")) && (b.includes("monterey") || b.includes("provolone"))) {
    return "LIKELY_DISTINCT";
  }
  if ((a.includes("olive oil") || a.includes("soya")) && (b.includes("olive oil") || b.includes("soya"))) {
    return "LIKELY_DISTINCT";
  }
  if ((a.includes("truffle") && b.includes("truffle")) || (a.includes("tartufo") && b.includes("truffle"))) {
    return "POSSIBLE_DUPLICATE";
  }
  if (/\bspt\b/.test(a) !== /\bspt\b/.test(b) && namesCloselyMatch(aName, bName)) {
    return "OTHER_BRAND_VARIANT";
  }
  return "UNRESOLVED";
}

function classifyModifierStockEffect(modifierName = "") {
  const name = String(modifierName || "").toLowerCase();
  if (!name) return "REVIEW_REQUIRED";
  if (/cook option|steak cook|eggs cook|egg option/i.test(name)) return "REVIEW_REQUIRED";
  if (/burger slice|extra patty|add on|add-on/i.test(name)) return "REVIEW_REQUIRED";
  if (/with ice|none\b|syrup option|milk & syrup/i.test(name)) return "CHOICE_ONLY";
  return "REVIEW_REQUIRED";
}

export function reconcileShortlistWithFoodics({
  recipes = [],
  foodicsRows = [],
  modifierRows = [],
  dependencies = [],
} = {}) {
  const groups = [];
  const allShortlistSkus = new Set();
  Object.values(SHORTLIST_FOODICS_PRODUCTS).forEach((cfg) => {
    cfg.foodicsProductSkus.forEach((s) => allShortlistSkus.add(s));
    (cfg.relatedProductSkus || []).forEach((s) => allShortlistSkus.add(s));
  });

  const relevantFoodics = foodicsRows.filter((r) => allShortlistSkus.has(r.productSku));
  // Cost consistency across ALL Foodics rows for the same inventory SKU (not only shortlist products).
  const foodicsByInventory = new Map();
  for (const row of foodicsRows) {
    const key = row.inventoryItemSku || normalizeText(row.inventoryItemName);
    if (!foodicsByInventory.has(key)) foodicsByInventory.set(key, []);
    foodicsByInventory.get(key).push(row);
  }

  const foodicsCostInconsistencies = [];
  for (const [sku, rows] of foodicsByInventory.entries()) {
    const shortlistTouch = rows.some((r) => allShortlistSkus.has(r.productSku));
    if (!shortlistTouch) continue;
    const refs = rows
      .map((r) => deriveFoodicsReferenceUnitCost(r))
      .filter((r) => r.status === "FOODICS_REFERENCE_COST" && r.impliedUnitCost != null);
    if (refs.length < 2) continue;
    const values = refs.map((r) => Number(r.impliedUnitCost.toFixed(6)));
    const min = Math.min(...values);
    const max = Math.max(...values);
    if (min > 0 && (max - min) / min > 0.15) {
      foodicsCostInconsistencies.push({
        inventoryItemSku: sku,
        inventoryItemName: rows[0].inventoryItemName,
        minImplied: min,
        maxImplied: max,
        samples: refs.slice(0, 5),
        code: "FOODICS_COST_INCONSISTENCY",
      });
    }
  }

  for (const [key, cfg] of Object.entries(SHORTLIST_FOODICS_PRODUCTS)) {
    const bible = foodBibleLinesForShortlist(recipes, cfg.foodBibleTitle, dependencies);
    const productRows = foodicsRows.filter((r) =>
      [...cfg.foodicsProductSkus, ...(cfg.relatedProductSkus || [])].includes(r.productSku)
    );
    const primaryRows = foodicsRows.filter((r) => cfg.foodicsProductSkus.includes(r.productSku));

    const reconciliations = [];
    const usedFoodics = new Set();

    for (const line of bible.lines) {
      const scored = productRows
        .map((r) => ({
          row: r,
          score: Math.max(
            matchScore(line.ksaOperationalName, r.inventoryItemName),
            matchScore(line.sourceName, r.inventoryItemName)
          ),
        }))
        .filter((x) => x.score >= 55)
        .sort((a, b) => b.score - a.score);
      const best = scored[0]?.row || null;
      const bestScore = scored[0]?.score || 0;
      if (best) usedFoodics.add(`${best.productSku}::${best.inventoryItemSku}::${best.quantity}`);

      const brand = classifyFoodicsBrandScope(best?.inventoryItemName || "", best?.productName || "");
      const foodicsType = best ? classifyFoodicsRecordType(best.inventoryItemName, best.unit) : null;
      const bibleIsPrepIdentity =
        isLikelyPrepName(line.ksaOperationalName) || isLikelyPrepName(line.sourceName);
      const recordType = foodicsType
        || (bibleIsPrepIdentity ? "PREP_SUBRECIPE" : "PURCHASED_INGREDIENT");

      let sourceConflict = null;
      // Only compare finished-portion Foodics qty vs Food Bible finished-line qty.
      // Prep batch lines vs finished Foodics portion lines are not directly comparable.
      if (best && line.recipeKind === "finished" && line.quantity != null && best.quantity != null) {
        const bibleUnit = String(line.unit || "").toLowerCase();
        const foodicsUnit = String(best.unit || "").toLowerCase().replace("gm", "g");
        const comparable =
          (bibleUnit === foodicsUnit) ||
          (bibleUnit === "g" && foodicsUnit === "g") ||
          (bibleUnit === "ml" && foodicsUnit === "ml");
        if (comparable && Math.abs(Number(line.quantity) - Number(best.quantity)) > 0.001) {
          sourceConflict = {
            code: "SOURCE_RECIPE_CONFLICT",
            foodBibleQty: line.quantity,
            foodBibleUnit: line.unit,
            foodicsQty: best.quantity,
            foodicsUnit: best.unit,
            detail: "Food Bible quantity differs from Foodics mapped quantity — Food Bible remains authoritative for recipe definition",
          };
        }
      }

      const refCost = best ? deriveFoodicsReferenceUnitCost(best) : null;
      const confidence =
        best && bestScore >= 88 && !sourceConflict
          ? "HIGH"
          : best && bestScore >= 55
            ? "MEDIUM"
            : "LOW";

      let action = "HUMAN_REVIEW_REQUIRED";
      if (brand.brandScope === "SPT") action = "OTHER_BRAND_REFERENCE";
      else if (recordType === "PACKAGING") action = "PACKAGING_REFERENCE";
      else if (recordType === "PREP_SUBRECIPE" || bibleIsPrepIdentity) action = "CREATE_PREP_CANDIDATE";
      else if (recordType === "PURCHASED_INGREDIENT") action = "CREATE_CANONICAL_CANDIDATE";
      else if (!best) action = "HUMAN_REVIEW_REQUIRED";

      reconciliations.push({
        foodBibleSourceName: line.sourceName,
        ksaOperationalName: line.ksaOperationalName,
        recordType: bibleIsPrepIdentity || recordType === "PREP_SUBRECIPE"
          ? "PREP_SUBRECIPE"
          : recordType === "PACKAGING"
            ? "PACKAGING"
            : "PURCHASED_INGREDIENT",
        recipeContext: line.recipeTitle,
        foodicsSourceName: best?.inventoryItemName || null,
        foodicsProductSku: best?.productSku || null,
        foodicsInventorySku: best?.inventoryItemSku || null,
        foodicsQty: best?.quantity ?? null,
        foodicsUnit: best?.unit || null,
        foodicsIngredientCost: best?.ingredientCost ?? null,
        foodicsReferenceCost: refCost,
        proposedNacCanonicalName: line.ksaOperationalName,
        proposedBaseUnit: normalizeCanonicalUnit(line.unit, line.quantity || 1).canonicalUnit,
        brandScope: brand.brandScope,
        branchEvidence: "Khobar target; no trusted July culinary ledger yet",
        foodBibleMatch: true,
        foodicsMatch: Boolean(best),
        sourceConflict,
        costStatus: refCost?.status || "NO_JULY_COST",
        confidence,
        action,
        externalRefs: best
          ? {
              external_system: "foodics",
              external_product_sku: best.productSku,
              external_inventory_item_sku: best.inventoryItemSku,
            }
          : null,
      });
    }

    // Foodics-only lines on primary product not matched to Food Bible
    for (const row of primaryRows) {
      const key = `${row.productSku}::${row.inventoryItemSku}::${row.quantity}`;
      if (usedFoodics.has(key)) continue;
      const brand = classifyFoodicsBrandScope(row.inventoryItemName, row.productName);
      const recordType = classifyFoodicsRecordType(row.inventoryItemName, row.unit);
      const refCost = deriveFoodicsReferenceUnitCost(row);
      reconciliations.push({
        foodBibleSourceName: null,
        ksaOperationalName: null,
        recordType,
        recipeContext: cfg.ksaOperationalTitle,
        foodicsSourceName: row.inventoryItemName,
        foodicsProductSku: row.productSku,
        foodicsInventorySku: row.inventoryItemSku,
        foodicsQty: row.quantity,
        foodicsUnit: row.unit,
        foodicsIngredientCost: row.ingredientCost,
        foodicsReferenceCost: refCost,
        proposedNacCanonicalName: row.inventoryItemName?.replace(/^NAC-/i, "") || null,
        proposedBaseUnit: null,
        brandScope: brand.brandScope,
        branchEvidence: "Khobar target; Foodics-only line",
        foodBibleMatch: false,
        foodicsMatch: true,
        sourceConflict: {
          code: "SOURCE_RECIPE_CONFLICT",
          detail: "Present in Foodics product mapping but not extracted from Food Bible shortlist lines",
        },
        costStatus: refCost.status,
        confidence: "LOW",
        action:
          brand.brandScope === "SPT"
            ? "OTHER_BRAND_REFERENCE"
            : recordType === "PACKAGING"
              ? "PACKAGING_REFERENCE"
              : recordType === "PREP_SUBRECIPE"
                ? "CREATE_PREP_CANDIDATE"
                : "HUMAN_REVIEW_REQUIRED",
        externalRefs: {
          external_system: "foodics",
          external_product_sku: row.productSku,
          external_inventory_item_sku: row.inventoryItemSku,
        },
      });
    }

    const modifiers = modifierRows
      .filter((m) => cfg.foodicsProductSkus.includes(m.productSku))
      .map((m) => ({
        ...m,
        stockEffectClass: classifyModifierStockEffect(m.modifierName),
      }));

    groups.push({
      shortlistKey: key,
      foodBibleTitle: cfg.foodBibleTitle,
      ksaOperationalTitle: cfg.ksaOperationalTitle,
      foodicsProductSkus: cfg.foodicsProductSkus,
      foodBibleFinishedFound: Boolean(bible.finished),
      foodBiblePrepCount: bible.preps.length,
      foodicsPrimaryRowCount: primaryRows.length,
      foodicsRelatedRowCount: productRows.length - primaryRows.length,
      reconciliations,
      modifiers,
      quantityConflicts: reconciliations.filter((r) => r.sourceConflict?.code === "SOURCE_RECIPE_CONFLICT" && r.foodBibleMatch && r.foodicsMatch),
    });
  }

  const purchased = [];
  const preps = [];
  const otherBrand = [];
  const packaging = [];
  const duplicates = [];

  for (const group of groups) {
    for (const row of group.reconciliations) {
      if (row.brandScope === "SPT" || row.action === "OTHER_BRAND_REFERENCE") otherBrand.push(row);
      else if (row.recordType === "PACKAGING" || row.action === "PACKAGING_REFERENCE") packaging.push(row);
      else if (row.recordType === "PREP_SUBRECIPE" || row.action === "CREATE_PREP_CANDIDATE") preps.push(row);
      else if (row.recordType === "PURCHASED_INGREDIENT" || row.action === "CREATE_CANONICAL_CANDIDATE") {
        purchased.push(row);
      }
    }
  }

  // duplicate signals among Foodics inventory names on shortlist
  const knownDuplicateHints = [
    ["NAC-Tomato Sauce", "NAC-Tomato Sauce mix"],
    ["Sea Salt (Maldon)", "Smoked Sea Salt (Maldon)", "Iodized Table Salt"],
    ["Monterey Jack Cheese", "Provolone Cheese"],
    ["Extra Virgin Olive Oil", "Soya OIl (Frying OIl)"],
    ["Unsalted Butter", "Butter"],
  ];
  for (const group of knownDuplicateHints) {
    const present = group.filter((name) =>
      relevantFoodics.some((r) => normalizeText(r.inventoryItemName) === normalizeText(name))
    );
    // Also catch olive oil via looser presence
    const presentLoose = group.filter((name) =>
      relevantFoodics.some((r) => matchScore(name, r.inventoryItemName) >= 80)
    );
    const list = [...new Set([...present, ...presentLoose])];
    if (list.length >= 2) {
      for (let i = 0; i < list.length; i += 1) {
        for (let j = i + 1; j < list.length; j += 1) {
          duplicates.push({
            left: list[i],
            right: list[j],
            classification: classifyDuplicatePair(list[i], list[j]),
            code: "POSSIBLE_DUPLICATE_OR_LEGACY_CLUTTER",
          });
        }
      }
    }
  }

  return {
    productionMutation: false,
    salesApproval: "NOT_IN_SCOPE",
    evidencePolicy: {
      foodicsRole: "EXTERNAL_LEGACY_EVIDENCE",
      recipeAuthority: "FOOD_BIBLE_FIRST",
      costAuthority: "NAC_LEDGER_THEN_APPROVED_KHOBAR_EVIDENCE; Foodics is LEGACY_FOODICS_REFERENCE only",
      zeroCostRule: "Foodics zero != legitimate zero",
      brandRule: "SPT is separate brand; unknown prefixes BRAND_SCOPE_UNRESOLVED",
    },
    summary: {
      shortlistDishes: groups.length,
      relevantFoodicsRows: relevantFoodics.length,
      purchasedIngredientCandidates: purchased.length,
      prepSubrecipeCandidates: preps.length,
      otherBrandReferences: otherBrand.length,
      packagingReferences: packaging.length,
      quantityConflicts: groups.reduce((n, g) => n + g.quantityConflicts.length, 0),
      foodicsCostInconsistencies: foodicsCostInconsistencies.length,
      duplicateSignals: duplicates.length,
    },
    groups,
    purchasedIngredientCandidates: purchased,
    prepSubrecipeCandidates: preps,
    otherBrandReferences: otherBrand,
    packagingReferences: packaging,
    foodicsCostInconsistencies,
    possibleDuplicates: duplicates,
    readyForApproval: [],
    remainingHumanConfirmations: [
      "Confirm Food Bible quantities where Foodics conflicts (Food Bible wins for recipe definition)",
      "Upload/approve real Khobar July purchase or item-cost evidence before TRUSTED_JULY_COST",
      "Confirm Halloumi vs Grilled Halloumi vs Halloumi Fries separation",
      "Confirm olive oil / butter / truffle-paste duplicate decisions",
      "Confirm Truffle Burger modifier stock effects (Steak Cook Option, Burger slice)",
      "Keep Mirin/Miso and vodka KSA policy unchanged",
      "Do not import SPT/MT/SN/Cart Foodics rows into NAC",
    ],
    realKhobarPurchaseCostStillRequired: true,
  };
}

function isLikelyPrepName(name = "") {
  return /sauce|mayo|mayonnaise|dressing|marinade|cooking|mix|patty|fillet|sweet corn/i.test(
    String(name)
  );
}
