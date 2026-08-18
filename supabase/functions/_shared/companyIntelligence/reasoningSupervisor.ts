/**
 * Thin reasoning supervisor above deterministic Fabric capabilities.
 * Decides WHAT must happen; existing capabilities decide HOW.
 * Feature-driven, not sample-phrase handlers.
 */

import { parseVaultComparePeriodsFromQuestion, parseVaultPeriodFromQuestion } from "../vaultPeriodParser.ts";
import { hasComparisonIntent } from "./turnSemantics.ts";
import type { CapabilityId } from "./capabilityRegistry.ts";
import type { StructuredConversationState } from "./conversationState.ts";
import type { DateRange } from "./types.ts";

export type SupervisorGoal =
  | "knowledge_freshness"
  | "coverage_query"
  | "acquisition_request"
  | "action_request"
  | "factual_query"
  | "comparison"
  | "diagnostic"
  | "explanation"
  | "recommendation"
  | "follow_up_modification"
  | "analytical_query";

export type RequiredMetric = "net_sales" | "covers" | "avg_spend" | "orders" | "average_check";

export type AnswerRequirements = {
  task: SupervisorGoal;
  periods: DateRange[];
  requiredMetrics: RequiredMetric[];
  requiredAuthority: Record<string, "cash_up" | "commerce" | "cash_up_or_commerce_provisional">;
  requiredDomains: Array<"cash_up" | "commerce" | "reviews" | "operations" | "knowledge">;
  selfContained: boolean;
};

export type UnresolvedGoal = {
  question: string;
  task: SupervisorGoal;
  requiredMetrics: RequiredMetric[];
  period: DateRange | null;
  missingRequirements: string[];
  lastFailureReason: string | null;
  lastAnswerText?: string | null;
  candidateRecoveryActions: Array<{ id: string; available: boolean; blocker?: string | null }>;
};

export type AdequacyResult = {
  ok: boolean;
  reason: string | null;
  executionVerification: "deterministic" | "none";
  evidenceCompleteness: "complete" | "partial" | "unavailable";
  answerConfidence: "high" | "medium" | "low" | "limitation";
};

const FRESHNESS_OBJECT = /\b(data|coverage|knowledge|sources?|fresh(?:ness)?|ingest(?:ed|ion)?|vault|cash[- ]?up|commerce|foodics|reviews?|logbook|reception)\b/i;
const FRESHNESS_ASK = /\b(last|latest|how current|up to date|through (?:which )?date|which date|what dates?|what(?:'s| is) missing|stale|do you have)\b/i;
const ACQUISITION = /\b(upload|fetch|sync|ingest|acquire|obtain|pull|download|get it yourself|do it yourself|upload it yourself)\b/i;
const ACTION = /\b(what should (?:i|we) do|recommend|focus|act on)\b/i;
const WHY = /\b(why|what drove|explain|weaker|stronger|declined|improved)\b/i;
const MIX_OR_OPS = /\b(basket|mix|operational|review|dessert|attach|companions?|pairs?)\b/i;

export function collectRequiredMetrics(question: string): RequiredMetric[] {
  const q = String(question || "").toLowerCase();
  const out: RequiredMetric[] = [];
  if (/\b(sales?|revenue|takings|net sales)\b/.test(q)) out.push("net_sales");
  if (/\b(covers?|guests?|guest count|nb of guests|number of guests)\b/.test(q)) out.push("covers");
  if (/\b(average spend|avg spend|avg check|average check)\b/.test(q)) out.push("avg_spend");
  if (/\border(?:s| count)?\b/.test(q) && !/\bborder\b/.test(q)) out.push("orders");
  return [...new Set(out)];
}

export function classifySupervisorGoal(input: {
  question: string;
  previous?: StructuredConversationState | null;
}): SupervisorGoal {
  const q = String(input.question || "").replace(/\s+/g, " ").trim();
  const qLower = q.toLowerCase();
  const metrics = collectRequiredMetrics(q);
  const prevGoal = input.previous?.unresolvedGoal || null;

  if (ACQUISITION.test(qLower) || (prevGoal && /^(?:ok[,.]?\s*)?(?:please\s+)?(?:do it|get it|try(?: it)?)\b/i.test(q))) {
    return "acquisition_request";
  }
  if (FRESHNESS_OBJECT.test(qLower) && FRESHNESS_ASK.test(qLower) && !metrics.length) {
    return "knowledge_freshness";
  }
  if (/\b(what do you know|what(?:'s| is) (?:your )?(?:coverage|ingest))\b/i.test(q) && !metrics.length) {
    return "coverage_query";
  }
  if (WHY.test(qLower) && (metrics.length || /\bperformance\b/i.test(qLower))) return "explanation";
  if (ACTION.test(qLower)) return "recommendation";
  if (hasComparisonIntent(q) || parseVaultComparePeriodsFromQuestion(q)) return "comparison";
  if (MIX_OR_OPS.test(qLower) && !metrics.includes("net_sales")) return "analytical_query";
  if (metrics.length) return "factual_query";
  if (input.previous?.unresolvedGoal) return "follow_up_modification";
  return "analytical_query";
}

export function deriveAnswerRequirements(input: {
  question: string;
  goal: SupervisorGoal;
  period?: DateRange | null;
  comparePeriod?: DateRange | null;
  previous?: StructuredConversationState | null;
  referenceDate?: Date;
}): AnswerRequirements {
  const q = String(input.question || "");
  const parsedCompare = parseVaultComparePeriodsFromQuestion(q, input.referenceDate || new Date());
  const parsed = parseVaultPeriodFromQuestion(q, input.referenceDate || new Date());
  const metrics = collectRequiredMetrics(q);
  const periods: DateRange[] = [];
  if (parsedCompare?.current) periods.push(parsedCompare.current as DateRange);
  if (parsedCompare?.previous) periods.push(parsedCompare.previous as DateRange);
  if (!periods.length && (input.period || parsed)) {
    const p = input.period || (parsed
      ? { startDate: parsed.startDate, endDate: parsed.endDate, label: parsed.label }
      : null);
    if (p) periods.push(p);
  }
  if (input.comparePeriod && !periods.some((p) => p.startDate === input.comparePeriod?.startDate)) {
    periods.push(input.comparePeriod);
  }

  if (input.goal === "knowledge_freshness" || input.goal === "coverage_query") {
    return {
      task: input.goal,
      periods,
      requiredMetrics: [],
      requiredAuthority: {},
      requiredDomains: ["knowledge"],
      selfContained: true,
    };
  }

  const inherited = input.previous?.unresolvedGoal;
  if (input.goal === "acquisition_request") {
    const inheritedMetrics = (inherited?.requiredMetrics || metrics || []) as RequiredMetric[];
    const useMetrics = inheritedMetrics.length ? inheritedMetrics : (["net_sales"] as RequiredMetric[]);
    const inheritedPeriod = inherited?.period || null;
    return {
      task: input.goal,
      periods: inheritedPeriod ? [inheritedPeriod] : periods,
      requiredMetrics: useMetrics,
      requiredAuthority: Object.fromEntries(useMetrics.map((m) => [m, "cash_up_or_commerce_provisional" as const])),
      requiredDomains: ["cash_up"],
      selfContained: true,
    };
  }

  const useMetrics = metrics.length ? metrics : (inherited?.requiredMetrics || ["net_sales"]);
  const authority: AnswerRequirements["requiredAuthority"] = {};
  for (const m of useMetrics) {
    authority[m] = m === "average_check" ? "commerce" : "cash_up";
  }
  const mixOnly = MIX_OR_OPS.test(q) && !metrics.includes("net_sales") && !metrics.includes("covers");
  const needsCommerce = MIX_OR_OPS.test(q) || input.goal === "explanation" || input.goal === "diagnostic";
  const domains: AnswerRequirements["requiredDomains"] = mixOnly ? ["commerce"] : ["cash_up"];
  if (!mixOnly && needsCommerce) domains.push("commerce");

  const selfContained = Boolean(parsedCompare?.current && parsedCompare?.previous)
    || Boolean(parsed?.startDate && (hasComparisonIntent(q) || metrics.length));

  return {
    task: input.goal,
    periods,
    requiredMetrics: useMetrics,
    requiredAuthority: authority,
    requiredDomains: [...new Set(domains)],
    selfContained,
  };
}

export function minimumSufficientCapabilities(req: AnswerRequirements): CapabilityId[] {
  if (req.requiredDomains.includes("knowledge") && req.requiredDomains.length === 1) {
    return ["company.knowledge_state"];
  }
  if (req.task === "acquisition_request") {
    return req.requiredMetrics.includes("covers")
      ? ["commercial.compare", "commercial.performance"]
      : ["commercial.performance"];
  }
  const cashOnly = req.requiredDomains.length === 1 && req.requiredDomains[0] === "cash_up";
  if (cashOnly && req.task === "comparison") return ["commercial.compare", "commercial.performance"];
  if (cashOnly) return ["commercial.performance"];
  if (req.requiredDomains.includes("commerce") && !req.requiredDomains.includes("cash_up")) {
    return ["commerce.semantic_query"];
  }
  if (req.task === "explanation" || req.task === "diagnostic") {
    return ["commercial.performance", "commercial.compare", "commerce.semantic_query"];
  }
  return ["commercial.performance"];
}

export function shouldUseUniversalComposition(req: AnswerRequirements): boolean {
  if (req.task === "knowledge_freshness" || req.task === "coverage_query" || req.task === "acquisition_request") {
    return false;
  }
  if (req.requiredDomains.length <= 1) return false;
  if (req.task === "comparison" && req.requiredDomains.every((d) => d === "cash_up")) return false;
  if (req.task === "factual_query" && req.requiredDomains.every((d) => d === "cash_up")) return false;
  return req.requiredDomains.length > 1;
}

/** Block multi-domain fabric when a single authoritative capability is sufficient. */
export function supervisorBlocksUniversal(req: AnswerRequirements): boolean {
  if (req.task === "knowledge_freshness" || req.task === "coverage_query" || req.task === "acquisition_request") {
    return true;
  }
  if (req.selfContained && (req.task === "comparison" || req.task === "factual_query") && req.requiredDomains.length <= 1) {
    return true;
  }
  if (req.task === "analytical_query" && req.requiredDomains.length === 1 && req.requiredDomains[0] === "commerce") {
    return true;
  }
  return false;
}

export function isSupervisorManagedTurn(
  question: string,
  previous?: StructuredConversationState | null,
): boolean {
  const goal = classifySupervisorGoal({ question, previous });
  return goal === "knowledge_freshness" || goal === "coverage_query" || goal === "acquisition_request";
}

export function relevantWarnings(input: {
  goal: SupervisorGoal;
  warnings: string[];
  executedTools: string[];
}): string[] {
  const allowCompare = input.goal === "comparison" || input.goal === "explanation"
    || input.executedTools.some((t) => /compare/.test(t));
  return (input.warnings || []).filter((w) => {
    if (!w) return false;
    if (/weekday_composition_differs|use_matched_or_normalized_method|missing_period/.test(w) && !allowCompare) {
      return false;
    }
    return true;
  });
}

export function assessAnswerAdequacy(input: {
  goal: SupervisorGoal;
  requirements: AnswerRequirements;
  answerText: string;
  evidenceKeys?: string[];
  repeatedPrevious?: boolean;
  actionAttempted?: boolean;
  actionSucceeded?: boolean;
  acquisitionBlocker?: string | null;
}): AdequacyResult {
  const text = String(input.answerText || "");
  const keys = input.evidenceKeys || [];
  const hasSales = keys.includes("net_sales") || /SAR\s|net sales/i.test(text);
  const hasCovers = keys.includes("covers") || /\bcovers?\b/i.test(text);
  const hasDates = /\d{4}-\d{2}-\d{2}|through|available through|latest/i.test(text);

  if (input.goal === "knowledge_freshness" || input.goal === "coverage_query") {
    if (hasDates && !/I could not assemble enough overlapping/i.test(text)) {
      return complete("deterministic", "complete", "high");
    }
    if (/SAR|net sales were/i.test(text) && !hasDates) {
      return fail("answered_performance_instead_of_freshness");
    }
    return fail("freshness_not_answered");
  }

  if (input.goal === "acquisition_request") {
    if (input.repeatedPrevious) return fail("repeated_previous_failure");
    if (input.actionSucceeded) return complete("deterministic", "partial", "medium");
    if (input.actionAttempted && input.acquisitionBlocker) {
      return {
        ok: true,
        reason: input.acquisitionBlocker,
        executionVerification: "deterministic",
        evidenceCompleteness: "unavailable",
        answerConfidence: "limitation",
      };
    }
    return fail("acquisition_not_attempted");
  }

  if (input.goal === "comparison") {
    const needSales = input.requirements.requiredMetrics.includes("net_sales");
    const needCovers = input.requirements.requiredMetrics.includes("covers");
    if ((needSales && !hasSales) || (needCovers && !hasCovers)) {
      if (/could not assemble enough overlapping/i.test(text)) return fail("false_multi_domain_overlap_requirement");
      return fail("comparison_sides_incomplete");
    }
    return complete("deterministic", "complete", "high");
  }

  if (/could not assemble enough overlapping/i.test(text)) {
    return fail("false_multi_domain_overlap_requirement");
  }

  if (/no cash-up|not available|missing|did not match/i.test(text) && !hasSales) {
    return {
      ok: true,
      reason: "authoritative_source_unavailable",
      executionVerification: "deterministic",
      evidenceCompleteness: "unavailable",
      answerConfidence: "limitation",
    };
  }

  if (/provisional|not Cash Up|not headline sales/i.test(text) && hasSales) {
    return complete("deterministic", "partial", "medium");
  }

  if (hasSales || hasCovers || keys.length) {
    return complete("deterministic", "complete", "high");
  }
  return complete("deterministic", "partial", "medium");
}

function complete(
  executionVerification: AdequacyResult["executionVerification"],
  evidenceCompleteness: AdequacyResult["evidenceCompleteness"],
  answerConfidence: AdequacyResult["answerConfidence"],
): AdequacyResult {
  return { ok: true, reason: null, executionVerification, evidenceCompleteness, answerConfidence };
}

function fail(reason: string): AdequacyResult {
  return {
    ok: false,
    reason,
    executionVerification: "deterministic",
    evidenceCompleteness: "unavailable",
    answerConfidence: "limitation",
  };
}

export function buildUnresolvedGoal(input: {
  question: string;
  task: SupervisorGoal;
  requirements: AnswerRequirements;
  period: DateRange | null;
  missing: string[];
  failureReason: string | null;
  lastAnswerText?: string | null;
  recovery: UnresolvedGoal["candidateRecoveryActions"];
}): UnresolvedGoal {
  return {
    question: input.question,
    task: input.task,
    requiredMetrics: input.requirements.requiredMetrics,
    period: input.period,
    missingRequirements: input.missing,
    lastFailureReason: input.failureReason,
    lastAnswerText: input.lastAnswerText || null,
    candidateRecoveryActions: input.recovery,
  };
}
