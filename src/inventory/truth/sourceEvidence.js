import { normalizeIdentityName } from "../../dashboard/health/identityClusters";
import { SOURCE_EVIDENCE_CLASS } from "./readinessContracts";

const DOCUMENTATION_LINE = /^(total|portions?|finished weight|fin?ished weight|bases|except the olive oil,?|notes|timing.*)$/i;

const NAME_ALIASES = Object.freeze({
  "table salt": "table salt",
  salt: "table salt",
  "iodized table salt": "table salt",
  "confit cherry tomatoes": "confit tomatoes",
  "confit baby tomatoes": "confit tomatoes",
  "quinoa cooking": "quinoa",
  quinoa: "quinoa",
  "black angus steak": "black angus steak",
  "beef tenderloin": "black angus steak",
});

export function normalizeSourceUnit(unit) {
  const value = String(unit || "").toLowerCase().replace(/\./g, "").trim();
  if (["g", "gm", "gr", "gram", "grams"].includes(value)) return "gram";
  if (["kg", "kilo", "kilogram"].includes(value)) return "kilogram";
  if (["ml", "millilitre", "milliliter"].includes(value)) return "millilitre";
  if (["l", "lt", "liter", "litre"].includes(value)) return "litre";
  if (["pcs", "pc", "ea", "each", "portion", "pax"].includes(value)) return "each";
  return value;
}

export function normalizeSourceName(value) {
  const key = normalizeIdentityName(value);
  return NAME_ALIASES[key] || key;
}

export function isDocumentationSourceLine(name) {
  return DOCUMENTATION_LINE.test(String(name || "").trim());
}

export function quantityMatches(left, right) {
  if (left == null || right == null || left === "" || right === "") return false;
  const a = Number(left);
  const b = Number(right);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(a - b) < 0.051;
}

function materialDraftLines(lines = []) {
  return (lines || []).filter((line) => {
    const name = line.name || line.ingredient || line.subRecipe || line.canonical_name;
    return name && !isDocumentationSourceLine(name);
  }).map((line) => ({
    name: line.name || line.ingredient || line.subRecipe || line.canonical_name,
    qty: line.qty ?? line.quantity,
    unit: line.unit,
  }));
}

function scoreNames(left, right) {
  const a = normalizeSourceName(left);
  const b = normalizeSourceName(right);
  if (!a || !b) return 0;
  if (a === b) return 3;
  if (a.includes(b) || b.includes(a)) return a.length >= 5 && b.length >= 5 ? 2 : 0;
  return 0;
}

function matchLines(draftLines, sourceLines) {
  const draft = materialDraftLines(draftLines);
  const used = new Set();
  const pairs = (sourceLines || []).map((source) => {
    let best = null;
    let bestIndex = -1;
    let bestScore = 0;
    draft.forEach((row, index) => {
      if (used.has(index)) return;
      const score = scoreNames(row.name, source.name);
      if (score > bestScore) {
        bestScore = score;
        best = row;
        bestIndex = index;
      }
    });
    if (best && bestScore >= 2) {
      used.add(bestIndex);
      return {
        source,
        draft: best,
        quantityMatch: quantityMatches(best.qty, source.qty),
        unitMatch: normalizeSourceUnit(best.unit) === normalizeSourceUnit(source.unit),
      };
    }
    return { source, draft: null, quantityMatch: false, unitMatch: false };
  });
  return {
    pairs,
    unmatchedDraft: draft.filter((_, index) => !used.has(index)),
    exactCount: pairs.filter((row) => row.draft && row.quantityMatch && row.unitMatch).length,
    sourceCount: (sourceLines || []).length,
  };
}

export function findCatalogDishes(recipeName, catalog) {
  const dishes = catalog?.dishes || [];
  const key = normalizeIdentityName(recipeName);
  const exact = dishes.filter((dish) => normalizeIdentityName(dish.dish) === key);
  if (exact.length) return exact;
  return dishes.filter((dish) => {
    const dishKey = normalizeIdentityName(dish.dish);
    return dishKey.startsWith(key) || key.startsWith(dishKey);
  });
}

export function detectIdentityMappingProblem({ soldDisplayName, recipeName, catalog } = {}) {
  const sold = normalizeIdentityName(soldDisplayName);
  if (!sold || !catalog?.dishes) return null;
  const recipeKey = normalizeIdentityName(recipeName);
  const soldHits = catalog.dishes.filter((dish) => (
    normalizeIdentityName(dish.foodicsName) === sold
    || normalizeIdentityName(dish.dish) === sold
    || normalizeIdentityName(dish.dish).startsWith(`${sold} `)
  ));
  if (soldHits.length > 1) {
    return {
      class: SOURCE_EVIDENCE_CLASS.IDENTITY_MAPPING_PROBLEM,
      reason: `Sold name matches ${soldHits.length} source dishes`,
      dishes: soldHits.map((dish) => dish.dish),
    };
  }
  const other = soldHits.find((dish) => normalizeIdentityName(dish.dish) !== recipeKey);
  if (other) {
    return {
      class: SOURCE_EVIDENCE_CLASS.IDENTITY_MAPPING_PROBLEM,
      reason: `Sold "${soldDisplayName}" matches source ${other.dish}, not ${recipeName}`,
      dishes: [other.dish],
    };
  }
  return null;
}

export function compareDraftToSource({
  recipeName,
  soldDisplayName = null,
  draftLines = [],
  catalog = null,
  draftUpdatedAt = null,
} = {}) {
  if (!catalog?.dishes) {
    return {
      class: SOURCE_EVIDENCE_CLASS.SOURCE_CATALOG_UNAVAILABLE,
      reason: "Local source catalog was not loaded",
      sourceDish: null,
      differences: [],
    };
  }

  const identity = detectIdentityMappingProblem({ soldDisplayName, recipeName, catalog });
  const dishes = findCatalogDishes(recipeName, catalog);
  if (dishes.length > 1 && new Set(dishes.map((dish) => dish.pdf)).size > 1) {
    return {
      class: SOURCE_EVIDENCE_CLASS.MULTIPLE_SOURCE_CONFLICT,
      reason: `Multiple source PDFs: ${dishes.map((dish) => dish.pdf).join(" | ")}`,
      sourceDish: dishes[0] || null,
      differences: [],
    };
  }
  if (!dishes.length) {
    return {
      class: identity?.class || SOURCE_EVIDENCE_CLASS.NO_SOURCE_EVIDENCE,
      reason: identity?.reason || "No Brand Food Bible / company PDF dish",
      sourceDish: null,
      differences: [],
    };
  }

  const sourceDish = dishes[0];
  const compared = matchLines(draftLines, sourceDish.lines || []);
  const differences = compared.pairs
    .filter((row) => !row.draft || !row.quantityMatch || !row.unitMatch)
    .map((row) => ({
      sourceName: row.source.name,
      sourceQty: row.source.qty,
      sourceUnit: row.source.unit,
      draftName: row.draft?.name || null,
      draftQty: row.draft?.qty ?? null,
      draftUnit: row.draft?.unit || null,
    }));
  for (const extra of compared.unmatchedDraft) {
    differences.push({
      sourceName: null,
      sourceQty: null,
      sourceUnit: null,
      draftName: extra.name,
      draftQty: extra.qty,
      draftUnit: extra.unit,
    });
  }

  let sourceClass = SOURCE_EVIDENCE_CLASS.SOURCE_CONFIRMED_WITH_DIFFERENCES;
  let reason = `${compared.exactCount}/${compared.sourceCount} brand lines match qty/UOM`;
  if (compared.sourceCount && compared.exactCount === compared.sourceCount && compared.unmatchedDraft.length === 0) {
    sourceClass = SOURCE_EVIDENCE_CLASS.SOURCE_CONFIRMED_CURRENT;
    reason = `All ${compared.sourceCount} brand PDF lines match this draft`;
  }
  if (identity) {
    return {
      class: SOURCE_EVIDENCE_CLASS.IDENTITY_MAPPING_PROBLEM,
      reason: identity.reason,
      sourceDish,
      differences,
      identityDishes: identity.dishes,
    };
  }

  if (draftUpdatedAt && sourceDish.sourceDate && Date.parse(draftUpdatedAt) > Date.parse(sourceDish.sourceDate) + 86400000 && differences.length) {
    sourceClass = SOURCE_EVIDENCE_CLASS.DATABASE_DRAFT_NEWER_THAN_SOURCE;
    reason = "Draft timestamp is newer than the company PDF and lines differ";
  }

  return {
    class: sourceClass,
    reason,
    sourceDish,
    differences,
    exactCount: compared.exactCount,
    sourceCount: compared.sourceCount,
  };
}

export function applySourceEvidenceToRecipeRow(row, evidence) {
  if (!row || !evidence) return row;
  const next = {
    ...row,
    sourceClass: evidence.class,
    sourceReason: evidence.reason,
    sourceDish: evidence.sourceDish?.dish || null,
    sourcePdf: evidence.sourceDish?.pdf || null,
    sourceDifferences: evidence.differences || [],
  };
  if (evidence.class === SOURCE_EVIDENCE_CLASS.SOURCE_CATALOG_UNAVAILABLE) return next;
  if (row.decision !== "SAFE_TO_ACTIVATE") return next;
  if (evidence.class === SOURCE_EVIDENCE_CLASS.SOURCE_CONFIRMED_CURRENT) return next;
  return {
    ...next,
    decision: "REVIEW_REQUIRED",
    reason: evidence.reason,
  };
}

export function classifyFoodicsProductIdentity(displayName, foodicsProducts = []) {
  const key = normalizeIdentityName(displayName);
  const hits = (foodicsProducts || []).filter((row) => normalizeIdentityName(row.name) === key);
  if (hits.length === 1) {
    return {
      class: "EXACT_FOODICS_PRODUCT_NAME_MATCH",
      sku: hits[0].sku,
      foodicsName: hits[0].name,
      reason: "Exact Foodics product name — identity evidence only, not a menu write",
    };
  }
  if (hits.length > 1) {
    return {
      class: "FOODICS_PRODUCT_NAME_AMBIGUOUS",
      sku: null,
      foodicsName: hits[0].name,
      skus: hits.map((row) => row.sku),
      reason: `${hits.length} Foodics SKUs share this exact name`,
    };
  }
  return null;
}

export function sourceHasIngredient(evidence, needle) {
  const re = needle instanceof RegExp ? needle : new RegExp(String(needle), "i");
  return (evidence?.sourceDish?.lines || []).some((line) => re.test(line.name || ""));
}
