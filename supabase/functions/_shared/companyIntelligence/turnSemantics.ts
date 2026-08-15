/**
 * Canonical turn semantics for Ask NAC Fabric.
 * Parse the current turn once, then merge with conversation.
 * Explicit current-turn meaning always outranks inherited context.
 */

import {
  buildPreviousEquivalentVaultPeriod,
  parseVaultComparePeriodsFromQuestion,
  parseVaultPeriodFromQuestion,
} from "../vaultPeriodParser.ts";
import { createEmptyConversationState, updateConversationState } from "./conversationState.ts";
import { normalizeBranchId } from "./scope.ts";
import { addIsoDays, isoWeekdayIndex } from "./managementPresentation.ts";
import { defaultTemporalService } from "./temporalService.ts";
import type { StructuredConversationState } from "./conversationState.ts";
import type { DateRange } from "./types.ts";

export type CommercialMetric =
  | "sales"
  | "covers"
  | "orders"
  | "avg_spend"
  | "delivery"
  | "dine_in";

export type AnalysisIntent =
  | "judgement"
  | "anomaly"
  | "trend"
  | "why"
  | "stands_out"
  | "contributors"
  | "breadth"
  | "action"
  | "weekend"
  | null;

export type AmbiguityKind =
  | "missing_comparison_baseline"
  | "underspecified_follow_up"
  | "unsupported_capability"
  | "missing_ranking_metric";

export type TurnDimensionFlags = {
  metric: boolean;
  period: boolean;
  branch: boolean;
  comparison: boolean;
};

export type TurnSemantics = {
  intent: string | null;
  metric: CommercialMetric | "commercial";
  scope: { branchId: string | null };
  period: DateRange | null;
  comparisonPeriod: DateRange | null;
  comparisonIntent: boolean;
  eventWindow: TemporalEventWindow | null;
  ranking: "top" | "bottom" | null;
  rankingCount: number | null;
  analysisIntent: AnalysisIntent;
  inheritedFromConversation: TurnDimensionFlags;
  explicitInCurrentTurn: TurnDimensionFlags;
  ambiguity: {
    needsClarification: boolean;
    kind: AmbiguityKind | null;
    prompt: string | null;
  };
  usedFollowUp: boolean;
  resolvedQuestion: string;
  notes: string[];
  conversation: StructuredConversationState;
  forecastPeriod?: DateRange | null;
  nextHolidayDate?: string | null;
};

type TemporalEventWindow = {
  holidayId: string;
  convention: string;
  conventionLabel: string;
  anchorDate: string;
  year: number;
  weekdaySignature: string;
};

const COMPARISON_INTENT_RE =
  /\b(?:compared?\s+(?:with|to)|compare(?:\s+it)?(?:\s+(?:with|to))?|versus|vs\.?|against|better or worse than|difference from|change versus|up or down from|how does that compare)\b/i;

const FOLLOW_UP_PREFIX_RE = /^(?:what about|how about|and|same for|actually|instead)\s+/i;
const CORRECTION_RE = /\b(?:actually|no,?\s+i meant|instead|rather)\b/i;

export function hasComparisonIntent(question: string): boolean {
  const q = String(question || "");
  if (/^why the difference\??$/i.test(q.trim())) return true;
  if (/\b(?:compared?\s+(?:with|to)|versus|vs\.?|against)\s+normal\s+(?:fridays?|saturdays?|sundays?|mondays?|tuesdays?|wednesdays?|thursdays?|weekdays?|weekends?)\b/i.test(q)) {
    return false;
  }
  return COMPARISON_INTENT_RE.test(q);
}

export function extractCommercialMetric(question: string): CommercialMetric | null {
  const q = String(question || "").toLowerCase();
  if (/\b(average spend|avg spend|spend per guest|average check|avg_spend)\b/.test(q)) return "avg_spend";
  if (/\b(covers?|guests?|guest count)\b/.test(q)) return "covers";
  if (/\border(?:s| count)?\b/.test(q)) return "orders";
  if (/\bdine[-\s]?in\b/.test(q)) return "dine_in";
  if (/\bdeliver(?:y|ies)\b/.test(q)) return "delivery";
  if (/\b(sales?|revenue|takings)\b/.test(q)) return "sales";
  return null;
}

export function extractFollowUpFocus(question: string): string | null {
  const q = String(question || "").trim();
  const m = q.match(/^(?:what about|how about|and|same for)\s+(.+?)\??$/i);
  return m ? m[1].trim() : null;
}

function toRange(period: { startDate?: string; endDate?: string; label?: string; periodType?: string } | null | undefined): DateRange | null {
  if (!period?.startDate || !period?.endDate) return null;
  return {
    startDate: period.startDate,
    endDate: period.endDate,
    label: period.label || null,
    semantic: period.periodType || null,
  };
}

function metricWord(metric: CommercialMetric | "commercial" | null): string {
  if (metric === "covers") return "covers";
  if (metric === "orders") return "orders";
  if (metric === "avg_spend") return "average spend";
  if (metric === "delivery") return "delivery sales";
  if (metric === "dine_in") return "dine-in sales";
  return "sales";
}

function reconstructQuestion(input: {
  metric: CommercialMetric | "commercial";
  period: DateRange | null;
  comparisonPeriod: DateRange | null;
  comparisonIntent: boolean;
  branchId: string | null;
  original: string;
}): string {
  const metric = metricWord(input.metric);
  const period = input.period?.label || input.period?.semantic || null;
  const compare = input.comparisonPeriod?.label || input.comparisonPeriod?.semantic || null;
  const branch = input.branchId
    ? ` for ${input.branchId[0].toUpperCase()}${input.branchId.slice(1)}`
    : "";
  if (input.comparisonIntent && period && compare) {
    return `Compare ${metric} in ${period} with ${compare}${branch}`;
  }
  if (period) return `How were ${metric} in ${period}${branch}?`;
  return input.original;
}

export function resolveFollowUpPeriodFocus(
  focus: string,
  referenceDate: Date = new Date(),
): DateRange | null {
  const f = String(focus || "").trim();
  if (!f) return null;
  const candidates = [
    f,
    `How did ${f} perform overall?`,
    `How was ${f}?`,
    `sales ${f}`,
  ];
  for (const candidate of candidates) {
    const resolved = defaultTemporalService.resolveFromQuestion(candidate, referenceDate);
    if (resolved.range?.startDate && resolved.range?.endDate) return resolved.range;
    const parsed = toRange(parseVaultPeriodFromQuestion(candidate, referenceDate));
    if (parsed) return parsed;
  }
  return null;
}

export function isPeriodOnlyFollowUpTurn(
  question: string,
  referenceDate: Date = new Date(),
): boolean {
  const q = String(question || "").trim();
  const self = parseVaultComparePeriodsFromQuestion(q, referenceDate);
  if (self?.current?.startDate && self?.previous?.startDate) return false;
  if (/^(?:compare(?:\s+it)?\s+(?:with|to)|vs|versus|compared with|compared to)\s+/i.test(q)) {
    const compareFocus = q.replace(/^(?:compare(?:\s+it)?\s+(?:with|to)|vs|versus|compared with|compared to)\s+/i, "").replace(/\?+$/, "").trim();
    return Boolean(resolveFollowUpPeriodFocus(compareFocus, referenceDate)?.startDate);
  }
  const focus = extractFollowUpFocus(q);
  if (!focus) return false;
  if (hasComparisonIntent(focus)) return false;
  if (extractCommercialMetric(focus) && !resolveFollowUpPeriodFocus(focus, referenceDate)) return false;
  return Boolean(resolveFollowUpPeriodFocus(focus, referenceDate)?.startDate);
}

function lastCompletedWeekdayRange(name: string, referenceDate: Date): DateRange | null {
  const want = {
    sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
  }[String(name || "").toLowerCase()];
  if (want == null) return null;
  const today = referenceDate.toISOString().slice(0, 10);
  let d = addIsoDays(today, -1);
  for (let i = 0; i < 7; i++) {
    if (isoWeekdayIndex(d) === want) {
      return { startDate: d, endDate: d, label: `${name[0].toUpperCase()}${name.slice(1).toLowerCase()}`, semantic: "single_day" };
    }
    d = addIsoDays(d, -1);
  }
  return null;
}

function extractRanking(question: string): "top" | "bottom" | null {
  const q = String(question || "").toLowerCase();
  if (/\b(top|strongest|best|highest)\b/.test(q)) return "top";
  if (/\b(bottom|weakest|worst|lowest)\b/.test(q)) return "bottom";
  return null;
}

function extractRankingCount(question: string): number {
  const q = String(question || "");
  const numbered = q.match(/\b(?:top|best|worst|bottom)\s+(\d{1,2})\b/i)
    || q.match(/\b(\d{1,2})\s+(?:best|worst|highest|lowest)\b/i);
  if (numbered) return Math.min(10, Math.max(1, Number(numbered[1])));
  if (/\b(best|worst|highest|lowest|top|bottom)\b.{0,24}\bdays\b/i.test(q)) return 3;
  return 1;
}

export function isSubjectiveJudgementPhrase(question: string): boolean {
  const q = String(question || "").toLowerCase();
  if (/\b(top|best|worst|highest|lowest)\s+\d/.test(q) && /\bdays?\b/.test(q)) return false;
  return /\b((?:was|is) that (?:a )?(?:good|bad|strong|weak|normal|unusual)|are we doing (?:well|badly|ok|okay|poorly)|was (?:yesterday|today|that) (?:good|strong|weak|bad|normal|unusual)|is this (?:week|month|better|normal|strong|weak|good|bad|unusual)|(?:is|was) this month (?:good|strong|weak|bad)|are we underperforming|was (?:this )?(?:friday|saturday|sunday|monday|tuesday|wednesday|thursday) (?:good|strong|weak|bad|normal)|good so far|was .{0,20} (?:good|bad|strong|weak)(?:\?|$)|is (?:this|that) (?:a )?good|strong month|weak month)\b/i
    .test(q);
}

export function extractAnalysisIntent(question: string): AnalysisIntent {
  const q = String(question || "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!q) return null;
  if (/\bwhat should i (?:do|look at|pay attention to|focus on|investigate)\b/.test(q)
    || /\bwhat should we (?:do|look at|focus on)\b/.test(q)
  ) return "action";
  if (/\b(what stands out|anything unusual|what matters|key takeaways|management view|what changed|tell me what matters|give me the (?:management )?view)\b/.test(q)) {
    return "stands_out";
  }
  if (/\b(which days? (?:hurt|dragged|drove|explain)|what dragged|what is dragging|dragging us down|what drove|where did the (?:decline|increase|drop) come from|contributors?)\b/.test(q)) {
    return "contributors";
  }
  if (/\b(one bad day|broad(?:-based)?|concentrated|spread across|most of the (?:decline|drop|increase))\b/.test(q)) {
    return "breadth";
  }
  if (/\b(trend(?:ing)?|improving|getting (?:worse|weaker|stronger)|deteriorat|falling|moving)\b/.test(q)
    || /\bare (?:sales|covers|weekends?|fridays?|saturdays?) (?:getting|trending)\b/.test(q)
  ) return "trend";
  if (/\b(unusual|outlier|anomal)\b/.test(q) || /\bnormal for\b/.test(q) || /\bis this normal\b/.test(q) || /\bwas (?:that|it|yesterday) normal\b/.test(q) || /\bnormal (?:fridays?|saturdays?|sundays?|mondays?|weekdays?)\b/.test(q)) {
    return "anomaly";
  }
  if (/\bwhy\b/.test(q)) return "why";
  if (/\bweekend\b/.test(q) && /\bweekday/.test(q)) return "weekend";
  if (isSubjectiveJudgementPhrase(q)) return "judgement";
  return null;
}

export function isSubjectiveJudgementTurn(question: string): boolean {
  return isSubjectiveJudgementPhrase(question);
}

function hasInheritContext(prev: StructuredConversationState): boolean {
  return Boolean(
    prev.activePeriods?.current
    || prev.activeMetric
    || prev.activeMetricFamily
    || prev.previousIntent
    || (prev.activeCapabilities && prev.activeCapabilities.length),
  );
}

export function resolveTurnSemantics(input: {
  question: string;
  previous?: StructuredConversationState | null;
  branchHint?: string | null;
  referenceDate?: Date;
}): TurnSemantics {
  const prev = input.previous || createEmptyConversationState();
  const q = String(input.question || "").trim();
  const ref = input.referenceDate || new Date();
  const notes: string[] = [];
  const inherit = hasInheritContext(prev);

  const explicitMetric = extractCommercialMetric(q);
  const mentionedBranch = normalizeBranchId(q);
  const rankingExplicit = extractRanking(q);
  let ranking: "top" | "bottom" | null = rankingExplicit;
  let rankingCount = rankingExplicit ? extractRankingCount(q) : null;
  const comparisonIntentExplicit = hasComparisonIntent(q);
  const correction = CORRECTION_RE.test(q);
  const subjective = isSubjectiveJudgementTurn(q);
  const analysisIntent = extractAnalysisIntent(q);
  const rankingInstead = Boolean(
    inherit
    && prev.activeRanking
    && explicitMetric
    && /\b(instead|by covers|by sales|by orders|by spend)\b/i.test(q)
    && !rankingExplicit,
  );
  const rankingFlip = Boolean(
    inherit
    && prev.activeRanking
    && /^(?:and\s+)?(?:the\s+)?(worst|best|top|bottom)\??$/i.test(q),
  );
  if (rankingInstead) {
    ranking = prev.activeRanking;
    rankingCount = prev.activeRankingCount || 1;
    notes.push("ranking_inherited_metric_switch");
  }
  if (rankingFlip) {
    ranking = rankingExplicit || prev.activeRanking;
    rankingCount = extractRankingCount(q) || prev.activeRankingCount || 1;
    notes.push("ranking_direction_follow_up");
  }
  const followUpShape = Boolean(extractFollowUpFocus(q) || FOLLOW_UP_PREFIX_RE.test(q) || comparisonIntentExplicit || correction || ranking || rankingInstead || rankingFlip || analysisIntent);

  const temporal = defaultTemporalService.resolveFromQuestion(q, ref);
  const selfCompare = parseVaultComparePeriodsFromQuestion(q, ref);
  let explicitPeriod = toRange(selfCompare?.current) || temporal.range || toRange(parseVaultPeriodFromQuestion(q, ref));
  let explicitCompare = toRange(selfCompare?.previous) || temporal.compareRange || null;

  const compareFocusMatch = q.match(
    /(?:compare(?:\s+(?:it|that))?\s+(?:with|to)|compared\s+(?:with|to)|versus|vs\.?|against)\s+(.+?)\??$/i,
  );
  const comparisonFollowUpOnly = Boolean(
    comparisonIntentExplicit
    && inherit
    && prev.activePeriods.current
    && (compareFocusMatch || /^compared?\b/i.test(q))
    && !selfCompare?.previous
  );
  if (comparisonFollowUpOnly && !temporal.compareRange && !selfCompare?.previous) {
    explicitPeriod = null;
  }

  if (comparisonIntentExplicit && !explicitPeriod && !comparisonFollowUpOnly) {
    const remainder = q.replace(COMPARISON_INTENT_RE, " ").replace(/\s+/g, " ").trim();
    explicitPeriod = resolveFollowUpPeriodFocus(remainder, ref);
  }

  const focus = extractFollowUpFocus(q);
  if (focus && !explicitPeriod) {
    const focusPeriod = resolveFollowUpPeriodFocus(focus, ref);
    if (focusPeriod && !extractCommercialMetric(focus)) {
      explicitPeriod = focusPeriod;
      notes.push("followup_period_from_focus");
    }
  }
  if (!explicitPeriod && (analysisIntent === "anomaly" || analysisIntent === "judgement" || /\bhow (?:was|were|is)\s+(this\s+)?(friday|saturday|sunday|monday|tuesday|wednesday|thursday)\b/i.test(q))) {
    const weekdayOnly = q.match(/\b(this\s+)?(friday|saturday|sunday|monday|tuesday|wednesday|thursday)s?\b/i);
    if (weekdayOnly && !/\bthis month\b/i.test(q) && !/\blast \d+ days\b/i.test(q)) {
      explicitPeriod = lastCompletedWeekdayRange(weekdayOnly[2], ref);
      if (explicitPeriod) notes.push("weekday_named_period");
    }
  }

  if (comparisonIntentExplicit && !explicitCompare) {
    const fragment = compareFocusMatch?.[1] || focus;
    if (fragment) {
      if (/\b(month before|previous month|prior month|previous period|(?:the\s+)?previous(?:\s+one)?|(?:the\s+)?(?:previous|prior)\s+\d+(?:\s+days?)?)\b/i.test(fragment)
        && (explicitPeriod || prev.activePeriods.current)
      ) {
        explicitCompare = toRange(
          buildPreviousEquivalentVaultPeriod(explicitPeriod || prev.activePeriods.current),
        );
        notes.push("comparison_previous_equivalent");
      } else {
        const resolved = resolveFollowUpPeriodFocus(fragment, ref);
        if (resolved) {
          explicitCompare = resolved;
          notes.push("followup_explicit_compare");
        }
      }
    }
  }

  if (/^why the difference\??$/i.test(q) && prev.activePeriods.current) {
    notes.push("followup_why_difference");
  }

  const explicit: TurnDimensionFlags = {
    metric: Boolean(explicitMetric),
    period: Boolean(explicitPeriod),
    branch: Boolean(mentionedBranch),
    comparison: Boolean(explicitCompare) || (comparisonIntentExplicit && Boolean(explicitCompare || prev.activePeriods.current)),
  };

  let metric: CommercialMetric | "commercial" =
    explicitMetric || (prev.activeMetric as CommercialMetric) || (inherit ? (prev.activeMetricFamily as CommercialMetric | "commercial") || "commercial" : "commercial");
  if (!explicitMetric && inherit && prev.activeMetric) metric = prev.activeMetric as CommercialMetric;

  let branchId = mentionedBranch || normalizeBranchId(input.branchHint) || prev.activeBranchId || null;
  let period = explicitPeriod || (inherit ? prev.activePeriods.current : null);
  let comparisonPeriod: DateRange | null = null;
  let comparisonIntent = comparisonIntentExplicit || Boolean(explicitCompare);

  if (explicitCompare) {
    comparisonPeriod = explicitCompare;
    if (!explicitPeriod && prev.activePeriods.current) {
      period = prev.activePeriods.current;
      notes.push("comparison_keeps_prior_current");
    }
  } else if (comparisonIntentExplicit && inherit && prev.activePeriods.current && prev.activePeriods.comparison && !explicitPeriod) {
    period = prev.activePeriods.current;
    comparisonPeriod = prev.activePeriods.comparison;
    notes.push("comparison_inherited_pair");
  } else if (explicitPeriod) {
    comparisonPeriod = null;
  } else if (inherit && !correction) {
    comparisonPeriod = prev.activePeriods.comparison;
    if (comparisonPeriod) {
      comparisonIntent = true;
      notes.push("comparison_preserved_on_metric_or_branch_follow_up");
    }
  }

  if (correction && explicitPeriod) {
    comparisonPeriod = explicitCompare;
    notes.push("explicit_period_replaces_inherited");
  }

  if (/weekend/i.test(q) && /what about|only/i.test(q) && prev.activePeriods.current) {
    notes.push("followup_weekend_filter");
    period = prev.activePeriods.current;
    comparisonPeriod = prev.activePeriods.comparison;
  }

  const inheritedFromConversation: TurnDimensionFlags = {
    metric: !explicit.metric && inherit && Boolean(prev.activeMetric || prev.activeMetricFamily),
    period: !explicit.period && inherit && Boolean(prev.activePeriods.current),
    branch: !explicit.branch && inherit && Boolean(prev.activeBranchId),
    comparison: !explicitCompare && comparisonIntent && inherit && Boolean(prev.activePeriods.comparison || prev.activePeriods.current),
  };

  let ambiguityKind: AmbiguityKind | null = null;
  let clarificationPrompt: string | null = null;

  if (comparisonIntent && period && !comparisonPeriod && !selfCompare) {
    ambiguityKind = "missing_comparison_baseline";
    clarificationPrompt = `Compare ${period.label || "that period"} to what?`;
  } else if (
    ranking
    && !explicitMetric
    && !inherit
    && metric === "commercial"
  ) {
    ambiguityKind = "missing_ranking_metric";
    clarificationPrompt = period
      ? "Best day by sales, covers, or another metric?"
      : "Best day by sales, covers, or another metric — and for which period?";
  } else if (
    inherit
    && followUpShape
    && !explicit.metric
    && !explicit.period
    && !explicit.branch
    && !comparisonIntent
    && !ranking
    && !subjective
    && !analysisIntent
    && !/^why the difference/i.test(q)
    && !/weekend/i.test(q)
  ) {
    ambiguityKind = "underspecified_follow_up";
    clarificationPrompt = "Which metric, period, or branch should I apply that to?";
  } else if (
    comparisonIntent
    && !period
    && !comparisonPeriod
    && !inherit
  ) {
    ambiguityKind = "missing_comparison_baseline";
    clarificationPrompt = "Compare which period to which baseline?";
  }

  const usedFollowUp = inherit && (
    followUpShape
    || inheritedFromConversation.metric
    || inheritedFromConversation.period
    || inheritedFromConversation.branch
    || comparisonIntent
    || notes.includes("followup_why_difference")
    || Boolean(analysisIntent)
  );

  if (ranking && !explicitMetric && inherit && (metric === "commercial" || !explicitMetric)) {
    metric = (prev.activeMetric as CommercialMetric) && prev.activeMetric !== "commercial"
      ? prev.activeMetric as CommercialMetric
      : "sales";
    notes.push("ranking_defaults_to_sales");
  }

  const intent = comparisonIntent
    ? "period_compare"
    : (ranking ? "day_ranking" : (subjective ? (prev.previousIntent || "performance_overview") : (prev.previousIntent && !explicitMetric && !explicitPeriod ? prev.previousIntent : "performance_overview")));

  const preserveOriginal = Boolean(
    temporal.eventWindow
    || temporal.holidayBundle
    || isSubjectiveJudgementTurn(q)
    || Boolean(analysisIntent)
    || ranking
    || /\b(ramadan|founding day|foundation day|eid|forecast|expect)\b/i.test(q)
  );
  const resolvedQuestion = preserveOriginal
    ? q
    : reconstructQuestion({
      metric,
      period,
      comparisonPeriod,
      comparisonIntent,
      branchId,
      original: q,
    });

  const capabilities = comparisonIntent
    ? ["commercial.compare", "commercial.performance"]
    : (prev.activeCapabilities?.length && !explicitPeriod
      ? prev.activeCapabilities.filter((c) => (comparisonIntent ? true : c !== "commercial.compare"))
      : ["commercial.performance"]);

  const conversation = updateConversationState(prev, {
    activeBranchId: branchId,
    activeCompanyId: prev.activeCompanyId || "nac_hospitality",
    activeBrandId: prev.activeBrandId || "nac",
    activeMetricFamily: metric === "covers" || metric === "orders" || metric === "avg_spend" || metric === "delivery"
      ? "commercial"
      : (metric || prev.activeMetricFamily || "commercial"),
    activeMetric: explicitMetric || prev.activeMetric || metric,
    activeCapabilities: comparisonIntent
      ? ["commercial.compare", "commercial.performance"]
      : capabilities,
    activePeriods: {
      current: period,
      comparison: comparisonPeriod,
    },
    previousIntent: intent,
    activeRanking: ranking,
    activeRankingCount: ranking ? (rankingCount || 1) : null,
    filterPatch: notes.includes("followup_weekend_filter") ? { weekendOnly: true } : undefined,
  });

  if (temporal.holidayBundle) notes.push("holiday_event_window_resolved");
  if (selfCompare?.current && selfCompare?.previous) notes.push("self_contained_comparison_preserved");

  return {
    intent,
    metric,
    scope: { branchId },
    period,
    comparisonPeriod,
    comparisonIntent,
    eventWindow: temporal.eventWindow || null,
    ranking,
    rankingCount: ranking ? (rankingCount || 1) : null,
    analysisIntent,
    inheritedFromConversation,
    explicitInCurrentTurn: explicit,
    ambiguity: {
      needsClarification: Boolean(ambiguityKind),
      kind: ambiguityKind,
      prompt: clarificationPrompt,
    },
    usedFollowUp,
    resolvedQuestion,
    notes,
    conversation,
    forecastPeriod: temporal.forecastRange || null,
    nextHolidayDate: temporal.nextHolidayDate || null,
  };
}
