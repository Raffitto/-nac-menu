import { PROCUREMENT_CATEGORY, isRecipeCostCategory } from "./contracts";

const RULES = [
  { category: PROCUREMENT_CATEGORY.CLEANING, pattern: /\b(bleach|detergent|disinfectant|cleaner|cleaning|soap|saniti[sz]er|degreaser|floor\s*cleaner)\b/i },
  { category: PROCUREMENT_CATEGORY.PACKAGING, pattern: /\b(garbage\s*bags?|bin\s*liners?|vacuum\s*bags?|gloves?|cling\s*film|stretch\s*film|takeaway|container|lid)\b/i },
  { category: PROCUREMENT_CATEGORY.OPERATING_SUPPLIES, pattern: /\b(stamp\s*ink|ink\s*pad|stationery|receipt\s*roll|paper\s*towel)\b/i },
  { category: PROCUREMENT_CATEGORY.EQUIPMENT, pattern: /\b(equipment|machine|blender|thermometer)\b/i },
  { category: PROCUREMENT_CATEGORY.BEVERAGE, pattern: /\b(wine|beer|spirit|juice|cola|water|soft\s*drink)\b/i },
];

export function classifyProcurementCategory(description, explicit = null) {
  if (explicit && PROCUREMENT_CATEGORY[explicit]) return explicit;
  const text = String(description || "");
  for (const rule of RULES) {
    if (rule.pattern.test(text)) return rule.category;
  }
  return PROCUREMENT_CATEGORY.FOOD;
}

export function lineEligibleForRecipeCost(line) {
  const category = line.procurementCategory || line.procurement_category
    || classifyProcurementCategory(line.originalDescription || line.original_description);
  return isRecipeCostCategory(category);
}
