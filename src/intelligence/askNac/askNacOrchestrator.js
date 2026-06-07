/**
 * Ask NAC orchestrator — route → readiness → read-only tools → deterministic answer.
 */

import { routeAskNacIntent } from "./intentRouter";
import { assessIntentReadiness, assessIntentReadinessSync } from "./readinessEngine";
import { runAskNacQueryTool } from "./queryTools";
import { buildDeterministicAskNacAnswer, maybeEnhanceWithOpenAi } from "./answerBuilder";

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
  options = {},
}) {
  const fallbackHours = filters.timeRangeHours ?? 24;
  const route = routeAskNacIntent(question, { fallbackHours });

  const readiness = await assessIntentReadiness(route.intent, {
    profile,
    branch: route.branchMention || filters.branch,
    branchMention: route.branchMention,
    supabaseConfigured: Boolean(supabase),
    supabase,
    foodicsPeriod: route.foodicsPeriod,
    foodicsCompare: route.foodicsCompare,
    vaultPeriod: route.vaultPeriod,
  });

  const syncBlocked = assessIntentReadinessSync(route.intent, {
    profile,
    supabaseConfigured: Boolean(supabase),
    foodicsPeriod: route.foodicsPeriod,
    foodicsCompare: route.foodicsCompare,
    vaultPeriod: route.vaultPeriod,
    branchMention: route.branchMention,
  });

  const effectiveReadiness = syncBlocked.status === "blocked" ? syncBlocked : readiness;

  let tool = null;
  if (effectiveReadiness.canQuery) {
    tool = await runAskNacQueryTool(supabase, route.intent, {
      hours: route.period.hours,
      period: route.period,
      branchMention: route.branchMention,
      filters,
      profile,
      question,
      foodicsPeriod: route.foodicsPeriod,
      foodicsCompare: route.foodicsCompare,
      vaultPeriod: route.vaultPeriod,
      rankingBasis: route.rankingBasis,
      topLimit: route.topLimit,
    });
  }

  const deterministic = buildDeterministicAskNacAnswer(route, tool, effectiveReadiness);
  deterministic.readiness = effectiveReadiness;

  const enhanced = await maybeEnhanceWithOpenAi(
    deterministic,
    { route, tool, readiness: effectiveReadiness },
    options,
  );

  return {
    ...enhanced,
    intent: route.intent,
    routingConfidence: route.confidence,
    routingDebug: route.debug,
  };
}
