/**
 * Deterministic Ask NAC intent router — maps natural language to canonical intents.
 * OpenAI must never choose intents; only this router does.
 */

import { normalizeBranchId } from "../../dashboard/utils/branchIdentity";
import { hoursToRange, MONTH_HOURS, branchDisplayName } from "../../dashboard/utils/rangeState";
import {
  detectRankChangeDirection,
  detectRankingBasis,
  detectTopLimit,
  parseFoodicsComparePeriods,
  parseFoodicsPeriodFromQuestion,
} from "./foodics/foodicsPeriodParser";
import {
  parseVaultPeriodFromQuestion,
  parseVaultComparePeriodsFromQuestion,
  hasVaultDayPeriod,
  isVaultCashUpAnalyticsPeriod,
  isVaultFlexibleRangePeriod,
} from "./vault/vaultPeriodParser";
import {
  isVaultDocumentSearchQuery,
  scoreVaultDocumentSearchIntent,
} from "./vault/vaultDocumentSearchRouting";
import { scoreVaultOperationalReviewIntent } from "./vault/vaultOperationalReviewRouting";
import { scoreSalesPerformanceQueryFocus, isDeliveryPlatformPeriodQuery } from "./vault/vaultSalesPerformanceIntelligence";
import {
  scoreVaultBusinessReasoningIntent,
  resolveWhyVaultCompare,
  detectWhyMetricFocus,
} from "./vault/vaultBusinessReasoningRouting";
import {
  isVaultDocumentSummaryQuery,
  scoreVaultDocumentSummaryIntent,
} from "./vault/vaultDocumentSummaryRouting";
import {
  isDriveDiscoveryApprovalCommand,
  isDriveDiscoveryCommand,
} from "./vault/driveDiscoveryQueryTools";
import { normalizeAskNacQuestion } from "./nlu/normalizeQuestion";
import { resolveIntentFromScores } from "./nlu/resolveIntentAmbiguity";
import { applyMetricDefaultsToRoute } from "./nlu/metricDefaults";

export const ASK_NAC_INTENTS = Object.freeze({
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
  VAULT_CASH_UP_SUMMARY: "vault_cash_up_summary",
  VAULT_RECEPTION_SUMMARY: "vault_reception_summary",
  VAULT_LOGBOOK_SUMMARY: "vault_logbook_summary",
  VAULT_GOOGLE_REVIEW_STAR_SUMMARY: "vault_google_review_star_summary",
  VAULT_CCM_RECONCILIATION_SUMMARY: "vault_ccm_reconciliation_summary",
  VAULT_OPERATIONAL_DAY_SUMMARY: "vault_operational_day_summary",
  VAULT_MANAGEMENT_REPORT: "vault_management_report_from_vault",
  VAULT_COVERAGE_LIST: "vault_coverage_list",
  VAULT_DOCUMENT_SEARCH: "vault_document_search",
  VAULT_DOCUMENT_SUMMARY: "vault_document_summary",
  VAULT_OPERATIONAL_REVIEW: "vault_operational_review",
  VAULT_BUSINESS_REASONING: "vault_business_reasoning",
  VAULT_WEEKLY_DASHBOARD: "vault_weekly_dashboard",
  VAULT_TEACH_OPERATOR: "vault_teach_operator",
  VAULT_PROVIDE_MANUAL_INPUT: "vault_provide_manual_input",
  VAULT_DRIVE_DISCOVER: "vault_drive_discover",
  VAULT_DRIVE_APPROVE_RULES: "vault_drive_approve_rules",
  VAULT_DAILY_BRIEFING_SUMMARY: "vault_daily_briefing_summary",
  VAULT_BREAKAGE_SUMMARY: "vault_breakage_summary",
  VAULT_KNOWLEDGE_HEALTH: "vault_knowledge_health",
  UNKNOWN: "unknown",
});

const FOODICS_SALES_SIGNAL =
  /\b(sales|revenue|sold|net sales|gross sales|pos sales|foodics|waiter sales|product sales|top items?|best sellers?|category|categories)\b/;
const DOCUMENT_INTENT_SIGNAL =
  /\b(logbooks?|daily logbooks?|uploaded reports?|uploaded documents?|documents?|data vault|vault|company knowledge)\b/;
const CASH_UP_INTENT_SIGNAL =
  /\b(cash[\s-]?up|cashup|cash report|daily cash report|cash reconciliation|cash[\s-]?up sales)\b/;
const CASH_UP_DAY_SALES_SIGNAL =
  /\b(net sales|gross sales|cash sales|card sales|delivery sales|total sales|revenue)\b/;
const CASH_UP_PERIOD_SALES_SIGNAL =
  /\b(sales|revenue|guests?|delivery|orders?|spend|average|compare)\b/;

const BRANCH_ALIASES = Object.freeze({
  khobar: ["khobar", "al khobar", "alkhobar"],
  riyadh: ["riyadh", "riyad"],
  jeddah: ["jeddah", "jedda"],
});

const INTENT_RULES = [
  {
    id: ASK_NAC_INTENTS.VAULT_TEACH_OPERATOR,
    score(q) {
      if (/^teach nac:\s*.+/i.test(q)) return 50;
      if (/^remember this:\s*.+/i.test(q)) return 50;
      if (/^save as operator knowledge:\s*.+/i.test(q)) return 50;
      return 0;
    },
  },
  {
    id: ASK_NAC_INTENTS.VAULT_WEEKLY_DASHBOARD,
    score(q) {
      if (/\bgenerate\b.*\b(weekly dashboard|khobar dashboard|dashboard for week)\b/i.test(q)) return 38;
      if (/\bweekly dashboard\b/i.test(q) && /\bgenerate\b/i.test(q)) return 36;
      if (/\bdashboard for week ending\b/i.test(q)) return 36;
      return 0;
    },
  },
  {
    id: ASK_NAC_INTENTS.VAULT_OPERATIONAL_REVIEW,
    score(q) {
      return scoreVaultOperationalReviewIntent(q);
    },
  },
  {
    id: ASK_NAC_INTENTS.VAULT_DOCUMENT_SUMMARY,
    score(q, options = {}) {
      return scoreVaultDocumentSummaryIntent(q, options.documentContext);
    },
  },
  {
    id: ASK_NAC_INTENTS.VAULT_DOCUMENT_SEARCH,
    score(q) {
      return scoreVaultDocumentSearchIntent(q);
    },
  },
  {
    id: ASK_NAC_INTENTS.VAULT_MANAGEMENT_REPORT,
    score(q) {
      if (isVaultDocumentSearchQuery(q)) return 0;
      if (!parseVaultPeriodFromQuestion(q)) return 0;
      if (/\b(management report|generate report|executive report)\b/.test(q)) return 20;
      if (/\b(summarize|summary report).*\b(operation|branch)\b/.test(q) && /\b(report)\b/.test(q)) {
        return 18;
      }
      return 0;
    },
  },
  {
    id: ASK_NAC_INTENTS.VAULT_OPERATIONAL_DAY_SUMMARY,
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
    id: ASK_NAC_INTENTS.VAULT_DRIVE_APPROVE_RULES,
    score(q) {
      if (isDriveDiscoveryApprovalCommand(q)) return 46;
      return 0;
    },
  },
  {
    id: ASK_NAC_INTENTS.VAULT_KNOWLEDGE_HEALTH,
    score(q) {
      if (/\b(health check|knowledge health)\b/i.test(q)) return 46;
      if (/\bwhat am i missing\b/i.test(q)) return 44;
      if (/\bdashboard readiness\b/i.test(q)) return 43;
      if (/\bwhy is confidence low\b|\bwhy.*confidence.*low\b/i.test(q)) return 42;
      return 0;
    },
  },
  {
    id: ASK_NAC_INTENTS.VAULT_DRIVE_DISCOVER,
    score(q) {
      if (isDriveDiscoveryCommand(q)) return 44;
      return 0;
    },
  },
  {
    id: ASK_NAC_INTENTS.VAULT_COVERAGE_LIST,
    score(q) {
      if (/\b(which uploaded files|uploaded files cover|files cover|data coverage|what data do we have|summarize uploaded files)\b/.test(q)) {
        return 18;
      }
      if (/\b(coverage|uploaded data)\b/.test(q) && parseVaultPeriodFromQuestion(q)) return 16;
      return 0;
    },
  },
  {
    id: ASK_NAC_INTENTS.VAULT_GOOGLE_REVIEW_STAR_SUMMARY,
    score(q) {
      if (isVaultDocumentSearchQuery(q)) return 0;
      if (!parseVaultPeriodFromQuestion(q)) return 0;
      if (/\b(5[\s-]?star|five star|google review star|star reviews?)\b/.test(q)) return 17;
      if (/\bgoogle reviews?\b/.test(q) && hasVaultDayPeriod(q)) return 14;
      return 0;
    },
  },
  {
    id: ASK_NAC_INTENTS.VAULT_RECEPTION_SUMMARY,
    score(q) {
      if (!parseVaultPeriodFromQuestion(q)) return 0;
      if (/\b(reservations?|covers|walk[\s-]?ins?|no[\s-]?shows?|cancellations?|reception)\b/.test(q)) {
        return 16;
      }
      return 0;
    },
  },
  {
    id: ASK_NAC_INTENTS.VAULT_CCM_RECONCILIATION_SUMMARY,
    score(q) {
      if (!parseVaultPeriodFromQuestion(q)) return 0;
      if (/\b(ccm|reconciliation|reconcile)\b/.test(q)) return 16;
      return 0;
    },
  },
  {
    id: ASK_NAC_INTENTS.VAULT_BUSINESS_REASONING,
    score(q) {
      return scoreVaultBusinessReasoningIntent(q);
    },
  },
  {
    id: ASK_NAC_INTENTS.VAULT_CASH_UP_SUMMARY,
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
    id: ASK_NAC_INTENTS.VAULT_LOGBOOK_SUMMARY,
    score(q) {
      if (isVaultDocumentSearchQuery(q)) return 0;
      if (isVaultDocumentSummaryQuery(q)) return 0;
      if (!parseVaultPeriodFromQuestion(q)) return 0;
      if (/\b(logbook|complaints?|training notes?|mod on duty|chef on duty|operational issues?)\b/.test(q)) {
        return 15;
      }
      return 0;
    },
  },
  {
    id: ASK_NAC_INTENTS.VAULT_DAILY_BRIEFING_SUMMARY,
    score(q) {
      if (isVaultDocumentSearchQuery(q)) return 0;
      if (!parseVaultPeriodFromQuestion(q)) return 0;
      if (/\b(daily briefing|briefing)\b/.test(q) && /\b(summarize|summary|reservations?|mod|staffing|focus)\b/.test(q)) {
        return 16;
      }
      if (/\bsummarize\b.*\bdaily briefing\b/.test(q)) return 17;
      return 0;
    },
  },
  {
    id: ASK_NAC_INTENTS.VAULT_BREAKAGE_SUMMARY,
    score(q) {
      if (!parseVaultPeriodFromQuestion(q)) return 0;
      if (/\b(breakage|broken glass|asset loss|spillage|wastage)\b/.test(q)) {
        return 16;
      }
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
      if (/\b(delivery|hungerstation|jahez|talabat|keeta|aggregator)\b/.test(q)) return 12;
      if (/\b(platform sales|delivery sales|delivery revenue)\b/.test(q)) return 13;
      return 0;
    },
  },
  {
    id: ASK_NAC_INTENTS.GOOGLE_REVIEWS,
    score(q) {
      if (isVaultDocumentSearchQuery(q)) return 0;
      if (/\b(redirect|qr scan|review qr|review card)\b/.test(q)) return 0;
      if (/\bhow many google reviews\b/.test(q)) return 17;
      if (/\bgoogle review count\b/.test(q)) return 17;
      if (/\bgoogle reviews\b/.test(q)) return 16;
      if (/\bhow many reviews\b/.test(q)) return 15;
      if (/\breviews?\b/.test(q) && /\b(last month|this month|month|may|june|july|august|september|october|november|december|january|february|march|april)\b/.test(q)) {
        return 15;
      }
      if (/^\s*reviews\s*$/.test(q)) return 14;
      if (/\b(actual google review|published review|new google review)\b/.test(q)) return 14;
      if (/\breviews on google\b/.test(q)) return 12;
      return 0;
    },
  },
  {
    id: ASK_NAC_INTENTS.ITEM_RANK_CHANGE,
    score(q) {
      if (/\b(entered|joined|new in|moved into|rank change|rank changes)\b.*\btop\b/.test(q)) return 16;
      if (/\b(item rank change|rank changes)\b/.test(q)) return 15;
      if (/\b(dropped|fell|left|removed from)\b.*\btop\b/.test(q)) return 16;
      if (/\b(which item).*(entered|dropped|left|joined)\b.*\btop\b/.test(q)) return 15;
      if (/\b(top \d+|top ten)\b.*\b(compare|compared|vs|versus|change|movement)\b/.test(q)) return 12;
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
      if (/\b(which item|what item).*(sell|sold|popular)\b/.test(q)) return 14;
      if (/\b(rank items?|ranking)\b/.test(q)) return 12;
      return 0;
    },
  },
  {
    id: ASK_NAC_INTENTS.CATEGORY_SALES,
    score(q) {
      if (/\b(top category|category.*most|most.*category)\b/.test(q)) return 16;
      if (/\b(category|categories)\b.*\b(sales|revenue|sold|most|highest|generated|top)\b/.test(q)) return 15;
      if (/\b(which category|category revenue|category sales)\b/.test(q)) return 14;
      return 0;
    },
  },
  {
    id: ASK_NAC_INTENTS.BRANCH_SALES,
    score(q) {
      if (!FOODICS_SALES_SIGNAL.test(q)) return 0;
      if (/\b(branch sales|branch net sales|sales by branch|branch revenue|net sales by branch|branch net sales comparison)\b/.test(q)) return 16;
      if (/\b(net sales|sales|revenue).*\b(by branch|each branch|per branch|all branches)\b/.test(q)) return 14;
      if (/\b(which branch).*(sales|revenue|sold most)\b/.test(q)) return 14;
      if (/\bbranch sales\b/.test(q)) return 13;
      return 0;
    },
  },
  {
    id: ASK_NAC_INTENTS.SALES_TOTAL,
    score(q) {
      if (DOCUMENT_INTENT_SIGNAL.test(q)) return 0;
      if (CASH_UP_INTENT_SIGNAL.test(q)) return 0;
      if (parseVaultPeriodFromQuestion(q)?.isSingleDay && CASH_UP_DAY_SALES_SIGNAL.test(q)) return 0;
      if (/\b(sales|revenue)\s+(today|this week|this month|yesterday)\b/.test(q)) return 13;
      if (hasVaultDayPeriod(q)) return 0;
      if (/\b(total sales|sales total|what were sales|how much sales|sales in|sales for|revenue in|revenue for)\b/.test(q)) {
        return 13;
      }
      if (FOODICS_SALES_SIGNAL.test(q) && /\b(total|how much|what were)\b/.test(q) && !/\btop\b/.test(q)) {
        return 11;
      }
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
      if (/\b(pos sales|import batch|waiter sales|product sales)\b/.test(q)) return 7;
      return 0;
    },
  },
  {
    id: ASK_NAC_INTENTS.STAFF_REDIRECT_LEADERBOARD,
    score(q) {
      if (/\b(staff|waiter|waitress|server|employee)\b/.test(q) && /\b(top|best|winning|leaderboard|rank)\b/.test(q)) {
        return /\breviews?\b/.test(q) && !/\bredirect/.test(q) ? 19 : 18;
      }
      if (/\b(waiter|waitress|server|employee).*(perform|performance|best|top)\b/.test(q)) return 17;
      if (/\bperform(s|ing)? best\b/.test(q) && /\b(waiter|waitress|server|staff|employee)\b/.test(q)) return 17;
      if (/\b(staff|waiter|waitress|server|employee).*(leaderboard|top|best|rank|drove|drive|most)\b/.test(q)) return 14;
      if (/\b(who|which).*(staff|waiter|employee).*(redirect|google)\b/.test(q)) return 15;
      if (/\b(who|which).*(drove|drive).*(most).*(redirect|google)\b/.test(q)) return 16;
      if (/\b(who|which).*(most).*(google redirect|redirects|redirect)\b/.test(q)) return 15;
      if (/\b(leaderboard|top staff|top waiters|best waiter)\b/.test(q)) return 12;
      return 0;
    },
  },
  {
    id: ASK_NAC_INTENTS.OPERATIONAL_KNOWLEDGE,
    score(q) {
      if (/\bfind mentions of\b/.test(q)) return 0;
      if (/\bsearch uploaded reports for\b/.test(q)) return 0;
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
      if (/\b(which branch is performing|performing best|performing better|best overall|which location is winning|location is winning)\b/.test(q)) {
        return 19;
      }
      if (/\bgoogle maps\b/.test(q) && /\b(perform|performance|better|overall|compare|winning)\b/.test(q)) return 19;
      if (/\bgoogle maps performance\b/.test(q)) return 19;
      if (/\b(which branch improved|improved the most|most improvement|biggest improvement)\b/.test(q)) return 18;
      if (/\b(khobar|riyadh|jeddah|branch).*\bimprove(d|ment)?\b/.test(q)) return 18;
      if (/\bdid\b.*\bimprove\b/.test(q)) return 17;
      if (/\bimprove(d|ment)?\b.*\b(khobar|riyadh|jeddah)\b/.test(q)) return 17;
      if (/\b(stars? (gained|added)|how many stars|review(s)? (gained|added)|since follow[\s-]?up)\b/.test(q)) return 18;
      if (/\b(what should (i|we|management) focus|focus on this week|management focus|priorit(y|ies) this week)\b/.test(q)) {
        return 18;
      }
      if (/\b(which manager|manager.*(impact|biggest influence|having the biggest))\b/.test(q)) return 17;
      if (/\b(needs attention|weakest branch|underperforming branch|branch needs attention)\b/.test(q)) return 17;
      if (/\b(executive|network health|operational score|command center|management insight)\b/.test(q)) return 16;
      if (/\bcompare all branches\b/.test(q)) return 15;
      if (/\bwhat changed since\b/.test(q)) return 16;
      return 0;
    },
  },
  {
    id: ASK_NAC_INTENTS.BRANCH_COMPARISON,
    score(q) {
      if (/\bcompare branches\b/.test(q)) return 15;
      if (/\b(khobar|riyadh|jeddah).*(vs|versus|compare|outperform)\b/.test(q)) return 14;
      if (/\b(branch|branches|location).*(compare|comparison|strongest|weakest)\b/.test(q)) return 12;
      if (/\b(cross.?branch|multi.?branch|which branch)\b/.test(q)) return 11;
      return 0;
    },
  },
  {
    id: ASK_NAC_INTENTS.GOOGLE_REDIRECTS,
    score(q) {
      if (/\b(staff|waiter|employee|who|which)\b/.test(q)) return 0;
      if (/\bgoogle redirect/.test(q)) return 14;
      if (/\b(redirect|redirects)\b/.test(q) && /\b(google|review page)\b/.test(q)) return 12;
      if (/\bhow many.*redirect/.test(q)) return 10;
      return 0;
    },
  },
  {
    id: ASK_NAC_INTENTS.REVIEW_QR_SCANS,
    score(q) {
      if (/\b(review qr|review card|review portal).*(scan|tap|open)\b/.test(q)) return 14;
      if (/\b(review qr scans|review scans)\b/.test(q)) return 13;
      if (/\bhow many review qr\b/.test(q)) return 12;
      return 0;
    },
  },
  {
    id: ASK_NAC_INTENTS.MENU_QR_SCANS,
    score(q) {
      if (/\b(menu qr|menu scan|qr scan).*\b(menu|digital menu)\b/.test(q)) return 14;
      if (/\b(menu qr scans|menu scans|qr scans)\b/.test(q) && !/\breview\b/.test(q)) return 13;
      if (/\bqr scans?\b/.test(q) && !/\breview\b/.test(q)) return 12;
      if (/\bhow many (menu )?(qr|scan)/.test(q) && !/\breview\b/.test(q)) return 11;
      return 0;
    },
  },
  {
    id: ASK_NAC_INTENTS.MENU_SESSIONS,
    score(q) {
      if (/\b(menu session|menu sessions|digital menu session)\b/.test(q)) return 14;
      if (/\bhow many session/.test(q) && !/\breview\b/.test(q)) return 11;
      if (/\b(session count|total sessions|guest sessions)\b/.test(q) && !/\breview\b/.test(q)) return 10;
      return 0;
    },
  },
];

/** Parse period from question; falls back to filter hours. */
export function parseAskNacPeriod(question = "", fallbackHours = 24) {
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
  if (/\b(today|business day)\b/.test(q)) {
    return { hours: 24, rangeId: "today", source: "question" };
  }
  const fb = Number(fallbackHours) || 24;
  return { hours: fb, rangeId: hoursToRange(fb), source: "filters" };
}

/** Extract branch mention from question. */
export function parseAskNacBranch(question = "") {
  const q = String(question || "").toLowerCase();
  for (const [id, aliases] of Object.entries(BRANCH_ALIASES)) {
    if (aliases.some((a) => q.includes(a))) {
      return normalizeBranchId(id);
    }
  }
  return null;
}

export function detectExecutiveAnalysisKind(question = "") {
  const q = String(question || "").toLowerCase();
  if (/\b(stars? (gained|added)|how many stars|reviews? (gained|added)|since follow[\s-]?up)\b/.test(q)) {
    return "stars_gained";
  }
  if (/\b(focus on|priorit(y|ies)|what should (i|we|management)|this week)\b/.test(q)) return "management_focus";
  if (/\b(manager|management).*(impact|biggest|influence)\b/.test(q)) return "manager_impact";
  if (/\b(improved|improvement|momentum|gaining ground)\b/.test(q)) return "improved_most";
  if (/\b(needs attention|weakest|underperform|concern|struggling)\b/.test(q)) return "needs_attention";
  if (/\b(google maps|maps performance|google rating)\b/.test(q)) return "google_maps";
  if (/\b(best overall|performing best|performing better|winning|strongest)\b/.test(q)) return "best_overall";
  return "general";
}

/**
 * @returns {{ intent: string, confidence: string, score: number, period: object, branchMention: string|null, debug: object }}
 */
export function routeAskNacIntent(question, options = {}) {
  const normalized = normalizeAskNacQuestion(question);
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

  const scored = INTENT_RULES.map((rule) => ({
    id: rule.id,
    score: rule.score(q, options),
  }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);

  const resolved = resolveIntentFromScores(scored, q, normalized.hints);
  let intent = resolved.intent;
  let score = resolved.score;
  let confidence = resolved.confidence;

  let route = {
    intent,
    confidence,
    score,
    period,
    branchMention,
    foodicsPeriod: isFoodicsDataIntent(intent) ? parseFoodicsPeriodFromQuestion(normalized.text) : null,
    foodicsCompare: isFoodicsCompareIntent(intent) ? parseFoodicsComparePeriods(normalized.text) : null,
    rankingBasis: isFoodicsDataIntent(intent) ? detectRankingBasis(normalized.text) : null,
    topLimit: isFoodicsDataIntent(intent) ? detectTopLimit(normalized.text) : null,
    rankChangeDirection:
      intent === ASK_NAC_INTENTS.ITEM_RANK_CHANGE ? detectRankChangeDirection(normalized.text) : null,
    vaultPeriod: parseVaultPeriodFromQuestion(normalized.text),
    executiveKind:
      intent === ASK_NAC_INTENTS.EXECUTIVE_ANALYSIS ? detectExecutiveAnalysisKind(normalized.text) : null,
    debug: {
      topMatches: scored.slice(0, 3),
      branchLabel: branchMention ? branchDisplayName(branchMention) : null,
      periodHours: period.hours,
      rangeId: period.rangeId,
      nlu: {
        normalizedQuestion: normalized.text,
        appliedRules: normalized.appliedRules,
        hints: normalized.hints,
        ambiguity: resolved.ambiguity || null,
      },
    },
  };

  route = applyMetricDefaultsToRoute(route, normalized.text, normalized.hints);

  const vaultCompare = intent === ASK_NAC_INTENTS.VAULT_BUSINESS_REASONING
    ? (resolveWhyVaultCompare(normalized.text) || parseVaultComparePeriodsFromQuestion(normalized.text))
    : parseVaultComparePeriodsFromQuestion(normalized.text);
  route.vaultPeriod = vaultCompare?.current || route.vaultPeriod;
  route.vaultCompare = vaultCompare || null;
  if (intent === ASK_NAC_INTENTS.VAULT_BUSINESS_REASONING) {
    route.whyMetricFocus = detectWhyMetricFocus(normalized.text);
  }

  route.debug.foodicsPeriod = route.foodicsPeriod;
  route.debug.vaultPeriod = route.vaultPeriod;
  route.debug.rankingBasis = route.rankingBasis;
  route.debug.topLimit = route.topLimit;

  return route;
}

export function isVaultDocumentSearchIntent(intent) {
  return intent === ASK_NAC_INTENTS.VAULT_DOCUMENT_SEARCH;
}

export function isVaultDocumentSummaryIntent(intent) {
  return intent === ASK_NAC_INTENTS.VAULT_DOCUMENT_SUMMARY;
}

export function isVaultDocumentIntent(intent) {
  return (
    isVaultDocumentSearchIntent(intent)
    || isVaultDocumentSummaryIntent(intent)
    || intent === ASK_NAC_INTENTS.VAULT_OPERATIONAL_REVIEW
  );
}

export function isVaultDataIntent(intent) {
  return [
    ASK_NAC_INTENTS.VAULT_CASH_UP_SUMMARY,
    ASK_NAC_INTENTS.VAULT_RECEPTION_SUMMARY,
    ASK_NAC_INTENTS.VAULT_LOGBOOK_SUMMARY,
    ASK_NAC_INTENTS.VAULT_DAILY_BRIEFING_SUMMARY,
    ASK_NAC_INTENTS.VAULT_BREAKAGE_SUMMARY,
    ASK_NAC_INTENTS.VAULT_GOOGLE_REVIEW_STAR_SUMMARY,
    ASK_NAC_INTENTS.VAULT_CCM_RECONCILIATION_SUMMARY,
    ASK_NAC_INTENTS.VAULT_OPERATIONAL_DAY_SUMMARY,
    ASK_NAC_INTENTS.VAULT_MANAGEMENT_REPORT,
    ASK_NAC_INTENTS.VAULT_COVERAGE_LIST,
    ASK_NAC_INTENTS.VAULT_BUSINESS_REASONING,
    ASK_NAC_INTENTS.VAULT_WEEKLY_DASHBOARD,
    ASK_NAC_INTENTS.VAULT_TEACH_OPERATOR,
    ASK_NAC_INTENTS.VAULT_PROVIDE_MANUAL_INPUT,
    ASK_NAC_INTENTS.VAULT_DRIVE_DISCOVER,
    ASK_NAC_INTENTS.VAULT_DRIVE_APPROVE_RULES,
    ASK_NAC_INTENTS.VAULT_KNOWLEDGE_HEALTH,
  ].includes(intent);
}

export function vaultReportTypesForIntent(intent) {
  const map = {
    [ASK_NAC_INTENTS.VAULT_CASH_UP_SUMMARY]: ["cash_up"],
    [ASK_NAC_INTENTS.VAULT_RECEPTION_SUMMARY]: ["reception_daily_report", "daily_logbook"],
    [ASK_NAC_INTENTS.VAULT_LOGBOOK_SUMMARY]: ["daily_logbook"],
    [ASK_NAC_INTENTS.VAULT_DAILY_BRIEFING_SUMMARY]: ["daily_briefing"],
    [ASK_NAC_INTENTS.VAULT_BREAKAGE_SUMMARY]: ["breakage_report"],
    [ASK_NAC_INTENTS.VAULT_GOOGLE_REVIEW_STAR_SUMMARY]: ["daily_logbook", "reception_daily_report"],
    [ASK_NAC_INTENTS.VAULT_CCM_RECONCILIATION_SUMMARY]: ["ccm_reconciliation"],
    [ASK_NAC_INTENTS.VAULT_OPERATIONAL_DAY_SUMMARY]: [
      "cash_up",
      "reception_daily_report",
      "daily_logbook",
      "ccm_reconciliation",
    ],
    [ASK_NAC_INTENTS.VAULT_MANAGEMENT_REPORT]: [
      "cash_up",
      "reception_daily_report",
      "daily_logbook",
      "ccm_reconciliation",
    ],
    [ASK_NAC_INTENTS.VAULT_COVERAGE_LIST]: [],
    [ASK_NAC_INTENTS.VAULT_KNOWLEDGE_HEALTH]: [],
  };
  return map[intent] || [];
}

export function isFoodicsDataIntent(intent) {
  return [
    ASK_NAC_INTENTS.SALES_TOTAL,
    ASK_NAC_INTENTS.TOP_ITEMS,
    ASK_NAC_INTENTS.TOP_ITEMS_COMPARE,
    ASK_NAC_INTENTS.ITEM_RANK_CHANGE,
    ASK_NAC_INTENTS.CATEGORY_SALES,
    ASK_NAC_INTENTS.BRANCH_SALES,
    ASK_NAC_INTENTS.FOODICS_QUERY,
  ].includes(intent);
}

export function isFoodicsCompareIntent(intent) {
  return [
    ASK_NAC_INTENTS.TOP_ITEMS_COMPARE,
    ASK_NAC_INTENTS.ITEM_RANK_CHANGE,
  ].includes(intent);
}

export function isMissingDataIntent(intent) {
  return [
    ASK_NAC_INTENTS.AVG_SPEND_PER_GUEST,
    ASK_NAC_INTENTS.DELIVERY_SALES,
  ].includes(intent);
}

export function isRealDataIntent(intent) {
  return [
    ASK_NAC_INTENTS.MENU_QR_SCANS,
    ASK_NAC_INTENTS.MENU_SESSIONS,
    ASK_NAC_INTENTS.GOOGLE_REDIRECTS,
    ASK_NAC_INTENTS.REVIEW_QR_SCANS,
    ASK_NAC_INTENTS.STAFF_REDIRECT_LEADERBOARD,
    ASK_NAC_INTENTS.BRANCH_COMPARISON,
    ASK_NAC_INTENTS.EXECUTIVE_ANALYSIS,
    ASK_NAC_INTENTS.OPERATIONAL_KNOWLEDGE,
    ASK_NAC_INTENTS.SALES_TOTAL,
    ASK_NAC_INTENTS.TOP_ITEMS,
    ASK_NAC_INTENTS.TOP_ITEMS_COMPARE,
    ASK_NAC_INTENTS.ITEM_RANK_CHANGE,
    ASK_NAC_INTENTS.CATEGORY_SALES,
    ASK_NAC_INTENTS.BRANCH_SALES,
    ASK_NAC_INTENTS.GOOGLE_REVIEWS,
    ...Object.values(ASK_NAC_INTENTS).filter((id) => String(id).startsWith("vault_")),
  ].includes(intent);
}
