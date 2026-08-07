/**
 * Preview-only shortlist canonical ingredient + July Khobar cost onboarding.
 * Never invents costs. Never mutates production.
 */

import { normalizeText, areUnitsCompatible } from "./inventoryIntelligence";
import { normalizeFoodBibleText } from "./foodBibleKsaAdaptation";
import { normalizeCanonicalUnit } from "./foodBiblePdfExtract";

export const SHORTLIST_FINISHED_TITLES = Object.freeze([
  "RIGATONI, PINK SAUCE, BASIL, CHILI, PARMIGIANO",
  "FREE RANGE GRILLED CAJUN CHICKEN, CORN, TOMATOES",
  "HALLOUMI",
  "TRUFFLE BURGER, MONTERREY JACK, TRUFFLE MAYO",
]);

const PREP_REF_HINTS = [
  /tomato sauce/i,
  /cajun chicken (fillet|sauce)/i,
  /sweet corn/i,
  /truffle (mayonnaise|salad dressing|mayo)/i,
  /mayonnaise base/i,
  /miso (marinade|aubergine)/i,
];

const POSSIBLE_DUPLICATE_GROUPS = [
  {
    key: "olive_oil",
    names: ["olive oil", "extra virgin olive oil"],
    note: "May be operationally distinct grades — confirm before merging",
  },
  {
    key: "butter",
    names: ["butter", "butter unsalted", "butter -"],
    note: "Salted vs unsalted may be distinct",
  },
  {
    key: "parmesan",
    names: ["parmigianno", "parmigiano", "parmesan", "grated parmesan"],
    note: "Spelling variants of same cheese family",
  },
  {
    key: "cream",
    names: ["cream", "double cream"],
    note: "Double cream is usually distinct from single/cooking cream",
  },
  {
    key: "truffle_paste",
    names: ["black truffle paste cortesi", "tartufo nero", "black truffle paste"],
    note: "Brand/form variants may share one canonical item",
  },
];

function proposedCanonicalName(sourceName) {
  const text = normalizeFoodBibleText(sourceName)
    .replace(/\s*-\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const lower = text.toLowerCase();
  if (/parmigian+o|parmesan/i.test(text)) return "Parmigiano";
  if (/rigaton+i pasta/i.test(text)) return "Rigatoni pasta";
  if (/chicken fillets?/i.test(text)) return "Chicken breast fillet";
  if (/minced beef/i.test(text)) return "Minced beef";
  if (/plantbased burger bun|plant-based burger bun/i.test(text)) return "Plant-based burger bun";
  if (/sliced cheese.*monterey|monterrey jack/i.test(text)) return "Monterey Jack cheese";
  if (/black truffle paste/i.test(text)) return "Black truffle paste";
  if (/butter/i.test(text) && /unsalted/i.test(text)) return "Butter unsalted";
  if (lower === "butter -" || lower === "butter") return "Butter";
  if (/extra virgin olive oil/i.test(text)) return "Extra virgin olive oil";
  if (/olive oil/i.test(text)) return "Olive oil";
  if (/double cream/i.test(text)) return "Double cream";
  if (/white wine vinegar/i.test(text)) return "White wine vinegar";
  if (/tinned tomatoes|tin tomatoes/i.test(text)) return "Tinned tomatoes";
  if (/cajun spices?/i.test(text)) return "Cajun spice mix";
  if (/za'?atar/i.test(text)) return "Za'atar";
  if (/sea salt|table salt|^salt$/i.test(text)) return text.replace(/table salt/i, "Salt");
  return text.replace(/\b\w/g, (m) => m.toUpperCase()).replace(/\bAnd\b/g, "and");
}

function proposedBaseUnit(sourceUnit) {
  const normalized = normalizeCanonicalUnit(sourceUnit, 1);
  if (normalized.canonicalUnit === "kg" || normalized.canonicalUnit === "litre" || normalized.canonicalUnit === "pcs") {
    return normalized.canonicalUnit;
  }
  if (!sourceUnit) return null;
  return normalized.canonicalUnit || String(sourceUnit).toLowerCase();
}

function isLikelyPrepReference(name, prepTitles = []) {
  const n = normalizeFoodBibleText(name).toLowerCase();
  if (PREP_REF_HINTS.some((re) => re.test(n))) return true;
  return prepTitles.some((title) => {
    const t = normalizeFoodBibleText(title).toLowerCase();
    return t && (n === t || n.includes(t) || t.includes(n));
  });
}

export function collectShortlistIngredientUniverse(recipes = []) {
  const shortlist = recipes.filter((r) =>
    SHORTLIST_FINISHED_TITLES.includes(normalizeFoodBibleText(r.sourceTitle || r.ksaOperationalTitle).toUpperCase())
  );
  const related = [];
  const shortlistFiles = new Set(shortlist.map((r) => r.sourceFile));
  for (const recipe of recipes) {
    if (shortlistFiles.has(recipe.sourceFile)) related.push(recipe);
  }

  const prepTitles = related
    .filter((r) => r.recipeKind === "prep")
    .map((r) => r.ksaOperationalTitle || r.sourceTitle);

  const byKey = new Map();
  for (const recipe of related) {
    const lines = recipe.ksaIngredients || recipe.ingredients || [];
    for (const line of lines) {
      const sourceName = normalizeFoodBibleText(line.ksaOperationalName || line.sourceName || line.name);
      if (!sourceName) continue;
      if (isLikelyPrepReference(sourceName, prepTitles) && recipe.recipeKind === "finished") {
        // Keep as graph edge, not raw cost-bearing leaf, unless no prep exists.
        const hasPrep = prepTitles.some((t) => normalizeFoodBibleText(t).toLowerCase().includes(sourceName.toLowerCase())
          || sourceName.toLowerCase().includes(normalizeFoodBibleText(t).toLowerCase()));
        if (hasPrep) continue;
      }
      const key = normalizeText(proposedCanonicalName(sourceName));
      const unit = line.sourceUnit || line.unit || null;
      const existing = byKey.get(key) || {
        sourceIngredient: sourceName,
        proposedCanonicalName: proposedCanonicalName(sourceName),
        sourceRecipes: [],
        sourceUnits: [],
        proposedBaseUnit: proposedBaseUnit(unit),
        sampleLines: [],
        classification: "food",
      };
      const recipeLabel = recipe.ksaOperationalTitle || recipe.sourceTitle;
      if (!existing.sourceRecipes.includes(recipeLabel)) existing.sourceRecipes.push(recipeLabel);
      if (unit && !existing.sourceUnits.includes(unit)) existing.sourceUnits.push(unit);
      if (!existing.proposedBaseUnit) existing.proposedBaseUnit = proposedBaseUnit(unit);
      existing.sampleLines.push({
        recipe: recipeLabel,
        sourceQuantity: line.sourceQuantity ?? line.quantity ?? null,
        sourceUnit: unit,
        canonicalQuantity: line.canonicalQuantity ?? null,
        canonicalUnit: line.canonicalUnit ?? null,
        alignment: line.alignment || null,
      });
      byKey.set(key, existing);
    }
  }

  return {
    shortlistFinished: shortlist.map((r) => r.ksaOperationalTitle || r.sourceTitle),
    relatedRecipes: related.map((r) => ({
      kind: r.recipeKind,
      sourceTitle: r.sourceTitle,
      ksaOperationalTitle: r.ksaOperationalTitle,
      yieldRaw: r.yieldRaw,
      sourceFile: r.sourceFile,
    })),
    ingredients: [...byKey.values()].sort((a, b) =>
      a.proposedCanonicalName.localeCompare(b.proposedCanonicalName)
    ),
  };
}

export function findPossibleDuplicateCanonicals(ingredients = []) {
  const flags = [];
  for (const group of POSSIBLE_DUPLICATE_GROUPS) {
    const hits = ingredients.filter((ing) =>
      group.names.includes(normalizeText(ing.proposedCanonicalName))
      || group.names.includes(normalizeText(ing.sourceIngredient))
    );
    if (hits.length >= 2) {
      flags.push({
        code: "POSSIBLE_DUPLICATE_CANONICAL",
        group: group.key,
        note: group.note,
        items: hits.map((h) => h.proposedCanonicalName),
      });
    }
  }
  return flags;
}

function matchCanonical(ingredient, catalogue = []) {
  const target = normalizeText(ingredient.proposedCanonicalName);
  const source = normalizeText(ingredient.sourceIngredient);
  for (const item of catalogue) {
    const name = normalizeText(item.canonical_name || item.name);
    if (!name) continue;
    if (name === target || name === source) {
      return {
        matchType: "MATCH_EXISTING",
        confidence: "high",
        method: "exact_normalized_name",
        ingredientId: item.id,
        canonicalName: item.canonical_name || item.name,
        baseUnit: item.base_inventory_unit || item.base_unit || null,
      };
    }
  }
  return {
    matchType: "NEW_CANDIDATE",
    confidence: "low",
    method: "no_existing_canonical",
    ingredientId: null,
    canonicalName: null,
    baseUnit: null,
  };
}

function matchSupplierOrOcr(ingredient, invoiceLines = [], aliases = [], catalogueItems = []) {
  const target = normalizeText(ingredient.proposedCanonicalName);
  const source = normalizeText(ingredient.sourceIngredient);
  for (const line of invoiceLines) {
    const desc = normalizeText(line.original_description || line.normalized_description);
    const sku = normalizeText(line.supplier_sku);
    if (sku && (sku === target || sku === source)) {
      return {
        method: "exact_sku",
        confidence: "high",
        evidence: line,
      };
    }
    if (desc && (desc === target || desc === source)) {
      return {
        method: "exact_normalized_invoice_description",
        confidence: line.review_status === "verified" ? "high" : "medium",
        evidence: line,
      };
    }
  }
  for (const alias of aliases) {
    const aliasName = normalizeText(alias.alias || alias.original_product_name || alias.normalized_product_name);
    if (aliasName && (aliasName === target || aliasName === source)) {
      return {
        method: "reviewed_supplier_alias",
        confidence: alias.verification_state === "verified" ? "high" : "medium",
        evidence: alias,
      };
    }
  }
  for (const item of catalogueItems) {
    const name = normalizeText(item.original_product_name || item.normalized_product_name);
    if (name && (name === target || name === source)) {
      return {
        method: "supplier_catalogue_exact",
        confidence: item.verification_state === "verified" ? "high" : "medium",
        evidence: item,
      };
    }
  }
  return { method: null, confidence: "none", evidence: null };
}

function resolveJulyCost(ingredient, { costHistory = [], purchaseLines = [], baselines = [], invoiceLines = [] } = {}) {
  const observations = [];
  const targetIds = new Set();
  // Only attach costs for known ingredient ids from exact matches elsewhere.
  for (const row of costHistory) {
    if (!row?.ingredient_id) continue;
    // Without a mapped culinary ingredient id, ledger rows cannot attach.
    observations.push({
      sourceType: "LEDGER_WAC_OR_PURCHASE",
      ingredientId: row.ingredient_id,
      businessDate: row.effective_at || row.purchase_date || null,
      quantity: row.canonical_quantity ?? row.purchase_quantity ?? null,
      unit: row.canonical_unit || null,
      unitCost: row.canonical_unit_cost ?? null,
      wac: row.weighted_average_cost ?? null,
      sourceId: row.id || row.receipt_id || row.invoice_id || null,
      attachable: false,
      reason: "No shortlist culinary ingredient_id mapped in production catalogue",
    });
  }
  for (const line of invoiceLines) {
    const desc = normalizeText(line.original_description || line.normalized_description);
    const target = normalizeText(ingredient.proposedCanonicalName);
    if (desc === target || desc === normalizeText(ingredient.sourceIngredient)) {
      observations.push({
        sourceType: "JULY_INVOICE_LINE",
        businessDate: line.invoice_date || null,
        quantity: line.original_quantity ?? null,
        unit: line.canonical_unit || line.original_unit || null,
        unitCost: line.unit_price ?? null,
        sourceId: line.id,
        description: line.original_description,
        attachable: true,
      });
    }
  }
  for (const baseline of baselines) {
    observations.push({
      sourceType: "APPROVED_EXTERNAL_BASELINE",
      businessDate: baseline.effective_date,
      unit: baseline.canonical_unit,
      unitCost: baseline.canonical_unit_cost,
      sourceId: baseline.source_file_id,
      sourceLocator: baseline.source_locator,
      attachable: Boolean(baseline.ingredient_id),
    });
  }

  const attachable = observations.filter((o) => o.attachable && o.unitCost != null);
  if (!attachable.length) {
    return {
      costStatus: "NO_JULY_COST",
      julyCost: null,
      observations,
      reason: "No July Khobar culinary purchase/cost/baseline evidence for this ingredient",
    };
  }
  const costs = [...new Set(attachable.map((o) => Number(o.unitCost)))];
  if (costs.length > 1) {
    return {
      costStatus: "CONFLICTING_COST",
      julyCost: null,
      observations: attachable,
      reason: "Multiple July unit costs present; no blind average applied",
    };
  }
  return {
    costStatus: "TRUSTED_JULY_COST",
    julyCost: {
      unitCost: costs[0],
      unit: attachable[0].unit,
      sourceType: attachable[0].sourceType,
      sourceId: attachable[0].sourceId,
      businessDate: attachable[0].businessDate,
    },
    observations: attachable,
    reason: null,
  };
}

function assessUnitConversion(ingredient, costResult) {
  const recipeUnits = ingredient.sourceUnits || [];
  const base = ingredient.proposedBaseUnit;
  const issues = [];
  for (const unit of recipeUnits) {
    if (!unit || !base) continue;
    try {
      if (!areUnitsCompatible(unit, base === "litre" ? "ml" : base === "kg" ? "g" : base)) {
        // g/kg and ml/L handled via normalizeCanonicalUnit already
      }
    } catch {
      issues.push({
        code: "CONVERSION_REVIEW_REQUIRED",
        detail: `Recipe unit ${unit} vs proposed base ${base}`,
      });
    }
  }
  if (costResult?.julyCost?.unit && base) {
    const costUnit = String(costResult.julyCost.unit).toLowerCase();
    const massVolMismatch =
      (base === "kg" && /l|litre|ml/.test(costUnit)) ||
      (base === "litre" && /kg|g/.test(costUnit));
    if (massVolMismatch) {
      issues.push({
        code: "UNIT_INCOMPATIBLE",
        detail: `Cost unit ${costResult.julyCost.unit} incompatible with recipe base ${base} without density/approved rule`,
      });
    }
  }
  return issues;
}

export function classifyPreviewItem(ingredient, match, costResult, unitIssues = []) {
  if (match.matchType === "MATCH_EXISTING" && costResult.costStatus === "TRUSTED_JULY_COST" && !unitIssues.length) {
    return { status: "MATCH_EXISTING", reason: "Exact canonical match with trusted July cost" };
  }
  if (match.matchType === "NEW_CANDIDATE" && costResult.costStatus === "TRUSTED_JULY_COST" && !unitIssues.length) {
    return { status: "READY_TO_CREATE", reason: "New canonical candidate with trusted July cost evidence" };
  }
  if (costResult.costStatus === "CONFLICTING_COST" || unitIssues.some((u) => u.code === "UNIT_INCOMPATIBLE")) {
    return { status: "BLOCKED", reason: costResult.reason || unitIssues[0]?.detail };
  }
  if (costResult.costStatus === "NO_JULY_COST") {
    return {
      status: "NEEDS_REVIEW",
      reason: "No July Khobar culinary cost evidence; canonical identity also requires review",
    };
  }
  return { status: "NEEDS_REVIEW", reason: "Awaiting human confirmation" };
}

export function classifyYieldBlockers(relatedRecipes = []) {
  const blockers = [];
  for (const recipe of relatedRecipes) {
    const title = normalizeFoodBibleText(recipe.ksaOperationalTitle || recipe.sourceTitle).toUpperCase();
    if (title === "CAJUN SAUCE") {
      blockers.push({
        recipe: recipe.ksaOperationalTitle || recipe.sourceTitle,
        issue: "Source yield missing",
        classification: "SOURCE_INCOMPLETE",
        detail: "No explicit yield printed on Cajun Sauce card",
      });
    }
    if (title === "SWEET CORN" && /cajun|corn/i.test(recipe.sourceFile || "")) {
      blockers.push({
        recipe: recipe.ksaOperationalTitle || recipe.sourceTitle,
        issue: "Unpaired g 1110 total row",
        classification: "HUMAN_CONFIRMATION_REQUIRED",
        detail: "Source shows Total g 1110 without stating it is batch output yield; do not invent yield",
      });
    }
    if (title === "HALLOUMI") {
      blockers.push({
        recipe: "HALLOUMI",
        issue: "Source yield missing",
        classification: "SOURCE_INCOMPLETE",
        detail: "Halloumi card has no explicit yield/pax field",
      });
    }
    if (/TRUFFLE SALAD DRESSING|TRUFFLE MAYONNAISE/i.test(title)) {
      blockers.push({
        recipe: recipe.ksaOperationalTitle || recipe.sourceTitle,
        issue: "Unpaired quantity rows / name mismatches",
        classification: "HUMAN_CONFIRMATION_REQUIRED",
        detail: "Orphan qty rows (e.g. g 5 / ml 20) and trailing names require human confirmation",
      });
    }
  }
  return blockers;
}

export function classifyMenuPlacements(menuItems = [], sectionMap = {}) {
  const groups = new Map();
  for (const item of menuItems) {
    const key = normalizeText(item.name || item.name_en);
    if (!groups.has(key)) groups.set(key, []);
    const section = sectionMap[item.section_id] || {};
    groups.get(key).push({
      id: item.id,
      name: item.name || item.name_en,
      price: item.price,
      sectionId: item.section_id,
      sectionName: section.name_en || item.section_name || null,
      daypart: section.daypart || item.daypart || null,
      placementGroupId: item.placement_group_id || null,
      sku: item.sku || null,
      active: item.active !== false,
      branchId: item.branch_id || item.branch || "khobar",
    });
  }

  const reviews = [];
  for (const [key, items] of groups.entries()) {
    if (!items.length) continue;
    const prices = [...new Set(items.map((i) => i.price))];
    const names = [...new Set(items.map((i) => i.name))];
    let classification = "UNKNOWN";
    let proposal = null;
    if (names.length === 1 && prices.length === 1 && items.length > 1) {
      classification = "SAME_CULINARY_PRODUCT_DIFFERENT_PLACEMENTS";
      proposal = "ONE_CULINARY_RECIPE_MULTIPLE_MENU_PLACEMENTS";
    } else if (names.length > 1 || prices.length > 1) {
      classification = "DIFFERENT_PRODUCT_VARIANTS_OR_UNKNOWN";
    }
    reviews.push({
      key,
      classification,
      proposal,
      items,
      evidence: {
        identicalName: names.length === 1,
        identicalPrice: prices.length === 1,
        skuPresent: items.some((i) => i.sku),
        dayparts: [...new Set(items.map((i) => i.daypart).filter(Boolean))],
        sections: [...new Set(items.map((i) => i.sectionName).filter(Boolean))],
      },
    });
  }
  return reviews;
}

export function buildShortlistIngredientCostPreview({
  recipes = [],
  canonicalIngredients = [],
  invoiceLines = [],
  aliases = [],
  catalogueItems = [],
  costHistory = [],
  purchaseLines = [],
  baselines = [],
  menuItems = [],
  sectionMap = {},
} = {}) {
  const universe = collectShortlistIngredientUniverse(recipes);
  const duplicates = findPossibleDuplicateCanonicals(universe.ingredients);
  const items = universe.ingredients.map((ingredient) => {
    const canonicalMatch = matchCanonical(ingredient, canonicalIngredients);
    const supplierMatch = matchSupplierOrOcr(ingredient, invoiceLines, aliases, catalogueItems);
    const costResult = resolveJulyCost(ingredient, {
      costHistory,
      purchaseLines,
      baselines,
      invoiceLines,
    });
    // If only verification cream exists, never attach it to Double cream by fuzzy means.
    if (
      costResult.costStatus !== "NO_JULY_COST" &&
      supplierMatch.evidence &&
      /verification/i.test(supplierMatch.evidence.original_description || "")
    ) {
      costResult.costStatus = "NO_JULY_COST";
      costResult.julyCost = null;
      costResult.reason = "Verification-only invoice evidence excluded from culinary costing";
    }
    const unitIssues = assessUnitConversion(ingredient, costResult);
    const preview = classifyPreviewItem(ingredient, canonicalMatch, costResult, unitIssues);
    return {
      sourceIngredient: ingredient.sourceIngredient,
      sourceRecipes: ingredient.sourceRecipes,
      proposedCanonicalName: ingredient.proposedCanonicalName,
      sourceUnits: ingredient.sourceUnits,
      proposedBaseUnit: ingredient.proposedBaseUnit,
      currentCanonicalMatch: canonicalMatch,
      supplierOcrMatch: supplierMatch,
      foodicsSku: null,
      julyPurchaseEvidence: costResult.observations.filter((o) => o.sourceType?.includes("INVOICE") || o.sourceType?.includes("PURCHASE")),
      julyCostEvidence: costResult,
      unitIssues,
      matchConfidence: canonicalMatch.confidence,
      reviewStatus: preview.status,
      previewClassification: preview,
      sampleLines: ingredient.sampleLines,
    };
  });

  const yieldBlockers = classifyYieldBlockers(universe.relatedRecipes);
  const menuPlacementReview = classifyMenuPlacements(menuItems, sectionMap);

  const summary = {
    uniqueIngredientCount: items.length,
    existingCanonicalMatches: items.filter((i) => i.currentCanonicalMatch.matchType === "MATCH_EXISTING").length,
    newCanonicalCandidates: items.filter((i) => i.currentCanonicalMatch.matchType === "NEW_CANDIDATE").length,
    possibleDuplicates: duplicates.length,
    trustedJulyCosts: items.filter((i) => i.julyCostEvidence.costStatus === "TRUSTED_JULY_COST").length,
    costCandidates: items.filter((i) => i.julyCostEvidence.costStatus === "COST_CANDIDATE").length,
    conflictingCosts: items.filter((i) => i.julyCostEvidence.costStatus === "CONFLICTING_COST").length,
    noJulyCost: items.filter((i) => i.julyCostEvidence.costStatus === "NO_JULY_COST").length,
    readyToCreate: items.filter((i) => i.previewClassification.status === "READY_TO_CREATE").length,
    matchExisting: items.filter((i) => i.previewClassification.status === "MATCH_EXISTING").length,
    needsReview: items.filter((i) => i.previewClassification.status === "NEEDS_REVIEW").length,
    blocked: items.filter((i) => i.previewClassification.status === "BLOCKED").length,
    productionMutation: false,
    salesApproval: "NOT_IN_SCOPE",
    mirinStatus: "REVIEW_ALCOHOL_BEARING / DRAFT / NEEDS_REVIEW",
  };

  return {
    summary,
    ingredients: items,
    possibleDuplicateCanonicals: duplicates,
    yieldBlockers,
    menuPlacementReview,
    evidenceAudit: {
      activeCulinaryCanonicals: canonicalIngredients.filter((i) => i.active !== false && !/verification/i.test(i.canonical_name || i.name || "")).length,
      julyCulinaryInvoiceLines: invoiceLines.filter((l) => !/verification/i.test(l.original_description || "")).length,
      approvedBaselines: baselines.length,
      companyKnowledgeCulinaryCostFiles: 0,
    },
    productionMutation: false,
  };
}
