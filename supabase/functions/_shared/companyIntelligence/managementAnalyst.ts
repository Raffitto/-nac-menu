/**
 * Deterministic management analyst: benchmarks, anomalies, trends, breadth, contributors.
 * Uses canonical daily Cash Up facts only. Never invents operational causes.
 */

import type { NormalizedDailyFact } from "./normalizedCapabilityResult.ts";
import type { CommercialMetric } from "./turnSemantics.ts";
import { extractAnalysisIntent, type AnalysisIntent } from "./turnSemantics.ts";
import type { DateRange } from "./types.ts";
import {
  MAGNITUDE_FLAT_PCT,
  addIsoDays,
  directionWord,
  formatManagerDate,
  formatMoney,
  formatPercent,
  isEffectivelyFlat,
  isKsaWeekendIso,
  isoWeekdayIndex,
  isoWeekdayName,
  magnitudePhrase,
  metricCopula,
  percentDelta,
} from "./managementPresentation.ts";

export const HISTORY_LOOKBACK_DAYS = 56;
export const SAME_WEEKDAY_SAMPLE_TARGET = 4;
export const SAME_WEEKDAY_SAMPLE_MIN = 3;
export const ANOMALY_MIN_SAMPLE = 6;
export const TREND_MIN_DAYS = 14;
export const TREND_HALF_WINDOW = 7;
export const TREND_NOISE_PCT = 5;
export const BREADTH_MIN_MATCHED = 4;
export const BROAD_DAY_SHARE = 0.7;
export const CONCENTRATED_SHARE = 0.5;

export type BenchmarkType =
  | "explicit"
  | "previous_period"
  | "same_weekday"
  | "recent_daily"
  | "elapsed_prior"
  | "weekday_pattern";

type CommercialSnap = {
  net_sales: number | null;
  covers: number | null;
  orders: number | null;
  avg_spend: number | null;
  previous_net_sales: number | null;
  previous_covers: number | null;
  previous_orders: number | null;
  previous_avg_spend: number | null;
};

export type AnomalyClass =
  | "normal"
  | "mildly_unusual"
  | "materially_unusual"
  | "strong_outlier"
  | "weak_outlier";

export type TrendClass = "upward" | "downward" | "broadly_flat" | "noisy" | "insufficient";
export type BreadthClass = "broad_based" | "concentrated" | "mixed" | "insufficient";
export type AttentionLevel = "normal" | "monitor" | "noteworthy" | "material";
export type AnalystConfidence = "high" | "medium" | "low" | "insufficient";

export type MetricFactKey = "net_sales" | "covers" | "orders" | "avg_spend";

export type DiagnosticFinding = {
  id: string;
  priority: number;
  text: string;
};

export type BenchmarkResult = {
  type: BenchmarkType;
  label: string;
  sampleSize: number;
  value: number | null;
  current: number | null;
  deltaPct: number | null;
  sufficient: boolean;
  insufficientText: string | null;
};

export type ContributorRow = {
  date: string;
  delta: number;
  shareOfMove: number | null;
};

export type ManagementDiagnostic = {
  judgement: string | null;
  benchmark: BenchmarkResult | null;
  movement: string | null;
  driver: string | null;
  breadth: { class: BreadthClass; text: string | null };
  anomalies: Array<{ date: string; class: AnomalyClass; text: string }>;
  contributors: ContributorRow[];
  contributorText: string | null;
  trend: { class: TrendClass; text: string | null };
  oneOffVsSustained: string | null;
  confidence: AnalystConfidence;
  attention: AttentionLevel;
  findings: DiagnosticFinding[];
  investigation: string | null;
  whyText: string | null;
  sentences: string[];
};

function metricKey(metric: CommercialMetric | "commercial" | null | undefined): MetricFactKey {
  if (metric === "covers") return "covers";
  if (metric === "orders") return "orders";
  if (metric === "avg_spend") return "avg_spend";
  return "net_sales";
}

function metricName(metric: CommercialMetric | "commercial" | MetricFactKey | null | undefined): string {
  if (metric === "covers") return "covers";
  if (metric === "orders") return "orders";
  if (metric === "avg_spend") return "average spend";
  return "sales";
}

function factValue(row: NormalizedDailyFact, key: MetricFactKey): number | null {
  const v = row[key];
  return v != null && Number.isFinite(Number(v)) ? Number(v) : null;
}

function formatMetricValue(key: MetricFactKey, value: number | null): string {
  if (value == null) return "—";
  if (key === "covers") return `${Math.round(value).toLocaleString("en-US")} covers`;
  if (key === "orders") return `${Math.round(value).toLocaleString("en-US")} orders`;
  return formatMoney(value, { exact: true });
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function mean(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function mad(values: number[], med: number): number {
  return median(values.map((v) => Math.abs(v - med))) || 0;
}

function modifiedZ(value: number, med: number, madValue: number): number {
  if (madValue < 1e-9) {
    const pct = percentDelta(value, med);
    if (pct == null || Math.abs(pct) < 5) return 0;
    return (pct >= 0 ? 1 : -1) * (Math.abs(pct) >= 25 ? 3.5 : 2.4);
  }
  return (0.6745 * (value - med)) / madValue;
}

function classifyZ(z: number): AnomalyClass {
  if (z >= 3) return "strong_outlier";
  if (z <= -3) return "weak_outlier";
  if (Math.abs(z) >= 3) return "materially_unusual";
  if (Math.abs(z) >= 2) return "mildly_unusual";
  return "normal";
}

function daysInclusive(start: string, end: string): number {
  const a = Date.parse(`${start}T00:00:00Z`);
  const b = Date.parse(`${end}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return 0;
  return Math.round((b - a) / 86400000) + 1;
}

function clampDay(year: number, month: number, day: number): string {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const d = Math.min(day, last);
  const mm = String(month).padStart(2, "0");
  const dd = String(d).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

export function elapsedPriorRange(period: DateRange): DateRange | null {
  if (!period?.startDate || !period.endDate) return null;
  const startParts = period.startDate.split("-").map(Number);
  const endParts = period.endDate.split("-").map(Number);
  if (startParts.length < 3 || endParts.length < 3) return null;
  const [sy, sm, sd] = startParts;
  const [, , ed] = endParts;
  const prevMonth = sm === 1 ? 12 : sm - 1;
  const prevYear = sm === 1 ? sy - 1 : sy;
  const start = clampDay(prevYear, prevMonth, sd);
  const end = clampDay(prevYear, prevMonth, ed);
  if (end < start) return null;
  return {
    startDate: start,
    endDate: end,
    label: `${isoWeekdayName(start) ? "" : ""}${start}–${end}`.replace(/^–/, ""),
    semantic: "elapsed_prior_month",
  };
}

function previousEquivalentRange(period: DateRange): DateRange | null {
  if (!period?.startDate || !period.endDate) return null;
  const len = daysInclusive(period.startDate, period.endDate);
  if (len <= 0) return null;
  const end = addIsoDays(period.startDate, -1);
  const start = addIsoDays(end, -(len - 1));
  return { startDate: start, endDate: end, label: `${start}–${end}`, semantic: "previous_equivalent" };
}

function inRange(date: string, range: DateRange | null | undefined): boolean {
  if (!range?.startDate || !range.endDate) return false;
  return date >= range.startDate && date <= range.endDate;
}

function openingClip(date: string, openingDate: string | null | undefined): boolean {
  if (!openingDate) return true;
  return date >= openingDate;
}

function completedFacts(
  facts: NormalizedDailyFact[],
  openingDate: string | null | undefined,
): NormalizedDailyFact[] {
  return facts
    .filter((f) => openingClip(f.date, openingDate) && (f.net_sales != null || f.covers != null))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function selectBenchmarkType(input: {
  question: string;
  analysisIntent: AnalysisIntent;
  exactDay: boolean;
  comparisonIntent: boolean;
  comparisonPeriod: DateRange | null | undefined;
  period: DateRange | null | undefined;
}): BenchmarkType {
  if (input.comparisonPeriod && (input.comparisonIntent || /\b(compared?|versus|vs\.?|against|last friday|previous)\b/i.test(input.question))) {
    return "explicit";
  }
  const intent = input.analysisIntent;
  const semantic = String(input.period?.semantic || input.period?.label || "").toLowerCase();
  const monthLike = /month|mtd|august|july|june|may|april|march|year/.test(semantic)
    || /\b(this month|mtd|august|july)\b/i.test(input.question);
  const weekLike = /\bweek\b/.test(semantic) || /\bthis week\b/i.test(input.question);
  if (intent === "anomaly" || /\bnormal for\b/i.test(input.question)) {
    return input.exactDay ? "same_weekday" : "recent_daily";
  }
  if (intent === "trend") return "recent_daily";
  if (intent === "judgement" || intent === "stands_out" || intent === "why" || intent === "action" || intent === "breadth") {
    if (input.exactDay) return "same_weekday";
    if (monthLike) return "elapsed_prior";
    if (weekLike) return "previous_period";
    return "previous_period";
  }
  if (input.exactDay) return "same_weekday";
  if (monthLike) return "elapsed_prior";
  return "previous_period";
}

function sameWeekdaySample(
  history: NormalizedDailyFact[],
  targetDate: string,
  key: MetricFactKey,
  openingDate: string | null | undefined,
): NormalizedDailyFact[] {
  const dow = isoWeekdayIndex(targetDate);
  if (dow == null) return [];
  return completedFacts(history, openingDate)
    .filter((f) => f.date < targetDate && isoWeekdayIndex(f.date) === dow && factValue(f, key) != null)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, SAME_WEEKDAY_SAMPLE_TARGET);
}

function recentDailySample(
  history: NormalizedDailyFact[],
  beforeDate: string,
  key: MetricFactKey,
  openingDate: string | null | undefined,
  n = 14,
): NormalizedDailyFact[] {
  return completedFacts(history, openingDate)
    .filter((f) => f.date < beforeDate && factValue(f, key) != null)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, n);
}

function sumKey(rows: NormalizedDailyFact[], key: MetricFactKey): number | null {
  const vals = rows.map((r) => factValue(r, key)).filter((v): v is number => v != null);
  if (!vals.length) return null;
  if (key === "avg_spend") {
    const sales = rows.map((r) => factValue(r, "net_sales")).filter((v): v is number => v != null);
    const covers = rows.map((r) => factValue(r, "covers")).filter((v): v is number => v != null);
    const s = sales.reduce((a, b) => a + b, 0);
    const c = covers.reduce((a, b) => a + b, 0);
    return c > 0 ? s / c : mean(vals);
  }
  return vals.reduce((a, b) => a + b, 0);
}

function computeBenchmark(input: {
  type: BenchmarkType;
  current: number | null;
  snap: CommercialSnap;
  key: MetricFactKey;
  label: string;
  period: DateRange | null;
  history: NormalizedDailyFact[];
  dailyFacts: NormalizedDailyFact[];
  previousDailyFacts: NormalizedDailyFact[];
  openingDate: string | null;
}): BenchmarkResult {
  const { type, current, key, label, period, history, dailyFacts, previousDailyFacts, openingDate, snap } = input;
  if (type === "explicit" || (type === "previous_period" && snap.previous_net_sales != null && previousDailyFacts.length === 0 && history.length === 0)) {
    const prev = key === "covers"
      ? snap.previous_covers
      : key === "orders"
        ? snap.previous_orders
        : key === "avg_spend"
          ? snap.previous_avg_spend
          : snap.previous_net_sales;
    const delta = percentDelta(current, prev);
    return {
      type,
      label: type === "explicit" ? "the stated baseline" : "the previous comparable period",
      sampleSize: previousDailyFacts.length || (prev != null ? 1 : 0),
      value: prev,
      current,
      deltaPct: delta,
      sufficient: prev != null && current != null,
      insufficientText: prev == null ? "There isn't a stated baseline with enough evidence to judge this reliably." : null,
    };
  }

  if (type === "same_weekday" && period?.startDate) {
    const sample = sameWeekdaySample(history.length ? history : dailyFacts, period.startDate, key, openingDate);
    const weekday = isoWeekdayName(period.startDate) || "that weekday";
    if (sample.length < SAME_WEEKDAY_SAMPLE_MIN) {
      return {
        type,
        label: `the previous ${SAME_WEEKDAY_SAMPLE_TARGET} ${weekday}s`,
        sampleSize: sample.length,
        value: null,
        current,
        deltaPct: null,
        sufficient: false,
        insufficientText: `There isn't enough comparable ${weekday} history yet to judge this reliably.`,
      };
    }
    const values = sample.map((s) => factValue(s, key)).filter((v): v is number => v != null);
    const avg = mean(values);
    return {
      type,
      label: `the average of the previous ${sample.length} ${weekday}s`,
      sampleSize: sample.length,
      value: avg,
      current,
      deltaPct: percentDelta(current, avg),
      sufficient: avg != null && current != null,
      insufficientText: null,
    };
  }

  if (type === "recent_daily" && period?.startDate) {
    const sample = recentDailySample(history.length ? history : dailyFacts, period.startDate, key, openingDate, 14);
    if (sample.length < 7) {
      return {
        type,
        label: "the recent completed-day average",
        sampleSize: sample.length,
        value: null,
        current,
        deltaPct: null,
        sufficient: false,
        insufficientText: "There isn't enough recent daily history yet to judge this reliably.",
      };
    }
    const values = sample.map((s) => factValue(s, key)).filter((v): v is number => v != null);
    const avg = mean(values);
    return {
      type,
      label: `the average of the previous ${sample.length} completed days`,
      sampleSize: sample.length,
      value: avg,
      current,
      deltaPct: percentDelta(current, avg),
      sufficient: avg != null && current != null,
      insufficientText: null,
    };
  }

  if (type === "elapsed_prior" && period) {
    const prior = elapsedPriorRange(period);
    if (!prior) {
      return {
        type,
        label: "the same elapsed portion of the previous month",
        sampleSize: 0,
        value: null,
        current,
        deltaPct: null,
        sufficient: false,
        insufficientText: "There isn't a comparable elapsed prior period to judge this reliably.",
      };
    }
    const pool = [...history, ...dailyFacts, ...previousDailyFacts];
    const rows = completedFacts(pool, openingDate).filter((f) => inRange(f.date, prior) && factValue(f, key) != null);
    const currentRows = completedFacts(dailyFacts, openingDate).filter((f) => inRange(f.date, period) && factValue(f, key) != null);
    if (rows.length < 7 || currentRows.length < 7) {
      return {
        type,
        label: `the same first ${daysInclusive(period.startDate, period.endDate)} days of the previous month`,
        sampleSize: rows.length,
        value: null,
        current,
        deltaPct: null,
        sufficient: false,
        insufficientText: "There isn't enough comparable elapsed-period history yet to judge this reliably.",
      };
    }
    const prevTotal = key === "avg_spend" ? sumKey(rows, key) : sumKey(rows, key);
    const currTotal = current != null ? current : sumKey(currentRows, key);
    return {
      type,
      label: `the same first ${currentRows.length} days of the previous month`,
      sampleSize: rows.length,
      value: prevTotal,
      current: currTotal,
      deltaPct: percentDelta(currTotal, prevTotal),
      sufficient: prevTotal != null && currTotal != null,
      insufficientText: null,
    };
  }

  const prior = period ? previousEquivalentRange(period) : null;
  const pool = [...history, ...previousDailyFacts, ...dailyFacts];
  const rows = prior
    ? completedFacts(pool, openingDate).filter((f) => inRange(f.date, prior) && factValue(f, key) != null)
    : previousDailyFacts.filter((f) => factValue(f, key) != null);
  if (snap.previous_net_sales != null && !rows.length) {
    const prev = key === "covers" ? snap.previous_covers
      : key === "orders" ? snap.previous_orders
        : key === "avg_spend" ? snap.previous_avg_spend
          : snap.previous_net_sales;
    return {
      type: "previous_period",
      label: "the previous comparable period",
      sampleSize: 1,
      value: prev,
      current,
      deltaPct: percentDelta(current, prev),
      sufficient: prev != null && current != null,
      insufficientText: null,
    };
  }
  if (rows.length < 3) {
    return {
      type: "previous_period",
      label: "the previous comparable period",
      sampleSize: rows.length,
      value: null,
      current,
      deltaPct: null,
      sufficient: false,
      insufficientText: "There isn't enough comparable history yet to judge this reliably.",
    };
  }
  const prevTotal = sumKey(rows, key);
  return {
    type: "previous_period",
    label: "the previous comparable period",
    sampleSize: rows.length,
    value: prevTotal,
    current,
    deltaPct: percentDelta(current, prevTotal),
    sufficient: prevTotal != null && current != null,
    insufficientText: null,
  };
}

function anomalyForDay(
  target: NormalizedDailyFact,
  history: NormalizedDailyFact[],
  key: MetricFactKey,
  openingDate: string | null,
): { class: AnomalyClass; z: number; sampleSize: number; text: string } | null {
  const value = factValue(target, key);
  if (value == null) return null;
  const weekdaySample = sameWeekdaySample(history, target.date, key, openingDate);
  const sample = weekdaySample.length >= ANOMALY_MIN_SAMPLE
    ? weekdaySample
    : sameWeekdaySample(history, target.date, key, openingDate).concat(
      recentDailySample(history, target.date, key, openingDate, 10),
    );
  const values = (weekdaySample.length >= SAME_WEEKDAY_SAMPLE_MIN ? weekdaySample : sample)
    .map((s) => factValue(s, key))
    .filter((v): v is number => v != null);
  const useWeekday = weekdaySample.length >= SAME_WEEKDAY_SAMPLE_MIN;
  const dist = useWeekday
    ? weekdaySample.map((s) => factValue(s, key)).filter((v): v is number => v != null)
    : values;
  if (dist.length < SAME_WEEKDAY_SAMPLE_MIN) {
    return {
      class: "normal",
      z: 0,
      sampleSize: dist.length,
      text: `There isn't enough comparable ${isoWeekdayName(target.date) || "weekday"} history yet to say whether ${formatManagerDate(target.date)} was unusual.`,
    };
  }
  const med = median(dist);
  if (med == null) return null;
  const z = modifiedZ(value, med, mad(dist, med));
  const klass = classifyZ(z);
  const weekday = isoWeekdayName(target.date);
  const vs = useWeekday ? `recent ${weekday}s` : "recent completed days";
  let text: string;
  if (klass === "normal") {
    text = `${formatManagerDate(target.date)} ${metricName(key)} ${metricCopula(metricName(key))} within a normal range versus ${vs}.`;
  } else if (klass === "strong_outlier") {
    text = `${formatManagerDate(target.date)} was a strong high outlier versus ${vs}.`;
  } else if (klass === "weak_outlier") {
    text = `${formatManagerDate(target.date)} was a weak outlier versus ${vs}.`;
  } else if (klass === "mildly_unusual") {
    text = `${formatManagerDate(target.date)} was mildly unusual versus ${vs}.`;
  } else {
    text = `${formatManagerDate(target.date)} was materially unusual versus ${vs}.`;
  }
  return { class: klass, z, sampleSize: dist.length, text };
}

function computeTrend(
  history: NormalizedDailyFact[],
  key: MetricFactKey,
  openingDate: string | null,
  endDate: string | null,
  weekdayOnly: number | null,
): { class: TrendClass; text: string | null } {
  let rows = completedFacts(history, openingDate).filter((f) => factValue(f, key) != null);
  if (endDate) rows = rows.filter((f) => f.date <= endDate);
  if (weekdayOnly != null) rows = rows.filter((f) => isoWeekdayIndex(f.date) === weekdayOnly);
  if (rows.length < (weekdayOnly != null ? 6 : TREND_MIN_DAYS)) {
    return {
      class: "insufficient",
      text: weekdayOnly != null
        ? `There isn't enough ${WEEKDAY_NAME(weekdayOnly)} history yet to describe a trend.`
        : "There isn't enough completed daily history yet to describe a trend.",
    };
  }
  const recent = rows.slice(-TREND_HALF_WINDOW);
  const prior = rows.slice(-TREND_HALF_WINDOW * 2, -TREND_HALF_WINDOW);
  if (prior.length < 5 || recent.length < 5) {
    return { class: "insufficient", text: "There isn't enough completed daily history yet to describe a trend." };
  }
  const recentAvg = mean(recent.map((r) => factValue(r, key)!));
  const priorAvg = mean(prior.map((r) => factValue(r, key)!));
  const pct = percentDelta(recentAvg, priorAvg);
  if (pct == null) return { class: "insufficient", text: "There isn't enough completed daily history yet to describe a trend." };
  const signs = recent.map((r, i) => {
    const prev = prior[Math.min(i, prior.length - 1)];
    const d = (factValue(r, key) || 0) - (factValue(prev, key) || 0);
    return d;
  });
  const up = signs.filter((s) => s > 0).length;
  const down = signs.filter((s) => s < 0).length;
  const label = weekdayOnly != null ? `${WEEKDAY_NAME(weekdayOnly)}s` : metricName(key === "avg_spend" ? "avg_spend" : key === "covers" ? "covers" : "sales");
  if (Math.abs(pct) < TREND_NOISE_PCT) {
    if (up >= 5 || down >= 5) {
      /* still small */
    } else {
      return { class: "broadly_flat", text: `${label} have been broadly flat over the recent completed days.` };
    }
    if (Math.abs(pct) < MAGNITUDE_FLAT_PCT) {
      return { class: "broadly_flat", text: `${label} have been broadly flat over the recent completed days.` };
    }
  }
  if (Math.abs(pct) < 8 && up >= 3 && down >= 3) {
    return { class: "noisy", text: `Recent ${label} movement looks like normal day-to-day variation rather than a sustained trend.` };
  }
  const pctText = formatPercent(Math.abs(pct));
  if (pct > 0) {
    return { class: "upward", text: `${label} show an upward trend: the latest ${recent.length} completed days averaged about ${pctText} above the prior ${prior.length}.` };
  }
  return { class: "downward", text: `${label} show a downward trend: the latest ${recent.length} completed days averaged about ${pctText} below the prior ${prior.length}.` };
}

function WEEKDAY_NAME(idx: number): string {
  return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][idx] || "weekday";
}

function matchDays(
  current: NormalizedDailyFact[],
  previous: NormalizedDailyFact[],
  key: MetricFactKey,
  mode: "index" | "day_of_month",
): Array<{ current: NormalizedDailyFact; previous: NormalizedDailyFact; delta: number }> {
  const curr = [...current].filter((f) => factValue(f, key) != null).sort((a, b) => a.date.localeCompare(b.date));
  const prev = [...previous].filter((f) => factValue(f, key) != null).sort((a, b) => a.date.localeCompare(b.date));
  const out: Array<{ current: NormalizedDailyFact; previous: NormalizedDailyFact; delta: number }> = [];
  if (mode === "day_of_month") {
    const map = new Map<number, NormalizedDailyFact>();
    for (const p of prev) map.set(Number(p.date.slice(8, 10)), p);
    for (const c of curr) {
      const p = map.get(Number(c.date.slice(8, 10)));
      if (!p) continue;
      out.push({ current: c, previous: p, delta: (factValue(c, key) as number) - (factValue(p, key) as number) });
    }
    return out;
  }
  const n = Math.min(curr.length, prev.length);
  const cSlice = curr.slice(-n);
  const pSlice = prev.slice(-n);
  for (let i = 0; i < n; i++) {
    out.push({
      current: cSlice[i],
      previous: pSlice[i],
      delta: (factValue(cSlice[i], key) as number) - (factValue(pSlice[i], key) as number),
    });
  }
  return out;
}

function computeBreadthAndContributors(
  pairs: Array<{ current: NormalizedDailyFact; previous: NormalizedDailyFact; delta: number }>,
  key: MetricFactKey,
): {
  breadth: { class: BreadthClass; text: string | null };
  contributors: ContributorRow[];
  contributorText: string | null;
} {
  if (pairs.length < BREADTH_MIN_MATCHED) {
    return {
      breadth: { class: "insufficient", text: null },
      contributors: [],
      contributorText: null,
    };
  }
  const net = pairs.reduce((s, p) => s + p.delta, 0);
  const signed = pairs.map((p) => {
    const prev = factValue(p.previous, key);
    const pct = percentDelta(factValue(p.current, key), prev);
    if (pct == null || isEffectivelyFlat(pct)) return 0;
    return p.delta;
  });
  const downDays = signed.filter((d) => d < 0).length;
  const upDays = signed.filter((d) => d > 0).length;
  const dirDays = net < 0 ? downDays : upDays;
  const share = dirDays / pairs.length;
  const sorted = [...pairs].sort((a, b) => a.delta - b.delta);
  const negatives = pairs.filter((p) => p.delta < 0);
  const positives = pairs.filter((p) => p.delta > 0);
  const topHurt = (net < 0 ? sorted.slice(0, 2) : [...sorted].reverse().slice(0, 2));
  const topSum = topHurt.reduce((s, p) => s + p.delta, 0);
  const posAbs = positives.reduce((s, p) => s + p.delta, 0);
  const negAbs = Math.abs(negatives.reduce((s, p) => s + p.delta, 0));
  const offsetting = negAbs > 0 && posAbs / negAbs >= 0.25;
  const concentrated = Math.abs(net) > 0 && Math.abs(topSum) / Math.abs(net) >= CONCENTRATED_SHARE && share < BROAD_DAY_SHARE;
  let breadthClass: BreadthClass = "mixed";
  let breadthText: string | null = null;
  if (share >= BROAD_DAY_SHARE && !isEffectivelyFlat(percentDelta(net + 1, 1))) {
    breadthClass = "broad_based";
    breadthText = net < 0
      ? `The weakness was broad-based: ${downDays} of ${pairs.length} matched days were down.`
      : `The strength was broad-based: ${upDays} of ${pairs.length} matched days were up.`;
  } else if (concentrated) {
    breadthClass = "concentrated";
    const days = topHurt.map((p) => formatManagerDate(p.current.date)).join(" and ");
    breadthText = net < 0
      ? `Most of the decline came from ${topHurt.length === 1 ? "one unusually weak day" : "a few unusually weak days"} (${days}).`
      : `Most of the increase came from ${topHurt.length === 1 ? "one unusually strong day" : "a few strong days"} (${days}).`;
  } else {
    breadthText = `${downDays} of ${pairs.length} matched days were down and ${upDays} were up.`;
  }

  const contributors: ContributorRow[] = topHurt.map((p) => ({
    date: p.current.date,
    delta: p.delta,
    shareOfMove: !offsetting && Math.abs(net) > 0 ? p.delta / net : null,
  }));
  let contributorText: string | null = null;
  if (contributors.length) {
    const bits = contributors.map((c) => {
      const signed = `${c.delta >= 0 ? "+" : "−"}${formatMetricValue(key, Math.abs(c.delta))}`;
      return `${formatManagerDate(c.date)} (${signed})`;
    });
    const together = contributors.reduce((s, c) => s + c.delta, 0);
    const togetherShare = !offsetting && Math.abs(net) > 0 ? Math.abs(together) / Math.abs(net) : null;
    const shareText = togetherShare != null
      ? `, together accounting for about ${formatPercent(togetherShare * 100)} of the matched-period ${net < 0 ? "decline" : "increase"}`
      : "";
    contributorText = net < 0
      ? `The largest negative contributors were ${bits.join(" and ")}${shareText}.`
      : `The largest positive contributors were ${bits.join(" and ")}${shareText}.`;
  }
  return { breadth: { class: breadthClass, text: breadthText }, contributors, contributorText };
}

function judgementWord(deltaPct: number | null, intent: AnalysisIntent): string | null {
  if (deltaPct == null) return null;
  if (isEffectivelyFlat(deltaPct)) return intent === "anomaly" ? "normal" : "in line with the baseline";
  if (deltaPct >= 12) return "strong";
  if (deltaPct >= 5) return "good";
  if (deltaPct > MAGNITUDE_FLAT_PCT) return "slightly better than the baseline";
  if (deltaPct <= -12) return "weak";
  if (deltaPct <= -5) return "below the baseline";
  return "slightly below the baseline";
}

function attentionLevel(input: {
  deltaPct: number | null;
  anomaly: AnomalyClass | null;
  breadth: BreadthClass;
}): AttentionLevel {
  if (input.anomaly === "strong_outlier" || input.anomaly === "weak_outlier") return "material";
  if (input.deltaPct != null && Math.abs(input.deltaPct) >= 12) return "noteworthy";
  if (input.anomaly === "materially_unusual" || input.breadth === "concentrated") return "noteworthy";
  if (input.anomaly === "mildly_unusual" || (input.deltaPct != null && Math.abs(input.deltaPct) >= 5)) return "monitor";
  return "normal";
}

export function diagnoseCommercialPerformance(input: {
  question: string;
  analysisIntent?: AnalysisIntent;
  branchId: string | null;
  period: DateRange | null;
  comparisonPeriod?: DateRange | null;
  comparisonIntent?: boolean;
  primaryMetric?: CommercialMetric | "commercial" | null;
  snap: CommercialSnap;
  dailyFacts?: NormalizedDailyFact[];
  historyDailyFacts?: NormalizedDailyFact[];
  previousDailyFacts?: NormalizedDailyFact[];
  openingDate?: string | null;
  driverStatement?: string | null;
}): ManagementDiagnostic {
  const intent = input.analysisIntent ?? extractAnalysisIntent(input.question);
  const metric = input.primaryMetric || "sales";
  const key = metricKey(metric);
  const label = metricName(metric);
  const exactDay = Boolean(input.period?.startDate && input.period.startDate === input.period.endDate);
  const openingDate = input.openingDate || null;
  const dailyFacts = input.dailyFacts || [];
  const history = input.historyDailyFacts?.length ? input.historyDailyFacts : dailyFacts;
  const previousDailyFacts = input.previousDailyFacts || [];
  const current = key === "covers" ? input.snap.covers
    : key === "orders" ? input.snap.orders
      : key === "avg_spend" ? input.snap.avg_spend
        : input.snap.net_sales;

  const benchType = selectBenchmarkType({
    question: input.question,
    analysisIntent: intent,
    exactDay,
    comparisonIntent: Boolean(input.comparisonIntent),
    comparisonPeriod: input.comparisonPeriod,
    period: input.period,
  });

  const benchmark = computeBenchmark({
    type: benchType,
    current,
    snap: input.snap,
    key,
    label,
    period: input.period,
    history,
    dailyFacts,
    previousDailyFacts,
    openingDate,
  });

  const targetFact = exactDay && input.period
    ? dailyFacts.find((d) => d.date === input.period!.startDate)
      || { date: input.period.startDate, net_sales: input.snap.net_sales, covers: input.snap.covers, orders: input.snap.orders, avg_spend: input.snap.avg_spend }
    : null;
  const anomaly = targetFact
    ? anomalyForDay(targetFact, history, key, openingDate)
    : null;

  const weekdayFilter = /\bfridays?\b/i.test(input.question) ? 5
    : /\bsaturdays?\b/i.test(input.question) ? 6
      : /\bsundays?\b/i.test(input.question) ? 0
        : null;
  const trend = computeTrend(history, key, openingDate, input.period?.endDate || null, weekdayFilter);

  const priorRange = benchType === "elapsed_prior" && input.period ? elapsedPriorRange(input.period) : input.comparisonPeriod || (input.period ? previousEquivalentRange(input.period) : null);
  const currentRows = input.period ? dailyFacts.filter((d) => inRange(d.date, input.period)) : dailyFacts;
  const previousRows = priorRange
    ? completedFacts([...history, ...previousDailyFacts], openingDate).filter((d) => inRange(d.date, priorRange))
    : previousDailyFacts;
  const matchMode = benchType === "elapsed_prior" ? "day_of_month" : "index";
  const pairs = matchDays(currentRows, previousRows, key, matchMode);
  const { breadth, contributors, contributorText } = computeBreadthAndContributors(pairs, key);

  const copula = metricCopula(label);
  let judgement: string | null = null;
  if (!benchmark.sufficient) {
    judgement = benchmark.insufficientText;
  } else if (benchmark.deltaPct != null && (intent === "judgement" || intent === "anomaly" || !intent)) {
    const word = judgementWord(benchmark.deltaPct, intent);
    const pct = formatPercent(Math.abs(benchmark.deltaPct));
    const dir = directionWord(benchmark.deltaPct);
    const dayLabel = exactDay && input.period ? formatManagerDate(input.period.startDate) : (input.period?.label || "This period");
    if (dir === "flat") {
      judgement = `${dayLabel} ${label} ${copula} in line with ${benchmark.label} (${pct}).`;
    } else if (word === "strong" || word === "good") {
      judgement = `Yes. ${dayLabel} ${label} ${copula} ${pct} above ${benchmark.label}.`;
    } else if (word === "weak") {
      judgement = `No. ${dayLabel} ${label} ${copula} ${pct} below ${benchmark.label}.`;
    } else {
      judgement = `${dayLabel} ${label} ${copula} ${dir} ${pct} versus ${benchmark.label}.`;
    }
  }

  let movement: string | null = null;
  if (benchmark.sufficient && benchmark.deltaPct != null) {
    const mag = magnitudePhrase(benchmark.deltaPct);
    const pct = formatPercent(Math.abs(benchmark.deltaPct));
    movement = mag
      ? `${label.replace(/^./, (c) => c.toUpperCase())} ${copula} ${mag} versus ${benchmark.label} (${pct}).`
      : null;
  }

  const driver = input.driverStatement || null;

  let oneOffVsSustained: string | null = null;
  if (
    anomaly
    && (anomaly.class === "weak_outlier" || anomaly.class === "mildly_unusual" || anomaly.class === "materially_unusual")
    && (trend.class === "broadly_flat" || trend.class === "noisy")
    && anomaly.class !== "normal"
  ) {
    oneOffVsSustained = exactDay && input.period
      ? `${formatManagerDate(input.period.startDate)} looks more like a one-off versus recent ${isoWeekdayName(input.period.startDate)}s than a sustained deterioration.`
      : "This looks more like a one-off than a sustained trend.";
  } else if (anomaly && (anomaly.class === "weak_outlier" || anomaly.class === "mildly_unusual") && trend.class === "downward") {
    oneOffVsSustained = "The weak day sits on a downward trend, so this looks more like repeated weakness than a one-off.";
  }

  const invented = /\b(weather|staffing|service quality|marketing|competition|guest sentiment|atmosphere)\b/i.test(input.question);
  let whyText: string | null = null;
  if (intent === "why" || intent === "action") {
    const parts = [driver, breadth.text, contributorText].filter(Boolean);
    whyText = parts.length
      ? `The measurable explanation is internal commercial evidence only. ${parts.join(" ")}`
      : "The available Cash Up evidence does not isolate a measurable volume, spend, or day-contribution driver for this change.";
    if (invented) {
      whyText += " I don't have connected evidence on staffing, weather, service, marketing, or guest sentiment, so I will not infer those causes.";
    }
  }

  let investigation: string | null = null;
  if (intent === "action") {
    if (driver && /covers|volume|traffic/i.test(driver) && /stable|spend per guest/i.test(driver)) {
      investigation = "The issue to investigate is traffic rather than spend: covers moved while spend per guest was stable. Review the weakest contributing days first.";
    } else if (driver && /spend per guest/i.test(driver)) {
      investigation = "The issue to investigate is spend per guest rather than traffic. Review the days with the largest spend gaps first.";
    } else {
      investigation = whyText
        ? "Use those measurable gaps as the first operational review points; I cannot prescribe a fix from Cash Up facts alone."
        : "I can point to measurable commercial gaps only; I cannot prescribe an operational fix from the available evidence.";
    }
    if (contributors.length) {
      investigation += ` Start with ${contributors.map((c) => formatManagerDate(c.date)).join(" and ")}.`;
    }
  }

  const findings: DiagnosticFinding[] = [];
  const push = (id: string, priority: number, text: string | null) => {
    if (text) findings.push({ id, priority, text });
  };
  if (benchmark.sufficient && benchmark.deltaPct != null && !isEffectivelyFlat(benchmark.deltaPct)) {
    push("movement", 100 + Math.min(40, Math.abs(benchmark.deltaPct)), movement || judgement);
  }
  if (anomaly && anomaly.class !== "normal" && !/isn't enough/.test(anomaly.text)) {
    push("anomaly", anomaly.class.includes("outlier") ? 90 : 70, anomaly.text);
  }
  if (driver && !/effectively unchanged/.test(driver)) push("driver", 80, driver);
  if (breadth.class === "concentrated") push("concentrated", 75, breadth.text);
  else if (breadth.class === "broad_based") push("broad", 60, breadth.text);
  if (contributorText && (intent === "contributors" || intent === "why" || intent === "stands_out" || intent === "breadth")) {
    push("contributors", 72, contributorText);
  }
  if (trend.class === "upward" || trend.class === "downward") push("trend", 55, trend.text);
  if (oneOffVsSustained) push("one_off", 68, oneOffVsSustained);

  findings.sort((a, b) => b.priority - a.priority);
  const topFindings = findings.slice(0, intent === "stands_out" || intent === "action" ? 4 : 4);

  const sentences: string[] = [];
  if (intent === "judgement" || intent === "anomaly") {
    if (judgement) sentences.push(judgement);
    if (intent === "anomaly" && anomaly && !sentences.includes(anomaly.text)) sentences.push(anomaly.text);
    if (driver && benchmark.sufficient && benchmark.deltaPct != null && !isEffectivelyFlat(benchmark.deltaPct)) {
      sentences.push(driver);
    }
    if (oneOffVsSustained) sentences.push(oneOffVsSustained);
  } else if (intent === "trend") {
    if (trend.text) sentences.push(trend.text);
  } else if (intent === "why") {
    if (whyText) sentences.push(whyText.replace(/^The measurable explanation is internal commercial evidence only\. /, ""));
  } else if (intent === "contributors") {
    if (contributorText) sentences.push(contributorText);
    else sentences.push("There aren't enough matched daily facts to rank day contributions reliably.");
  } else if (intent === "breadth") {
    if (breadth.text) sentences.push(breadth.text);
    if (contributorText && breadth.class === "concentrated") sentences.push(contributorText);
  } else if (intent === "stands_out") {
    if (!topFindings.length) sentences.push("Nothing material stands out versus the available baseline.");
    else for (const f of topFindings.slice(0, 4)) sentences.push(f.text);
  } else if (intent === "action") {
    if (investigation) sentences.push(investigation);
  } else if (intent === "weekend") {
    const rows = dailyFacts.filter((d) => factValue(d, key) != null);
    let weekend = 0;
    let weekendN = 0;
    let weekday = 0;
    let weekdayN = 0;
    for (const row of rows) {
      const v = factValue(row, key) || 0;
      if (isKsaWeekendIso(row.date)) {
        weekend += v;
        weekendN += 1;
      } else {
        weekday += v;
        weekdayN += 1;
      }
    }
    if (weekendN && weekdayN) {
      const share = key === "avg_spend" ? null : weekend / (weekend + weekday);
      sentences.push(
        `Friday–Saturday average ${label} ${copula} ${formatMetricValue(key, weekend / weekendN)} versus ${formatMetricValue(key, weekday / weekdayN)} on Sunday–Thursday.`
        + (share != null ? ` Weekends accounted for ${formatPercent(share * 100)} of ${label} in the requested period.` : ""),
      );
    }
  }

  const uniqueSentences = sentences.filter((s, i) => s && sentences.indexOf(s) === i).slice(0, 5);

  return {
    judgement,
    benchmark,
    movement,
    driver,
    breadth,
    anomalies: anomaly ? [{ date: targetFact!.date, class: anomaly.class, text: anomaly.text }] : [],
    contributors,
    contributorText,
    trend,
    oneOffVsSustained,
    confidence: !benchmark.sufficient || trend.class === "insufficient"
      ? "insufficient"
      : (benchmark.sampleSize >= 4 ? "high" : "medium"),
    attention: attentionLevel({
      deltaPct: benchmark.deltaPct,
      anomaly: anomaly?.class || null,
      breadth: breadth.class,
    }),
    findings: topFindings,
    investigation,
    whyText,
    sentences: uniqueSentences,
  };
}
