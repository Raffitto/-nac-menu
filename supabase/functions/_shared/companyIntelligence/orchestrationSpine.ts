/**
 * Company Intelligence Fabric — authoritative orchestration spine v1.
 * Legacy Ask NAC tools are reused via CapabilityExecutor; Fabric owns state.
 */

import {
  planManagementQuestion,
  planManagementQuestionHeuristic,
  looksLikeManagementCommercialQuestion,
  looksLikeOperationalManagementQuestion,
  buildManagementPlannerSystemPrompt,
  buildManagementPlannerUserPayload,
  parseManagementPlanFromModelContent,
} from "../askNacManagementPlanner.ts";
import { assessComparability } from "./comparabilityEngine.ts";
import { assembleClaimsFromEvidence } from "./claimAssembly.ts";
import {
  createMockCapabilityExecutor,
  executeBuiltinCapability,
  normalizeCapabilityResultToEvidence,
  withNormalizedCapabilityResult,
  type CapabilityExecutor,
  type CapabilityExecutionResult,
} from "./capabilityResolver.ts";
import { critiqueEvidence } from "./evidenceCritic.ts";
import { assessFeasibility } from "./feasibilityGate.ts";
import { buildInfeasibleComparisonAnswer } from "./askNacFabricBridge.ts";
import { isPeriodOnlyFollowUpTurn, resolveFabricFollowUp } from "./conversationFollowUp.ts";
import { extractCommercialMetric, extractAnalysisIntent, hasComparisonIntent, isSubjectiveJudgementTurn, isFabricManagedTurn } from "./turnSemantics.ts";
import { HISTORY_LOOKBACK_DAYS } from "./managementAnalyst.ts";
import { isBroadManagementQuestion } from "./managementReasoning.ts";
import { parseVaultPeriodFromQuestion } from "../vaultPeriodParser.ts";
import type { StructuredConversationState } from "./conversationState.ts";
import { synthesizeDeterministicAnswer } from "./deterministicSynthesis.ts";
import { answerPublishedCommerce, missingSessionEvidenceAnswer, type PublishedCommerce } from "./commerce/synthesis.ts";
import { requiresDineInSessionEvidence } from "./commerce/intent.ts";
import type { NormalizedDailyFact, NormalizedRanking } from "./normalizedCapabilityResult.ts";
import type { CanonicalMatchedPair } from "../cashUpMatchedCoverageComparison.ts";
import {
  createCompanyIntelligenceState,
  patchIntelligenceState,
  type CompanyIntelligenceState,
  type FabricStage,
} from "./intelligenceState.ts";
import { defaultBusinessTimeline } from "./businessTimeline.ts";
import { detectHolidayQuestionIntent } from "./holidayCalendar.ts";
import { defaultTemporalService } from "./temporalService.ts";
import { decideResearchBudget } from "./researchBudget.ts";
import { validateCapabilityPlan } from "./planValidation.ts";
import {
  CAPABILITY_REGISTRY,
  type CapabilityId,
  isRegisteredCapability,
} from "./capabilityRegistry.ts";
import { createModelGateway, loadModelGatewayConfig, type ModelGateway } from "./modelGateway.ts";
import { verifySynthesizedAnswer } from "./answerVerifier.ts";
import { estimateOpenAiMiniCostUsd } from "./telemetry.ts";
import {
  createIntelligenceScope,
  normalizeBranchId,
  type IntelligenceScope,
} from "./scope.ts";

export type OrchestrationOptions = {
  question: string;
  branchHint?: string | null;
  /** Authoritative authenticated + authorized scope (preferred over branchHint alone). */
  scope?: IntelligenceScope | null;
  threadId?: string | null;
  conversation?: StructuredConversationState | null;
  referenceDate?: Date;
  /** Existing routeIntent snapshot (optional fast-path hint). */
  legacyRoute?: {
    intent?: string;
    confidence?: string;
    branchMention?: string | null;
  } | null;
  executor?: CapabilityExecutor | null;
  gateway?: ModelGateway | null;
  /** Force heuristic planner / no cloud synthesize. */
  mode?: "auto" | "heuristic" | "offline";
  maxPaidCalls?: number;
  publishedCommerce?: PublishedCommerce | null;
};

export type OrchestrationResult = {
  state: CompanyIntelligenceState;
  answerText: string;
  answerType: string;
  keyMetrics: Array<{ label: string; value: unknown; unit?: string; source?: string }>;
  insights: string[];
  nextConversation: StructuredConversationState;
  toolsExecuted: string[];
  paidModelCalls: number;
};

const INTENT_CAPABILITIES: Record<string, CapabilityId[]> = {
  performance_overview: ["commercial.performance", "commercial.compare"],
  period_compare: ["commercial.compare", "commercial.performance"],
  trend_analysis: ["commercial.trend", "commercial.compare"],
  day_ranking: ["commercial.rank_days"],
  operational_review: ["operations.review"],
  issue_detection: ["commercial.performance", "commercial.compare", "commercial.rank_days", "operations.review"],
  briefing_summary: ["commercial.performance", "operations.review"],
  management_summary: ["commercial.performance", "operations.review"],
  branch_compare: ["company.scope_compare"],
  cost_margin: ["cost.margin_analysis", "commercial.performance"],
  factual_lookup: ["commercial.performance"],
  event_forecast: ["commercial.forecast", "commercial.performance", "calendar.resolve_period"],
  commerce_session: ["commerce.session_mix", "commerce.compare_mix"],
  unsupported: [],
};

const TOOL_TO_CAPABILITY: Record<string, CapabilityId> = {
  cash_up_performance: "commercial.performance",
  cash_up_compare: "commercial.compare",
  cash_up_day_ranking: "commercial.rank_days",
  event_forecast: "commercial.forecast",
  operational_evidence: "operations.review",
  branch_compare: "company.scope_compare",
};

function transition(state: CompanyIntelligenceState, stage: FabricStage, patch: Partial<CompanyIntelligenceState> = {}) {
  return patchIntelligenceState(state, { ...patch, stage });
}

function collectRankingsAndFacts(state: CompanyIntelligenceState): {
  rankings: NormalizedRanking[];
  dailyFacts: NormalizedDailyFact[];
  historyDailyFacts: NormalizedDailyFact[];
  previousDailyFacts: NormalizedDailyFact[];
  comparisonMode: string | null;
  matchedPairs: CanonicalMatchedPair[];
} {
  const rankings: NormalizedRanking[] = [];
  const dailyMap = new Map<string, NormalizedDailyFact>();
  const historyMap = new Map<string, NormalizedDailyFact>();
  const previousMap = new Map<string, NormalizedDailyFact>();
  let comparisonMode: string | null = null;
  let matchedPairs: CanonicalMatchedPair[] = [];
  for (const row of Object.values(state.toolResults || {})) {
    const tr = row as Record<string, unknown>;
    if (Array.isArray(tr.rankings)) rankings.push(...tr.rankings as NormalizedRanking[]);
    if (Array.isArray(tr.dailyFacts)) {
      for (const fact of tr.dailyFacts as NormalizedDailyFact[]) {
        if (fact?.date) dailyMap.set(fact.date, fact);
      }
    }
    if (Array.isArray(tr.historyDailyFacts)) {
      for (const fact of tr.historyDailyFacts as NormalizedDailyFact[]) {
        if (fact?.date) historyMap.set(fact.date, fact);
      }
    }
    if (Array.isArray(tr.previousDailyFacts)) {
      for (const fact of tr.previousDailyFacts as NormalizedDailyFact[]) {
        if (fact?.date) previousMap.set(fact.date, fact);
      }
    }
    const comparison = tr.comparison as { mode?: string; matchedPairs?: CanonicalMatchedPair[] } | null;
    if (!comparisonMode && comparison?.mode) comparisonMode = comparison.mode;
    if (!matchedPairs.length && Array.isArray(comparison?.matchedPairs) && comparison.matchedPairs.length) {
      matchedPairs = comparison.matchedPairs;
    }
  }
  return {
    rankings,
    dailyFacts: [...dailyMap.values()].sort((a, b) => a.date.localeCompare(b.date)),
    historyDailyFacts: [...historyMap.values()].sort((a, b) => a.date.localeCompare(b.date)),
    previousDailyFacts: [...previousMap.values()].sort((a, b) => a.date.localeCompare(b.date)),
    comparisonMode,
    matchedPairs,
  };
}

export function managementPlanToCapabilities(plan: {
  intent?: string;
  operations?: Array<{ tool: string }>;
  comparison?: { requested?: boolean };
}): CapabilityId[] {
  const fromIntent = INTENT_CAPABILITIES[String(plan.intent || "")] || [];
  const fromOps = (plan.operations || [])
    .map((op) => TOOL_TO_CAPABILITY[op.tool])
    .filter(Boolean) as CapabilityId[];
  const caps = [...fromIntent, ...fromOps];
  if (plan.comparison?.requested && !caps.includes("commercial.compare")) {
    caps.push("commercial.compare");
  }
  const uniq: CapabilityId[] = [];
  for (const c of caps) {
    if (isRegisteredCapability(c) && !uniq.includes(c)) uniq.push(c);
  }
  return uniq.slice(0, 6);
}

function hasFabricInheritContext(prev?: StructuredConversationState | null): boolean {
  if (!prev) return false;
  return Boolean(
    prev.activePeriods?.current
    || prev.activeMetricFamily
    || prev.previousIntent
    || (prev.activeCapabilities && prev.activeCapabilities.length),
  );
}

/**
 * Gate for entering the Fabric spine.
 * When a prior Fabric conversation already resolved commercial/ops intent,
 * a period-only follow-up ("what about jan 2026") must stay on Fabric —
 * otherwise month+year turns that miss the legacy keyword gate fall to
 * "Need a clearer metric question".
 */
export function isManagementIntelligenceQuestion(
  question: string,
  legacyRoute?: OrchestrationOptions["legacyRoute"],
  options?: {
    priorFabricConversation?: StructuredConversationState | null;
    referenceDate?: Date;
  },
) {
  const q = String(question || "").trim();
  if (isFabricManagedTurn(q)) return true;
  const intent = String(legacyRoute?.intent || "");
  if (/^vault_cash_up|^vault_operational|^vault_business_reasoning|^executive_analysis/.test(intent)) {
    return true;
  }

  if (
    hasFabricInheritContext(options?.priorFabricConversation)
    && (
      isPeriodOnlyFollowUpTurn(question, options?.referenceDate || new Date())
      || isSubjectiveJudgementTurn(question)
      || Boolean(extractAnalysisIntent(question))
      || Boolean(extractCommercialMetric(question))
      || hasComparisonIntent(question)
      || /^(?:what about|how about|and\b|average spend|covers\??|orders\??|was that|is that)/i.test(String(question || "").trim())
    )
  ) {
    return true;
  }

  if (intent === "unknown" || legacyRoute?.confidence === "none" || legacyRoute?.confidence === "low") {
    return looksLikeManagementCommercialQuestion(question)
      || looksLikeOperationalManagementQuestion(question);
  }
  if (/^(sales_total|top_items)/.test(intent) && looksLikeManagementCommercialQuestion(question)) {
    return true;
  }
  return looksLikeManagementCommercialQuestion(question)
    || looksLikeOperationalManagementQuestion(question);
}

function isExplicitFastPath(question: string, legacyRoute?: OrchestrationOptions["legacyRoute"], referenceDate?: Date) {
  const q = question.toLowerCase();
  const high = legacyRoute?.confidence === "high";
  const analyst = extractAnalysisIntent(question);
  const holidayish = /\b(ramadan|founding|foundation|forecast|expect|operational|complaint)\b/.test(q);
  const diagnostic = /\b(shit|act on|briefing|lately)\b/.test(q) || holidayish;
  if (diagnostic && !(high && /^vault_cash_up_summary$/.test(String(legacyRoute?.intent || "")))) {
    return false;
  }
  if (analyst && !holidayish) return true;
  const parsedPeriod = parseVaultPeriodFromQuestion(question, referenceDate || new Date());
  const simple = Boolean(parsedPeriod)
    || /\b(yesterday|today|sales yesterday|guests yesterday|average spend)\b/.test(q);
  return Boolean(simple || (high && /^vault_cash_up_summary$/.test(String(legacyRoute?.intent || ""))
    && !diagnostic));
}

function metricKeyMetrics(state: CompanyIntelligenceState) {
  return state.evidence
    .filter((e) => typeof e.value === "number")
    .slice(0, 8)
    .map((e) => ({
      label: e.metricOrEvent,
      value: e.value,
      source: e.source,
    }));
}

async function executeCapabilities(
  state: CompanyIntelligenceState,
  capabilities: CapabilityId[],
  executor: CapabilityExecutor,
): Promise<{ state: CompanyIntelligenceState; results: CapabilityExecutionResult[]; tools: string[] }> {
  const results: CapabilityExecutionResult[] = [];
  const tools: string[] = [];
  let next = state;

  for (const capability of capabilities) {
    const req = {
      capability,
      branchId: next.scope.primaryBranchId,
      currentPeriod: next.periods.current,
      comparisonPeriod: next.periods.comparison,
      comparabilityMethod: next.comparability?.recommendedMethod || null,
      question: next.request.normalizedQuestion,
      historyLookbackDays: capability === "commercial.performance"
        && (
          Boolean(extractAnalysisIntent(next.request.originalQuestion || next.request.normalizedQuestion))
          || isSubjectiveJudgementTurn(next.request.originalQuestion || next.request.normalizedQuestion)
          || isBroadManagementQuestion(next.request.originalQuestion || next.request.normalizedQuestion, "commercial")
        )
        ? HISTORY_LOOKBACK_DAYS
        : null,
    };

    const builtin = await executeBuiltinCapability(req, next);
    const rawResult = builtin || await executor(req);
    const result = withNormalizedCapabilityResult(rawResult, next);
    results.push(result);
    tools.push(result.implementationTool);

    const evidence = normalizeCapabilityResultToEvidence(result, next);
    const coverage = result.coverage
      ? [...next.coverage, result.coverage]
      : next.coverage;

    next = patchIntelligenceState(next, {
      evidence: [...next.evidence, ...evidence],
      coverage,
      toolResults: {
        ...next.toolResults,
        [capability]: {
          ok: result.ok,
          skipped: result.skipped || false,
          skipReason: result.skipReason || null,
          metrics: result.normalized?.metrics || result.metrics || [],
          comparison: result.normalized?.comparison || null,
          coverage: result.normalized?.coverage || null,
          qualitativeEvidence: result.normalized?.qualitativeEvidence || [],
          sourceAuthority: result.normalized?.sourceAuthority || null,
          rankings: result.normalized?.rankings || [],
          dailyFacts: result.normalized?.dailyFacts || [],
          historyDailyFacts: result.normalized?.historyDailyFacts || [],
          previousDailyFacts: result.normalized?.previousDailyFacts || [],
        },
      },
      cost: {
        ...next.cost,
        toolsCalled: [...next.cost.toolsCalled, result.implementationTool],
      },
    });
  }

  return { state: next, results, tools };
}

export async function runCompanyIntelligenceOrchestration(
  options: OrchestrationOptions,
): Promise<OrchestrationResult> {
  const started = Date.now();
  const maxPaid = options.maxPaidCalls ?? Number(
    (typeof Deno !== "undefined" && Deno.env.get("MODEL_GATEWAY_MAX_PAID_CALLS")) || 2,
  );
  const mode = options.mode
    || ((typeof Deno !== "undefined" && Deno.env.get("ASK_NAC_PLANNER_MODE")) as "auto" | "heuristic" | null)
    || "auto";
  const cloudEnabled = loadModelGatewayConfig().cloudEnabled && mode !== "offline" && mode !== "heuristic";
  const gateway = options.gateway || createModelGateway(undefined, {
    ...loadModelGatewayConfig(),
    cloudEnabled,
    maxPaidCallsPerAnswer: maxPaid,
  });
  const executor = options.executor || createMockCapabilityExecutor();

  const followUp = resolveFabricFollowUp({
    question: options.question,
    previous: options.conversation || null,
    branchHint: options.scope?.primaryBranchId
      || options.branchHint
      || options.legacyRoute?.branchMention
      || null,
    referenceDate: options.referenceDate,
  });

  // Prefer caller-authorized scope; keep follow-up branch only when it matches access.
  const authorized = options.scope || null;
  const followUpBranch = normalizeBranchId(followUp.branchId);
  const followUpAllowed = followUpBranch
    ? (authorized
      ? (authorized.access.canSeeNetwork || authorized.access.allowedBranchIds.includes(followUpBranch))
      : true)
    : false;
  const primaryBranchId = (followUpAllowed && followUpBranch)
    ? followUpBranch
    : (authorized?.primaryBranchId || followUpBranch || null);

  let state = createCompanyIntelligenceState({
    originalQuestion: options.question,
    normalizedQuestion: followUp.resolvedQuestion,
    threadId: options.threadId || null,
    scope: createIntelligenceScope({
      primaryBranchId,
      branchIds: primaryBranchId
        ? [primaryBranchId]
        : (authorized?.branchIds || []),
      allowedBranchIds: authorized?.access.allowedBranchIds,
      canSeeNetwork: authorized?.access.canSeeNetwork,
      role: authorized?.access.role,
      companyId: authorized?.companyId,
      brandId: authorized?.brandId,
    }),
    conversation: followUp.conversation,
  });
  state = patchIntelligenceState(state, {
    cost: {
      ...state.cost,
      maxPaidCallsPerAnswer: maxPaid,
      paidModelCallsPerAnswer: 0,
    },
  });
  state = transition(state, "INITIALIZED");
  state = transition(state, "SCOPED", {
    scope: state.scope,
    conversation: followUp.conversation,
  });

  // Temporal from follow-up or fresh resolution already in followUp
  let currentPeriod = followUp.currentPeriod;
  let comparisonPeriod = followUp.comparisonPeriod;
  const holidayIntent = detectHolidayQuestionIntent(
    state.request.originalQuestion || state.request.normalizedQuestion,
  );
  const looksLikePeriodFollowUp = followUp.usedFollowUp
    || isPeriodOnlyFollowUpTurn(String(options.question || "").trim(), options.referenceDate || new Date());
  // Never collapse unresolved follow-ups into last_7_days — that erases inherited July→June semantics.
  if (!currentPeriod && !holidayIntent.detected && !(looksLikePeriodFollowUp && options.conversation) && !followUp.usedFollowUp) {
    // Safe default recent window for management language without inventing named calendar periods.
    const fallback = defaultTemporalService.resolveExpression(
      "last_7_days",
      options.referenceDate || new Date(),
    );
    currentPeriod = fallback.range;
  }
  state = transition(state, "TEMPORAL_RESOLVED", {
    periods: {
      current: currentPeriod,
      comparison: comparisonPeriod,
      forecast: followUp.forecastPeriod || null,
      requestedSemantics: followUp.usedFollowUp
        ? "conversation_followup"
        : (holidayIntent.detected ? "holiday_event_window" : "question"),
      eventWindow: followUp.eventWindow || null,
      nextHolidayDate: followUp.nextHolidayDate || null,
    },
  });

  const branch = state.scope.primaryBranchId;
  const requiresComparison = Boolean(state.periods.comparison)
    || Boolean(followUp.semantics?.comparisonIntent)
    || hasComparisonIntent(options.question);

  const comparisonOperating = branch && state.periods.comparison
    ? defaultBusinessTimeline.getOperatingStatus(branch, state.periods.comparison)
    : null;
  const currentOperating = branch && state.periods.current
    ? defaultBusinessTimeline.getOperatingStatus(branch, state.periods.current)
    : null;

  const allowPartialWithoutHistorical = Boolean(
    holidayIntent.detected
    && (holidayIntent.wantsForecast || holidayIntent.wantsNextDate)
    && currentOperating?.status === "not_yet_open",
  );

  const feasibility = assessFeasibility({
    scope: state.scope,
    currentPeriod: state.periods.current,
    comparisonPeriod: state.periods.comparison,
    requiresComparison,
    timeline: defaultBusinessTimeline,
    allowPartialWithoutHistorical,
  });

  const comparability = requiresComparison
    ? assessComparability({
      current: state.periods.current,
      comparison: state.periods.comparison,
      currentOperating,
      comparisonOperating,
    })
    : null;

  state = transition(state, "FEASIBILITY_CHECKED", {
    feasibility,
    comparability,
    warnings: [...feasibility.detail, ...(comparability?.reasons || [])],
  });

  // Short-circuit impossible comparisons — zero tool / paid calls
  const infeasible = buildInfeasibleComparisonAnswer(state);
  if (infeasible || feasibility.status === "NOT_ANSWERABLE_AS_REQUESTED") {
    const text = infeasible || feasibility.detail.join(" ") || "Request is not answerable as asked.";
    state = transition(state, "COMPLETE", {
      answer: { text, verified: true },
      cost: {
        ...state.cost,
        deterministicRouteUsed: true,
        plannerUsed: false,
        paidModelCallsPerAnswer: 0,
        verifierOk: true,
        latencyMs: Date.now() - started,
        budgetTier: 0,
        requestCategory: "feasibility_block",
      },
      plan: {
        ...state.plan,
        goal: "explain_infeasible",
        capabilities: ["company.branch_timeline", "calendar.resolve_period"],
        researchBudgetTier: 0,
        needsClarification: false,
        clarificationPrompt: null,
      },
    });
    return {
      state,
      answerText: text,
      answerType: "feasibility_block",
      keyMetrics: [],
      insights: feasibility.suggestedAlternatives || [],
      nextConversation: state.conversation,
      toolsExecuted: [],
      paidModelCalls: 0,
    };
  }

  if (
    followUp.ambiguity?.needsClarification
    || feasibility.status === "REQUIRES_CLARIFICATION"
  ) {
    const text = followUp.ambiguity?.prompt
      || feasibility.detail[0]
      || "I need a bit more detail to answer that safely.";
    state = transition(state, "COMPLETE", {
      answer: { text, verified: true },
      cost: {
        ...state.cost,
        deterministicRouteUsed: true,
        plannerUsed: false,
        paidModelCallsPerAnswer: 0,
        verifierOk: true,
        latencyMs: Date.now() - started,
        budgetTier: 0,
        requestCategory: "clarification",
      },
      plan: {
        ...state.plan,
        goal: "clarify",
        capabilities: [],
        researchBudgetTier: 0,
        needsClarification: true,
        clarificationPrompt: text,
      },
    });
    return {
      state,
      answerText: text,
      answerType: "clarification",
      keyMetrics: [],
      insights: feasibility.suggestedAlternatives || [],
      nextConversation: state.conversation,
      toolsExecuted: [],
      paidModelCalls: 0,
    };
  }

  const commerceFocus = followUp.semantics?.commerceFocus || null;
  const published = options.publishedCommerce || null;
  const publishedReady = Boolean(published?.mix?.totalSessions)
    || ((commerceFocus === "health" || commerceFocus === "freshness" || commerceFocus === "data_used" || commerceFocus === "trust" || commerceFocus === "reconciliation")
      && Boolean(published?.health || published?.evidence || published?.reconciliation));
  if (commerceFocus && publishedReady && published) {
    const text = answerPublishedCommerce(commerceFocus, options.publishedCommerce);
    state = transition(state, "COMPLETE", {
      answer: { text, verified: true },
      cost: {
        ...state.cost,
        deterministicRouteUsed: true,
        plannerUsed: false,
        paidModelCallsPerAnswer: 0,
        verifierOk: true,
        latencyMs: Date.now() - started,
        budgetTier: 0,
        requestCategory: "commerce_session",
      },
      plan: {
        ...state.plan,
        goal: "commerce_session",
        capabilities: ["commerce.session_mix"],
        researchBudgetTier: 0,
        needsClarification: false,
        clarificationPrompt: null,
      },
    });
    return {
      state,
      answerText: text,
      answerType: "commerce",
      keyMetrics: [],
      insights: [],
      nextConversation: state.conversation,
      toolsExecuted: [],
      paidModelCalls: 0,
    };
  }
  if (requiresDineInSessionEvidence(commerceFocus)) {
    const text = missingSessionEvidenceAnswer();
    state = transition(state, "COMPLETE", {
      answer: { text, verified: true },
      cost: {
        ...state.cost,
        deterministicRouteUsed: true,
        plannerUsed: false,
        paidModelCallsPerAnswer: 0,
        verifierOk: true,
        latencyMs: Date.now() - started,
        budgetTier: 0,
        requestCategory: "commerce_session_unavailable",
      },
      plan: {
        ...state.plan,
        goal: "commerce_session",
        capabilities: ["commerce.session_mix"],
        researchBudgetTier: 0,
        needsClarification: false,
        clarificationPrompt: null,
      },
    });
    return {
      state,
      answerText: text,
      answerType: "commerce_unavailable",
      keyMetrics: [],
      insights: [],
      nextConversation: state.conversation,
      toolsExecuted: [],
      paidModelCalls: 0,
    };
  }

  const inheritedCommercialFollowUp = Boolean(
    followUp.usedFollowUp
    && (followUp.metricFamily === "commercial"
      || followUp.conversation.activeMetricFamily === "commercial"
      || String(followUp.conversation.previousIntent || "").includes("performance")
      || (followUp.conversation.activeCapabilities || []).some((c) => String(c).startsWith("commercial."))),
  );
  const fastPath = isExplicitFastPath(options.question, options.legacyRoute, options.referenceDate)
    || inheritedCommercialFollowUp;
  let capabilities: CapabilityId[] = [];
  let plannerCalls = 0;
  let plannerSource: string | null = null;
  let fallbackReason: string | null = null;
  let planGoal = inheritedCommercialFollowUp ? "performance_overview" : "answer_management_question";
  let planNeedsClarification = false;
  let planClarificationPrompt: string | null = null;

  if (fastPath) {
    capabilities = ["commercial.performance"];
    if (requiresComparison) capabilities.push("commercial.compare");
    state = patchIntelligenceState(state, {
      cost: {
        ...state.cost,
        deterministicRouteUsed: true,
        plannerUsed: false,
        requestCategory: "lookup",
      },
    });
  } else {
    // Planner → capabilities
    // Prefer ModelGateway local when cloud is off (dev lab / company GPU).
    // Heuristic only for forced offline/heuristic modes, or local schema failure.
    try {
      if (mode === "heuristic" || mode === "offline") {
        const plan = planManagementQuestionHeuristic(state.request.normalizedQuestion, {
          branchHint: branch,
        });
        capabilities = managementPlanToCapabilities(plan);
        plannerSource = "heuristic";
      } else if (!cloudEnabled) {
        const planRes = await gateway.plan({
          system: buildManagementPlannerSystemPrompt(),
          user: JSON.stringify(buildManagementPlannerUserPayload(state.request.normalizedQuestion, {
            branchHint: branch,
            conversationSummary: options.conversation
              ? String((options.conversation as { lastQuestion?: string }).lastQuestion || "")
              : null,
          })),
          json: true,
          temperature: 0.1,
        });
        const localPlan = parseManagementPlanFromModelContent(planRes.content);
        if (planRes.ok && localPlan) {
          capabilities = managementPlanToCapabilities(localPlan);
          plannerSource = planRes.provider || "openai_compatible_local";
          planGoal = localPlan.intent;
          planNeedsClarification = localPlan.needs_clarification;
          planClarificationPrompt = localPlan.clarification_prompt || null;
          state = patchIntelligenceState(state, {
            cost: {
              ...state.cost,
              plannerUsed: true,
              modelProvider: planRes.provider,
              modelName: planRes.model,
              promptTokens: (state.cost.promptTokens || 0) + (planRes.usage?.promptTokens || 0),
              completionTokens: (state.cost.completionTokens || 0) + (planRes.usage?.completionTokens || 0),
            },
          });
        } else {
          const plan = planManagementQuestionHeuristic(state.request.normalizedQuestion, {
            branchHint: branch,
          });
          capabilities = managementPlanToCapabilities(plan);
          plannerSource = "heuristic";
          fallbackReason = planRes.error || "local_planner_schema_invalid";
        }
      } else {
        const { plan, source } = await planManagementQuestion(state.request.normalizedQuestion, {
          branchHint: branch,
          mode: "auto",
          referenceDate: options.referenceDate,
        });
        capabilities = managementPlanToCapabilities(plan);
        plannerSource = source;
        if (source === "openai") {
          plannerCalls = 1;
          state = patchIntelligenceState(state, {
            cost: {
              ...state.cost,
              paidModelCallsPerAnswer: state.cost.paidModelCallsPerAnswer + 1,
              plannerUsed: true,
            },
          });
        } else {
          state = patchIntelligenceState(state, {
            cost: { ...state.cost, plannerUsed: true },
          });
        }
      }
    } catch {
      const plan = planManagementQuestionHeuristic(state.request.normalizedQuestion, { branchHint: branch });
      capabilities = managementPlanToCapabilities(plan);
      plannerSource = "heuristic";
      fallbackReason = "planner_provider_failure";
    }
  }

  // Always include timeline/calendar cheaply for management questions
  if (!capabilities.includes("calendar.resolve_period")) {
    capabilities = ["calendar.resolve_period", ...capabilities];
  }
  if (holidayIntent.detected) {
    if (!capabilities.includes("company.branch_timeline")) {
      capabilities = ["company.branch_timeline", ...capabilities];
    }
    if (holidayIntent.wantsForecast && !capabilities.includes("commercial.forecast")) {
      capabilities.push("commercial.forecast");
    }
    if (holidayIntent.wantsHistoricalPerformance && !capabilities.includes("commercial.performance")) {
      capabilities.push("commercial.performance");
    }
    // Drop misleading compare when holiday question is forecast/history oriented without YoY compare.
    if (!requiresComparison) {
      capabilities = capabilities.filter((c) => c !== "commercial.compare" && c !== "commercial.trend");
    }
  }
  if (feasibility.status === "PARTIALLY_ANSWERABLE" && currentOperating?.status === "not_yet_open") {
    capabilities = capabilities.filter((c) => c !== "commercial.performance" && c !== "commercial.compare");
  }

  const budget = decideResearchBudget({
    question: state.request.normalizedQuestion,
    capabilities,
    requiresComparison,
    deterministicRouteHighConfidence: fastPath,
    feasibilityStatus: feasibility.status,
  });

  state = transition(state, "PLANNED", {
    plan: {
      goal: planGoal,
      capabilities,
      researchBudgetTier: budget.tier,
      needsClarification: planNeedsClarification,
      clarificationPrompt: planClarificationPrompt,
    },
    cost: {
      ...state.cost,
      budgetTier: budget.tier,
      requestCategory: budget.label,
      deterministicRouteUsed: fastPath,
      plannerUsed: !fastPath,
      cloudEscalationReason: fallbackReason,
      modelProvider: plannerSource === "openai"
        ? "openai"
        : plannerSource === "openai_compatible_local"
        ? "openai_compatible_local"
        : plannerSource === "heuristic"
        ? "none"
        : plannerSource,
    },
  });

  const validated = validateCapabilityPlan(state, capabilities);
  if (!validated.ok) {
    const text = "I could not form a safe analysis plan for that question. Please specify branch and period.";
    state = transition(state, "COMPLETE", {
      answer: { text, verified: true },
      warnings: [...state.warnings, ...validated.reasons],
    });
    return {
      state,
      answerText: text,
      answerType: "plan_rejected",
      keyMetrics: [],
      insights: [],
      nextConversation: state.conversation,
      toolsExecuted: [],
      paidModelCalls: state.cost.paidModelCallsPerAnswer,
    };
  }

  // Drop expensive research caps always in this phase
  const executable = validated.capabilities.filter((c) =>
    !c.startsWith("research.") && c !== "analytics.safe_compute"
  );

  // If not comparable, do not run misleading compare percentages
  const toRun = comparability?.status === "not_comparable"
    ? executable.filter((c) => c !== "commercial.compare" && c !== "commercial.trend")
    : executable;

  state = transition(state, "EXECUTING");
  const executed = await executeCapabilities(state, toRun, executor);
  state = executed.state;
  let toolsExecuted = executed.tools;

  // Refresh comparability with observed coverage
  if (requiresComparison && state.periods.current && state.periods.comparison) {
    const salesCov = state.coverage.find((c) => c.domain === "sales") || null;
    state = patchIntelligenceState(state, {
      comparability: assessComparability({
        current: state.periods.current,
        comparison: state.periods.comparison,
        currentCoverage: salesCov,
        comparisonCoverage: salesCov,
        currentOperating,
        comparisonOperating,
      }),
    });
  }

  let claims = assembleClaimsFromEvidence({
    evidence: state.evidence,
    branchId: state.scope.primaryBranchId,
    period: state.periods.current,
    comparability: state.comparability,
  });
  state = transition(state, "EVIDENCE_READY", { claims });

  // Critic — one pass max
  const critic = critiqueEvidence({
    question: state.request.normalizedQuestion,
    evidence: state.evidence,
    feasibility: state.feasibility,
    comparability: state.comparability,
    budgetTier: budget.tier,
    researchPassesUsed: 0,
  });

  if (critic.recommendAdditionalPass && critic.additionalCapabilities.length) {
    const extra = critic.additionalCapabilities
      .filter((c): c is CapabilityId => isRegisteredCapability(c))
      .filter((c) => !toRun.includes(c));
    if (extra.length) {
      state = patchIntelligenceState(state, {
        warnings: [...state.warnings, `critic_extra_pass:${critic.reason}`],
      });
      const more = await executeCapabilities(state, extra.slice(0, 1), executor);
      state = more.state;
      toolsExecuted = [...toolsExecuted, ...more.tools];
      claims = assembleClaimsFromEvidence({
        evidence: state.evidence,
        branchId: state.scope.primaryBranchId,
        period: state.periods.current,
        comparability: state.comparability,
      });
      state = patchIntelligenceState(state, { claims });
    }
  }

  // Synthesis — cloud when enabled; unpaid local when cloud off but local synth configured.
  const localUnpaidSynth = gateway.config.synthesizeProvider === "openai_compatible_local"
    && Boolean(gateway.config.localBaseUrl);
  const preferDeterministic = fastPath
    || budget.tier === 0
    || mode === "offline"
    || mode === "heuristic"
    || (!cloudEnabled && !localUnpaidSynth)
    // Paid budget gates cloud synthesis only; unpaid local may still synthesize.
    || (cloudEnabled && state.cost.paidModelCallsPerAnswer >= maxPaid);

  const extras = collectRankingsAndFacts(state);
  const synthesisInput = {
    question: state.request.originalQuestion || state.request.normalizedQuestion,
    branchId: state.scope.primaryBranchId,
    period: state.periods.current,
    comparisonPeriod: state.periods.comparison,
    forecastPeriod: state.periods.forecast,
    nextHolidayDate: state.periods.nextHolidayDate,
    eventWindow: state.periods.eventWindow,
    evidence: state.evidence,
    claims: state.claims,
    coverage: state.coverage,
    comparability: state.comparability,
    comparisonMode: extras.comparisonMode,
    primaryMetric: followUp.semantics?.metric || null,
    ranking: followUp.semantics?.ranking || null,
    rankingCount: followUp.semantics?.rankingCount || null,
    comparisonIntent: Boolean(followUp.semantics?.comparisonIntent),
    rankings: extras.rankings,
    dailyFacts: extras.dailyFacts,
    historyDailyFacts: extras.historyDailyFacts,
    previousDailyFacts: extras.previousDailyFacts,
    canonicalMatchedPairs: extras.matchedPairs,
    analysisIntent: followUp.semantics?.analysisIntent || null,
    responseMode: followUp.semantics?.responseMode || null,
    commerceFocus: followUp.semantics?.commerceFocus || null,
    publishedCommerce: options.publishedCommerce || null,
    openingDate: state.scope.primaryBranchId
      ? defaultBusinessTimeline.getOpeningDate(state.scope.primaryBranchId)
      : null,
    offlineAnalysis: !cloudEnabled && !localUnpaidSynth && !fastPath && budget.tier >= 1,
  };

  let answerText = synthesizeDeterministicAnswer(synthesisInput);

  let synthesisCalls = 0;
  if (!preferDeterministic && budget.tier >= 1) {
    const syn = await gateway.synthesize({
      system: [
        "You are Ask NAC. Write a concise manager answer from verified evidence only.",
        "Return JSON only: {\"directAnswer\":\"...\"}.",
        "Do not invent numbers, dates, branches, causes, or margins.",
        "Do not use causal verbs unless claim type is VERIFIED_FACT with strong evidence.",
        "Do not mention tools, SQL, or internal labels.",
        "Respect comparability method and coverage warnings.",
      ].join(" "),
      user: JSON.stringify({
        question: state.request.originalQuestion,
        scope: state.scope,
        periods: state.periods,
        comparability: state.comparability,
        claims: state.claims,
        evidence: state.evidence.map((e) => ({
          id: e.id,
          source: e.source,
          authority: e.sourceAuthority,
          metric: e.metricOrEvent,
          value: e.value,
          summary: e.textSummary,
          period: e.period,
        })),
        warnings: state.warnings,
      }),
      json: true,
      maxTokens: Number(
        (typeof Deno !== "undefined" && Deno.env.get("MODEL_GATEWAY_LOCAL_MAX_TOKENS")) || 1600,
      ),
    });
    if (syn.ok && syn.content) {
      try {
        const parsed = JSON.parse(syn.content);
        answerText = String(parsed.directAnswer || parsed.answer || answerText);
        synthesisCalls = 1;
        state = patchIntelligenceState(state, {
          cost: {
            ...state.cost,
            paidModelCallsPerAnswer: state.cost.paidModelCallsPerAnswer + (syn.paid ? 1 : 0),
            promptTokens: (state.cost.promptTokens || 0) + (syn.usage?.promptTokens || 0),
            completionTokens: (state.cost.completionTokens || 0) + (syn.usage?.completionTokens || 0),
            modelProvider: syn.provider,
            modelName: syn.model,
            estimatedCostUsd: syn.paid
              ? estimateOpenAiMiniCostUsd(
                (state.cost.promptTokens || 0) + (syn.usage?.promptTokens || 0),
                (state.cost.completionTokens || 0) + (syn.usage?.completionTokens || 0),
              )
              : 0,
          },
        });
      } catch {
        // keep deterministic
        fallbackReason = fallbackReason || "synthesis_parse_failure";
      }
    } else if (!syn.ok) {
      fallbackReason = fallbackReason || syn.error || "synthesis_provider_failure";
      answerText = synthesizeDeterministicAnswer({
        ...synthesisInput,
        offlineAnalysis: true,
      });
    }
  }

  state = transition(state, "SYNTHESIZED", {
    answer: { text: answerText, verified: null },
  });

  // Verifier
  let verified = verifySynthesizedAnswer({
    answerText,
    branchId: state.scope.primaryBranchId,
    period: state.periods.current,
    evidence: state.evidence,
    claims: state.claims,
    presentedSources: state.evidence.map((e) => e.source),
  });

  if (!verified.ok && verified.repairedAnswer) {
    answerText = verified.repairedAnswer;
    verified = verifySynthesizedAnswer({
      answerText,
      branchId: state.scope.primaryBranchId,
      period: state.periods.current,
      evidence: state.evidence,
      claims: state.claims,
      presentedSources: state.evidence.map((e) => e.source),
    });
  }

  // One regeneration only if still failing and paid budget remains
  if (
    !verified.ok
    && cloudEnabled
    && state.cost.paidModelCallsPerAnswer < maxPaid
    && synthesisCalls > 0
  ) {
    const repair = await gateway.synthesize({
      system: "Repair the answer to satisfy verifier issues. JSON {directAnswer}. No invented numbers.",
      user: JSON.stringify({ answerText, issues: verified.issues, claims: state.claims }),
      json: true,
      maxTokens: 300,
    });
    if (repair.ok && repair.content) {
      try {
        const parsed = JSON.parse(repair.content);
        answerText = String(parsed.directAnswer || answerText);
        if (repair.paid) {
          state = patchIntelligenceState(state, {
            cost: {
              ...state.cost,
              paidModelCallsPerAnswer: state.cost.paidModelCallsPerAnswer + 1,
            },
          });
        }
        verified = verifySynthesizedAnswer({
          answerText,
          branchId: state.scope.primaryBranchId,
          period: state.periods.current,
          evidence: state.evidence,
          claims: state.claims,
        });
        if (!verified.ok && verified.repairedAnswer) answerText = verified.repairedAnswer;
      } catch {
        /* keep */
      }
    }
  }

  const nextConversation = {
    ...state.conversation,
    activeBranchId: state.scope.primaryBranchId,
    activeCompanyId: state.scope.companyId,
    activeBrandId: state.scope.brandId,
    activePeriods: {
      current: state.periods.current,
      comparison: state.periods.comparison,
    },
    activeMetricFamily: followUp.metricFamily
      || state.conversation.activeMetricFamily
      || (state.plan.capabilities.some((c) => String(c).startsWith("commercial.")) ? "commercial" : null)
      || "commercial",
    activeMetric: followUp.semantics?.metric
      || followUp.conversation.activeMetric
      || state.conversation.activeMetric,
    activeRanking: followUp.semantics ? followUp.semantics.ranking : (followUp.conversation.activeRanking ?? null),
    activeRankingCount: followUp.semantics
      ? followUp.semantics.rankingCount
      : (followUp.conversation.activeRankingCount ?? null),
    activeCapabilities: state.plan.capabilities.length
      ? state.plan.capabilities
      : (state.conversation.activeCapabilities || []),
    previousIntent: followUp.semantics?.intent
      || followUp.conversation.previousIntent
      || state.plan.goal
      || null,
  };

  state = transition(state, "VERIFIED", {
    answer: { text: answerText, verified: verified.ok },
    conversation: nextConversation,
    cost: {
      ...state.cost,
      verifierOk: verified.ok,
      latencyMs: Date.now() - started,
      cloudEscalationReason: fallbackReason,
      toolsCalled: toolsExecuted,
    },
    warnings: [
      ...state.warnings,
      ...verified.issues.map((i) => i.code),
    ],
  });
  state = transition(state, "COMPLETE");

  return {
    state,
    answerText,
    answerType: fastPath ? "deterministic_lookup" : "management_intelligence",
    keyMetrics: metricKeyMetrics(state),
    insights: critic.gaps || [],
    nextConversation,
    toolsExecuted,
    paidModelCalls: state.cost.paidModelCallsPerAnswer,
  };
}

export { CAPABILITY_REGISTRY, normalizeBranchId };
