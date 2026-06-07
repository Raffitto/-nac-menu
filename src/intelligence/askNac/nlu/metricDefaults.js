/**
 * Metric defaults applied after routing — sensible analyst assumptions.
 */

import { ASK_NAC_INTENTS } from "../intentRouter";
import { detectTopLimit } from "../foodics/foodicsPeriodParser";

export function applyMetricDefaultsToRoute(route, question = "", hints = {}) {
  if (!route || route.intent === ASK_NAC_INTENTS.UNKNOWN) return route;

  const next = { ...route };
  const q = String(question || "").toLowerCase();

  if (
    [
      ASK_NAC_INTENTS.TOP_ITEMS,
      ASK_NAC_INTENTS.TOP_ITEMS_COMPARE,
      ASK_NAC_INTENTS.ITEM_RANK_CHANGE,
    ].includes(next.intent)
  ) {
    if (!next.rankingBasis && (hints.quantityRanking || /\b(sells most|best selling|by quantity)\b/.test(q))) {
      next.rankingBasis = "quantity";
    }
    if (!next.topLimit) {
      next.topLimit = detectTopLimit(question, hints.topItems ? 10 : 10);
    }
  }

  if (next.intent === ASK_NAC_INTENTS.GOOGLE_REVIEWS && next.period?.source === "filters") {
    if (/\b(this month|month to date|mtd)\b/.test(q) || hints.reviews) {
      next.period = { hours: next.period.hours, rangeId: "month", source: "nlu_default" };
    }
  }

  if (next.intent === ASK_NAC_INTENTS.SALES_TOTAL && !next.foodicsPeriod) {
    if (/\b(this month|last month)\b/.test(q)) {
      next.debug = { ...next.debug, nluPeriodHint: true };
    }
  }

  if (next.intent === ASK_NAC_INTENTS.EXECUTIVE_ANALYSIS && !next.executiveKind) {
    if (hints.improve || /\bimprove(d|ment)?\b/.test(q)) {
      next.executiveKind = "improved_most";
    } else if (hints.branch && /\bperform(ing)? best\b/.test(q)) {
      next.executiveKind = "best_overall";
    }
  }

  if (next.intent === ASK_NAC_INTENTS.STAFF_REDIRECT_LEADERBOARD && next.period?.source === "filters") {
    next.period = { ...next.period, rangeId: next.period.rangeId || "month", source: "nlu_default" };
  }

  return next;
}
