import { ASK_NAC_INTENTS } from "../intentRouter";

export function buildSpecificMissingDataMessage(route, readiness) {
  const intent = route?.intent;
  const reason = readiness?.reasons?.[0];

  if (readiness?.status === "blocked" && reason) {
    return reason;
  }

  if (intent === ASK_NAC_INTENTS.UNKNOWN) {
    return "I could not map this question to a supported NAC metric. Try naming the metric (menu QR scans, sales, Google redirects, staff leaderboard, vault report).";
  }

  if (intent === ASK_NAC_INTENTS.EXECUTIVE_ANALYSIS) {
    return `Executive analysis needs network-wide review, redirect, and Google snapshot history for ${route?.period?.rangeId || "the selected period"}.`;
  }

  if (intent === ASK_NAC_INTENTS.STAFF_REDIRECT_LEADERBOARD) {
    const period = route?.period?.rangeId || "the selected period";
    return `No staff-attributed Google redirect data was found for ${period}. Staff attribution requires employee fields on review redirect events.`;
  }

  if (intent === ASK_NAC_INTENTS.GOOGLE_REDIRECTS) {
    const period = route?.period?.rangeId || "the selected period";
    return `No Google redirect events were recorded for ${period}. Redirects measure intent to review — not published Google reviews.`;
  }

  if (String(intent || "").startsWith("vault_")) {
    return reason || "No uploaded vault files cover the requested period for your authorized branch scope.";
  }

  if (
    [
      ASK_NAC_INTENTS.SALES_TOTAL,
      ASK_NAC_INTENTS.TOP_ITEMS,
      ASK_NAC_INTENTS.CATEGORY_SALES,
      ASK_NAC_INTENTS.BRANCH_SALES,
    ].includes(intent)
  ) {
    return reason || "No Foodics import batch covers the requested calendar period for the selected branch.";
  }

  return reason || "The requested verified data is not available for this question yet.";
}

export function buildSpecificUnknownMessage() {
  return "Try asking about menu QR scans, Google redirects, staff leaderboard, Foodics sales, or uploaded vault reports — include a period like today, last month, or May.";
}
