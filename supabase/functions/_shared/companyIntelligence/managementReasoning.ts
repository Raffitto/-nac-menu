/**
 * Deterministic commercial reasoning for Ask NAC.
 * Interprets metric relationships only — never invents operational causes.
 */

import type { EvidenceRecord } from "./evidenceLedger.ts";
import type { ComparabilityResult } from "./comparabilityEngine.ts";
import type { CoverageReport } from "./coverageModel.ts";
import type { NormalizedDailyFact, NormalizedRanking } from "./normalizedCapabilityResult.ts";
import type { CommercialMetric, AnalysisIntent } from "./turnSemantics.ts";
import { extractAnalysisIntent, isSubjectiveJudgementPhrase } from "./turnSemantics.ts";
import type { DateRange } from "./types.ts";
import {
  MAGNITUDE_FLAT_PCT,
  directionWord,
  formatCount,
  formatManagerDate,
  formatMoney,
  formatPercent,
  isEffectivelyFlat,
  isoWeekdayName,
  isKsaWeekendIso,
  magnitudePhrase,
  metricCopula,
  percentDelta,
} from "./managementPresentation.ts";
import { diagnoseCommercialPerformance } from "./managementAnalyst.ts";

export type RelationshipType =
  | "volume_led_decline"
  | "volume_led_growth"
  | "spend_led_decline"
  | "spend_led_growth"
  | "offsetting_volume_spend"
  | "order_mix_more_smaller"
  | "order_mix_fewer_larger"
  | "flat_insignificant";

export type ManagementRelationship = {
  type: RelationshipType;
  confidence: "supported";
  evidence: string[];
  statement: string;
};

export type AnswerDepth = "fact" | "metric_fact" | "comparison" | "overview" | "ranking" | "judgement";

export type CommercialSnapshot = {
  net_sales: number | null;
  covers: number | null;
  orders: number | null;
  avg_spend: number | null;
  previous_net_sales: number | null;
  previous_covers: number | null;
  previous_orders: number | null;
  previous_avg_spend: number | null;
  sales_delta_pct: number | null;
  covers_delta_pct: number | null;
  orders_delta_pct: number | null;
  avg_spend_delta_pct: number | null;
  aov: number | null;
  previous_aov: number | null;
  aov_delta_pct: number | null;
};

export type ManagementReasoning = {
  primaryMetric: CommercialMetric | "commercial";
  depth: AnswerDepth;
  headline: string | null;
  supporting: string[];
  relationships: ManagementRelationship[];
  comparisonContext: string | null;
  coverageContext: string | null;
  rankingText: string | null;
  judgementOffer: string | null;
  groupingText: string | null;
  analystSentences: string[];
};

function numEvidence(evidence: EvidenceRecord[], key: string): number | null {
  const hit = evidence.find((e) => e.metricOrEvent === key && typeof e.value === "number");
  return hit && typeof hit.value === "number" ? Number(hit.value) : null;
}

export function extractCommercialSnapshot(evidence: EvidenceRecord[]): CommercialSnapshot {
  const net_sales = numEvidence(evidence, "net_sales") ?? numEvidence(evidence, "total_sales");
  const covers = numEvidence(evidence, "covers") ?? numEvidence(evidence, "guests");
  const orders = numEvidence(evidence, "orders");
  const avg_spend = numEvidence(evidence, "avg_spend") ?? numEvidence(evidence, "average_spend")
    ?? (net_sales != null && covers && covers > 0 ? net_sales / covers : null);
  const previous_net_sales = numEvidence(evidence, "previous_net_sales");
  const previous_covers = numEvidence(evidence, "previous_covers");
  const previous_orders = numEvidence(evidence, "previous_orders");
  const previous_avg_spend = numEvidence(evidence, "previous_avg_spend");
  const sales_delta_pct = numEvidence(evidence, "delta_pct")
    ?? percentDelta(net_sales, previous_net_sales);
  const covers_delta_pct = numEvidence(evidence, "covers_delta_pct")
    ?? percentDelta(covers, previous_covers);
  const orders_delta_pct = numEvidence(evidence, "orders_delta_pct")
    ?? percentDelta(orders, previous_orders);
  const avg_spend_delta_pct = numEvidence(evidence, "avg_spend_delta_pct")
    ?? percentDelta(avg_spend, previous_avg_spend);
  const aov = net_sales != null && orders && orders > 0 ? net_sales / orders : null;
  const previous_aov = previous_net_sales != null && previous_orders && previous_orders > 0
    ? previous_net_sales / previous_orders
    : null;
  return {
    net_sales,
    covers,
    orders,
    avg_spend,
    previous_net_sales,
    previous_covers,
    previous_orders,
    previous_avg_spend,
    sales_delta_pct,
    covers_delta_pct,
    orders_delta_pct,
    avg_spend_delta_pct,
    aov,
    previous_aov,
    aov_delta_pct: percentDelta(aov, previous_aov),
  };
}

export function primaryMetricKey(metric: CommercialMetric | "commercial" | null | undefined): keyof Pick<CommercialSnapshot, "net_sales" | "covers" | "orders" | "avg_spend"> {
  if (metric === "covers") return "covers";
  if (metric === "orders") return "orders";
  if (metric === "avg_spend") return "avg_spend";
  return "net_sales";
}

export function metricLabel(metric: CommercialMetric | "commercial" | null | undefined): string {
  if (metric === "covers") return "covers";
  if (metric === "orders") return "orders";
  if (metric === "avg_spend") return "average spend";
  if (metric === "delivery") return "delivery sales";
  if (metric === "dine_in") return "dine-in sales";
  return "sales";
}

function formatPrimaryValue(
  metric: CommercialMetric | "commercial" | null | undefined,
  snap: CommercialSnapshot,
  exact: boolean,
): string | null {
  const key = primaryMetricKey(metric);
  const value = snap[key];
  if (value == null) return null;
  if (key === "covers") return formatCount(value, "covers");
  if (key === "orders") return formatCount(value, "orders");
  if (key === "avg_spend") return formatMoney(value, { exact: true });
  return formatMoney(value, { exact });
}

function primaryDelta(metric: CommercialMetric | "commercial" | null | undefined, snap: CommercialSnapshot): number | null {
  const key = primaryMetricKey(metric);
  if (key === "covers") return snap.covers_delta_pct;
  if (key === "orders") return snap.orders_delta_pct;
  if (key === "avg_spend") return snap.avg_spend_delta_pct;
  return snap.sales_delta_pct;
}

export function deriveCommercialRelationships(snap: CommercialSnapshot): ManagementRelationship[] {
  const out: ManagementRelationship[] = [];
  const sales = snap.sales_delta_pct;
  const covers = snap.covers_delta_pct;
  const spend = snap.avg_spend_delta_pct;
  const orders = snap.orders_delta_pct;
  const aov = snap.aov_delta_pct;

  if (sales != null && isEffectivelyFlat(sales) && (covers == null || isEffectivelyFlat(covers)) && (spend == null || isEffectivelyFlat(spend))) {
    out.push({
      type: "flat_insignificant",
      confidence: "supported",
      evidence: ["sales", "covers", "avg_spend"].filter((k) => (snap as Record<string, unknown>)[`${k === "sales" ? "sales" : k}_delta_pct`] != null || k === "sales"),
      statement: "The change is within a small band and is treated as effectively unchanged.",
    });
  }

  const salesDown = sales != null && sales < -MAGNITUDE_FLAT_PCT;
  const salesUp = sales != null && sales > MAGNITUDE_FLAT_PCT;
  const coversDown = covers != null && covers < -MAGNITUDE_FLAT_PCT;
  const coversUp = covers != null && covers > MAGNITUDE_FLAT_PCT;
  const coversFlat = covers == null || isEffectivelyFlat(covers);
  const spendFlat = spend == null || isEffectivelyFlat(spend);
  const spendDown = spend != null && spend < -MAGNITUDE_FLAT_PCT;
  const spendUp = spend != null && spend > MAGNITUDE_FLAT_PCT;

  if (salesDown && coversDown && spendFlat) {
    out.push({
      type: "volume_led_decline",
      confidence: "supported",
      evidence: ["net_sales", "covers", "avg_spend"],
      statement: "The sales decline is primarily associated with fewer covers; spend per guest was broadly stable.",
    });
  } else if (salesDown && coversFlat && spendDown) {
    out.push({
      type: "spend_led_decline",
      confidence: "supported",
      evidence: ["net_sales", "covers", "avg_spend"],
      statement: "The weaker result is mainly associated with lower spend per guest rather than traffic.",
    });
  } else if ((sales == null || isEffectivelyFlat(sales)) && coversDown && spendUp) {
    out.push({
      type: "offsetting_volume_spend",
      confidence: "supported",
      evidence: ["net_sales", "covers", "avg_spend"],
      statement: "Higher spend per guest offset weaker cover volume.",
    });
  } else if (salesUp && coversUp && spendFlat) {
    out.push({
      type: "volume_led_growth",
      confidence: "supported",
      evidence: ["net_sales", "covers", "avg_spend"],
      statement: "Growth was mainly volume-led.",
    });
  } else if (salesUp && coversFlat && spendUp) {
    out.push({
      type: "spend_led_growth",
      confidence: "supported",
      evidence: ["net_sales", "covers", "avg_spend"],
      statement: "Growth was primarily spend-led.",
    });
  } else if (salesUp && coversDown && spendUp) {
    out.push({
      type: "offsetting_volume_spend",
      confidence: "supported",
      evidence: ["net_sales", "covers", "avg_spend"],
      statement: "Sales increased while covers fell, with higher average spend more than offsetting weaker traffic.",
    });
  } else if (salesDown && coversUp && spendDown) {
    out.push({
      type: "spend_led_decline",
      confidence: "supported",
      evidence: ["net_sales", "covers", "avg_spend"],
      statement: "Traffic held or increased, so the sales decline is associated with lower spend per guest.",
    });
  }

  const ordersUp = orders != null && orders > MAGNITUDE_FLAT_PCT;
  const ordersDown = orders != null && orders < -MAGNITUDE_FLAT_PCT;
  const aovDown = aov != null && aov < -MAGNITUDE_FLAT_PCT;
  const aovUp = aov != null && aov > MAGNITUDE_FLAT_PCT;
  if (ordersUp && (sales == null || isEffectivelyFlat(sales)) && aovDown) {
    out.push({
      type: "order_mix_more_smaller",
      confidence: "supported",
      evidence: ["orders", "net_sales", "aov"],
      statement: "There were more orders but a lower value per order.",
    });
  } else if (ordersDown && aovUp) {
    out.push({
      type: "order_mix_fewer_larger",
      confidence: "supported",
      evidence: ["orders", "aov"],
      statement: "Stronger value per order partly offset fewer orders.",
    });
  }

  return out.filter((rel, idx, arr) => arr.findIndex((r) => r.type === rel.type) === idx);
}

function comparisonMethodNote(input: {
  comparability?: ComparabilityResult | null;
  comparisonMode?: string | null;
  primaryLabel: string;
  deltaPct: number | null;
  coverage?: CoverageReport | null;
}): string | null {
  if (input.comparability?.status === "not_comparable" || input.comparisonMode === "not_comparable") {
    return "A defensible percentage comparison cannot be made for these periods.";
  }
  if (input.deltaPct == null) return null;
  const pct = formatPercent(Math.abs(input.deltaPct));
  const dir = directionWord(input.deltaPct);
  const mag = magnitudePhrase(input.deltaPct);
  const label = input.primaryLabel;
  const mode = input.comparisonMode || input.comparability?.recommendedMethod || "";
  const obs = input.coverage?.availableRecords;
  const exp = input.coverage?.expectedRecords;
  const partial = obs != null && exp != null && exp > 0 && obs < exp;

  if (dir === "flat") {
    return `${label} ${metricCopula(label)} ${mag || "effectively unchanged"} versus the previous period (${pct}).`;
  }
  const upDown = dir === "up" ? "up" : "down";
  if (mode === "daily_average" || input.comparability?.recommendedMethod === "daily_average") {
    return `${label} ${metricCopula(label)} ${upDown} ${pct} based on average observed days, because the windows are not fully like-for-like.`;
  }
  if (
    mode === "matched_days"
    || mode === "matched_weekdays"
    || input.comparability?.status === "partially_comparable"
    || input.comparability?.recommendedMethod === "matched_days"
    || input.comparability?.recommendedMethod === "matched_weekday"
  ) {
    let text = `${label} ${metricCopula(label)} ${upDown} ${pct} on a like-for-like matched-day basis.`;
    if (partial && obs != null && exp != null) text += ` Coverage is ${obs}/${exp} days.`;
    return text;
  }
  return `${label} ${metricCopula(label)} ${upDown} ${pct} versus the previous period.`;
}

function coverageNote(coverage: CoverageReport[] | undefined, period: DateRange | null, depth: AnswerDepth): string | null {
  if (!coverage?.length) return null;
  const cov = coverage.find((c) => c.coverageRatio != null && c.coverageRatio < 1) || coverage[0];
  if (!cov || cov.coverageRatio == null || cov.coverageRatio >= 1) return null;
  if (cov.availableRecords === 0) {
    const requested = period?.label
      || (period?.startDate && period?.endDate && period.startDate === period.endDate
        ? period.startDate
        : (period ? `${period.startDate}–${period.endDate}` : "the requested day"));
    let msg = `Cash Up for ${requested} is not yet available in the canonical data.`;
    const latest = cov.freshness && String(cov.freshness);
    if (latest && latest !== period?.startDate && latest !== period?.endDate) {
      msg += ` The latest completed Cash Up I have is ${latest}.`;
    }
    return msg;
  }
  if (depth === "fact" && cov.expectedRecords === 1) return null;
  if (cov.expectedRecords != null && cov.availableRecords != null) {
    return `Coverage is ${cov.availableRecords}/${cov.expectedRecords} days.`;
  }
  return null;
}

function weekdayName(iso: string): string {
  return isoWeekdayName(iso);
}

function isKsaWeekend(iso: string): boolean {
  return isKsaWeekendIso(iso);
}

function rankingMetricKey(metric: CommercialMetric | "commercial" | null | undefined): string {
  if (metric === "covers") return "covers";
  if (metric === "orders") return "orders";
  if (metric === "avg_spend") return "avg_spend";
  return "net_sales";
}

function valueFromDaily(row: NormalizedDailyFact, metricKey: string): number | null {
  if (metricKey === "covers") return row.covers;
  if (metricKey === "orders") return row.orders;
  if (metricKey === "avg_spend") return row.avg_spend;
  return row.net_sales;
}

function formatRankValue(metricKey: string, value: number | null): string {
  if (value == null) return "—";
  if (metricKey === "covers") return formatCount(value, "covers");
  if (metricKey === "orders") return formatCount(value, "orders");
  return formatMoney(value, { exact: true });
}

function buildRankingText(input: {
  ranking: "top" | "bottom" | null;
  rankingCount: number;
  metric: CommercialMetric | "commercial";
  rankings: NormalizedRanking[];
  dailyFacts: NormalizedDailyFact[];
  coverage?: CoverageReport | null;
}): string | null {
  if (!input.ranking) return null;
  const metricKey = rankingMetricKey(input.metric);
  const count = Math.min(10, Math.max(1, input.rankingCount || 1));
  let rows: Array<{ date: string | null; value: number | null; label?: string | null }> = [];
  if (input.dailyFacts.length) {
    rows = input.dailyFacts
      .map((d) => ({ date: d.date, value: valueFromDaily(d, metricKey) }))
      .filter((d) => d.value != null && Number.isFinite(Number(d.value)));
  } else {
    rows = input.rankings
      .filter((r) => (r.metricKey === metricKey || (!r.metricKey && metricKey === "net_sales"))
        && (r.direction === input.ranking || r.direction === "unknown"))
      .map((r) => ({ date: r.date, value: r.value, label: r.label }));
  }
  if (!rows.length) return null;
  rows.sort((a, b) => input.ranking === "bottom"
    ? Number(a.value) - Number(b.value)
    : Number(b.value) - Number(a.value));
  const picked = rows.slice(0, count);
  const label = metricLabel(input.metric);
  const heading = input.ranking === "bottom"
    ? (count === 1 ? `Weakest ${label} day` : `Weakest ${count} ${label} days`)
    : (count === 1 ? `Strongest ${label} day` : `Strongest ${count} ${label} days`);
  const list = picked.map((row, i) => {
    const date = row.date ? formatManagerDate(row.date) : (row.label || `rank ${i + 1}`);
    return `${date}: ${formatRankValue(metricKey, row.value)}`;
  }).join("; ");
  let text = `${heading}: ${list}.`;
  const cov = input.coverage;
  if (cov?.expectedRecords != null && cov.availableRecords != null && cov.availableRecords < cov.expectedRecords) {
    text += ` Ranking uses ${cov.availableRecords} of ${cov.expectedRecords} requested days.`;
  }
  return text;
}

function buildGroupingText(question: string, dailyFacts: NormalizedDailyFact[], metric: CommercialMetric | "commercial"): string | null {
  if (!dailyFacts.length) return null;
  const q = question.toLowerCase();
  const metricKey = rankingMetricKey(metric);
  const rows = dailyFacts.filter((d) => valueFromDaily(d, metricKey) != null);
  if (rows.length < 4) return null;

  if (/\bweekend\b/.test(q) && /\bweekday/.test(q)) {
    let weekend = 0;
    let weekendN = 0;
    let weekday = 0;
    let weekdayN = 0;
    for (const row of rows) {
      const v = Number(valueFromDaily(row, metricKey));
      if (isKsaWeekend(row.date)) {
        weekend += v;
        weekendN += 1;
      } else {
        weekday += v;
        weekdayN += 1;
      }
    }
    if (!weekendN || !weekdayN) return null;
    const wkdAvg = weekday / weekdayN;
    const wkeAvg = weekend / weekendN;
    return `Friday–Saturday average ${metricLabel(metric)} was ${formatRankValue(metricKey, wkeAvg)} versus ${formatRankValue(metricKey, wkdAvg)} on Sunday–Thursday (${weekendN} weekend days, ${weekdayN} weekdays).`;
  }

  if (/\bweekday/.test(q) || /\bby day\b/.test(q) || /\bdaily\b/.test(q) && /\b(sales|covers)\b/.test(q)) {
    const buckets = new Map<string, { sum: number; n: number }>();
    for (const row of rows) {
      const name = weekdayName(row.date);
      const cur = buckets.get(name) || { sum: 0, n: 0 };
      cur.sum += Number(valueFromDaily(row, metricKey));
      cur.n += 1;
      buckets.set(name, cur);
    }
    const avgs = [...buckets.entries()]
      .map(([name, b]) => ({ name, avg: b.sum / b.n, n: b.n }))
      .sort((a, b) => b.avg - a.avg);
    if (avgs.length < 3) return null;
    const best = avgs[0];
    const worst = avgs[avgs.length - 1];
    return `Strongest weekday by ${metricLabel(metric)} was ${best.name} (${formatRankValue(metricKey, best.avg)} average); weakest was ${worst.name} (${formatRankValue(metricKey, worst.avg)} average).`;
  }
  return null;
}

function branchLabel(branchId: string | null | undefined) {
  if (!branchId) return "the branch";
  return ({ khobar: "Khobar", riyadh: "Riyadh", jeddah: "Jeddah" } as Record<string, string>)[branchId] || branchId;
}

function periodLabel(period: DateRange | null | undefined) {
  if (!period) return "the requested period";
  return period.label || `${period.startDate}–${period.endDate}`;
}

export function isSubjectiveJudgementQuestion(question: string): boolean {
  return isSubjectiveJudgementPhrase(question);
}

export function isBroadManagementQuestion(question: string, metric: CommercialMetric | "commercial"): boolean {
  if (metric !== "commercial" && metric !== "sales") return false;
  return /\b(how (?:are|is|did) we|how (?:is|are) \w+ doing|give me the picture|summarize|how did we perform|how have we performed|how are we doing)\b/i
    .test(String(question || ""));
}

export function reasonAboutCommercialEvidence(input: {
  question: string;
  branchId: string | null;
  period: DateRange | null;
  comparisonPeriod?: DateRange | null;
  evidence: EvidenceRecord[];
  coverage?: CoverageReport[];
  comparability?: ComparabilityResult | null;
  comparisonMode?: string | null;
  primaryMetric?: CommercialMetric | "commercial" | null;
  ranking?: "top" | "bottom" | null;
  rankingCount?: number | null;
  comparisonIntent?: boolean;
  rankings?: NormalizedRanking[];
  dailyFacts?: NormalizedDailyFact[];
  historyDailyFacts?: NormalizedDailyFact[];
  previousDailyFacts?: NormalizedDailyFact[];
  judgementQuestion?: boolean;
  analysisIntent?: AnalysisIntent;
  openingDate?: string | null;
}): ManagementReasoning {
  const snap = extractCommercialSnapshot(input.evidence);
  const metric = input.primaryMetric || "commercial";
  const exactDay = Boolean(input.period?.startDate && input.period.startDate === input.period.endDate);
  const missing = (input.coverage || []).some((c) => c.availableRecords === 0 && (c.expectedRecords || 0) > 0);
  const judgement = Boolean(input.judgementQuestion || isSubjectiveJudgementQuestion(input.question));
  const ranking = input.ranking || null;
  const comparisonIntent = Boolean(input.comparisonIntent || input.comparisonPeriod || input.comparability);
  const broad = isBroadManagementQuestion(input.question, metric);
  const analysisIntent = input.analysisIntent ?? extractAnalysisIntent(input.question);

  let depth: AnswerDepth = "fact";
  if (missing) depth = "fact";
  else if (ranking) depth = "ranking";
  else if (judgement || analysisIntent === "judgement" || analysisIntent === "anomaly") depth = "judgement";
  else if (analysisIntent === "why" || analysisIntent === "stands_out" || analysisIntent === "trend" || analysisIntent === "contributors" || analysisIntent === "breadth" || analysisIntent === "action") depth = comparisonIntent ? "comparison" : "overview";
  else if (comparisonIntent) depth = "comparison";
  else if (broad || metric === "commercial") depth = exactDay ? "fact" : "overview";
  else if (metric !== "sales" && metric !== "commercial") depth = "metric_fact";
  else depth = exactDay ? "fact" : "overview";

  const branch = branchLabel(input.branchId);
  const period = periodLabel(input.period);
  const exact = exactDay;
  const primaryValue = formatPrimaryValue(metric === "commercial" ? "sales" : metric, snap, exact);
  const relationshipsRaw = (!missing && (comparisonIntent || depth === "overview" || depth === "comparison" || Boolean(analysisIntent)))
    ? deriveCommercialRelationships(snap)
    : [];
  const relationships = relationshipsRaw.filter((rel) => {
    if (metric === "covers" && isEffectivelyFlat(snap.covers_delta_pct) && /spend_led|volume_led|offsetting/.test(rel.type)) {
      return false;
    }
    if (metric === "orders" && isEffectivelyFlat(snap.orders_delta_pct) && rel.type.startsWith("order_mix") === false && /spend_led|volume_led/.test(rel.type)) {
      return false;
    }
    if (metric === "avg_spend" && isEffectivelyFlat(snap.avg_spend_delta_pct) && rel.type !== "spend_led_decline" && rel.type !== "spend_led_growth") {
      return rel.type === "flat_insignificant";
    }
    return true;
  });

  let headline: string | null = null;
  if (!missing && primaryValue) {
    if (metric === "covers") {
      headline = exactDay
        ? `${period.replace(/^the /, "") === period ? period : period}, ${branch} recorded ${primaryValue}.`.replace(/^, /, "")
        : `For ${branch} in ${period}, covers were ${formatCount(snap.covers, "covers").replace(" covers", "")}.`;
      headline = exactDay
        ? `${period}, ${branch} recorded ${primaryValue}.`
        : `For ${branch} in ${period}, covers were ${snap.covers?.toLocaleString("en-US")}.`;
    } else if (metric === "orders") {
      headline = exactDay
        ? `${period}, ${branch} recorded ${primaryValue}.`
        : `For ${branch} in ${period}, orders were ${snap.orders?.toLocaleString("en-US")}.`;
    } else if (metric === "avg_spend") {
      headline = exactDay
        ? `${period}, ${branch} average spend was ${primaryValue}.`
        : `For ${branch} in ${period}, average spend was ${primaryValue}.`;
    } else if (depth === "fact" && exactDay && snap.covers != null && (metric === "sales" || metric === "commercial")) {
      headline = `${period}, ${branch} generated ${formatMoney(snap.net_sales, { exact: true })} from ${formatCount(snap.covers, "covers")}.`;
    } else if (snap.net_sales != null) {
      headline = `For ${branch} in ${period}, net sales were ${formatMoney(snap.net_sales, { exact })}.`;
    }
  }

  const supporting: string[] = [];
  if (!missing && (depth === "overview" || (depth === "fact" && metric === "commercial" && !exactDay))) {
    if (metric !== "covers" && snap.covers != null) supporting.push(`Covers were ${snap.covers.toLocaleString("en-US")}.`);
    if (metric !== "avg_spend" && snap.avg_spend != null) supporting.push(`Average spend was ${formatMoney(snap.avg_spend, { exact: true })}.`);
    if (metric !== "orders" && snap.orders != null && depth === "overview") {
      supporting.push(`Orders were ${snap.orders.toLocaleString("en-US")}.`);
    }
  } else if (!missing && depth === "metric_fact" && metric === "covers" && snap.avg_spend != null && snap.net_sales != null) {
    // keep supporting off unless useful — skip sales headline
  } else if (!missing && depth === "comparison" && metric !== "covers" && metric !== "avg_spend" && snap.covers != null) {
    const coversDelta = snap.covers_delta_pct;
    if (coversDelta != null && !isEffectivelyFlat(coversDelta)) {
      supporting.push(`Covers were ${directionWord(coversDelta)} ${formatPercent(Math.abs(coversDelta))}.`);
    }
  }

  const delta = primaryDelta(metric === "commercial" ? "sales" : metric, snap);
  const comparisonContext = (!missing && (comparisonIntent || depth === "comparison"))
    ? comparisonMethodNote({
      comparability: input.comparability,
      comparisonMode: input.comparisonMode,
      primaryLabel: metricLabel(metric === "commercial" ? "sales" : metric).replace(/^./, (c) => c.toUpperCase()),
      deltaPct: delta,
      coverage: input.coverage?.[0] || null,
    })
    : null;

  const salesCoverage = (input.coverage || []).find((c) => c.domain === "sales") || input.coverage?.[0] || null;
  const rankingText = ranking
    ? buildRankingText({
      ranking,
      rankingCount: input.rankingCount || 1,
      metric: metric === "commercial" ? "sales" : metric,
      rankings: input.rankings || [],
      dailyFacts: input.dailyFacts || [],
      coverage: salesCoverage,
    })
    : null;

  const groupingText = (!ranking && !missing)
    ? buildGroupingText(input.question, input.dailyFacts || [], metric === "commercial" ? "sales" : metric)
    : null;

  let judgementOffer: string | null = null;
  const driverRel = relationships.find((r) => r.type !== "flat_insignificant") || null;
  const diagnostic = (!missing && (judgement || analysisIntent || broad))
    ? diagnoseCommercialPerformance({
      question: input.question,
      analysisIntent,
      branchId: input.branchId,
      period: input.period,
      comparisonPeriod: input.comparisonPeriod,
      comparisonIntent,
      primaryMetric: metric,
      snap,
      dailyFacts: input.dailyFacts || [],
      historyDailyFacts: input.historyDailyFacts || [],
      previousDailyFacts: input.previousDailyFacts || [],
      openingDate: input.openingDate || null,
      driverStatement: driverRel?.statement || null,
    })
    : null;

  if (judgement && diagnostic?.sentences.length) {
    judgementOffer = diagnostic.sentences[0];
  } else if (judgement && comparisonIntent && delta != null) {
    const mag = magnitudePhrase(delta);
    const pct = formatPercent(Math.abs(delta));
    const label = metricLabel(metric);
    judgementOffer = mag
      ? `Versus the available baseline, ${label} ${metricCopula(label)} ${mag} (${directionWord(delta) === "flat" ? pct : `${directionWord(delta)} ${pct}`}).`
      : null;
  }

  const covNote = coverageNote(input.coverage, input.period, depth);
  const analystSentences = diagnostic?.sentences || [];

  return {
    primaryMetric: metric,
    depth,
    headline: missing ? null : headline,
    supporting: missing ? [] : supporting,
    relationships: missing || depth === "fact" || depth === "metric_fact" || depth === "ranking" ? [] : relationships,
    comparisonContext: missing ? null : comparisonContext,
    coverageContext: covNote,
    rankingText,
    judgementOffer,
    groupingText,
    analystSentences,
  };
}

export function composeReasonedAnswer(reasoning: ManagementReasoning, extras: {
  eventPreface?: string | null;
  costMissing?: string | null;
  forecast?: string | null;
  holiday?: string | null;
  ops?: string | null;
  causalNote?: string | null;
  offline?: boolean;
} = {}): string {
  const parts: string[] = [];
  if (extras.eventPreface) parts.push(extras.eventPreface);
  if (extras.costMissing) parts.push(extras.costMissing);
  if (reasoning.coverageContext && /not yet available/.test(reasoning.coverageContext) && !reasoning.headline) {
    parts.push(reasoning.coverageContext);
  } else {
    if (reasoning.rankingText) parts.push(reasoning.rankingText);
    else if ((reasoning.analystSentences || []).length && (reasoning.depth === "judgement" || reasoning.judgementOffer)) {
      if (reasoning.headline && reasoning.depth === "judgement") parts.push(reasoning.headline);
      for (const s of reasoning.analystSentences || []) {
        if (s && !parts.some((p) => p.includes(s) || s.includes(p))) parts.push(s);
      }
    } else if (reasoning.judgementOffer && reasoning.depth === "judgement") {
      if (reasoning.headline) parts.push(reasoning.headline);
      parts.push(reasoning.judgementOffer);
    } else if (reasoning.headline) parts.push(reasoning.headline);
    if (!reasoning.rankingText && reasoning.depth !== "metric_fact" && reasoning.depth !== "judgement") {
      for (const s of reasoning.supporting) parts.push(s);
    }
    if ((reasoning.analystSentences || []).length && reasoning.depth !== "judgement") {
      for (const s of reasoning.analystSentences || []) {
        if (s && !parts.some((p) => p.includes(s) || s.includes(p))) parts.push(s);
      }
    }
    const analystCoversCompare = (reasoning.analystSentences || []).some((s) => /versus|above the average|below the|previous (?:four|three|comparable)|elapsed/i.test(s));
    if (reasoning.comparisonContext && !analystCoversCompare && reasoning.depth !== "judgement") {
      parts.push(reasoning.comparisonContext);
    }
    if (reasoning.relationships.length && (reasoning.depth === "comparison" || reasoning.depth === "overview") && !reasoning.analystSentences.length) {
      const rel = reasoning.relationships.find((r) => r.type !== "flat_insignificant") || reasoning.relationships[0];
      if (rel && rel.type !== "flat_insignificant") parts.push(rel.statement);
    }
    if (reasoning.groupingText) parts.push(reasoning.groupingText);
    if (reasoning.coverageContext && !/not yet available/.test(reasoning.coverageContext || "")) {
      if (reasoning.depth !== "fact" || (reasoning.comparisonContext && /Coverage is/.test(reasoning.comparisonContext))) {
        if (!reasoning.comparisonContext || !/Coverage is/.test(reasoning.comparisonContext)) {
          parts.push(reasoning.coverageContext);
        }
      } else if (reasoning.depth !== "fact") {
        parts.push(reasoning.coverageContext);
      }
    }
    if (reasoning.coverageContext && /not yet available/.test(reasoning.coverageContext) && reasoning.headline) {
      parts.push(reasoning.coverageContext);
    }
  }
  if (extras.forecast) parts.push(extras.forecast);
  if (extras.holiday) parts.push(extras.holiday);
  if (extras.ops) parts.push(extras.ops);
  if (extras.causalNote) parts.push(extras.causalNote);
  if (!parts.length) {
    parts.push("Verified structured evidence for this question is limited or unavailable.");
  }
  if (extras.offline) {
    parts.push("Natural-language analysis is unavailable in offline mode; showing verified retrieved data only.");
  }
  return parts.join(" ");
}

