/**
 * Ask NAC Edge orchestrator — route → query tools → deterministic answer → optional AI narration.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { fetchAskNacMenuMetrics } from "./askNacMenuMetrics.ts";
import { MONTH_HOURS } from "./mtdHybridMerge.ts";
import { buildDeterministicAskNacAnswer, branchDisplayName, MAX_BRANCH_ROWS, MAX_STAFF_ROWS, periodLabelFromHours } from "./askNacEdgeAnswerBuilder.ts";
import { narrateWithOpenAi } from "./askNacOpenAiNarrator.ts";
import {
  compareFoodicsTopItems,
  getFoodicsBranchSalesComparison,
  getFoodicsCategorySales,
  getFoodicsSalesSummary,
  getFoodicsTopItems,
} from "./askNacFoodicsTools.ts";
import {
  detectRankChangeDirection,
  detectRankingBasis,
  detectTopLimit,
  parseFoodicsComparePeriods,
  parseFoodicsPeriodFromQuestion,
  resolveFoodicsPeriodWithFallback,
} from "./askNacPeriodFallback.ts";
import {
  buildVaultAnswer,
  buildCashUpDebugPayload,
  extractDocumentSearchTerms,
  hasVaultDayPeriod,
  isSalesPerformanceExecutiveQuery,
  isVaultDataIntent,
  isVaultDocumentSearchIntent,
  isVaultDocumentSummaryIntent,
  isVaultDocumentIntent,
  isVaultDocumentSearchQuery,
  isVaultDocumentSummaryQuery,
  parseVaultPeriodFromQuestion,
  parseVaultComparePeriodsFromQuestion,
  runVaultQueryTool,
  scoreVaultDocumentSearchIntent,
  scoreVaultDocumentSummaryIntent,
  isVaultRangePeriod,
  isVaultCashUpAnalyticsPeriod,
  isVaultFlexibleRangePeriod,
  VAULT_INTENTS,
} from "./askNacVaultTools.ts";
import { scoreVaultOperationalReviewIntent } from "./vaultOperationalIntelligence.ts";
import { scoreSalesPerformanceQueryFocus, isDeliveryPlatformPeriodQuery } from "./vaultSalesPerformanceIntelligence.ts";
import {
  scoreVaultBusinessReasoningIntent,
  resolveWhyVaultCompare,
  detectWhyMetricFocus,
} from "./vaultBusinessReasoningRouting.ts";
import { prepareAskNacQuestionEdge } from "./askNacConversation.ts";
import { detectExecutiveAnalysisKindEdge, queryExecutiveAnalysisEdge } from "./askNacExecutiveTools.ts";
import {
  assessNetworkDataConfidence,
  evaluateExecutiveRankingEligibility,
  requiresExecutiveRankingSafeguard,
} from "./askNacDataConfidenceLayer.ts";
import { queryOperationalKnowledgeEdge } from "./askNacKnowledgeTools.ts";
import { normalizeAskNacQuestionEdge, resolveIntentFromScoresEdge } from "./askNacNlu.ts";
import { probeGoogleReviewSnapshotsEdge, queryGoogleReviewCountEdge } from "./askNacGoogleReviewTools.ts";
import {
  createEmptyCashUpProductionTrace,
  finalizeCashUpProductionTrace,
  type CashUpProductionTrace,
} from "./cashUpProductionTrace.ts";
import { resolveHumanInTheLoopTurn } from "./askNacHumanInLoop.ts";
import { applyExecutiveIntelligenceV2 } from "./askNacExecutiveEvidenceV2.ts";
import { scoreDriveDiscoveryIntent } from "./askNacDriveDiscovery.ts";

export const ASK_NAC_INTENTS = {
  MENU_QR_SCANS: "menu_qr_scans",
  MENU_SESSIONS: "menu_sessions",
  GOOGLE_REDIRECTS: "google_redirects",
  REVIEW_QR_SCANS: "review_qr_scans",
  STAFF_REDIRECT_LEADERBOARD: "staff_redirect_leaderboard",
  BRANCH_COMPARISON: "branch_comparison",
  EXECUTIVE_ANALYSIS: "executive_analysis",
  OPERATIONAL_KNOWLEDGE: "operational_knowledge",
  SALES_TOTAL: "sales_total",
  TOP_ITEMS: "top_items",
  TOP_ITEMS_COMPARE: "top_items_compare",
  ITEM_RANK_CHANGE: "item_rank_change",
  CATEGORY_SALES: "category_sales",
  BRANCH_SALES: "branch_sales",
  AVG_SPEND_PER_GUEST: "avg_spend_per_guest",
  DELIVERY_SALES: "delivery_sales",
  GOOGLE_REVIEWS: "google_reviews",
  FOODICS_QUERY: "foodics_query",
  ...VAULT_INTENTS,
  UNKNOWN: "unknown",
} as const;

const FOODICS_SALES_SIGNAL =
  /\b(sales|revenue|sold|net sales|gross sales|pos sales|foodics|waiter sales|product sales|top items?|best sellers?|category|categories)\b/;
const DOCUMENT_INTENT_SIGNAL =
  /\b(logbooks?|daily logbooks?|uploaded reports?|uploaded documents?|documents?|data vault|vault|company knowledge)\b/;
const CASH_UP_INTENT_SIGNAL =
  /\b(cash[\s-]?up|cashup|cash report|daily cash report|cash reconciliation|cash[\s-]?up sales)\b/;
const CASH_UP_DAY_SALES_SIGNAL =
  /\b(net sales|gross sales|cash sales|card sales|delivery sales|total sales|revenue)\b/;

function shouldSkipAiNarration(
  intent: string,
  tool: Record<string, unknown> | null,
  vaultPeriod?: { periodType?: string },
): boolean {
  if (intent === VAULT_INTENTS.BUSINESS_REASONING) return true;
  if (
    intent === VAULT_INTENTS.TEACH_OPERATOR
    || intent === VAULT_INTENTS.WEEKLY_DASHBOARD
    || intent === VAULT_INTENTS.PROVIDE_MANUAL_INPUT
    || intent === VAULT_INTENTS.DRIVE_DISCOVER
    || intent === VAULT_INTENTS.DRIVE_APPROVE_RULES
  ) {
    return true;
  }
  if (intent !== VAULT_INTENTS.CASH_UP) return false;
  if (vaultPeriod?.periodType === "year_to_date") return true;
  const aggregation = tool?.aggregation as Record<string, unknown> | undefined;
  const dayCount = Number(aggregation?.dayCount) || 0;
  if (dayCount > 31) return true;
  const sources = (tool?.sources as { name?: string }[]) || [];
  return sources.some((s) => s.name === "get_vault_cash_up_range_aggregate");
}
const CASH_UP_PERIOD_SALES_SIGNAL =
  /\b(sales|revenue|guests?|delivery|orders?|spend|average|compare)\b/;

const BRANCH_ALIASES: Record<string, string[]> = {
  khobar: ["khobar", "al khobar", "alkhobar"],
  riyadh: ["riyadh", "riyad"],
  jeddah: ["jeddah", "jedda"],
};

const INTENT_RULES: { id: string; score: (q: string, options?: { documentContext?: Record<string, unknown> | null }) => number }[] = [
  {
    id: ASK_NAC_INTENTS.TEACH_OPERATOR,
    score(q) {
      if (/^teach nac:\s*.+/i.test(q)) return 50;
      if (/^remember this:\s*.+/i.test(q)) return 50;
      if (/^save as operator knowledge:\s*.+/i.test(q)) return 50;
      return 0;
    },
  },
  {
    id: ASK_NAC_INTENTS.WEEKLY_DASHBOARD,
    score(q) {
      if (/\bgenerate\b.*\b(weekly dashboard|khobar dashboard|dashboard for week)\b/i.test(q)) return 38;
      if (/\bweekly dashboard\b/i.test(q) && /\bgenerate\b/i.test(q)) return 36;
      if (/\bdashboard for week ending\b/i.test(q)) return 36;
      return 0;
    },
  },
  {
    id: ASK_NAC_INTENTS.DRIVE_APPROVE_RULES,
    score(q) {
      const score = scoreDriveDiscoveryIntent(q);
      return score >= 46 ? score : 0;
    },
  },
  {
    id: ASK_NAC_INTENTS.DRIVE_DISCOVER,
    score(q) {
      const score = scoreDriveDiscoveryIntent(q);
      return score === 44 ? score : 0;
    },
  },
  {
    id: ASK_NAC_INTENTS.OPERATIONAL_REVIEW,
    score(q) {
      return scoreVaultOperationalReviewIntent(q);
    },
  },
  {
    id: ASK_NAC_INTENTS.DOCUMENT_SUMMARY,
    score(q, options = {}) {
      return scoreVaultDocumentSummaryIntent(q, options.documentContext || null);
    },
  },
  {
    id: ASK_NAC_INTENTS.DOCUMENT_SEARCH,
    score(q) {
      return scoreVaultDocumentSearchIntent(q);
    },
  },
  {
    id: ASK_NAC_INTENTS.MANAGEMENT_REPORT,
    score(q) {
      if (isVaultDocumentSearchQuery(q)) return 0;
      if (!parseVaultPeriodFromQuestion(q)) return 0;
      if (/\b(management report|generate report|executive report)\b/.test(q)) return 20;
      if (/\b(summarize|summary report).*\b(operation|branch)\b/.test(q) && /\b(report)\b/.test(q)) return 18;
      return 0;
    },
  },
  {
    id: ASK_NAC_INTENTS.OPERATIONAL_DAY,
    score(q) {
      if (isVaultDocumentSummaryQuery(q)) return 0;
      if (isVaultDocumentSearchQuery(q)) return 0;
      if (DOCUMENT_INTENT_SIGNAL.test(q)) return 0;
      if (!parseVaultPeriodFromQuestion(q)?.isSingleDay) return 0;
      if (/\b(cash[\s-]?up)\b/.test(q)) return 0;
      if (/\b(what happened|summarize|summary|operational day|day summary)\b/.test(q)) return 19;
      if (/\b(operation|operational)\b/.test(q) && /\b(on|for)\b/.test(q)) return 17;
      return 0;
    },
  },
  {
    id: ASK_NAC_INTENTS.COVERAGE_LIST,
    score(q) {
      if (/\b(which uploaded files|uploaded files cover|files cover|data coverage|what data do we have)\b/.test(q)) return 18;
      if (/\b(coverage|uploaded data)\b/.test(q) && parseVaultPeriodFromQuestion(q)) return 16;
      return 0;
    },
  },
  {
    id: ASK_NAC_INTENTS.GOOGLE_STARS,
    score(q) {
      if (isVaultDocumentSearchQuery(q)) return 0;
      if (!parseVaultPeriodFromQuestion(q)) return 0;
      if (/\b(5[\s-]?star|five star|google review star|star reviews?)\b/.test(q)) return 17;
      if (/\bgoogle reviews?\b/.test(q) && hasVaultDayPeriod(q)) return 14;
      return 0;
    },
  },
  {
    id: ASK_NAC_INTENTS.RECEPTION,
    score(q) {
      if (!parseVaultPeriodFromQuestion(q)) return 0;
      if (/\b(reservations?|covers|walk[\s-]?ins?|no[\s-]?shows?|cancellations?|reception)\b/.test(q)) return 16;
      return 0;
    },
  },
  {
    id: ASK_NAC_INTENTS.CCM,
    score(q) {
      if (!parseVaultPeriodFromQuestion(q)) return 0;
      if (/\b(ccm|reconciliation|reconcile)\b/.test(q)) return 16;
      return 0;
    },
  },
  {
    id: ASK_NAC_INTENTS.BUSINESS_REASONING,
    score(q) {
      return scoreVaultBusinessReasoningIntent(q);
    },
  },
  {
    id: ASK_NAC_INTENTS.CASH_UP,
    score(q) {
      if (DOCUMENT_INTENT_SIGNAL.test(q) && !CASH_UP_INTENT_SIGNAL.test(q)) return 0;
      if (CASH_UP_INTENT_SIGNAL.test(q)) return 36;
      if (scoreSalesPerformanceQueryFocus(q)) return 35;
      if (/\bwhat should management know from\b.*\b(performance|sales|june|july|august|september|october|november|december|january|february|march|april|may)\b/.test(q)) {
        return 35;
      }
      if (/\b(cash variance|shortage|overage|any shortage|any overage)\b/.test(q)) return 18;
      const period = parseVaultPeriodFromQuestion(q);
      const vaultCompare = parseVaultComparePeriodsFromQuestion(q);
      if (CASH_UP_INTENT_SIGNAL.test(q) && period) return 36;
      if (period?.isSingleDay && (/\b(what were sales|how much sales|sales on|revenue on|net sales)\b/.test(q) || CASH_UP_DAY_SALES_SIGNAL.test(q))) {
        return 34;
      }
      if (period?.periodType === "year_to_date" && (scoreSalesPerformanceQueryFocus(q) || isDeliveryPlatformPeriodQuery(q) || CASH_UP_PERIOD_SALES_SIGNAL.test(q))) {
        return 36;
      }
      if ((isVaultCashUpAnalyticsPeriod(period) || isVaultFlexibleRangePeriod(period) || vaultCompare)
        && (scoreSalesPerformanceQueryFocus(q)
          || isDeliveryPlatformPeriodQuery(q)
          || vaultCompare
          || isVaultFlexibleRangePeriod(period)
          || (/\b(last|past)\s+\d+\s+days?\b/.test(q) && CASH_UP_PERIOD_SALES_SIGNAL.test(q))
          || (/\b(last|past)\s+two\s+weeks?\b/.test(q) && CASH_UP_PERIOD_SALES_SIGNAL.test(q))
          || (period?.periodType === "this_month" && /\b(guests?|average spend|avg spend|delivery)\b/.test(q))
          || (period?.periodType === "custom_range" && /\b(sales|guests?|delivery|average spend|orders?)\b/.test(q))
          || (period?.periodType === "first_half" || period?.periodType === "second_half"))) {
        return 34;
      }
      return 0;
    },
  },
  {
    id: ASK_NAC_INTENTS.LOGBOOK,
    score(q) {
      if (isVaultDocumentSearchQuery(q)) return 0;
      if (isVaultDocumentSummaryQuery(q)) return 0;
      if (!parseVaultPeriodFromQuestion(q)) return 0;
      if (/\b(logbook|complaints?|training notes?|mod on duty|chef on duty|operational issues?)\b/.test(q)) return 15;
      return 0;
    },
  },
  {
    id: VAULT_INTENTS.DAILY_BRIEFING,
    score(q) {
      if (isVaultDocumentSearchQuery(q)) return 0;
      if (!parseVaultPeriodFromQuestion(q)) return 0;
      if (/\b(daily briefing|briefing)\b/.test(q) && /\b(summarize|summary|reservations?|mod|staffing|focus)\b/.test(q)) return 16;
      if (/\bsummarize\b.*\bdaily briefing\b/.test(q)) return 17;
      return 0;
    },
  },
  {
    id: VAULT_INTENTS.BREAKAGE,
    score(q) {
      if (!parseVaultPeriodFromQuestion(q)) return 0;
      if (/\b(breakage|broken glass|asset loss|spillage|wastage)\b/.test(q)) return 16;
      return 0;
    },
  },
  {
    id: ASK_NAC_INTENTS.AVG_SPEND_PER_GUEST,
    score(q) {
      if (/\b(avg|average|mean)\b.*\b(spend|spending|ticket|check)\b.*\b(guest|customer|cover)\b/.test(q)) return 14;
      if (/\b(spend per guest|average spend|avg spend|guest spend)\b/.test(q)) return 14;
      return 0;
    },
  },
  {
    id: ASK_NAC_INTENTS.DELIVERY_SALES,
    score(q) {
      if (CASH_UP_INTENT_SIGNAL.test(q)) return 0;
      if (parseVaultPeriodFromQuestion(q)?.isSingleDay && /\bdelivery sales\b/.test(q)) return 0;
      const period = parseVaultPeriodFromQuestion(q);
      if (period && (isVaultCashUpAnalyticsPeriod(period) || period.periodType === "year_to_date") && /\b(delivery|platform|apps?)\b/.test(q)) return 0;
      if (/\b(delivery|hungerstation|jahez|talabat|keeta|aggregator)\b/.test(q)) return 12;
      if (/\b(platform sales|delivery sales|delivery revenue)\b/.test(q)) return 13;
      return 0;
    },
  },
  {
    id: ASK_NAC_INTENTS.GOOGLE_REVIEWS,
    score(q) {
      if (isVaultDocumentSearchQuery(q)) return 0;
      if (/\b(redirect|qr scan|review qr)\b/.test(q)) return 0;
      if (/\bhow many google reviews\b/.test(q)) return 17;
      if (/\bgoogle reviews\b/.test(q)) return 16;
      if (/\bhow many reviews\b/.test(q)) return 15;
      if (/\breviews?\b/.test(q) && /\b(last month|this month|may|june)\b/.test(q)) return 15;
      return 0;
    },
  },
  {
    id: ASK_NAC_INTENTS.ITEM_RANK_CHANGE,
    score(q) {
      if (/\b(entered|joined|new in|moved into)\b.*\btop\b/.test(q)) return 16;
      if (/\b(dropped|fell|left|removed from)\b.*\btop\b/.test(q)) return 16;
      if (/\b(which item).*(entered|dropped|left|joined)\b.*\btop\b/.test(q)) return 15;
      return 0;
    },
  },
  {
    id: ASK_NAC_INTENTS.TOP_ITEMS_COMPARE,
    score(q) {
      if (/\b(compare|compared|vs|versus|against)\b.*\btop\b/.test(q)) return 14;
      if (/\btop\b.*\b(compare|compared|vs|versus|between|two months)\b/.test(q)) return 13;
      return 0;
    },
  },
  {
    id: ASK_NAC_INTENTS.TOP_ITEMS,
    score(q) {
      if (/\b(top \d+|top ten|best sellers?|top items?|highest selling|most sold|top selling items?)\b/.test(q)) return 14;
      if (/\b(best sell|sells most|most popular|top item)\b/.test(q)) return 15;
      return 0;
    },
  },
  {
    id: ASK_NAC_INTENTS.CATEGORY_SALES,
    score(q) {
      if (/\b(category|categories)\b.*\b(sales|revenue|sold|most|highest|generated)\b/.test(q)) return 15;
      return 0;
    },
  },
  {
    id: ASK_NAC_INTENTS.BRANCH_SALES,
    score(q) {
      if (!FOODICS_SALES_SIGNAL.test(q)) return 0;
      if (/\b(sales|revenue).*\b(by branch|each branch|per branch|all branches)\b/.test(q)) return 14;
      if (/\b(which branch).*(sales|revenue|sold most)\b/.test(q)) return 14;
      return 0;
    },
  },
  {
    id: ASK_NAC_INTENTS.SALES_TOTAL,
    score(q) {
      if (DOCUMENT_INTENT_SIGNAL.test(q)) return 0;
      if (CASH_UP_INTENT_SIGNAL.test(q)) return 0;
      if (parseVaultPeriodFromQuestion(q)?.isSingleDay && CASH_UP_DAY_SALES_SIGNAL.test(q)) return 0;
      if (parseVaultPeriodFromQuestion(q)?.isSingleDay && /\b(net sales|what were net sales)\b/.test(q)) return 0;
      if (/\b(sales|revenue|net sales)\s+(today|this week|this month|yesterday)\b/.test(q)) return 0;
      if (/\b(sales|revenue)\s+(today|this week|this month|yesterday)\b/.test(q)) return 13;
      if (hasVaultDayPeriod(q)) return 0;
      if (/\b(total sales|sales total|what were sales|how much sales|sales in|sales for|revenue in|revenue for)\b/.test(q)) return 13;
      if (FOODICS_SALES_SIGNAL.test(q) && /\b(total|how much|what were)\b/.test(q) && !/\btop\b/.test(q)) return 11;
      if (/\bfoodics\b/.test(q) && /\b(sales|revenue)\b/.test(q)) return 12;
      return 0;
    },
  },
  {
    id: ASK_NAC_INTENTS.FOODICS_QUERY,
    score(q) {
      if (DOCUMENT_INTENT_SIGNAL.test(q)) return 0;
      if (CASH_UP_INTENT_SIGNAL.test(q)) return 0;
      if (/\bfoodics\b/.test(q)) return 8;
      return 0;
    },
  },
  {
    id: ASK_NAC_INTENTS.STAFF_REDIRECT_LEADERBOARD,
    score(q) {
      if (/\b(staff|waiter|waitress|server|employee)\b/.test(q) && /\b(top|best|perform|leaderboard|rank)\b/.test(q)) {
        return /\breviews?\b/.test(q) && !/\bredirect/.test(q) ? 19 : 18;
      }
      if (/\b(waiter|waitress|server|employee).*(perform|performance|best|top)\b/.test(q)) return 17;
      if (/\b(who|which).*(staff|waiter|employee).*(redirect|google)\b/.test(q)) return 15;
      if (/\b(who|which).*(drove|drive).*(most).*(redirect|google)\b/.test(q)) return 16;
      if (/\b(who|which).*(most).*(google redirect|redirects|redirect)\b/.test(q)) return 15;
      if (/\b(leaderboard|top staff|top waiters)\b/.test(q)) return 11;
      return 0;
    },
  },
  {
    id: ASK_NAC_INTENTS.OPERATIONAL_KNOWLEDGE,
    score(q) {
      if (/\bwhy did sales drop\b/.test(q)) return 18;
      if (/\b(operational issues? repeated|issues? repeated|same problem)\b/.test(q)) return 17;
      if (/\bwhat changed between\b/.test(q)) return 16;
      if (/\bwhich reports mention\b/.test(q)) return 16;
      if (/\b(linked reports|connected reports|across reports)\b/.test(q)) return 15;
      return 0;
    },
  },
  {
    id: ASK_NAC_INTENTS.EXECUTIVE_ANALYSIS,
    score(q) {
      if (isVaultDocumentSummaryQuery(q)) return 0;
      if (/\b(which branch is performing|performing best|performing better|best overall|which location is winning)\b/.test(q)) return 19;
      if (/\bgoogle maps\b/.test(q) && /\b(perform|better|overall|compare|winning)\b/.test(q)) return 19;
      if (/\b(which branch improved|improved the most|most improvement)\b/.test(q)) return 18;
      if (/\b(stars? (gained|added)|how many stars|since follow[\s-]?up)\b/.test(q)) return 18;
      if (/\b(what should (i|we|management) focus|focus on this week|priorit(y|ies) this week)\b/.test(q)) return 18;
      if (/\b(which manager|manager.*(impact|biggest influence))\b/.test(q)) return 17;
      if (/\b(needs attention|weakest branch|underperforming branch)\b/.test(q)) return 17;
      if (/\bcompare all branches\b/.test(q)) return 15;
      return 0;
    },
  },
  {
    id: ASK_NAC_INTENTS.BRANCH_COMPARISON,
    score(q) {
      if (/\bcompare branches\b/.test(q)) return 15;
      if (/\b(khobar|riyadh|jeddah).*(vs|versus|compare|outperform)\b/.test(q)) return 14;
      if (/\b(branch|branches|location).*(compare|comparison|strongest|weakest)\b/.test(q)) return 12;
      return 0;
    },
  },
  {
    id: ASK_NAC_INTENTS.GOOGLE_REDIRECTS,
    score(q) {
      if (/\b(staff|waiter|employee|who|which)\b/.test(q)) return 0;
      if (/\bgoogle redirect/.test(q)) return 14;
      if (/\b(redirect|redirects)\b/.test(q) && /\b(google|review page)\b/.test(q)) return 12;
      return 0;
    },
  },
  {
    id: ASK_NAC_INTENTS.REVIEW_QR_SCANS,
    score(q) {
      if (/\b(review qr|review card|review portal).*(scan|tap|open)\b/.test(q)) return 14;
      if (/\b(review qr scans|review scans)\b/.test(q)) return 13;
      return 0;
    },
  },
  {
    id: ASK_NAC_INTENTS.MENU_QR_SCANS,
    score(q) {
      if (/\b(menu qr|menu scan|qr scan).*\b(menu|digital menu)\b/.test(q)) return 14;
      if (/\b(menu qr scans|menu scans|qr scans)\b/.test(q) && !/\breview\b/.test(q)) return 13;
      if (/\bqr scans?\b/.test(q) && !/\breview\b/.test(q)) return 12;
      return 0;
    },
  },
  {
    id: ASK_NAC_INTENTS.MENU_SESSIONS,
    score(q) {
      if (/\b(menu session|menu sessions|digital menu session)\b/.test(q)) return 14;
      if (/\b(session count|total sessions|guest sessions)\b/.test(q) && !/\breview\b/.test(q)) return 10;
      return 0;
    },
  },
];

function parseAskNacPeriod(question = "", fallbackHours = 24) {
  const q = String(question || "").toLowerCase();
  if (/\b(this month|month to date|month-to-date|mtd)\b/.test(q)) {
    return { hours: MONTH_HOURS, rangeId: "month", source: "question" };
  }
  if (/\b(last month|previous month)\b/.test(q)) {
    return { hours: MONTH_HOURS, rangeId: "last_month", source: "question" };
  }
  if (/\b(last 7|7d|7 days|past week|this week)\b/.test(q)) {
    return { hours: 168, rangeId: "7d", source: "question" };
  }
  if (/\byesterday\b/.test(q)) {
    return { hours: 48, rangeId: "yesterday", source: "question" };
  }
  if (/\b(today|business day)\b/.test(q)) return { hours: 24, rangeId: "today", source: "question" };
  const fb = Number(fallbackHours) || 24;
  const rangeId = fb === MONTH_HOURS ? "month" : fb >= 168 ? "7d" : "today";
  return { hours: fb, rangeId, source: "filters" };
}

function parseAskNacBranch(question = "") {
  const q = String(question || "").toLowerCase();
  for (const [id, aliases] of Object.entries(BRANCH_ALIASES)) {
    if (aliases.some((a) => q.includes(a))) return id;
  }
  return null;
}

function isFoodicsDataIntent(intent: string) {
  return [
    ASK_NAC_INTENTS.SALES_TOTAL,
    ASK_NAC_INTENTS.TOP_ITEMS,
    ASK_NAC_INTENTS.TOP_ITEMS_COMPARE,
    ASK_NAC_INTENTS.ITEM_RANK_CHANGE,
    ASK_NAC_INTENTS.CATEGORY_SALES,
    ASK_NAC_INTENTS.BRANCH_SALES,
    ASK_NAC_INTENTS.FOODICS_QUERY,
  ].includes(intent as typeof ASK_NAC_INTENTS[keyof typeof ASK_NAC_INTENTS]);
}

function isFoodicsCompareIntent(intent: string) {
  return [ASK_NAC_INTENTS.TOP_ITEMS_COMPARE, ASK_NAC_INTENTS.ITEM_RANK_CHANGE].includes(
    intent as typeof ASK_NAC_INTENTS[keyof typeof ASK_NAC_INTENTS],
  );
}

function isMissingDataIntent(intent: string) {
  return [
    ASK_NAC_INTENTS.AVG_SPEND_PER_GUEST,
    ASK_NAC_INTENTS.DELIVERY_SALES,
  ].includes(intent as typeof ASK_NAC_INTENTS[keyof typeof ASK_NAC_INTENTS]);
}

export function routeIntent(question: string, options: { fallbackHours?: number; documentContext?: Record<string, unknown> | null } = {}) {
  const normalized = normalizeAskNacQuestionEdge(question);
  const q = normalized.text.trim().toLowerCase();
  const period = parseAskNacPeriod(normalized.text, options.fallbackHours ?? 24);
  const branchMention = parseAskNacBranch(normalized.text);

  if (!q) {
    return {
      intent: ASK_NAC_INTENTS.UNKNOWN,
      confidence: "none",
      score: 0,
      period,
      branchMention,
      debug: { reason: "empty_question" },
    };
  }

  const scored = INTENT_RULES.map((rule) => ({ id: rule.id, score: rule.score(q, options) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);

  const resolved = resolveIntentFromScoresEdge(scored, q, normalized.hints);
  const intent = resolved.intent;
  const score = resolved.score;
  const confidence = resolved.confidence;
  const foodicsPeriod = isFoodicsDataIntent(intent) ? parseFoodicsPeriodFromQuestion(normalized.text) : null;
  const foodicsCompare = isFoodicsCompareIntent(intent) ? parseFoodicsComparePeriods(normalized.text) : null;
  const rankingBasis = isFoodicsDataIntent(intent) ? detectRankingBasis(normalized.text) : null;
  const topLimit = isFoodicsDataIntent(intent) ? detectTopLimit(normalized.text) : null;
  const rankChangeDirection = intent === ASK_NAC_INTENTS.ITEM_RANK_CHANGE
    ? detectRankChangeDirection(normalized.text)
    : null;
  const vaultCompare = intent === VAULT_INTENTS.BUSINESS_REASONING
    ? (resolveWhyVaultCompare(normalized.text) || parseVaultComparePeriodsFromQuestion(normalized.text))
    : parseVaultComparePeriodsFromQuestion(normalized.text);
  const vaultPeriod = vaultCompare?.current || parseVaultPeriodFromQuestion(normalized.text);
  const whyMetricFocus = intent === VAULT_INTENTS.BUSINESS_REASONING
    ? detectWhyMetricFocus(normalized.text)
    : null;

  return {
    intent,
    confidence,
    score,
    period,
    branchMention,
    foodicsPeriod,
    foodicsCompare,
    rankingBasis,
    topLimit,
    rankChangeDirection,
    vaultPeriod,
    vaultCompare: vaultCompare || null,
    whyMetricFocus,
    executiveKind:
      intent === ASK_NAC_INTENTS.EXECUTIVE_ANALYSIS ? detectExecutiveAnalysisKindEdge(question) : null,
    debug: {
      topMatches: scored.slice(0, 3),
      branchLabel: branchMention ? branchDisplayName(branchMention) : null,
      periodHours: period.hours,
      rangeId: period.rangeId,
      foodicsPeriod,
      vaultPeriod,
      rankingBasis,
      topLimit,
    },
  };
}

async function assessReadiness(
  route: ReturnType<typeof routeIntent>,
  supabase: SupabaseClient,
  context: Record<string, unknown> = {},
) {
  if (isMissingDataIntent(route.intent)) {
    const labels: Record<string, string> = {
      [ASK_NAC_INTENTS.AVG_SPEND_PER_GUEST]: "Average spend per guest",
      [ASK_NAC_INTENTS.DELIVERY_SALES]: "Delivery platform sales",
      [ASK_NAC_INTENTS.GOOGLE_REVIEWS]: "Actual Google reviews",
    };
    return {
      status: "missing",
      canQuery: false,
      reasons: [`${labels[route.intent] || route.intent} is not wired in Edge yet.`],
      missingData: [{ intent: route.intent, label: labels[route.intent] || route.intent }],
    };
  }
  if (route.intent === ASK_NAC_INTENTS.UNKNOWN) {
    return { status: "missing", canQuery: false, reasons: ["Could not map question to a supported intent."], missingData: [] };
  }
  if (isVaultDocumentSummaryIntent(route.intent)) {
    return { status: "ready", canQuery: true, reasons: [], missingData: [] };
  }
  if (route.intent === VAULT_INTENTS.OPERATIONAL_REVIEW) {
    return { status: "ready", canQuery: true, reasons: [], missingData: [] };
  }
  if (
    route.intent === VAULT_INTENTS.DRIVE_DISCOVER
    || route.intent === VAULT_INTENTS.DRIVE_APPROVE_RULES
  ) {
    return { status: "ready", canQuery: true, reasons: [], missingData: [] };
  }
  if (
    route.intent === VAULT_INTENTS.TEACH_OPERATOR
    || route.intent === VAULT_INTENTS.WEEKLY_DASHBOARD
    || route.intent === VAULT_INTENTS.PROVIDE_MANUAL_INPUT
  ) {
    if (route.intent === VAULT_INTENTS.TEACH_OPERATOR) {
      return { status: "ready", canQuery: true, reasons: [], missingData: [] };
    }
    const branch = route.branchMention || (context.profile as { branchScope?: string } | undefined)?.branchScope;
    if (!branch) {
      return {
        status: "missing",
        canQuery: false,
        reasons: ["Branch scope required for weekly dashboard."],
        missingData: [{ intent: route.intent, label: "Branch" }],
      };
    }
    return { status: "ready", canQuery: true, reasons: [], missingData: [] };
  }
  if (isVaultDocumentSearchIntent(route.intent)) {
    const searchTerms = extractDocumentSearchTerms(String(context.question || ""));
    if (!searchTerms || searchTerms.length < 2) {
      return {
        status: "missing",
        canQuery: false,
        reasons: ["Could not extract search terms from the question."],
        missingData: [{ intent: route.intent, label: "Document search terms" }],
      };
    }
    return { status: "ready", canQuery: true, reasons: [], missingData: [], searchTerms };
  }
  if (isVaultDataIntent(route.intent) && (!route.vaultPeriod?.startDate || !route.vaultPeriod?.endDate)) {
    if (route.intent === VAULT_INTENTS.CASH_UP && isSalesPerformanceExecutiveQuery(String(context.question || ""))) {
      return { status: "ready", canQuery: true, reasons: [], missingData: [] };
    }
    return {
      status: "missing",
      canQuery: false,
      reasons: ["Could not parse a calendar day or month for this vault question."],
      missingData: [{ intent: route.intent, label: "Vault period" }],
    };
  }
  if (route.intent === ASK_NAC_INTENTS.GOOGLE_REVIEWS) {
    const probe = await probeGoogleReviewSnapshotsEdge(supabase);
    if (!probe.hasSnapshots) {
      return {
        status: "missing",
        canQuery: false,
        reasons: ["No Google review snapshots are stored yet."],
        missingData: [{ intent: route.intent, label: "Google review snapshots" }],
      };
    }
    return { status: "ready", canQuery: true, reasons: [], missingData: [] };
  }
  if (route.intent === ASK_NAC_INTENTS.OPERATIONAL_KNOWLEDGE) {
    return {
      status: "ready",
      canQuery: true,
      reasons: [],
      missingData: [],
    };
  }
  if (route.intent === ASK_NAC_INTENTS.EXECUTIVE_ANALYSIS) {
    const assessment = await assessNetworkDataConfidence(supabase, {
      hours: route.period.hours,
      profile: context.profile,
    }).catch(() => null);

    if (!assessment) {
      return {
        status: "missing",
        canQuery: false,
        reasons: ["Could not assess network data coverage for executive analysis."],
        missingData: [],
      };
    }

    const executiveKind = (context.executiveKind as string) || route.executiveKind || "general";
    const eligibility = evaluateExecutiveRankingEligibility(assessment, executiveKind);
    if (!eligibility.allowed && requiresExecutiveRankingSafeguard(executiveKind)) {
      return {
        status: "ready",
        canQuery: true,
        reasons: [eligibility.reason],
        missingData: [],
        dataConfidence: assessment,
        executiveCoverageBlocked: true,
      };
    }

    return {
      status: assessment.confidenceLevel === "low" ? "partial" : "ready",
      canQuery: true,
      reasons:
        assessment.confidenceLevel === "low"
          ? ["Network data confidence is low — executive conclusions may be directional only."]
          : [],
      missingData: [],
      dataConfidence: assessment,
      warnings:
        assessment.confidenceLevel !== "high"
          ? [`Coverage confidence: ${assessment.confidenceLevel}`]
          : [],
    };
  }
  return { status: "ready", canQuery: true, reasons: [], missingData: [] };
}

function resolveBranch(context: Record<string, unknown>) {
  const profile = context.profile as { branchScope?: string; allBranches?: boolean } | undefined;
  if (profile?.branchScope && !profile.allBranches) return profile.branchScope;
  return (context.branchMention as string) || (context.filters as { branch?: string })?.branch || (context.branch as string) || null;
}

async function queryReviewMetrics(supabase: SupabaseClient, context: Record<string, unknown>) {
  const hours = Number(context.hours) || 24;
  const branch = resolveBranch(context);
  const { data, error } = await supabase.rpc("get_review_events_summary", {
    p_branch: branch,
    p_hours: hours,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  const staff = Array.isArray(row?.staff) ? row.staff : [];
  const byBranch = Array.isArray(row?.by_branch) ? row.by_branch : [];

  return {
    hours,
    branch,
    branchLabel: branch ? branchDisplayName(branch) : "Network (all branches)",
    periodLabel: periodLabelFromHours(hours),
    reviewQrScans: Number(row?.qr_scans) || 0,
    googleRedirects: Number(row?.google_redirects) || 0,
    staffMerged: staff,
    branchComparison: byBranch,
    sources: [{ name: "get_review_events_summary", detail: "verified RPC" }],
    warnings: [] as string[],
  };
}

async function queryMenuMetrics(supabase: SupabaseClient, context: Record<string, unknown>) {
  const hours = Number(context.hours) || 24;
  const branch = resolveBranch(context);
  const metrics = await fetchAskNacMenuMetrics(supabase, { branch, hours });
  return {
    hours,
    branch,
    branchLabel: branch ? branchDisplayName(branch) : "Network (all branches)",
    periodLabel: periodLabelFromHours(hours),
    menuQrScans: metrics.menuQrScans,
    menuSessions: metrics.menuSessions,
    partial: metrics.partial,
    note: metrics.note,
    dataSource: metrics.dataSource,
    mtdHybrid: metrics.mtdHybrid,
    warnings: metrics.warnings,
    sources: [{ name: metrics.rpc || "fetchAskNacMenuMetrics", detail: metrics.dataSource || "live/rollup/hybrid" }],
  };
}

async function queryStaffLeaderboard(supabase: SupabaseClient, context: Record<string, unknown>) {
  const review = await queryReviewMetrics(supabase, context);
  const leaderboard = (review.staffMerged as Record<string, unknown>[])
    .map((s) => ({
      name: s.name,
      role: s.role || "",
      branch: s.branch,
      googleRedirects: Number(s.google) || 0,
      reviewQrScans: Number(s.scans) || 0,
    }))
    .filter((r) => r.googleRedirects > 0 || r.reviewQrScans > 0)
    .sort((a, b) => b.googleRedirects - a.googleRedirects || b.reviewQrScans - a.reviewQrScans)
    .slice(0, MAX_STAFF_ROWS);

  return { ...review, leaderboard };
}

async function queryBranchComparison(supabase: SupabaseClient, context: Record<string, unknown>) {
  const hours = Number(context.hours) || 24;
  const useRollup = hours >= 168 || hours === MONTH_HOURS;
  const rpc = useRollup ? "get_branch_comparison_from_rollup" : "get_branch_comparison";
  const { data, error } = await supabase.rpc(rpc, { p_hours: hours });
  if (error) throw error;
  const menuRows = (Array.isArray(data) ? data : []).slice(0, MAX_BRANCH_ROWS);

  const review = await queryReviewMetrics(supabase, { ...context, branch: null });
  const reviewByBranch = new Map(
    ((review.branchComparison as Record<string, unknown>[]) || []).map((r) => [String(r.branch_id), r]),
  );

  const rows = menuRows.map((row: Record<string, unknown>) => {
    const id = row.branch_id;
    const rev = reviewByBranch.get(String(id)) || {};
    return {
      branch_id: id,
      branchLabel: branchDisplayName(String(id)),
      menuSessions: Number(row.sessions) || 0,
      menuImpressions: Number(row.impressions) || 0,
      menuOpens: Number(row.opens) || 0,
      reviewQrScans: Number(rev.qr_scans) || 0,
      googleRedirects: Number(rev.google_redirects) || 0,
    };
  }).sort((a, b) => b.menuSessions - a.menuSessions);

  return {
    hours,
    periodLabel: periodLabelFromHours(hours),
    rows,
    sources: [
      { name: rpc, detail: "branch comparison RPC" },
      { name: "get_review_events_summary", detail: "review by_branch slice" },
    ],
    warnings: [],
  };
}

async function runQueryTool(
  supabase: SupabaseClient,
  intent: string,
  context: Record<string, unknown>,
) {
  if (isVaultDataIntent(intent) || isVaultDocumentIntent(intent)) {
    return runVaultQueryTool(supabase, intent, context);
  }

  switch (intent) {
    case ASK_NAC_INTENTS.MENU_QR_SCANS:
    case ASK_NAC_INTENTS.MENU_SESSIONS:
      return queryMenuMetrics(supabase, context);
    case ASK_NAC_INTENTS.GOOGLE_REDIRECTS:
    case ASK_NAC_INTENTS.REVIEW_QR_SCANS:
      return queryReviewMetrics(supabase, context);
    case ASK_NAC_INTENTS.STAFF_REDIRECT_LEADERBOARD:
      return queryStaffLeaderboard(supabase, context);
    case ASK_NAC_INTENTS.BRANCH_COMPARISON:
      return queryBranchComparison(supabase, context);
    case ASK_NAC_INTENTS.EXECUTIVE_ANALYSIS:
      return queryExecutiveAnalysisEdge(supabase, {
        ...context,
        executiveKind: context.executiveKind || detectExecutiveAnalysisKindEdge(String(context.question || "")),
      });
    case ASK_NAC_INTENTS.OPERATIONAL_KNOWLEDGE:
      return queryOperationalKnowledgeEdge(supabase, context);
    case ASK_NAC_INTENTS.GOOGLE_REVIEWS:
      return queryGoogleReviewCountEdge(supabase, context);
    case ASK_NAC_INTENTS.SALES_TOTAL:
    case ASK_NAC_INTENTS.FOODICS_QUERY:
      return getFoodicsSalesSummary(supabase, context);
    case ASK_NAC_INTENTS.TOP_ITEMS:
      return getFoodicsTopItems(supabase, context);
    case ASK_NAC_INTENTS.TOP_ITEMS_COMPARE:
    case ASK_NAC_INTENTS.ITEM_RANK_CHANGE:
      return compareFoodicsTopItems(supabase, context);
    case ASK_NAC_INTENTS.CATEGORY_SALES:
      return getFoodicsCategorySales(supabase, context);
    case ASK_NAC_INTENTS.BRANCH_SALES:
      return getFoodicsBranchSalesComparison(supabase, context);
    default:
      return null;
  }
}

export async function processAskNacOnEdge(
  supabase: SupabaseClient,
  {
    question,
    branch = null,
    hours,
    range,
    profileHint = null,
    filters = {},
    conversationContext = null,
    userEmail = null,
  }: {
    question: string;
    branch?: string | null;
    hours?: number;
    range?: string;
    profileHint?: Record<string, unknown> | null;
    filters?: Record<string, unknown>;
    conversationContext?: Record<string, unknown> | null;
    userEmail?: string | null;
  },
) {
  const baseFilters = {
    ...filters,
    branch: branch ?? (filters.branch as string | null) ?? null,
    timeRangeHours: hours ?? filters.timeRangeHours,
    selectedRange: range ?? filters.selectedRange,
  };

  const prepareResult = prepareAskNacQuestionEdge({
    question,
    conversationContext,
    filters: baseFilters,
  });
  const effectiveQuestion = prepareResult.effectiveQuestion;

  const mergedFilters = prepareResult.filters;
  const fallbackHours = Number(mergedFilters.timeRangeHours) || 24;
  const resolvedBranch = branch ?? (mergedFilters.branch as string | null) ?? null;
  const effectiveUserEmail = String(
    userEmail
    || (profileHint as { email?: string } | null)?.email
    || "",
  ).trim().toLowerCase() || null;

  const humanLoop = await resolveHumanInTheLoopTurn({
    question,
    conversationContext: conversationContext as Record<string, unknown> | null,
    supabase,
    branch: resolvedBranch,
    userEmail: effectiveUserEmail,
  });

  let route = routeIntent(effectiveQuestion, {
    fallbackHours,
    documentContext: (conversationContext as Record<string, unknown> | null)?.lastDocumentContext as Record<string, unknown> | null,
  });

  if (humanLoop?.overrideIntent) {
    route = {
      ...route,
      intent: humanLoop.overrideIntent,
      debug: {
        ...(route.debug as Record<string, unknown> | undefined),
        humanInLoop: true,
        resolutionNotes: humanLoop.resolutionNotes,
      },
    };
  }
  const readiness = await assessReadiness(route, supabase, {
    profile: profileHint,
    executiveKind: route.executiveKind,
    hours: route.period.hours,
    question: effectiveQuestion,
    documentContext: (conversationContext as Record<string, unknown> | null)?.lastDocumentContext || null,
  });

  let foodicsPeriod = route.foodicsPeriod;
  let periodWarnings: string[] = [];

  if (isFoodicsDataIntent(route.intent)) {
    const fallback = await resolveFoodicsPeriodWithFallback(supabase, {
      question: effectiveQuestion,
      filters: mergedFilters,
      branch: (route.branchMention || mergedFilters.branch) as string | null,
      profileHint,
    });
    if (!foodicsPeriod && fallback.period) foodicsPeriod = fallback.period;
    periodWarnings = fallback.warnings;
    if (foodicsPeriod) route.foodicsPeriod = foodicsPeriod;
  }

  let tool: Record<string, unknown> | null = null;
  if (readiness.canQuery) {
    tool = await runQueryTool(supabase, route.intent, {
      hours: route.period.hours,
      period: route.period,
      branchMention: route.branchMention,
      filters: mergedFilters,
      profile: profileHint,
      branch: mergedFilters.branch,
      question: effectiveQuestion,
      searchTerms: (readiness as Record<string, unknown>).searchTerms,
      documentContext: (conversationContext as Record<string, unknown> | null)?.lastDocumentContext || null,
      foodicsPeriod,
      foodicsCompare: route.foodicsCompare,
      vaultPeriod: route.vaultPeriod,
      vaultCompare: route.vaultCompare,
      rankingBasis: route.rankingBasis,
      topLimit: route.topLimit,
      executiveKind: route.executiveKind,
      userEmail: effectiveUserEmail,
      conversationContext,
      teachPayload: humanLoop?.teachPayload,
      manualInputPayload: humanLoop?.manualInputPayload,
      pendingSession: humanLoop?.pendingSession,
    }) as Record<string, unknown> | null;

    if (periodWarnings.length && tool) {
      tool.warnings = [...((tool.warnings as string[]) || []), ...periodWarnings];
    }
  }

  const usedVaultAnswerBuilder = isVaultDataIntent(route.intent) || isVaultDocumentIntent(route.intent);
  const routeWithQuestion = { ...route, question: effectiveQuestion };
  let deterministic = usedVaultAnswerBuilder
    ? buildVaultAnswer(routeWithQuestion, tool, readiness)
    : buildDeterministicAskNacAnswer(routeWithQuestion, tool, readiness);

  deterministic.intent = route.intent;
  deterministic.readiness = readiness;

  deterministic = await applyExecutiveIntelligenceV2({
    supabase,
    route: routeWithQuestion,
    tool,
    response: deterministic,
    userEmail: effectiveUserEmail,
    profile: profileHint as Record<string, unknown> | null,
    filters: mergedFilters as Record<string, unknown>,
  }) as typeof deterministic;

  const isCashUpQuestion = /\bcash\s*up\b/i.test(effectiveQuestion);
  let cashUpProductionTrace: CashUpProductionTrace | undefined;
  if (route.intent === VAULT_INTENTS.CASH_UP || isCashUpQuestion) {
    const base =
      (tool?.cashUpProductionTrace as CashUpProductionTrace | undefined)
      || createEmptyCashUpProductionTrace();
    base.branchFilter = {
      rawBranchFromFilters: mergedFilters.branch ?? null,
      rawBranchFromRequest: branch ?? null,
      branchMention: route.branchMention ?? null,
      normalizedBranch: (base.branchFilter?.normalizedBranch as string | null) ?? (mergedFilters.branch as string | null) ?? null,
      profileHint: profileHint ?? null,
    };
    cashUpProductionTrace = finalizeCashUpProductionTrace(base, {
      routedIntent: route.intent,
      effectiveQuestion,
      readiness,
      tool,
      answerBuilderUsed: usedVaultAnswerBuilder ? "buildVaultAnswer" : "buildDeterministicAskNacAnswer",
      isVaultDataIntent: isVaultDataIntent(route.intent),
      isVaultDocumentIntent: isVaultDocumentIntent(route.intent),
      directAnswer: String(deterministic.directAnswer || ""),
    });
  }

  const cashUpDebug = route.intent === VAULT_INTENTS.CASH_UP
    ? buildCashUpDebugPayload({
      intent: route.intent,
      selectedTool: String(
        (tool?.cashUpDebug as Record<string, unknown> | undefined)?.selectedTool
        || (readiness.canQuery ? (tool ? "runVaultQueryTool" : "none") : "readiness_blocked"),
      ),
      context: {
        filters: mergedFilters,
        profile: profileHint,
        vaultPeriod: route.vaultPeriod,
        branch: mergedFilters.branch,
        question: effectiveQuestion,
      },
      tool,
      readiness,
      route,
      selectedCoverageRow: (tool?.cashUpDebug as Record<string, unknown> | undefined)?.selectedCoverageRow as Record<string, unknown> | null ?? null,
      factsQueryFilters: (tool?.cashUpDebug as Record<string, unknown> | undefined)?.factsQueryFilters as Record<string, unknown> ?? {
        branch_id: mergedFilters.branch ?? null,
        vault_period: route.vaultPeriod ?? null,
      },
      facts: (tool?.facts as Record<string, unknown>[]) || [],
    })
    : undefined;

  if (cashUpDebug) {
    deterministic.cashUpDebug = cashUpDebug;
  }
  if (cashUpProductionTrace) {
    deterministic.cashUpProductionTrace = cashUpProductionTrace;
  }

  const skipAiNarration = shouldSkipAiNarration(route.intent, tool, route.vaultPeriod as { periodType?: string } | undefined);
  const { answer, aiConnected } = skipAiNarration
    ? { answer: deterministic, aiConnected: false }
    : await narrateWithOpenAi(deterministic, {
      question: effectiveQuestion,
      intent: route.intent,
      tool,
      diagnostics: (tool?.mtdHybrid as Record<string, unknown>) || null,
    });

  return {
    ...answer,
    intent: route.intent,
    cashUpDebug,
    cashUpProductionTrace,
    routingConfidence: route.confidence,
    routingDebug: route.debug,
    conversationResolution: {
      originalQuestion: prepareResult.originalQuestion,
      resolvedQuestion: effectiveQuestion,
      usedContext: Boolean(prepareResult.conversationResolution?.usedContext),
      resolutionNotes: [
        ...(prepareResult.conversationResolution?.resolutionNotes || []),
        ...(humanLoop?.resolutionNotes || []),
      ],
    },
    serverConnected: true,
    aiConnected,
    localFallback: false,
  };
}
