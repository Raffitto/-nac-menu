import { normalizeText } from "./inventoryIntelligence";

const NON_KITCHEN_SECTION = /\b(drink|drinks|coffee|coffees|beverage|beverages|juice|juices|bar|mocktail|mocktails|soft drink|water|wine|beer|shisha|smoothie)\b/i;
const BOTTLED_OR_BAR = /^(7 up|coca cola|sprite|fanta|water|still water|sparkling water|apple juice|pineapple juice|orange juice|classic mojito|americano|latte|cappuccino|espresso|flat white|macchiato|iced spanish latte)$/i;
const ADD_ON_ONLY = /^(beef bacon|extra egg|add avocado|add halloumi)$/i;

export function requiresKitchenRecipe({ name, sectionName, categoryName } = {}) {
  const itemName = String(name || "").trim();
  if (!itemName) return false;
  if (ADD_ON_ONLY.test(itemName)) return false;
  if (BOTTLED_OR_BAR.test(itemName)) return false;
  const place = `${sectionName || ""} ${categoryName || ""}`;
  if (NON_KITCHEN_SECTION.test(place) && !/\b(dessert|food|kitchen|mains|breakfast)\b/i.test(place)) {
    return false;
  }
  if (NON_KITCHEN_SECTION.test(itemName) && itemName.split(/\s+/).length <= 3 && !/\b(affogato|churros|pavlova)\b/i.test(itemName)) {
    return false;
  }
  return true;
}

export function kitchenRecipeCoverage(liveRows = [], lookup = {}) {
  const required = liveRows.filter((row) => requiresKitchenRecipe({
    name: row.liveName,
    sectionName: lookup.sectionById?.[row.sectionId] || row.sectionName,
    categoryName: lookup.categoryById?.[row.categoryId] || row.categoryName,
  }));
  const matchedRequired = required.filter((row) => row.state === "active + matched");
  const matchedAll = liveRows.filter((row) => row.state === "active + matched");
  return {
    overallMatched: matchedAll.length,
    overallLive: liveRows.length,
    overallPct: liveRows.length ? Math.round((matchedAll.length / liveRows.length) * 100) : 0,
    kitchenRequired: required.length,
    kitchenMatched: matchedRequired.length,
    kitchenPct: required.length ? Math.round((matchedRequired.length / required.length) * 100) : 0,
    kitchenMissing: required.filter((row) => row.state !== "active + matched").map((row) => row.liveName),
  };
}

export function classifyUnitIssue(issue) {
  const detail = String(issue?.detail || "");
  if (issue?.category) return issue.category;
  if (/Ingredient without quantity/i.test(detail)) return "missing_source_qty";
  if (/Unpaired quantity/i.test(detail)) return "unpaired_qty";
  if (/Unpaired unit/i.test(detail)) return "parser_unpaired_unit";
  if (/Quantity without ingredient/i.test(detail)) return "qty_without_name";
  return "other";
}

export function summarizeParseIssues(recipes = []) {
  const counts = {};
  for (const recipe of recipes) {
    for (const issue of recipe.issues || []) {
      if (issue.code !== "AMBIGUOUS_UNIT" && issue.code !== "MISSING_QUANTITY") continue;
      const key = classifyUnitIssue(issue);
      counts[key] = (counts[key] || 0) + 1;
    }
  }
  return counts;
}
