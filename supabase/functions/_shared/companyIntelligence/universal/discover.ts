/**
 * Domain discovery from natural language + conversation.
 * Registry-driven cues, not per-sample handlers.
 */

import { detectHolidayQuestionIntent } from "../holidayCalendar.ts";
import { defaultBusinessTimeline } from "../businessTimeline.ts";
import {
  looksLikeHeadlinePlusOperational,
  looksLikeSemanticCommerceQuestion,
} from "../commerce/semantic/planner.ts";
import { buildPreviousEquivalentVaultPeriod } from "../../vaultPeriodParser.ts";
import { DOMAIN_REGISTRY, type DomainId } from "./domainRegistry.ts";
import { isUniversalFollowUpTurn, mergeUniversalFollowUp } from "./merge.ts";
import type { UniversalEvidenceLeg, UniversalIntent, UniversalQueryPlan } from "./plan.ts";
import type { DateRange } from "../types.ts";

export function looksLikeComparativePerformance(question: string): boolean {
  return /\b(weaker|stronger|improv(?:e|ed|ing)|declined|higher|lower|better|worse|why did performance change|why were sales|why did sales)\b/i.test(String(question || ""));
}

const SALES_ONLY = /^(?:how (?:were|was|are) (?:net )?sales\b|what (?:were|was) (?:the )?(?:net )?sales\b|net sales\b|sales in \w+)/i;

function managementCues(q: string) {
  const qLower = q.toLowerCase();
  return {
    whySales: /\b(why|weaker|fell|fall|drop|didn'?t sales|sales improve|performance change)\b/i.test(qLower)
      && /\b(sales|performance|covers)\b/i.test(qLower),
    opportunity: /\b(opportunit(?:y|ies)?|what should we do|focus|recommend|tomorrow)\b/i.test(qLower),
    unusual: /\b(unusual|what changed|how (?:is|are) |should i know|important things|looks wrong|what improved|management brief|this week going)\b/i.test(qLower),
    reviews: /\breviews?|complaints?|ratings?|stars?|service themes\b/i.test(qLower),
    dessert: /\bdessert\b/i.test(qLower) && /\baverage check|avg check|help or hurt\b/i.test(qLower),
    menu: /\bmenu|brownies? launched|launch\b/i.test(qLower),
    covers: /\bcovers?\b/i.test(qLower),
    operational: /\boperational/i.test(qLower),
    avgCheck: /\bavg check|average check\b/i.test(qLower),
  };
}

export function looksLikeSalesOnlyFactual(question: string): boolean {
  const q = String(question || "").trim();
  if (!SALES_ONLY.test(q)) return false;
  return !/\b(why|operational|covers?|review|basket|mix|opportunit|unusual|focus)\b/i.test(q);
}

export function looksLikeUniversalManagementQuestion(
  question: string,
  previous?: UniversalQueryPlan | null,
): boolean {
  const q = String(question || "").trim();
  if (!q) return false;
  if (looksLikeSalesOnlyFactual(q)) return false;
  if (isUniversalFollowUpTurn(q, previous || null)) return true;
  if (looksLikeComparativePerformance(q) && /\b(sales|performance|results|covers|check)\b/i.test(q)) return true;
  const c = managementCues(q);
  if (c.whySales || c.opportunity || c.unusual || c.dessert || c.menu || c.operational || c.reviews || c.covers || c.avgCheck) return true;
  if (c.reviews && /\b(sales|covers?|weekend|period|when|vs|versus|weaker|stronger|last)\b/i.test(q)) return true;
  if (c.reviews && /^what about reviews/i.test(q)) return true;
  if (looksLikeHeadlinePlusOperational(q)) return true;
  if (/\b(help or hurt|hurt average|improve average check|dessert.{0,40}average check)\b/i.test(q)) {
    return true;
  }
  if (/\b(basket gap|high covers but falling|falling avg check)\b/i.test(q)) return true;
  if (
    /\bsales\b/i.test(q)
    && /\b(why|versus|vs\.?|covers|review|operational|window|fell|weaker|mix|basket)\b/i.test(q)
    && !looksLikeSalesOnlyFactual(q)
  ) {
    return true;
  }
  if (/\bcovers?\b/i.test(q) && /\b(sales|avg check|average check|weaker|fell|falling)\b/i.test(q)) return true;
  if (/\bfounding day|ramadan\b/i.test(q) && /\b(sales|operational|versus|vs)\b/i.test(q)) return true;
  if (/\b(policy|vault|document-recorded)\b/i.test(q)) return true;
  if (looksLikeSemanticCommerceQuestion(q) && !/\b(sales|covers?|review|opportunit|unusual|management|why)\b/i.test(q)) {
    return false;
  }
  return false;
}

function addLeg(
  legs: UniversalEvidenceLeg[],
  domain: DomainId,
  capability: string,
  metric?: string,
  operators?: string[],
  filters?: UniversalEvidenceLeg["filters"],
) {
  const existing = legs.find((l) => l.domain === domain);
  if (existing) {
    if (operators?.length) existing.operators = [...new Set([...(existing.operators || []), ...operators])];
    if (filters?.length) existing.filters = [...(existing.filters || []), ...filters];
    if (metric && !existing.metric) existing.metric = metric;
    return;
  }
  if (legs.length >= 4) return;
  const def = DOMAIN_REGISTRY[domain];
  legs.push({
    domain,
    capability: capability || def.queryCapability,
    metric: metric || null,
    operators: operators || [],
    filters: filters ? [...filters] : [],
  });
}

function resolveEvent(question: string, branchId: string | null): UniversalQueryPlan["event"] {
  const q = String(question || "");
  const holiday = detectHolidayQuestionIntent(q);
  if (holiday.detected && holiday.holidayId) {
    return { name: holiday.holidayId, date: null, resolved: true };
  }
  if (/\b(brownies? launched|latest menu additions|menu launch|after (?:the )?menu)\b/i.test(q)) {
    const events = branchId ? defaultBusinessTimeline.listEvents(branchId as "khobar") : [];
    const menu = events.find((e) => e.type === "menu_relaunch" || /menu|brownie/i.test(String(e.note || "")));
    if (menu) return { name: menu.note || menu.type, date: menu.effectiveDate, resolved: true };
    return { name: "menu_change", date: null, resolved: false };
  }
  return null;
}

function inferPreviousComparable(period: DateRange | null, explicit: DateRange | null | undefined): DateRange | null {
  if (explicit?.startDate && explicit.endDate) return explicit;
  if (!period?.startDate || !period.endDate) return null;
  const prev = buildPreviousEquivalentVaultPeriod({
    startDate: period.startDate,
    endDate: period.endDate,
    label: period.label,
    periodType: period.semantic || "custom",
  });
  if (!prev?.startDate || !prev.endDate) return null;
  if (prev.startDate === period.startDate && prev.endDate === period.endDate) return null;
  return {
    startDate: prev.startDate,
    endDate: prev.endDate,
    label: prev.label || "the previous comparable period",
    semantic: prev.periodType || "previous_equivalent",
  };
}

export function planUniversalManagement(input: {
  question: string;
  branchId?: string | null;
  period?: DateRange | null;
  comparePeriod?: DateRange | null;
  previousPlan?: UniversalQueryPlan | null;
  weekendOnly?: boolean;
  referenceDate?: Date;
}): UniversalQueryPlan {
  const q = String(input.question || "").replace(/\s+/g, " ").trim();
  const qLower = q.toLowerCase();
  const prev = input.previousPlan || null;
  const c = managementCues(q);
  const branch = input.branchId || prev?.branchScope[0] || "khobar";

  if (prev && (isUniversalFollowUpTurn(q, prev, input.referenceDate || new Date()) || looksLikeComparativePerformance(q))) {
    const merged = mergeUniversalFollowUp({
      previous: prev,
      question: q,
      period: input.period,
      comparePeriod: input.comparePeriod,
      branchId: branch,
      weekendOnly: input.weekendOnly,
      referenceDate: input.referenceDate,
    });
    if (looksLikeComparativePerformance(q) || merged.intent === "driver_analysis") {
      merged.compare = inferPreviousComparable(merged.period, merged.compare || input.comparePeriod);
      merged.comparisonMethod = merged.comparisonMethod || "matched_days";
    }
    return merged;
  }

  const legs: UniversalEvidenceLeg[] = [];
  let intent: UniversalIntent = "diagnostic";
  if (c.whySales || looksLikeComparativePerformance(q)) intent = "driver_analysis";
  else if (c.opportunity) intent = "opportunity";
  else if (c.menu) intent = "event_before_after";
  else if (c.unusual) intent = "diagnostic";

  if (c.whySales || c.unusual || c.opportunity || looksLikeHeadlinePlusOperational(q) || c.covers || c.avgCheck || c.operational || looksLikeComparativePerformance(q)) {
    addLeg(legs, "cash_up", "commercial.performance", "net_sales", ["baseline_comparison", "driver_decomposition"]);
  }
  if (c.whySales || c.unusual || c.opportunity || c.dessert || c.avgCheck || looksLikeHeadlinePlusOperational(q) || c.operational || /\bbasket\b/i.test(qLower) || looksLikeComparativePerformance(q)) {
    addLeg(
      legs,
      "commerce",
      "commerce.semantic_query",
      "average_check",
      c.dessert ? ["cohort_compare", "association"] : ["contribution", "diagnostic"],
      c.dessert ? [{ field: "family", op: "eq", value: "dessert" }] : undefined,
    );
  }
  if (c.reviews) addLeg(legs, "reviews", "guest.feedback", "review_volume", ["association"]);
  if (c.reviews && /\b(weaker|sales|covers|period|weekend|last year|overlap|divergen)\b/i.test(qLower)) {
    addLeg(legs, "cash_up", "commercial.performance", "net_sales", ["association"]);
  }
  if (c.covers && /\b(sales|avg check|average check|down|weaker)\b/i.test(qLower)) {
    addLeg(legs, "commerce", "commerce.semantic_query", "average_check", ["driver_decomposition"]);
  }
  if (c.covers && !legs.some((l) => l.domain === "cash_up")) {
    addLeg(legs, "cash_up", "commercial.performance", "covers", ["baseline_comparison"]);
  }
  if (/\b(policy|logbook|operational notes?|vault|document-recorded)\b/i.test(qLower) || c.unusual) {
    addLeg(legs, "operations", "operations.review", "issue_mentions", []);
  }
  if (/\b(policy|vault)\b/i.test(qLower) && /\bsales\b/i.test(qLower)) {
    addLeg(legs, "cash_up", "commercial.performance", "net_sales", []);
  }
  if (c.menu) {
    addLeg(legs, "menu", "menu.performance", "availability_flag", ["before_after_event"]);
    addLeg(legs, "commerce", "commerce.semantic_query", "average_check", ["before_after_event"]);
  }
  if (/\bcommerce\b/i.test(qLower)) addLeg(legs, "commerce", "commerce.semantic_query", "average_check", []);
  if (/\bfounding day|ramadan\b/i.test(qLower) && /\b(sales|operational|versus|vs)\b/i.test(qLower)) {
    addLeg(legs, "cash_up", "commercial.performance", "net_sales", []);
    addLeg(legs, "commerce", "commerce.semantic_query", "average_check", []);
  }
  if (!legs.length && looksLikeUniversalManagementQuestion(q, prev)) {
    addLeg(legs, "cash_up", "commercial.performance", "net_sales", ["diagnostic"]);
    addLeg(legs, "commerce", "commerce.semantic_query", "average_check", ["diagnostic"]);
  }

  const inheritWeekend = Boolean(input.weekendOnly) || /\bonly weekends?\b|\bwhat about weekends?\b/i.test(qLower);
  const unsupportedFilters: UniversalQueryPlan["unsupportedFilters"] = [];
  if (inheritWeekend) {
    for (const leg of legs) {
      if (!DOMAIN_REGISTRY[leg.domain].knownUnavailable.includes("weekend_native_filter")
        && (DOMAIN_REGISTRY[leg.domain].dimensions.includes("weekend") || leg.domain === "commerce")) {
        if (!(leg.filters || []).some((f) => f.field === "weekend")) {
          leg.filters = [...(leg.filters || []), { field: "weekend", op: "eq", value: true }];
        }
      } else if (leg.domain === "cash_up") {
        unsupportedFilters.push({
          domain: "cash_up",
          field: "weekend",
          reason: "Cash Up has no native weekend slice; headline figures remain the full selected period.",
        });
      }
    }
  }

  const event = resolveEvent(q, branch);
  const period = input.period || prev?.period || null;
  const wantsCompare = looksLikeComparativePerformance(q) || intent === "driver_analysis";
  const compare = wantsCompare
    ? inferPreviousComparable(period, input.comparePeriod)
    : (input.comparePeriod || prev?.compare || null);

  let unavailable: UniversalQueryPlan["unavailable"] = null;
  if (/\b7rooms|seven rooms\b/i.test(qLower)) {
    unavailable = { field: "seven_rooms", reason: "A live 7Rooms reservation feed is not ingested. Reception covers from logbook/Cash Up may be available instead." };
  }
  if (/\bphysical table|table number\b/i.test(qLower)) {
    unavailable = { field: "physical_table_number", reason: "Physical table identity is not stored in canonical commerce." };
  }
  if (event && !event.resolved && intent === "event_before_after") {
    unavailable = { field: "event_date", reason: `No trusted date is registered for ${event.name}. Before/after analysis is not run from a guessed launch date.` };
  }

  return {
    intent,
    question: q,
    branchScope: [branch],
    period,
    compare,
    evidence: legs,
    alignment: inheritWeekend ? ["period", "branch", "weekend"] : ["period", "branch"],
    synthesis: unavailable && !legs.length ? "limitation" : "management",
    event,
    unavailable,
    unsupportedFilters,
    comparisonMethod: wantsCompare ? "matched_days" : null,
  };
}
