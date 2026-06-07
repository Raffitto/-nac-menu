import { MONTH_HOURS } from "../../../dashboard/utils/rangeState";
import { ASK_NAC_INTENTS } from "../intentRouter";
import { resolveFollowUpQuestion } from "./resolveFollowUpQuestion";
import { updateConversationContext } from "./conversationContext";

/**
 * Prepare question for routing with optional conversational follow-up resolution.
 */
export function prepareAskNacQuestion({
  question,
  conversationContext = null,
  filters = {},
}) {
  const resolution = conversationContext
    ? resolveFollowUpQuestion(question, conversationContext)
    : { resolvedQuestion: question, usedContext: false, resolutionNotes: [] };

  const effectiveQuestion = resolution.resolvedQuestion || question;
  const effectiveFilters = { ...filters };

  if (resolution.usedContext && conversationContext?.lastPeriod && !effectiveFilters.selectedRange) {
    effectiveFilters.selectedRange = conversationContext.lastPeriod;
  }

  return {
    originalQuestion: question,
    effectiveQuestion,
    conversationResolution: resolution,
    filters: effectiveFilters,
  };
}

/**
 * Apply intelligent review-period defaults after routing when question omits period.
 */
export function applyReviewPeriodDefaults(route, filters = {}) {
  if (!route?.period || route.period.source === "question") return route;

  const reviewIntents = [
    ASK_NAC_INTENTS.MENU_QR_SCANS,
    ASK_NAC_INTENTS.MENU_SESSIONS,
    ASK_NAC_INTENTS.GOOGLE_REDIRECTS,
    ASK_NAC_INTENTS.REVIEW_QR_SCANS,
    ASK_NAC_INTENTS.STAFF_REDIRECT_LEADERBOARD,
    ASK_NAC_INTENTS.BRANCH_COMPARISON,
  ];

  if (!reviewIntents.includes(route.intent)) return route;

  const filterHours = Number(filters.timeRangeHours) || 24;
  const filterRange = filters.selectedRange || null;

  if (filterRange === "month" || filterHours >= MONTH_HOURS) {
    return {
      ...route,
      period: { hours: MONTH_HOURS, rangeId: "month", source: "filters" },
      debug: { ...route.debug, periodDefault: "global_filter_mtd" },
    };
  }

  if (filterHours >= 168) {
    return {
      ...route,
      period: { hours: 168, rangeId: "7d", source: "filters" },
      debug: { ...route.debug, periodDefault: "global_filter_7d" },
    };
  }

  return route;
}

export function buildConversationMeta(prepareResult, response, route) {
  return {
    originalQuestion: prepareResult.originalQuestion,
    resolvedQuestion: prepareResult.effectiveQuestion,
    usedContext: Boolean(prepareResult.conversationResolution?.usedContext),
    resolutionNotes: prepareResult.conversationResolution?.resolutionNotes || [],
    nextContext: updateConversationContext({}, {
      question: prepareResult.originalQuestion,
      resolvedQuestion: prepareResult.effectiveQuestion,
      response,
      route,
    }),
  };
}
