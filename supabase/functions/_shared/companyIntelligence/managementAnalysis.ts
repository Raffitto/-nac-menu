/**
 * Deterministic management analysis for Ask NAC.
 * Baseline is the first mentioned period. Subject is the second.
 * delta = subject - baseline. deltaPct = delta / baseline.
 * Keep in lockstep with supabase/functions/_shared/companyIntelligence/managementAnalysis.ts
 */

import { numericOrNull } from "./comparisonContract.ts";

function finite(value) {
  const n = numericOrNull(value);
  return n == null ? null : n;
}

export function formatSar(value) {
  const n = finite(value);
  if (n == null) return "unavailable";
  return n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export function formatPct(value) {
  const n = finite(value);
  if (n == null) return null;
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

function formatSignedSar(value) {
  const n = finite(value);
  if (n == null) return "unavailable";
  const sign = n > 0 ? "+" : "";
  return `${sign}${formatSar(n)} SAR`;
}

function perDay(total, days) {
  const t = finite(total);
  const d = finite(days);
  if (t == null || d == null || d === 0) return null;
  return t / d;
}

function ratio(numerator, denominator) {
  const n = finite(numerator);
  const d = finite(denominator);
  if (n == null || d == null || d === 0) return null;
  return n / d;
}

export function deltaPair(subjectValue, baselineValue) {
  const subject = finite(subjectValue);
  const baseline = finite(baselineValue);
  if (subject == null || baseline == null) {
    return { delta: null, deltaPct: null, reason: "missing_value" };
  }
  const delta = subject - baseline;
  if (baseline === 0) return { delta, deltaPct: null, reason: "zero_denominator" };
  return { delta, deltaPct: (delta / baseline) * 100, reason: null };
}

export function buildPeriodSide({
  label,
  start = null,
  end = null,
  days = null,
  sales = null,
  covers = null,
  orders = null,
  missingDays = 0,
  source = "cash_up",
} = {}) {
  const representedDays = finite(days);
  const netSales = finite(sales);
  const coverCount = finite(covers);
  const orderCount = finite(orders);
  return {
    label: label || "Period",
    start,
    end,
    representedDays,
    missingHistoricalDays: finite(missingDays) || 0,
    source: source || "cash_up",
    netSales,
    covers: coverCount,
    orders: orderCount,
    salesPerDay: perDay(netSales, representedDays),
    coversPerDay: perDay(coverCount, representedDays),
    ordersPerDay: perDay(orderCount, representedDays),
    averageSpendPerCover: ratio(netSales, coverCount),
    averageOrderValue: ratio(netSales, orderCount),
  };
}

export function buildManagementComparison({ baseline, subject } = {}) {
  if (!baseline || !subject) return null;
  const sales = deltaPair(subject.netSales, baseline.netSales);
  const covers = deltaPair(subject.covers, baseline.covers);
  const orders = deltaPair(subject.orders, baseline.orders);
  const salesPerDay = deltaPair(subject.salesPerDay, baseline.salesPerDay);
  const coversPerDay = deltaPair(subject.coversPerDay, baseline.coversPerDay);
  const ordersPerDay = deltaPair(subject.ordersPerDay, baseline.ordersPerDay);
  const spendPerCover = deltaPair(subject.averageSpendPerCover, baseline.averageSpendPerCover);
  const averageOrderValue = deltaPair(subject.averageOrderValue, baseline.averageOrderValue);
  const sameLength = baseline.representedDays != null
    && subject.representedDays != null
    && baseline.representedDays === subject.representedDays;
  return {
    baseline,
    subject,
    comparisonMode: sameLength ? "like_for_like" : "full_vs_open",
    sales,
    covers,
    orders,
    salesPerDay,
    coversPerDay,
    ordersPerDay,
    spendPerCover,
    averageOrderValue,
  };
}

function namedDelta(label, pair, unit) {
  if (!pair || pair.delta == null) return `${label}: unavailable`;
  const pct = formatPct(pair.deltaPct);
  const amount = unit === "SAR" ? formatSignedSar(pair.delta) : `${pair.delta > 0 ? "+" : ""}${formatSar(pair.delta)}`;
  return pct ? `${label}: ${amount} (${pct})` : `${label}: ${amount}`;
}

function largestDriver(model) {
  const candidates = [
    ["covers/day", model.coversPerDay],
    ["orders/day", model.ordersPerDay],
    ["spend per cover", model.spendPerCover],
    ["average order value", model.averageOrderValue],
  ].filter(([, pair]) => pair?.deltaPct != null);
  if (!candidates.length) return null;
  candidates.sort((a, b) => Math.abs(b[1].deltaPct) - Math.abs(a[1].deltaPct));
  const [name, pair] = candidates[0];
  return `The largest measured difference is ${name} (${formatPct(pair.deltaPct)}).`;
}

export function formatManagementComparison(model, { projectionRequested = false } = {}) {
  if (!model?.baseline || !model?.subject) return "";
  const base = model.baseline;
  const subject = model.subject;
  const modeLine = model.comparisonMode === "like_for_like"
    ? "Like-for-like comparison. Both periods use the same number of represented days."
    : "Full-period comparison. Day counts differ, so the total and the daily pace are both shown.";
  const side = (period) => [
    period.start && period.end ? `${period.label} · ${period.start} to ${period.end}` : period.label,
    `${formatSar(period.netSales)} SAR · ${period.representedDays ?? "?"} represented days · ${formatSar(period.salesPerDay)} SAR/day`,
    `Covers ${formatSar(period.covers)} · ${formatSar(period.coversPerDay)}/day · Orders ${formatSar(period.orders)} · ${formatSar(period.ordersPerDay)}/day`,
    `Spend/cover ${formatSar(period.averageSpendPerCover)} SAR · Average order ${formatSar(period.averageOrderValue)} SAR`,
  ].join("\n");

  const totalPct = formatPct(model.sales.deltaPct);
  const pacePct = formatPct(model.salesPerDay.deltaPct);
  const totalWord = model.sales.deltaPct == null
    ? "cannot be percent-compared"
    : model.sales.deltaPct < -0.05
      ? `${Math.abs(model.sales.deltaPct).toFixed(2)}% below`
      : model.sales.deltaPct > 0.05
        ? `${model.sales.deltaPct.toFixed(2)}% above`
        : "about level with";
  const paceWord = model.salesPerDay.deltaPct == null
    ? "a daily pace that cannot be percent-compared"
    : `running ${Math.abs(model.salesPerDay.deltaPct).toFixed(2)}% ${model.salesPerDay.deltaPct >= 0 ? "above" : "below"}`;
  const interpretation = model.comparisonMode === "like_for_like"
    ? `${subject.label} vs ${base.label}: total sales are ${totalWord} ${base.label} on the same day count.`
    : `${subject.label}'s total is ${totalWord} ${base.label}, and it contains ${subject.representedDays ?? "?"} represented days versus ${base.label}'s ${base.representedDays ?? "?"}. On a per-day basis, ${subject.label} is ${paceWord} ${base.label}.`;

  const lines = [
    `${subject.label} vs ${base.label}: ${formatSignedSar(model.sales.delta)}${totalPct ? ` (${totalPct})` : ""}`,
    interpretation,
    "",
    modeLine,
    "",
    side(base),
    "",
    side(subject),
    "",
    "TOTAL SALES",
    namedDelta(`${subject.label} vs ${base.label}`, model.sales, "SAR"),
    "",
    "DAILY SALES PACE",
    `${base.label}: ${formatSar(base.salesPerDay)} SAR/day`,
    `${subject.label}: ${formatSar(subject.salesPerDay)} SAR/day`,
    namedDelta(`${subject.label} vs ${base.label}`, model.salesPerDay, "SAR"),
    "",
    "COVERS AND ORDERS",
    namedDelta("Covers", model.covers, "count"),
    namedDelta("Orders", model.orders, "count"),
    namedDelta("Covers/day", model.coversPerDay, "count"),
    namedDelta("Orders/day", model.ordersPerDay, "count"),
    namedDelta("Spend/cover", model.spendPerCover, "SAR"),
    namedDelta("Average order value", model.averageOrderValue, "SAR"),
  ];
  const driver = largestDriver(model);
  if (driver) lines.push("", driver);
  if (base.source === "commerce_orders" || subject.source === "commerce_orders") {
    lines.push("", "Source: commerce orders where Cash Up has no days. This is not a Cash Up total.");
  }
  if (projectionRequested && subject.salesPerDay != null && subject.representedDays) {
    lines.push("", "No month-end projection was requested in a way that changes the actual totals above.");
  }
  return lines.filter((line) => line != null).join("\n");
}

export function projectRunRate({ salesPerDay, elapsedDays, monthDays, label }) {
  const pace = finite(salesPerDay);
  const elapsed = finite(elapsedDays);
  const span = finite(monthDays);
  if (pace == null || elapsed == null || span == null || elapsed <= 0 || span <= 0) return null;
  return {
    label: "projection / run-rate estimate",
    text: `Projection / run-rate estimate for ${label || "the open period"}: ${formatSar(pace * span)} SAR if ${formatSar(pace)} SAR/day continued across ${span} days. This is not actual sales. Actual sales so far are ${formatSar(pace * elapsed)} SAR across ${elapsed} represented days.`,
  };
}

function dayValue(row, metric) {
  if (!row) return null;
  if (metric === "covers") return finite(row.totalGuests);
  if (metric === "orders") return finite(row.totalOrders);
  if (metric === "spend") {
    const sales = finite(row.totalSales);
    const covers = finite(row.totalGuests);
    if (sales == null || covers == null || covers === 0) return null;
    return sales / covers;
  }
  return finite(row.totalSales);
}

function metricUnit(metric) {
  return metric === "covers" || metric === "orders" ? "" : "SAR";
}

export function rankDailyFacts(rows = [], { metric = "sales", direction = "top", limit = 5 } = {}) {
  const ranked = (rows || [])
    .map((row) => ({ date: String(row.date || ""), value: dayValue(row, metric) }))
    .filter((row) => row.date && row.value != null);
  ranked.sort((a, b) => {
    if (a.value === b.value) return a.date < b.date ? -1 : 1;
    return direction === "bottom" ? a.value - b.value : b.value - a.value;
  });
  return ranked.slice(0, Math.max(1, limit)).map((row, index) => ({
    rank: index + 1,
    date: row.date,
    value: row.value,
    tiedWithPrevious: index > 0 && row.value === ranked[index - 1].value,
  }));
}

export function formatRankingAnswer({
  label,
  metric = "sales",
  direction = "top",
  rows = [],
  missingHistoricalDays = 0,
}) {
  const ranked = rankDailyFacts(rows, { metric, direction, limit: rows.limit || 5 });
  const unit = metricUnit(metric);
  const noun = metric === "covers" ? "covers" : metric === "orders" ? "orders" : metric === "spend" ? "spend per cover" : "sales";
  if (!ranked.length) {
    return `No represented ${noun} days are available for ${label || "this period"}. Missing days were not treated as zero.`;
  }
  const lead = ranked[0];
  const heading = direction === "bottom" ? "Lowest" : "Highest";
  const lines = [
    `${heading} ${noun} day in ${label || "this period"}: ${lead.date} — ${formatSar(lead.value)}${unit ? ` ${unit}` : ""}.`,
    "",
  ];
  ranked.forEach((row) => {
    const tie = row.tiedWithPrevious ? " (tie)" : "";
    lines.push(`${row.rank}. ${row.date} — ${formatSar(row.value)}${unit ? ` ${unit}` : ""}${tie}`);
  });
  if (missingHistoricalDays > 0) {
    lines.push("", `${missingHistoricalDays} historical day${missingHistoricalDays === 1 ? "" : "s"} had no Cash Up and ${missingHistoricalDays === 1 ? "was" : "were"} excluded, not counted as zero.`);
  }
  return lines.join("\n");
}

export function trendFromDailyFacts(rows = [], metric = "sales") {
  const series = (rows || [])
    .map((row) => ({ date: String(row.date || ""), value: dayValue(row, metric) }))
    .filter((row) => row.date && row.value != null)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  if (series.length < 2) {
    return { direction: "insufficient", latest: [], preceding: [], latestAverage: null, precedingAverage: null, deltaPct: null };
  }
  const useRecent = series.length >= 14;
  const window = useRecent ? 7 : Math.floor(series.length / 2);
  const latest = series.slice(-window);
  const preceding = series.slice(-(window * 2), -window);
  const avg = (list) => list.reduce((sum, row) => sum + row.value, 0) / list.length;
  const latestAverage = avg(latest);
  const precedingAverage = preceding.length ? avg(preceding) : null;
  const change = deltaPair(latestAverage, precedingAverage);
  const direction = change.deltaPct == null
    ? "insufficient"
    : change.deltaPct > 0.5
      ? "up"
      : change.deltaPct < -0.5
        ? "down"
        : "flat";
  return {
    direction,
    method: useRecent ? "latest_7_vs_preceding_7" : "second_half_vs_first_half",
    latest,
    preceding,
    latestAverage,
    precedingAverage,
    deltaPct: change.deltaPct,
    representedDays: series.length,
  };
}

export function formatTrendAnswer({ label, metric = "sales", rows = [] }) {
  const trend = trendFromDailyFacts(rows, metric);
  const noun = metric === "covers" ? "covers" : metric === "orders" ? "orders" : metric === "spend" ? "spend per cover" : "sales";
  const unit = metricUnit(metric);
  if (trend.direction === "insufficient" || trend.precedingAverage == null) {
    return `Not enough represented ${noun} days in ${label || "this period"} to compare a recent window with the one before it.`;
  }
  const windowLabel = trend.method === "latest_7_vs_preceding_7"
    ? "the latest 7 represented days"
    : "the second half of represented days";
  const priorLabel = trend.method === "latest_7_vs_preceding_7"
    ? "the preceding 7 represented days"
    : "the first half of represented days";
  const pct = formatPct(trend.deltaPct);
  return [
    `Average daily ${noun} over ${windowLabel} in ${label || "this period"} were ${formatSar(trend.latestAverage)}${unit ? ` ${unit}` : ""} versus ${formatSar(trend.precedingAverage)}${unit ? ` ${unit}` : ""} over ${priorLabel}${pct ? `, a ${pct} change` : ""}.`,
    `Direction: ${trend.direction}. Represented days used: ${trend.representedDays}. Days without Cash Up were excluded, not treated as zero.`,
  ].join("\n");
}

function weekdayIndex(iso) {
  const [y, m, d] = String(iso).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function contributionFromDailyFacts(rows = []) {
  const series = (rows || [])
    .map((row) => ({ date: String(row.date || ""), sales: finite(row.totalSales) }))
    .filter((row) => row.date && row.sales != null)
    .sort((a, b) => b.sales - a.sales);
  const total = series.reduce((sum, row) => sum + row.sales, 0);
  const top = series.slice(0, 5);
  const topSales = top.reduce((sum, row) => sum + row.sales, 0);
  const weekend = series.filter((row) => {
    const day = weekdayIndex(row.date);
    return day === 5 || day === 6;
  });
  const weekendSales = weekend.reduce((sum, row) => sum + row.sales, 0);
  return {
    total,
    representedDays: series.length,
    top,
    topShare: total > 0 ? (topSales / total) * 100 : null,
    weekendSales,
    weekendShare: total > 0 ? (weekendSales / total) * 100 : null,
    weekendDays: weekend.length,
  };
}

export function formatContributionAnswer({ label, rows = [], focus = "top" }) {
  const mix = contributionFromDailyFacts(rows);
  if (!mix.representedDays || mix.total <= 0) {
    return `No represented sales days are available to measure mix for ${label || "this period"}.`;
  }
  const topLines = mix.top.map((row, index) => `${index + 1}. ${row.date} — ${formatSar(row.sales)} SAR`);
  const topSentence = `The top ${mix.top.length} sales days contributed ${formatSar(mix.top.reduce((s, r) => s + r.sales, 0))} SAR, ${mix.topShare == null ? "an unavailable share" : `${mix.topShare.toFixed(2)}%`} of ${formatSar(mix.total)} SAR in ${label || "this period"}.`;
  const weekendSentence = `Friday and Saturday contributed ${formatSar(mix.weekendSales)} SAR across ${mix.weekendDays} represented days, ${mix.weekendShare == null ? "an unavailable share" : `${mix.weekendShare.toFixed(2)}%`} of sales.`;
  const lines = focus === "weekend"
    ? [weekendSentence, "", topSentence, "", ...topLines]
    : [topSentence, "", weekendSentence, "", ...topLines];
  lines.push("", "Shares use represented Cash Up days only. Missing days are excluded, not counted as zero.");
  return lines.join("\n");
}

export function managementBriefForCashUp({
  question = "",
  baseline = null,
  subject = null,
  daily = [],
  label = "",
  missingHistoricalDays = 0,
  source = "cash_up",
} = {}) {
  const q = String(question || "").toLowerCase();
  if (baseline && subject) {
    const model = buildManagementComparison({ baseline, subject });
    const text = formatManagementComparison(model, {
      projectionRequested: /\b(at this pace|run-?rate|project|finish at|end the month)\b/.test(q),
    });
    if (/\b(at this pace|run-?rate|project|finish at)\b/.test(q)) {
      const monthDays = baseline.representedDays && subject.representedDays
        ? Math.max(baseline.representedDays, subject.representedDays, 30)
        : null;
      const projection = projectRunRate({
        salesPerDay: subject.salesPerDay,
        elapsedDays: subject.representedDays,
        monthDays,
        label: subject.label,
      });
      return projection ? `${text}\n\n${projection.text}` : text;
    }
    return text;
  }
  const metric = /\b(average spend|spend per cover|avg spend)\b/.test(q)
    ? "spend"
    : /\b(covers|guests)\b/.test(q)
      ? "covers"
      : /\borders\b/.test(q)
        ? "orders"
        : "sales";
  const rankedRows = daily || [];
  if (/\b(best|worst|top|bottom|highest|lowest|which day|most orders)\b/.test(q)) {
    const limitMatch = q.match(/\b(?:top|bottom)\s+(\d{1,2})\b/);
    const limit = limitMatch ? Number(limitMatch[1]) : (/\b(top|bottom)\b/.test(q) ? 5 : 1);
    const direction = /\b(worst|bottom|lowest)\b/.test(q) ? "bottom" : "top";
    return formatRankingAnswer({
      label,
      metric,
      direction,
      rows: Object.assign(rankedRows, { limit }),
      missingHistoricalDays,
    });
  }
  if (/\b(trend|trending|improving|going up|going down)\b/.test(q)) {
    return formatTrendAnswer({ label, metric, rows: rankedRows });
  }
  if (/\b(percentage|percent|share|contributed|contribution|weekend|friday|saturday|top 5)\b/.test(q)) {
    return formatContributionAnswer({
      label,
      rows: rankedRows,
      focus: /\b(weekend|friday|saturday)\b/.test(q) ? "weekend" : "top",
    });
  }
  if (/\bwhich branch\b/.test(q)) {
    return "This Cash Up total is not split by branch in the selected aggregate. Ask for Khobar, Riyadh, or Jeddah, or compare those branches by name. A branch share was not invented.";
  }
  if (source === "commerce_orders") {
    return "These totals are from commerce orders because Cash Up has no days in this window. They are not Cash Up totals.";
  }
  return "";
}
