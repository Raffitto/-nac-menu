/**
 * Deterministic follow-up merge: inherit previous plan, apply only explicit turn changes.
 * Period replacement must not drop compatible filters/cohorts.
 */

import { isPeriodOnlyFollowUpTurn } from "../conversationFollowUp.ts";
import { looksLikeSemanticCommerceQuestion } from "../commerce/semantic/planner.ts";
import type { CommerceQueryPlan } from "../commerce/semantic/plan.ts";
import type { DateRange } from "../types.ts";
import { DOMAIN_REGISTRY, type DomainId } from "./domainRegistry.ts";
import type { UniversalEvidenceLeg, UniversalQueryPlan, UnsupportedDomainFilter } from "./plan.ts";

export type PlanFilter = { field: string; op: string; value?: string | number | boolean };

export type ExplicitFollowUpChanges = {
  periodReplace: boolean;
  weekend: "add" | "clear" | null;
  hourGte: number | null;
  family: string | null;
  seedProduct: string | null;
  addReviews: boolean;
  forget: string[];
};

const HOUR_AFTER = /(?:after|from|past|later than)\s+(\d{1,2})\s*(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?/i;

function hour24(raw: string, ampm: string | undefined): number {
  let h = Number(raw);
  const mer = String(ampm || "").replace(/\./g, "").toLowerCase();
  if (mer === "pm" && h < 12) h += 12;
  if (mer === "am" && h === 12) h = 0;
  return h;
}

export function parseExplicitFollowUpChanges(question: string, referenceDate: Date = new Date()): ExplicitFollowUpChanges {
  const q = String(question || "").replace(/\s+/g, " ").trim();
  const qLower = q.toLowerCase();
  const forget: string[] = [];
  const forgetM = qLower.match(/\bforget(?:ting)?(?:\s+(?:the\s+)?)?(weekends?|hours?|after \d|desserts?|products?)\b/);
  if (forgetM) forget.push(/weekend/.test(forgetM[1]) ? "weekend" : /hour|after/.test(forgetM[1]) ? "hour" : /dessert/.test(forgetM[1]) ? "family" : "product");

  let hourGte: number | null = null;
  const hourM = q.match(HOUR_AFTER);
  if (hourM) hourGte = hour24(hourM[1], hourM[3]);
  else if (/\bafter\s+10\b/i.test(q) || /\bafter 10pm\b/i.test(q)) hourGte = 22;
  else if (/\bafter\s+9\b/i.test(q)) hourGte = 21;

  let family: string | null = null;
  if (/\bonly desserts?\b|\bonly dessert\b/.test(qLower) || (/\bonly\b/.test(qLower) && /\bdessert/.test(qLower) && !/\bforget/.test(qLower))) {
    family = "dessert";
  }

  let seedProduct: string | null = null;
  const about = q.match(/^(?:what about|how about)\s+(.+?)\??$/i);
  if (about) {
    const focus = about[1].trim();
    if (!/\b(reviews?|weekends?|weekdays?|sales|covers|july|august|month|week)\b/i.test(focus)) {
      seedProduct = focus.replace(/^["']|["']$/g, "").trim() || null;
    }
  }

  return {
    periodReplace: isPeriodOnlyFollowUpTurn(q, referenceDate),
    weekend: forget.includes("weekend")
      ? "clear"
      : (/\bonly weekends?\b|\bwhat about weekends?\b/i.test(qLower) ? "add" : null),
    hourGte: forget.includes("hour") ? null : hourGte,
    family: forget.includes("family") ? null : family,
    seedProduct,
    addReviews: /\bwhat about reviews\b/i.test(qLower),
    forget,
  };
}

export function isUniversalFollowUpTurn(question: string, previous?: UniversalQueryPlan | null, referenceDate: Date = new Date()): boolean {
  if (!previous) return false;
  const q = String(question || "").trim();
  const commerceOnly = previous.evidence.length > 0
    && previous.evidence.every((leg) => leg.domain === "commerce");
  if (commerceOnly && looksLikeSemanticCommerceQuestion(q) && !/sales|covers|review|why were/i.test(q)) {
    return false;
  }
  if (/^(?:what about|how about|and |same for|why\??$|what should we do|compare with|only |forget |which one )/i.test(q)) return true;
  return isPeriodOnlyFollowUpTurn(q, referenceDate);
}

function cloneLegs(legs: UniversalEvidenceLeg[]): UniversalEvidenceLeg[] {
  return legs.map((leg) => ({
    ...leg,
    operators: [...(leg.operators || [])],
    filters: [...(leg.filters || [])],
  }));
}

function upsertFilter(filters: PlanFilter[], next: PlanFilter): PlanFilter[] {
  const idx = filters.findIndex((f) => f.field === next.field);
  if (idx >= 0) {
    const copy = [...filters];
    copy[idx] = next;
    return copy;
  }
  return [...filters, next];
}

function removeFilter(filters: PlanFilter[], field: string): PlanFilter[] {
  return filters.filter((f) => f.field !== field);
}

export function domainSupportsFilter(domain: DomainId, field: string): boolean {
  const def = DOMAIN_REGISTRY[domain];
  if (!def) return false;
  if (field === "weekend" && def.knownUnavailable.includes("weekend_native_filter")) return false;
  if (def.knownUnavailable.includes(field)) return false;
  if (field === "hour" || field === "family" || field === "product") {
    return def.dimensions.includes(field) || def.dimensions.includes("product") || domain === "commerce";
  }
  if (field === "weekend") return def.dimensions.includes("weekend") || def.dimensions.includes("date");
  return def.dimensions.includes(field);
}

export function discloseUnsupportedFilters(legs: UniversalEvidenceLeg[]): UnsupportedDomainFilter[] {
  const fields = new Set<string>();
  for (const leg of legs) {
    for (const filter of leg.filters || []) {
      if (domainSupportsFilter(leg.domain, filter.field)) fields.add(filter.field);
    }
  }
  const out: UnsupportedDomainFilter[] = [];
  const seen = new Set<string>();
  for (const field of fields) {
    for (const leg of legs) {
      if (domainSupportsFilter(leg.domain, field)) continue;
      const key = `${leg.domain}:${field}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        domain: leg.domain,
        field,
        reason: `${DOMAIN_REGISTRY[leg.domain].authority} does not support a native ${field} slice.`,
      });
    }
  }
  return out;
}

export function applyCompatibleFilters(
  legs: UniversalEvidenceLeg[],
  filters: PlanFilter[],
): { legs: UniversalEvidenceLeg[]; unsupported: UnsupportedDomainFilter[] } {
  const unsupported: UnsupportedDomainFilter[] = [];
  const next = cloneLegs(legs);
  for (const filter of filters) {
    for (const leg of next) {
      if (!domainSupportsFilter(leg.domain, filter.field)) {
        unsupported.push({
          domain: leg.domain,
          field: filter.field,
          reason: `${DOMAIN_REGISTRY[leg.domain].authority} does not support a native ${filter.field} slice.`,
        });
        continue;
      }
      leg.filters = upsertFilter(leg.filters || [], filter);
    }
  }
  return { legs: next, unsupported };
}

function inheritCommerceSnapshot(
  prev: CommerceQueryPlan | null | undefined,
  period: DateRange | null,
  compare: DateRange | null,
  changes: ExplicitFollowUpChanges,
): CommerceQueryPlan | null {
  if (!prev) return null;
  const filters = [...(prev.filters || [])];
  let nextFilters = filters;
  if (changes.weekend === "clear") nextFilters = removeFilter(nextFilters, "weekend");
  if (changes.weekend === "add") nextFilters = upsertFilter(nextFilters, { field: "weekend", op: "eq", value: true });
  if (
    changes.weekend !== "clear"
    && (prev.cohort?.kind === "weekend" || nextFilters.some((f) => f.field === "weekend" && f.value !== false))
    && prev.compareCohort?.kind !== "weekday"
  ) {
    nextFilters = upsertFilter(nextFilters, { field: "weekend", op: "eq", value: true });
  }
  if (changes.hourGte != null) nextFilters = upsertFilter(nextFilters, { field: "hour", op: "gte", value: changes.hourGte });
  if (changes.family) nextFilters = upsertFilter(nextFilters, { field: "family", op: "eq", value: changes.family });
  if (changes.forget.includes("hour")) nextFilters = removeFilter(nextFilters, "hour");
  if (changes.forget.includes("family")) nextFilters = removeFilter(nextFilters, "family");
  let cohort = prev.cohort;
  if (changes.weekend === "clear" && cohort?.kind === "weekend") cohort = null;
  if (
    changes.weekend !== "clear"
    && prev.compareCohort?.kind !== "weekday"
    && nextFilters.some((f) => f.field === "weekend" && f.value !== false)
    && (!cohort || cohort.kind === "weekend")
  ) {
    cohort = { kind: "weekend" };
  }
  return {
    ...prev,
    filters: nextFilters,
    period: period
      ? { startDate: period.startDate, endDate: period.endDate, label: period.label }
      : prev.period,
    compare: compare
      ? { startDate: compare.startDate, endDate: compare.endDate, label: compare.label }
      : prev.compare,
    seedProduct: changes.seedProduct || prev.seedProduct,
    cohort,
    compareCohort: prev.compareCohort,
    calculation: prev.calculation,
    outputIntent: prev.outputIntent,
    ranking: prev.ranking,
    entity: prev.entity,
    metric: prev.metric,
    dimensions: prev.dimensions ? [...prev.dimensions] : prev.dimensions,
    targetFamily: changes.family === "dessert" ? "dessert" : prev.targetFamily,
  };
}

export function mergeUniversalFollowUp(input: {
  previous: UniversalQueryPlan;
  question: string;
  period?: DateRange | null;
  comparePeriod?: DateRange | null;
  branchId?: string | null;
  weekendOnly?: boolean;
  referenceDate?: Date;
}): UniversalQueryPlan {
  const prev = input.previous;
  const q = String(input.question || "").replace(/\s+/g, " ").trim();
  const changes = parseExplicitFollowUpChanges(q, input.referenceDate || new Date());
  const period = input.period || prev.period;
  const compare = input.comparePeriod !== undefined && input.comparePeriod !== null
    ? input.comparePeriod
    : prev.compare;
  const branch = input.branchId || prev.branchScope[0] || "khobar";

  let intent = prev.intent === "driver_analysis" ? prev.intent : "follow_up";
  if (/^why\??$/i.test(q) || (/\bwhy\b/i.test(q) && /\b(sales|performance|weaker|change)\b/i.test(q))) {
    intent = "driver_analysis";
  } else if (/\bwhat should we do\b/i.test(q)) {
    intent = "opportunity";
  }

  let legs = cloneLegs(prev.evidence);
  if (changes.addReviews && !legs.some((l) => l.domain === "reviews")) {
    legs.push({
      domain: "reviews",
      capability: "guest.feedback",
      metric: "review_volume",
      operators: ["align_periods"],
      filters: [],
    });
  }

  const incoming: PlanFilter[] = [];
  if (changes.weekend === "add" || input.weekendOnly) incoming.push({ field: "weekend", op: "eq", value: true });
  if (changes.hourGte != null) incoming.push({ field: "hour", op: "gte", value: changes.hourGte });
  if (changes.family) incoming.push({ field: "family", op: "eq", value: changes.family });
  if (changes.seedProduct) incoming.push({ field: "product", op: "eq", value: changes.seedProduct });

  if (changes.weekend === "clear" || changes.forget.includes("weekend")) {
    legs = legs.map((leg) => ({ ...leg, filters: removeFilter(leg.filters || [], "weekend") }));
  }
  if (changes.forget.includes("hour")) {
    legs = legs.map((leg) => ({ ...leg, filters: removeFilter(leg.filters || [], "hour") }));
  }

  const applied = applyCompatibleFilters(legs, incoming);
  const weekendActive = applied.legs.some((l) => (l.filters || []).some((f) => f.field === "weekend" && f.value !== false))
    && changes.weekend !== "clear";

  return {
    intent,
    question: q,
    branchScope: [branch],
    period,
    compare,
    evidence: applied.legs,
    alignment: weekendActive ? ["period", "branch", "weekend"] : ["period", "branch"],
    synthesis: "management",
    event: prev.event || null,
    unavailable: prev.unavailable || null,
    unsupportedFilters: discloseUnsupportedFilters(applied.legs),
    commerceSnapshot: inheritCommerceSnapshot(prev.commerceSnapshot, period, compare, changes),
    comparisonMethod: prev.comparisonMethod || "matched_days",
  };
}
