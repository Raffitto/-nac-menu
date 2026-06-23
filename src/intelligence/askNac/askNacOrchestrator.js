/**
 * Ask NAC orchestrator — route → readiness → read-only tools → deterministic answer.
 */

import { routeAskNacIntent, isFoodicsCompareIntent, isFoodicsDataIntent, ASK_NAC_INTENTS } from "./intentRouter";
import { assessIntentReadiness, assessIntentReadinessSync } from "./readinessEngine";
import { runAskNacQueryTool } from "./queryTools";
import { buildDeterministicAskNacAnswer } from "./answerBuilder";
import { resolveFoodicsPeriodWithFallback } from "./shared/periodFallback";
import { prepareAskNacQuestion, applyReviewPeriodDefaults } from "./conversation/prepareAskNacQuestion";
import { resolveHumanInTheLoopTurn } from "./executive/humanInLoopResolver";

/**
 * Process an Ask NAC question end-to-end (deterministic; optional AI wrap via options).
 *
 * @param {object} params
 * @param {string} params.question
 * @param {import('@supabase/supabase-js').SupabaseClient} params.supabase
 * @param {object} [params.profile] RBAC profile
 * @param {object} [params.filters] Platform filters (branch, timeRangeHours, …)
 * @param {object} [params.options] { openAiConfigured, explainFn }
 */
export async function processAskNacQuestion({
  question,
  supabase,
  profile = null,
  filters = {},
  conversationContext = null,
  session = null,
  options = {},
}) {
  const prepareResult = prepareAskNacQuestion({ question, conversationContext, filters });
  const effectiveQuestion = prepareResult.effectiveQuestion;
  const effectiveFilters = prepareResult.filters;
  const branch = effectiveFilters.branch || null;
  const userEmail = String(session?.user?.email || profile?.email || "").trim().toLowerCase() || null;

  const humanLoop = supabase
    ? await resolveHumanInTheLoopTurn({
      question,
      conversationContext,
      supabase,
      branch,
      userEmail,
    })
    : null;

  let route = routeAskNacIntent(effectiveQuestion, {
    fallbackHours: effectiveFilters.timeRangeHours ?? 24,
    documentContext: conversationContext?.lastDocumentContext || null,
  });

  if (humanLoop?.overrideIntent) {
    route = {
      ...route,
      intent: humanLoop.overrideIntent,
      debug: {
        ...route.debug,
        humanInLoop: true,
        resolutionNotes: humanLoop.resolutionNotes,
      },
    };
  }
  route = applyReviewPeriodDefaults(route, effectiveFilters);
  const periodFallbackWarnings = [];

  if (
    isFoodicsDataIntent(route.intent) &&
    route.intent !== ASK_NAC_INTENTS.FOODICS_QUERY &&
    !isFoodicsCompareIntent(route.intent) &&
    (!route.foodicsPeriod?.startDate || !route.foodicsPeriod?.endDate)
  ) {
    const resolved = await resolveFoodicsPeriodWithFallback(supabase, {
      question: effectiveQuestion,
      filters: effectiveFilters,
      branch: route.branchMention || effectiveFilters.branch,
      profile,
    });
    if (resolved.period?.startDate && resolved.period?.endDate) {
      route.foodicsPeriod = resolved.period;
      route.debug = { ...route.debug, foodicsPeriod: resolved.period, periodFallbackSource: resolved.source };
      periodFallbackWarnings.push(...(resolved.warnings || []));
    }
  }

  const readiness = await assessIntentReadiness(route.intent, {
    profile,
    branch: route.branchMention || effectiveFilters.branch,
    branchMention: route.branchMention,
    supabaseConfigured: Boolean(supabase),
    supabase,
    foodicsPeriod: route.foodicsPeriod,
    foodicsCompare: route.foodicsCompare,
    vaultPeriod: route.vaultPeriod,
    executiveKind: route.executiveKind,
    hours: route.period?.hours,
    question: effectiveQuestion,
  });

  const syncBlocked = assessIntentReadinessSync(route.intent, {
    profile,
    supabaseConfigured: Boolean(supabase),
    foodicsPeriod: route.foodicsPeriod,
    foodicsCompare: route.foodicsCompare,
    vaultPeriod: route.vaultPeriod,
    branchMention: route.branchMention,
    question: effectiveQuestion,
  });

  const effectiveReadiness = syncBlocked.status === "blocked" ? syncBlocked : readiness;

  let tool = null;
  if (effectiveReadiness.canQuery) {
    tool = await runAskNacQueryTool(supabase, route.intent, {
      hours: route.period.hours,
      period: route.period,
      branchMention: route.branchMention,
      filters: effectiveFilters,
      profile,
      session,
      userEmail,
      question: effectiveQuestion,
      searchTerms: effectiveReadiness.searchTerms,
      readiness: effectiveReadiness,
      documentContext: conversationContext?.lastDocumentContext || null,
      conversationContext,
      foodicsPeriod: route.foodicsPeriod,
      foodicsCompare: route.foodicsCompare,
      vaultPeriod: route.vaultPeriod,
      vaultCompare: route.vaultCompare,
      rankingBasis: route.rankingBasis,
      topLimit: route.topLimit,
      executiveKind: route.executiveKind,
      teachPayload: humanLoop?.teachPayload,
      manualInputPayload: humanLoop?.manualInputPayload,
      pendingSession: humanLoop?.pendingSession,
    });
  }

  const deterministic = buildDeterministicAskNacAnswer({ ...route, question: effectiveQuestion }, tool, effectiveReadiness);
  deterministic.readiness = effectiveReadiness;
  if (periodFallbackWarnings.length) {
    deterministic.warnings = [...(deterministic.warnings || []), ...periodFallbackWarnings];
  }

  const conversationResolution = {
    originalQuestion: prepareResult.originalQuestion,
    resolvedQuestion: effectiveQuestion,
    usedContext: Boolean(prepareResult.conversationResolution?.usedContext),
    resolutionNotes: [
      ...(prepareResult.conversationResolution?.resolutionNotes || []),
      ...(humanLoop?.resolutionNotes || []),
    ],
  };

  return {
    ...deterministic,
    intent: route.intent,
    routingConfidence: route.confidence,
    routingDebug: route.debug,
    conversationResolution,
    localFallback: true,
    aiConnected: false,
  };
}
