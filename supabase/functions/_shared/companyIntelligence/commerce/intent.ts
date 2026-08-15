/**
 * Commerce question families. Distinct: dessert-focused vs any-dessert vs dessert conversion.
 */

import type { CommerceFocus } from "./types.ts";

export function extractCommerceFocus(question: string): CommerceFocus {
  const q = String(question || "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!q) return null;
  if (/\b(can i trust|trust this result|should i trust)\b/.test(q)) return "trust";
  if (/\b(why are sales different|different from the foodics|foodics check total|cash up vs foodics|reconcile)\b/.test(q)) {
    return "reconciliation";
  }
  if (/\b(what data did you use|is this data fresh)\b/.test(q)) return "data_used";
  if (/\b(is (?:my |the )?(?:foodics )?data (?:healthy|fresh|up to date)|foodics data healthy)\b/.test(q)) {
    return "health";
  }
  if (/\b(dine-in guests?|guests were in dessert-focused)\b/.test(q)) return "guest_weighted";
  if (/\b(what should i pay attention|what should i watch)\b/.test(q) && /\b(table|dessert|foodics|mix)\b/.test(q)) {
    return "attention";
  }
  if (/\bdessert tables?\b/.test(q) && /\bfood tables?\b/.test(q)) return "session_mix";
  if (/\b(what if|scenario|opportunity|jeddah'?s (?:table|food) mix)\b/.test(q)) return "opportunity";
  if (/\b(why is \w+ (?:lower|behind|weaker)|biggest commercial opportunities|decompose)\b/.test(q)) {
    return "branch_decomposition";
  }
  if (/\b(ordered together|most commonly ordered with|after big nac|attachment)\b/.test(q)) return "attachment";
  if (/\b(top desserts?|best-selling mains?|how many brownies|items? declined|item mix|category share)\b/.test(q)) {
    return "item_mix";
  }
  if (/\b(average (?:check|spend) by table|which table type (?:spends|is worth))\b/.test(q)) return "session_mix";
  if (/\b(dessert conversion|food tables? (?:also )?ordered dessert|percentage of food tables)\b/.test(q)) {
    return "dessert_conversion";
  }
  if (/\b(tables? that ordered dessert|sessions? containing dessert)\b/.test(q)) return "basket";
  if (/\b(dessert[- ]focused|dessert tables?|just for dessert|dessert-only|dessert and coffee tables?)\b/.test(q)
    && !/\bfood tables?\b/.test(q)
  ) return "dessert_focused";
  if (/\b(food[- ]containing|food tables?|tables? that ordered food)\b/.test(q)) return "food_containing";
  if (/\bfull-service\b/.test(q)) return "full_service";
  if (/\bcoffee-only\b/.test(q)) return "coffee_only";
  if (/\b(table mix|service mix|what percentage of (?:our )?tables)\b/.test(q)) return "session_mix";
  return null;
}

export function isCommerceManagementTurn(question: string): boolean {
  return Boolean(extractCommerceFocus(question));
}

/** Session-archetype questions cannot be answered from period-grain Foodics exports. */
export function requiresDineInSessionEvidence(focus: CommerceFocus): boolean {
  return Boolean(focus)
    && focus !== "item_mix"
    && focus !== "rank_items"
    && focus !== "freshness"
    && focus !== "health"
    && focus !== "data_used"
    && focus !== "trust"
    && focus !== "reconciliation";
}
