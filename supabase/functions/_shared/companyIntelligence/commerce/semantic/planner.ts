/**
 * Deterministic NL → commerce query plan.
 * Registry/pattern driven. Not a handler per sample sentence.
 */

import { metricByAlias, type SemanticMetricId } from "./metrics.ts";
import type { CommerceCohort, CommercePlanFilter, CommerceQueryPlan } from "./plan.ts";
import { validateCommercePlan, type PlanValidation } from "./plan.ts";
import type { DateRange } from "../../types.ts";

const HOUR_AFTER = /(?:after|from|past|later than)\s+(\d{1,2})\s*(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?/i;
const HOUR_BARE = /(\d{1,2})\s*(a\.?m\.?|p\.?m\.?)/i;
const SPEND = /(?:checks?|orders?|baskets?)\s+(?:above|over|greater than|>\s*)\s*(\d+(?:\.\d+)?)\s*(?:sar)?/i;
const SPEND2 = /(?:above|over)\s+(\d+(?:\.\d+)?)\s*sar/i;
const GUESTS = /(\d+)\s*\+?\s*guests?|(\d+)\s+or more guests?|(?:guest|cover)s?\s*(?:count\s*)?(?:of\s*)?(?:>=|at least|over|more than)?\s*(\d+)/i;
const BASKET_EQ = /only one product|single product|one product only|checks? had only one/i;
const BASKET_GT = /more than\s+(\d+)\s+items?|over\s+(\d+)\s+items?|(\d+)\+\s*items/i;
const BASKET_GTE = /at least\s+(\d+)\s+items?|(?:with\s+)?(\d+)\s+or more items?/i;
const DISTINCT_GTE = /at least\s+(\d+)\s+different products?|(\d+)\s+different products/i;
const TOP_N = /(?:top|biggest|largest|highest)\s+(\d+)/i;
const WITH_PRODUCT = /(?:ordered with|alongside|together with|go with|goes with|pair(?:ed)? with|with)\s+["']?([A-Za-z][A-Za-z0-9'&+\- ]{1,40})["']?/i;
const WHEN_PRODUCT = /when\s+["']?([A-Za-z][A-Za-z0-9'&+\- ]{1,40})["']?\s+is ordered/i;
const CONTAINING = /(?:containing|contain|that (?:include|included|had|have)|checks? with)\s+["']?([A-Za-z][A-Za-z0-9'&+\- ]{1,40})["']?/i;
const ATTACHED_TO = /(?:attached to|alongside)\s+["']?([A-Za-z][A-Za-z0-9'&+\- ]{1,40})["']?/i;
const SPECIFIC_ITEM = /specific item|a given item/;

function hour24(raw: string, ampm: string | undefined): number {
  let h = Number(raw);
  const mer = String(ampm || "").replace(/\./g, "").toLowerCase();
  if (mer === "pm" && h < 12) h += 12;
  if (mer === "am" && h === 12) h = 0;
  return h;
}

function extractHourGte(q: string): number | null {
  const m = q.match(HOUR_AFTER);
  if (m) return hour24(m[1], m[3]);
  if (/\bafter\s+10\b/i.test(q) || /\bafter 10pm\b/i.test(q)) return 22;
  if (/\bafter\s+9\b/i.test(q)) return 21;
  return null;
}

const MONTH_TAIL = /\s+in\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:\s+\d{4})?$/i;

function extractProduct(q: string): string | null {
  const quoted = q.match(/["']([A-Za-z][A-Za-z0-9'&+\- ]{1,40})["']/);
  if (quoted) return quoted[1].trim();
  for (const re of [WHEN_PRODUCT, ATTACHED_TO, WITH_PRODUCT, CONTAINING]) {
    const m = q.match(re);
    if (m) {
      const name = m[1].trim()
        .replace(MONTH_TAIL, "")
        .replace(/\s+on\s+(?:high[- ]value|high[- ]spend|big).*$/i, "")
        .replace(/\s+(is ordered|on (?:tables|checks)|but no.*)$/i, "")
        .trim();
      if (/^(dessert|food|coffee|mains?|drinks?|checks?|orders?|guests?|items?|people|the|\d+|at least|more than|only)$/i.test(name)) continue;
      if (/\b(versus|without|at least|or more)\b/i.test(name)) continue;
      return name;
    }
  }
  return null;
}

function looksLimitation(q: string): { field: string; reason: string } | null {
  if (/\bphysical table|table numbers?|which table (?:number|#)|table no\b/i.test(q)) {
    return {
      field: "physical_table_number",
      reason: "Physical table identity is not stored in canonical commerce. Order/session-level analysis is available instead.",
    };
  }
  if (/\bmoved (?:item|rows|lines)|item rows were moved|proportion of .*moved\b/i.test(q)) {
    return {
      field: "item_moved",
      reason: "Moved vs Done is not retained as a distinct canonical item status (official CSV Moved was mapped to completed).",
    };
  }
  if (/\b(waiter|creator|who closed the check)\b/i.test(q)) {
    return {
      field: "creator",
      reason: "Order creator is not a canonical commerce field.",
    };
  }
  return null;
}

export function looksLikeCommerceDiagnostic(question: string): boolean {
  const q = String(question || "").toLowerCase();
  return /\b(what changed|anything unusual|what should i know|how are baskets|baskets looking|operationally|check-size distribution|how was .{0,20}operational)\b/.test(q)
    || /\bwhat changed (?:this month|in |after )\b/.test(q)
    || (/\bhow (?:was|were)\b/.test(q)
      && /\b(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sep|october|oct|november|nov|december|dec|yesterday|last week|this month|last month)\b/.test(q)
      && !/\bsales\b/.test(q));
}

export function looksLikeHeadlinePlusOperational(question: string): boolean {
  const q = String(question || "").toLowerCase();
  return /\b(sales were|stronger this month|headline)\b/.test(q) && /\b(operational|what changed|baskets?|checks?)\b/.test(q);
}

export function looksLikeSemanticCommerceQuestion(question: string): boolean {
  const q = String(question || "").toLowerCase();
  if (!q.trim()) return false;
  if (looksLimitation(q)) return true;
  if (looksLikeCommerceDiagnostic(q) || looksLikeHeadlinePlusOperational(q)) return true;
  if (/^(?:only after\b|only desserts?\b|same for\b|which one changed)/i.test(q.trim())) return true;
  const composition = /\b(checks?|baskets?|products?|items?|desserts?|drinks?|cookies|rigatoni|dine-in checks?|food-containing|containing dessert)\b/.test(q)
    || /\b(ordered with|association|associated with|attach rate|co-?occur|basket size|biggest checks?|largest checks?|average check when|different products)\b/.test(q);
  const analytic = /\b(most |common|often|appear|share|percentage|percent|at least|or more|versus|vs\.?|associated|association|after \d|weekend|weekday|biggest|largest|only one|average (?:check|spend) (?:when|on checks)|over-index|gained|declined|distribution|percentile|pairs?|together)\b/.test(q);
  if (composition && analytic) return true;
  return (
    /\b(ordered with|alongside|attach rate|co-?occur|basket size|biggest checks?|largest checks?|average check when|checks? (?:above|over)|only one product|more than \d+ items?|share of checks|percentage of checks|ordered together|most associated|high-spend|high value checks?|guest(?:s)? count|dine-in checks?|food-containing|dessert-focused|but no food|but no mains|open\/joined|joined orders|weekend basket|weekday basket|after \d{1,2}|daypart|combinations?|penetration|what do (?:people|guests|customers) order with|products? (?:are )?(?:most )?(?:commonly )?ordered|highest attach|compare weekend)\b/.test(q)
    || /\b(top(?:-|\s)?(?:selling )?products?|top desserts? on checks|most common desserts?)\b/.test(q)
    || /\bwhen [a-z].{1,30} is ordered\b/.test(q)
    || /\b\d+\s*(?:\+|or more)\s*guests?\b/.test(q)
    || /\b(sell together|big checks|over-index|share from|check-size|90th percentile|low-spend|high-spend baskets)\b/.test(q)
  );
}

function defaultMetric(q: string, calc: CommerceQueryPlan["calculation"]): SemanticMetricId {
  const aliased = metricByAlias(q);
  if (aliased) return aliased;
  if (calc === "cooccurrence") return "cooccurrence_rate";
  if (calc === "attach_rate") return "attach_rate";
  if (calc === "lift") return "lift_vs_baseline";
  if (calc === "penetration") return "penetration_rate";
  if (calc === "cohort_compare") return "average_check";
  if (calc === "share_change") return "category_share";
  if (calc === "contribution") return "revenue";
  if (calc === "percentile") return "median_check";
  if (calc === "spend_buckets") return "high_spend_share";
  if (calc === "pairs") return "cooccurrence_count";
  if (calc === "diagnostic") return "average_check";
  if (/\bpercentile|median\b/.test(q)) return "median_check";
  if (/\bbasket\b/.test(q)) return "basket_item_count";
  if (/\baverage check\b/.test(q)) return "average_check";
  if (/\bmedian\b/.test(q)) return "median_check";
  if (/\bopen|joined\b/.test(q)) return "open_order_count";
  if (/\bbiggest checks|largest checks\b/.test(q)) return "gross_check";
  if (/\btop|most (?:often|common)|rank\b/.test(q)) return "item_quantity";
  return "order_count";
}

export function planSemanticCommerce(input: {
  question: string;
  branchId?: string | null;
  period?: DateRange | null;
  comparePeriod?: DateRange | null;
  previousPlan?: CommerceQueryPlan | null;
}): PlanValidation {
  const q = String(input.question || "").replace(/\s+/g, " ").trim();
  const qLower = q.toLowerCase();
  const prev = input.previousPlan || null;
  const limitation = looksLimitation(qLower);
  if (limitation) {
    const plan: CommerceQueryPlan = {
      domain: "commerce",
      entity: "orders",
      metric: "order_count",
      dimensions: [],
      filters: [],
      period: input.period ? { startDate: input.period.startDate, endDate: input.period.endDate, label: input.period.label } : prev?.period || null,
      outputIntent: "limitation",
      unavailable: limitation,
    };
    return validateCommercePlan(plan);
  }

  const filters: CommercePlanFilter[] = prev ? [...prev.filters] : [];
  const addFilter = (field: string, op: CommercePlanFilter["op"], value?: CommercePlanFilter["value"]) => {
    const idx = filters.findIndex((f) => f.field === field && f.op === op);
    const next = { field, op, value };
    if (idx >= 0) filters[idx] = next;
    else filters.push(next);
  };

  if (input.branchId) addFilter("branch", "eq", input.branchId);
  if (/\bweekends?\b/.test(qLower) && !/\bweekdays?/.test(qLower)) addFilter("weekend", "eq", true);
  if (/\bweekdays?/.test(qLower) && !/\bweekends?\b/.test(qLower)) addFilter("weekend", "eq", false);
  const hourGte = extractHourGte(q);
  if (hourGte != null) addFilter("hour", "gte", hourGte);
  if (/\bonly desserts?\b|\bonly dessert\b/.test(qLower) || (/\bonly\b/.test(qLower) && /\bdessert/.test(qLower))) {
    addFilter("family", "eq", "dessert");
  }
  if (/\bcompleted dine-in|dine-in checks?\b/.test(qLower)) {
    addFilter("order_type", "eq", "dine_in");
    addFilter("status", "eq", "completed");
  }

  let seedProduct = extractProduct(q) || prev?.seedProduct || null;
  if (SPECIFIC_ITEM.test(qLower) && !seedProduct) seedProduct = prev?.seedProduct || null;

  let calculation: CommerceQueryPlan["calculation"] = prev?.calculation || "none";
  let outputIntent: CommerceQueryPlan["outputIntent"] = prev?.outputIntent || "value";
  let cohort: CommerceCohort | null = prev?.cohort || null;
  let compareCohort: CommerceCohort | null = prev?.compareCohort || null;
  let ranking = prev?.ranking || null;
  let dimensions = prev?.dimensions ? [...prev.dimensions] : [];
  let entity: CommerceQueryPlan["entity"] = prev?.entity || "orders";
  let targetFamily = prev?.targetFamily || null;

  const spendM = q.match(SPEND) || q.match(SPEND2);
  if (spendM) {
    cohort = { kind: "spend_gt", value: Number(spendM[1]) };
    calculation = "lift";
    outputIntent = "ranking";
    entity = "items";
    dimensions = ["product"];
    ranking = ranking || { direction: "desc", limit: 10 };
  }

  const guestM = q.match(GUESTS) || q.match(/(\d+)\s*\+\s*guests?|checks? with (\d+)\s+or more guests?|checks? with (\d+)\+?\s*guests?/);
  if (guestM) {
    const n = Number(guestM[1] || guestM[2] || guestM[3]);
    if (Number.isFinite(n)) {
      cohort = { kind: "covers_gte", value: n };
      if (/\bproducts?\b/.test(qLower)) {
        calculation = "penetration";
        outputIntent = "ranking";
        entity = "items";
        dimensions = ["product"];
        ranking = ranking || { direction: "desc", limit: 10 };
      }
    }
  } else if (/\bguest count affect|how does guest count\b/.test(qLower)) {
    dimensions = ["guest_band"];
    outputIntent = "distribution";
    calculation = "distribution";
  }

  if (BASKET_EQ.test(qLower)) {
    cohort = { kind: "basket_eq", value: 1 };
    calculation = "penetration";
    outputIntent = "value";
    entity = "orders";
  }
  const basketGt = q.match(BASKET_GT);
  if (basketGt) {
    cohort = { kind: "basket_gt", value: Number(basketGt[1] || basketGt[2] || basketGt[3]) };
    outputIntent = "value";
    entity = "orders";
  }
  const basketGte = q.match(BASKET_GTE);
  if (basketGte) {
    cohort = { kind: "basket_gte", value: Number(basketGte[1] || basketGte[2]) };
    entity = "orders";
    if (/\bproducts?\b/.test(qLower)) {
      outputIntent = "ranking";
      entity = "items";
      dimensions = ["product"];
      ranking = ranking || { direction: "desc", limit: 10 };
    } else {
      outputIntent = "value";
    }
  }
  const distinctGte = q.match(DISTINCT_GTE);
  if (distinctGte) {
    cohort = { kind: "distinct_gte", value: Number(distinctGte[1] || distinctGte[2]) };
    calculation = "penetration";
    outputIntent = "value";
    entity = "orders";
  }

  if (/\bdrinks?\b/.test(qLower) && (seedProduct || /\bassociation|associated|with\b/.test(qLower))) {
    calculation = "cooccurrence";
    outputIntent = "ranking";
    entity = "items";
    dimensions = ["product"];
    ranking = ranking || { direction: "desc", limit: 10 };
    addFilter("family", "eq", "beverage");
    if (seedProduct) cohort = { kind: "contains_product", value: seedProduct };
  }

  if (/\bordered with|alongside|together with|what do (?:people|guests|customers) order with|most commonly ordered with/.test(qLower)) {
    calculation = "cooccurrence";
    outputIntent = "ranking";
    entity = "items";
    dimensions = ["product"];
    ranking = ranking || { direction: "desc", limit: 10 };
    if (seedProduct) cohort = { kind: "contains_product", value: seedProduct };
  }

  if (/\battached to\b/.test(qLower) && seedProduct) {
    calculation = "cooccurrence";
    outputIntent = "ranking";
    entity = "items";
    dimensions = ["product"];
    ranking = ranking || { direction: "desc", limit: 10 };
    cohort = { kind: "contains_product", value: seedProduct };
  } else if (/\battach(?:\s+rate)?\b/.test(qLower)) {
    calculation = "attach_rate";
    outputIntent = /\bwhich products|highest attach|products have\b/.test(qLower) ? "ranking" : "value";
    entity = outputIntent === "ranking" ? "items" : "sessions";
    if (/\bfood-containing|food containing\b/.test(qLower) && /\bdessert\b/.test(qLower)) {
      targetFamily = "dessert";
      cohort = { kind: "has_family", value: "food" };
      compareCohort = { kind: "has_family", value: "dessert" };
      calculation = "attach_rate";
      entity = "sessions";
      outputIntent = "value";
    }
    if (/\bdessert-focused|dessert focused\b/.test(qLower)) {
      cohort = { kind: "archetype", value: "dessert_focused" };
      dimensions = ["product"];
      outputIntent = "ranking";
      entity = "items";
      calculation = "attach_rate";
    }
    if (/\bto mains?|to food\b/.test(qLower)) {
      cohort = { kind: "has_family", value: "food" };
      dimensions = ["product"];
      outputIntent = "ranking";
      entity = "items";
    }
  }

  if (/\bdessert but no food|dessert and no food\b/.test(qLower)) {
    cohort = { kind: "has_family", value: "dessert" };
    compareCohort = { kind: "not_has_family", value: "food" };
    outputIntent = "value";
    entity = "orders";
    addFilter("order_type", "eq", "dine_in");
    addFilter("status", "eq", "completed");
  }

  if (/\bcoffee and dessert but no mains|coffee and dessert but no food\b/.test(qLower)) {
    cohort = { kind: "archetype", value: "dessert_and_coffee" };
    outputIntent = "value";
    entity = "sessions";
  }

  if (/\baverage check when\b/.test(qLower) && seedProduct) {
    cohort = { kind: "contains_product", value: seedProduct };
    calculation = "none";
    outputIntent = "value";
    entity = "orders";
  }

  if (/\b(containing|with) dessert\b/.test(qLower) && /\b(without dessert|versus those without|vs without|versus those without dessert)\b/.test(qLower)
    || /\bdoes ordering dessert increase|dessert increase average check|with dessert vs without\b/.test(qLower)) {
    cohort = { kind: "has_family", value: "dessert" };
    compareCohort = { kind: "not_has_family", value: "dessert" };
    calculation = "cohort_compare";
    outputIntent = "comparison";
    entity = "orders";
  }

  if (/\bweekend basket.*weekday|weekday.*weekend basket|compare weekend basket\b/.test(qLower)
    || (/\bbasket size\b/.test(qLower) && /\bweekend\b/.test(qLower) && /\bweekday/.test(qLower))) {
    calculation = "cohort_compare";
    outputIntent = "comparison";
    cohort = { kind: "weekend" };
    compareCohort = { kind: "weekday" };
    entity = "orders";
  }

  if (/\bbiggest checks|largest checks|highest checks\b/.test(qLower)) {
    outputIntent = "ranking";
    entity = "orders";
    ranking = { direction: "desc", limit: Number((q.match(TOP_N) || [])[1] || 10) };
    dimensions = [];
  }

  if (/\btop(?:-|\s)?(?:selling )?products?|products? (?:ordered |appear )?most often|most common desserts?|common desserts?\b/.test(qLower)
    && calculation === "none" && outputIntent !== "ranking") {
    outputIntent = "ranking";
    entity = "items";
    dimensions = ["product"];
    ranking = ranking || { direction: "desc", limit: Number((q.match(TOP_N) || [])[1] || 10) };
    if (/\bdesserts?\b/.test(qLower)) addFilter("family", "eq", "dessert");
  }

  if (/\bopen\/joined|joined orders|how many open\b/.test(qLower)) {
    addFilter("status", "in", ["open"]);
    outputIntent = "value";
    entity = "orders";
  }

  if (/\bshare of checks contain|percentage of checks contain|what share of checks\b/.test(qLower)) {
    calculation = "penetration";
    outputIntent = "value";
    if (seedProduct) cohort = { kind: "contains_product", value: seedProduct };
  }

  if (/\bpercentage of food-containing|food-containing sessions also ordered dessert|food tables? (?:also )?ordered dessert\b/.test(qLower)) {
    calculation = "attach_rate";
    outputIntent = "value";
    entity = "sessions";
    targetFamily = "dessert";
    cohort = { kind: "has_family", value: "food" };
    compareCohort = { kind: "has_family", value: "dessert" };
  }

  if (/\bweekend/.test(qLower) && /\bweekday/.test(qLower) && /\b(basket|mix|product)/.test(qLower)) {
    calculation = "cohort_compare";
    outputIntent = "comparison";
    cohort = { kind: "weekend" };
    compareCohort = { kind: "weekday" };
    entity = "orders";
  }

  if (/\bguest-count band|by guest count|guest count affect\b/.test(qLower)) {
    dimensions = ["guest_band"];
    outputIntent = "distribution";
    calculation = "distribution";
  }

  if (/\bhigh-value|high-spend|high value checks|disproportionately ordered on high|big checks\b/.test(qLower) && !spendM) {
    cohort = { kind: "spend_gt", value: 300 };
    if (calculation === "none") {
      calculation = "lift";
      outputIntent = "ranking";
      entity = "items";
      dimensions = ["product"];
      ranking = ranking || { direction: "desc", limit: 10 };
    }
  }

  if (/\b(1\s*[–-]\s*2|1 or 2)\s+guest/.test(qLower) && /\b4\s*\+?\s*guest|4 or more guest/.test(qLower)) {
    cohort = { kind: "covers_between", value: "1-2" };
    compareCohort = { kind: "covers_gte", value: 4 };
    calculation = "cohort_compare";
    outputIntent = "comparison";
    entity = "orders";
  }

  if (/\bover-index|unusually common|disproportionately present\b/.test(qLower)) {
    calculation = "lift";
    outputIntent = "ranking";
    entity = "items";
    dimensions = ["product"];
    ranking = ranking || { direction: "desc", limit: 10 };
  }

  if (/\bgained the most share|lost the most share|declined the most|share from\b/.test(qLower)
    || (/\bwhich products (?:gained|declined|changed)\b/.test(qLower) && input.comparePeriod)) {
    calculation = "share_change";
    outputIntent = "ranking";
    entity = "items";
    dimensions = ["product"];
    ranking = ranking || { direction: "desc", limit: 10 };
  }

  if (/\bcontributed most|what drove|explain the difference|why were weekend\b/.test(qLower)) {
    calculation = "contribution";
    outputIntent = "ranking";
    entity = "items";
    dimensions = ["product"];
    ranking = ranking || { direction: "desc", limit: 10 };
    if (/\bweekend/.test(qLower)) {
      cohort = { kind: "weekend" };
      compareCohort = { kind: "weekday" };
    }
    if (/\bhigh-value|big checks|high-spend|above 300\b/.test(qLower)) {
      cohort = { kind: "spend_gt", value: 300 };
    }
  }

  if (/\bcheck-size distribution|share of checks fall|spend bands?\b/.test(qLower) || /<100/.test(qLower)) {
    calculation = "spend_buckets";
    outputIntent = "distribution";
    entity = "orders";
  }

  if (/\bmedian\b/.test(qLower) && /\b90th|p90|percentile\b/.test(qLower) || /\bpercentile check\b/.test(qLower)) {
    calculation = "percentile";
    outputIntent = "distribution";
    entity = "orders";
  }

  if (/\bproduct pairs|sell together|combinations?\b/.test(qLower) && !/\bdessert\+drink|dessert and drink\b/.test(qLower)) {
    calculation = "pairs";
    outputIntent = "ranking";
    entity = "items";
  }

  if (/\bdessert\+drink|dessert and drink combinations\b/.test(qLower)) {
    calculation = "pairs";
    outputIntent = "ranking";
    entity = "items";
    addFilter("family", "eq", "dessert");
  }

  if (/\bfood-containing vs dessert-focused|dessert-focused vs food-containing\b/.test(qLower)) {
    cohort = { kind: "archetype", value: "food_containing" };
    compareCohort = { kind: "archetype", value: "dessert_focused" };
    calculation = "cohort_compare";
    outputIntent = "comparison";
  }

  if (/\blow-spend vs high-spend|high-spend vs low-spend|low-spend baskets\b/.test(qLower)) {
    cohort = { kind: "spend_gt", value: 300 };
    compareCohort = { kind: "spend_gt", value: 0 };
    calculation = "cohort_compare";
    outputIntent = "comparison";
    entity = "orders";
  }

  if ((looksLikeHeadlinePlusOperational(q) || looksLikeCommerceDiagnostic(q) || /\bhow are baskets looking\b/.test(qLower))
    && !["share_change", "lift", "contribution", "spend_buckets", "percentile", "pairs", "cohort_compare", "cooccurrence", "attach_rate", "penetration"].includes(String(calculation))) {
    calculation = "diagnostic";
    outputIntent = "diagnostic";
    entity = "orders";
  }

  if (/\bwhich one changed the most\b/.test(qLower) && prev) {
    calculation = "share_change";
    outputIntent = "ranking";
    entity = "items";
    dimensions = ["product"];
  }

  if (/\bcompare\b/.test(qLower) && input.comparePeriod) {
    outputIntent = outputIntent === "value" ? "comparison" : outputIntent;
  }

  const topN = q.match(TOP_N);
  if (topN) ranking = { direction: "desc", limit: Number(topN[1]) };

  if (/\bonly after\b/.test(qLower) && prev) {
    outputIntent = prev.outputIntent;
    calculation = prev.calculation || calculation;
    entity = prev.entity;
    dimensions = prev.dimensions;
    ranking = prev.ranking;
    seedProduct = prev.seedProduct || seedProduct;
    cohort = prev.cohort || cohort;
  }

  const period = input.period
    ? { startDate: input.period.startDate, endDate: input.period.endDate, label: input.period.label }
    : prev?.period || null;
  const compare = input.comparePeriod
    ? { startDate: input.comparePeriod.startDate, endDate: input.comparePeriod.endDate, label: input.comparePeriod.label }
    : (/\bsame for|compare .*july|vs july|versus july\b/.test(qLower) ? prev?.compare : prev?.compare) || null;

  const metric = defaultMetric(qLower, calculation);
  const plan: CommerceQueryPlan = {
    domain: "commerce",
    entity,
    metric: metric === "order_count" && outputIntent === "ranking" && entity === "items" ? "item_quantity" : metric,
    dimensions,
    filters,
    period,
    compare: compare || undefined,
    ranking: ranking || undefined,
    cohort,
    compareCohort,
    calculation,
    outputIntent,
    seedProduct,
    targetFamily,
  };
  return validateCommercePlan(plan);
}
