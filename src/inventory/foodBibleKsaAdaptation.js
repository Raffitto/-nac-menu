/**
 * Deterministic NAC KSA Food Bible adaptations.
 * Preserves international source wording as evidence; never invents quantities.
 *
 * Market distinction (smallest safe mechanism, no brand hierarchy redesign):
 * - sourceMarket: international / unspecified Food Bible wording (immutable evidence)
 * - operationalMarket: KSA operational labels/ingredients used for Khobar recipes
 * Future: Company -> Brand -> Market/Country -> Branch can consume these fields
 * without duplicating historical source evidence.
 */

const SPIRIT_RE = /\b(vodka|sake|liqueur|cognac|rum|whisky|whiskey|gin|brandy|tequila)\b/i;
const WINE_RE = /\b((?:red|white)\s+wine|cooking wine)\b/i;
const WINE_VINEGAR_RE = /\bwine vinegar\b/i;
const MIRIN_RE = /\bmirin\b/i;
const VODKA_TOMATO_SAUCE_RE = /\bvodka\s+tomato\s+sauce\b/i;

export function normalizeFoodBibleText(value) {
  return String(value || "")
    .replace(/[’`]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function isWineVinegar(name) {
  return WINE_VINEGAR_RE.test(normalizeFoodBibleText(name));
}

export function isCookingWine(name) {
  const text = normalizeFoodBibleText(name);
  return WINE_RE.test(text) && !isWineVinegar(text);
}

export function isSpiritIngredient(name) {
  const text = normalizeFoodBibleText(name);
  if (VODKA_TOMATO_SAUCE_RE.test(text)) return false;
  return SPIRIT_RE.test(text);
}

export function ksaOperationalRecipeTitle(sourceTitle) {
  const source = normalizeFoodBibleText(sourceTitle);
  if (VODKA_TOMATO_SAUCE_RE.test(source)) {
    return {
      ksaOperationalTitle: "TOMATO SAUCE",
      adaptation: {
        code: "KSA_MARKET_ADAPTATION_REQUIRED",
        type: "RENAME",
        rule: "VODKA_TOMATO_SAUCE_RENAME",
        sourceTitle: source,
        ksaOperationalTitle: "TOMATO SAUCE",
      },
    };
  }
  if (/\bvodka\b/i.test(source)) {
    return {
      ksaOperationalTitle: source,
      adaptation: {
        code: "KSA_MARKET_ADAPTATION_REQUIRED",
        type: "RENAME_REVIEW",
        sourceTitle: source,
        detail: "Vodka in title requires explicit KSA rename review",
      },
    };
  }
  return { ksaOperationalTitle: source, adaptation: null };
}

export function ksaZeroAlcoholWineName(sourceName) {
  const text = normalizeFoodBibleText(sourceName);
  if (!isCookingWine(text)) return null;
  if (/\bred\s+wine\b/i.test(text)) return "Red Wine 0.0% Alcohol";
  if (/\bwhite\s+wine\b/i.test(text)) return "White Wine 0.0% Alcohol";
  return "Wine 0.0% Alcohol";
}

/**
 * Adapt one source ingredient line for KSA operations.
 * Returns null operational ingredient when the line must be excluded.
 */
export function adaptFoodBibleIngredientForKsa(ingredient) {
  const sourceName = normalizeFoodBibleText(ingredient?.sourceName || ingredient?.name);
  const adaptations = [];
  const sourceEvidence = {
    sourceName,
    sourceQuantity: ingredient?.sourceQuantity ?? ingredient?.quantity ?? null,
    sourceUnit: ingredient?.sourceUnit ?? ingredient?.unit ?? null,
    sourceLocator: ingredient?.sourceLocator || null,
    sourceLine: ingredient?.sourceLine || null,
  };

  if (VODKA_TOMATO_SAUCE_RE.test(sourceName)) {
    const ksaOperationalName = "Tomato Sauce";
    adaptations.push({
      code: "KSA_MARKET_ADAPTATION_REQUIRED",
      type: "RENAME_SUBRECIPE_REF",
      rule: "VODKA_TOMATO_SAUCE_RENAME",
      sourceIngredient: sourceName,
      ksaIngredient: ksaOperationalName,
      sourceEvidence,
    });
    return {
      includeInKsaRecipe: true,
      ksaOperationalName,
      adaptations,
      sourceEvidence,
    };
  }

  if (isWineVinegar(sourceName)) {
    return {
      includeInKsaRecipe: true,
      ksaOperationalName: sourceName,
      adaptations,
      sourceEvidence,
    };
  }

  const wineName = ksaZeroAlcoholWineName(sourceName);
  if (wineName) {
    adaptations.push({
      code: "KSA_ZERO_ALCOHOL_WINE_MAPPING",
      type: "ZERO_ALCOHOL_WINE",
      sourceIngredient: sourceName,
      ksaIngredient: wineName,
      quantityPreserved: true,
      sourceEvidence,
    });
    return {
      includeInKsaRecipe: true,
      ksaOperationalName: wineName,
      adaptations,
      sourceEvidence,
    };
  }

  if (isSpiritIngredient(sourceName)) {
    adaptations.push({
      code: "KSA_MARKET_ADAPTATION_REQUIRED",
      type: "EXCLUDE_SPIRIT",
      sourceIngredient: sourceName,
      detail:
        "Alcoholic spirit/liqueur excluded from KSA operational recipe; no replacement invented",
      sourceEvidencePreserved: true,
      sourceEvidence,
    });
    return {
      includeInKsaRecipe: false,
      ksaOperationalName: null,
      adaptations,
      sourceEvidence,
    };
  }

  if (MIRIN_RE.test(sourceName)) {
    adaptations.push({
      code: "KSA_MARKET_ADAPTATION_REQUIRED",
      type: "REVIEW_ALCOHOL_BEARING",
      sourceIngredient: sourceName,
      detail:
        "Mirin may be alcohol-bearing; retained pending approved KSA equivalent confirmation",
      sourceEvidence,
    });
  }

  return {
    includeInKsaRecipe: true,
    ksaOperationalName: sourceName,
    adaptations,
    sourceEvidence,
  };
}

export function findMethodIngredientMismatches({
  methodText = "",
  ingredients = [],
  operationalMarket = "KSA",
} = {}) {
  const issues = [];
  const names = ingredients
    .map((item) => normalizeFoodBibleText(item.sourceName || item.name).toLowerCase())
    .filter(Boolean);
  const method = normalizeFoodBibleText(methodText);
  const mentions = method.match(/\b(vodka|sake|liqueur|cognac|rum|whisky|whiskey|gin|brandy|tequila|red wine|white wine)\b/gi) || [];
  for (const mention of mentions) {
    const key = mention.toLowerCase();
    const present = names.some((name) => name.includes(key));
    if (!present) {
      const intentionalKsaSpiritExclusion =
        operationalMarket === "KSA" && SPIRIT_RE.test(key) && !isCookingWine(key);
      issues.push({
        code: "SOURCE_RECIPE_INCONSISTENCY",
        detail: `Method references "${mention}" but ingredient table has no matching line`,
        // Preserve source evidence, but do not block KSA ops when the spirit is
        // intentionally excluded and no KSA replacement quantity is required.
        ksaBlocking: intentionalKsaSpiritExclusion ? false : true,
        ksaPolicy: intentionalKsaSpiritExclusion
          ? "INTENTIONAL_SPIRIT_EXCLUSION_NO_KSA_QTY_REQUIRED"
          : null,
      });
    }
  }
  return issues;
}

export function adaptFoodBibleRecipeForKsa(recipe) {
  const titleResult = ksaOperationalRecipeTitle(recipe?.sourceTitle || recipe?.name);
  const adaptations = titleResult.adaptation ? [titleResult.adaptation] : [];
  const ksaIngredients = [];
  const excludedIngredients = [];

  for (const ingredient of recipe?.ingredients || []) {
    const adapted = adaptFoodBibleIngredientForKsa(ingredient);
    adaptations.push(...adapted.adaptations);
    if (adapted.includeInKsaRecipe) {
      ksaIngredients.push({
        ...ingredient,
        sourceName: adapted.sourceEvidence.sourceName,
        ksaOperationalName: adapted.ksaOperationalName,
      });
    } else {
      excludedIngredients.push({
        ...ingredient,
        sourceName: adapted.sourceEvidence.sourceName,
        exclusion: adapted.adaptations[0] || null,
      });
    }
  }

  const issues = [
    ...(recipe?.issues || []),
    ...findMethodIngredientMismatches({
      methodText: Array.isArray(recipe?.method) ? recipe.method.join(" ") : recipe?.method,
      ingredients: recipe?.ingredients || [],
      operationalMarket: "KSA",
    }),
  ];

  if (/\bvodka\b/i.test(titleResult.ksaOperationalTitle)) {
    issues.push({
      code: "KSA_MARKET_ADAPTATION_REQUIRED",
      detail: "KSA operational title still contains vodka",
    });
  }

  return {
    sourceMarket: recipe?.sourceMarket || "international",
    operationalMarket: "KSA",
    sourceTitle: normalizeFoodBibleText(recipe?.sourceTitle || recipe?.name),
    ksaOperationalTitle: titleResult.ksaOperationalTitle,
    ksaIngredients,
    excludedIngredients,
    adaptations,
    issues,
  };
}
