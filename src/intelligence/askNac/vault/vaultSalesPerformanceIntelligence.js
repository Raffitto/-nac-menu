import { parseVaultComparePeriodsFromQuestion } from "./vaultPeriodParser";
import {
  assessPeriodCoverage,
  buildCoverageAnswerLines,
} from "../coverage/coverageAwareness";
import {
  deriveTrafficSpendInterpretation,
  deriveRecommendedAction,
} from "../interpretation/operationalInterpretation";

export const DELIVERY_PLATFORM_KEYS = Object.freeze(["jahez", "chefz", "keeta", "hunger"]);

const DELIVERY_PLATFORM_LABELS = Object.freeze({
  jahez: "Jahez",
  chefz: "Chefz",
  keeta: "Keeta",
  hunger: "Hunger",
});

export function normalizeDeliveryPlatform(raw) {
  const text = String(raw || "").trim().toLowerCase();
  if (!text) return null;
  if (text.includes("jahez")) return "jahez";
  if (text.includes("chefz") || text.includes("the chefz")) return "chefz";
  if (text.includes("keeta")) return "keeta";
  if (text.includes("hunger")) return "hunger";
  return null;
}

export function formatDeliveryPlatformLabel(platformKey) {
  return DELIVERY_PLATFORM_LABELS[platformKey] || String(platformKey || "");
}

function pickMetricValue(facts, metricKey) {
  const hit = (facts || []).find(
    (f) => (f.metricKey || f.metric_key) === metricKey && (f.metricValue ?? f.metric_value) != null,
  );
  return hit ? (hit.metricValue ?? hit.metric_value) : null;
}

/** Prefer aggregate workbook rows (no dimensions) for headline metrics. */
export function pickAggregateMetricValue(facts, metricKey) {
  const rows = (facts || []).filter(
    (f) => (f.metricKey || f.metric_key) === metricKey && (f.metricValue ?? f.metric_value) != null,
  );
  if (!rows.length) return null;

  const aggregate = rows.find((f) => !f.dimensions || Object.keys(f.dimensions).length === 0);
  if (aggregate) return aggregate.metricValue ?? aggregate.metric_value;

  if (metricKey === "delivery_sales" || metricKey === "delivery_orders") {
    const platformRows = rows.filter((f) => f.dimensions?.platform);
    if (platformRows.length) {
      return platformRows.reduce(
        (sum, row) => sum + Number(row.metricValue ?? row.metric_value),
        0,
      );
    }
  }

  return rows[0].metricValue ?? rows[0].metric_value;
}

export const SALES_PERFORMANCE_METRICS = Object.freeze([
  ["total_sales", "Total sales", "SAR"],
  ["net_sales", "Net sales", "SAR"],
  ["guest_count", "Guest count", ""],
  ["order_count", "Order count", ""],
  ["avg_per_guest", "Average spend per guest", "SAR"],
  ["target_sales", "Sales target / budget", "SAR"],
  ["cash_sales", "Cash sales", "SAR"],
  ["card_sales", "Electronic payments", "SAR"],
  ["delivery_sales", "Delivery sales", "SAR"],
  ["discounts", "Discounts", "SAR"],
  ["voids", "Voids", "SAR"],
  ["tips", "Tips", "SAR"],
  ["breakfast_sales", "Breakfast sales", "SAR"],
  ["lunch_sales", "Lunch sales", "SAR"],
  ["dinner_sales", "Dinner sales", "SAR"],
  ["ccm_sales", "CCM sales", "SAR"],
]);

export const RECONCILIATION_METRICS = Object.freeze([
  ["cash_expected", "Cash expected", "SAR"],
  ["cash_counted", "Cash counted", "SAR"],
  ["cash_variance", "Cash variance", "SAR"],
  ["cash_shortage", "Cash shortage", "SAR"],
  ["cash_overage", "Cash overage", "SAR"],
  ["petty_cash_variance", "Petty cash variance", "SAR"],
]);

/** Metric keys allowed when querying cash-up structured facts (avoids full-workbook scans). */
export const CASH_UP_STRUCTURED_METRIC_KEYS = Object.freeze([
  "gross_sales",
  "business_date",
  "delivery_orders",
  ...SALES_PERFORMANCE_METRICS.map(([key]) => key),
  ...RECONCILIATION_METRICS.map(([key]) => key),
]);

/** Headline keys only — used for multi-day range aggregation (no payment mix / reconciliation). */
export const CASH_UP_PERIOD_AGGREGATION_METRIC_KEYS = Object.freeze([
  "gross_sales",
  "net_sales",
  "total_sales",
  "guest_count",
  "order_count",
  "avg_per_guest",
  "delivery_sales",
  "delivery_orders",
  "business_date",
]);

export const CASH_UP_FACTS_QUERY_LIMIT = 64;

function formatNumber(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (Number.isFinite(n)) return n.toLocaleString();
  return String(value);
}

function formatCurrency(value) {
  const formatted = formatNumber(value);
  return formatted != null ? `${formatted} SAR` : null;
}

export function hasReconciliationData(facts = []) {
  const keys = new Set(RECONCILIATION_METRICS.map(([k]) => k));
  return (facts || []).some((f) => keys.has(f.metricKey || f.metric_key));
}

export function isSalesPerformanceKnowledgeQuery(question = "") {
  const q = String(question || "").toLowerCase();
  return (
    /\b(cash[\s-]?up|sales performance|guest spend|average spend|payment mix|budget|daypart|meal period)\b/.test(q)
    || /\b(net sales|guest count|how many guests|mada|visa|hunger|jahez|keeta|talabat)\b/.test(q)
  );
}

export function isSalesPerformanceExecutiveQuery(question = "") {
  const q = String(question || "").toLowerCase();
  return (
    /\b(summarize|summary|latest|what should management know)\b.*\b(cash[\s-]?up|sales|performance|june|july|august|september|october|november|december|january|february|march|april|may)\b/.test(q)
    || /\bwhat should management know from\b.*\b(performance|sales)\b/.test(q)
    || /\b(cash[\s-]?up|cashup|cash report|daily cash report|cash reconciliation)\b/.test(q)
    || /\bsearch company knowledge for cash[\s-]?up\b/.test(q)
    || scoreSalesPerformanceQueryFocus(q) != null
  );
}

export function scoreSalesPerformanceQueryFocus(question = "") {
  const q = String(question || "").toLowerCase();
  if (/\b(compare|compared|vs|versus)\b.*\btop\b/.test(q) || /\btop\b.*\b(compare|compared|vs|versus|between|two months)\b/.test(q)) {
    return null;
  }
  if (scoreDeliveryPlatformQueryFocus(q)) return "delivery_platform";
  if (parseVaultComparePeriodsFromQuestion(question)) return "period_compare";
  if (/\bcompare\b.*\b(last|past)\s+(7|14|30)\s+days?\b/.test(q)) return "period_compare";
  if (/\b(net sales|sales|revenue)\b.*\byesterday\b/.test(q)) return "period_sales";
  if (/\b(guest count|guests?|covers)\b.*\byesterday\b/.test(q)) return "guest_count";
  if (/\b(average spend|avg spend|average check)\b.*\b(this month|this year|ytd|year)\b/.test(q)) return "avg_spend";
  if (/\b(delivery platforms?|delivery apps?)\b.*\b(this year|ytd|year)\b/.test(q)) return "delivery_platform";
  if (/\b(sales|revenue)\b.*\b(last|past)\s+\d+\s+days?\b/.test(q)) return "period_sales";
  if (/\b(guests?|guest count)\b.*\b(this month|current month|last|past)\b/.test(q)) return "guest_count";
  if (/\b(average guest spend|avg spend|spend per guest|average spend per guest|average spend)\b/.test(q)) return "avg_spend";
  if (/\bhow many guests\b/.test(q)) return "guest_count";
  if (/\b(which payment method|most used payment|payment mix)\b/.test(q)) return "payment_mix";
  if (/\bhow much came from\b.*\bmada\b/.test(q)) return "payment_mada";
  if (/\bhow much came from\b.*\bvisa\b/.test(q)) return "payment_visa";
  if (/\b(meal period|daypart).*(most revenue|generates most)\b/.test(q)) return "top_daypart";
  if (/\b(breakfast|lunch|dinner).*(most revenue|generates most)\b/.test(q)) return "top_daypart";
  if (/\b(how far|distance).*\b(budget|target)\b/.test(q)) return "budget_gap";
  if (/\b(daily average|average daily)\b.*\bsales\b/.test(q)) return "daily_avg";
  if (/\b(delivery orders?|hunger|jahez|keeta|talabat)\b/.test(q)) return "delivery";
  if (/\b(cash variance|shortage|overage)\b/.test(q)) return "reconciliation";
  return null;
}

export function scoreDeliveryPlatformQueryFocus(question = "") {
  const q = String(question || "").toLowerCase();
  if (/\bcompare\b.*\bdelivery platform/.test(q)) return "platform_compare";
  if (/\b(delivery mix|platform breakdown|delivery platform breakdown)\b/.test(q)) return "platform_breakdown";
  if (/\btop delivery platform\b/.test(q)) return "platform_top";
  if (/\bwhich delivery platform\b.*\b(most|top|highest|biggest)\b.*\border/.test(q)) return "platform_top_orders";
  if (/\bwhich delivery platform\b.*\b(most|top|highest|biggest|generated)\b.*\bsales/.test(q)) return "platform_top_sales";
  if (/\baverage order value\b.*\b(delivery )?platform/.test(q)) return "platform_aov";
  if (/\bdelivery platform\b/.test(q) && /\b(most|top|highest|breakdown|mix|compare)\b/.test(q)) return "platform_breakdown";
  if (/\b(how much|how many)\b.*\b(hungerstation|hunger|chefz|jahez|keeta)\b/.test(q)) return "platform_specific";
  if (/\b(hungerstation|hunger|chefz|jahez|keeta)\b.*\b(sales|orders|delivery|made)\b/.test(q)) return "platform_specific";
  if (/\b(hunger|chefz|jahez|keeta)\b.*\b(this month|last|past)\b/.test(q)) return "platform_specific";
  if (/\bjahez delivery\b|\bkeeta delivery\b|\bchefz orders\b/.test(q)) return "platform_specific";
  return null;
}

export function isDeliveryPlatformPeriodQuery(question = "") {
  return scoreDeliveryPlatformQueryFocus(question) != null;
}

export function extractDeliveryPlatformFromQuestion(question = "") {
  const q = String(question || "").toLowerCase();
  const match = q.match(/\b(hungerstation|hunger|chefz|jahez|keeta)\b/);
  if (!match) return null;
  const normalized = match[1].replace("station", "");
  if (normalized.includes("hunger")) return "hunger";
  if (normalized.includes("chefz")) return "chefz";
  if (normalized.includes("jahez")) return "jahez";
  if (normalized.includes("keeta")) return "keeta";
  return null;
}

export function extractPaymentMix(facts = []) {
  return (facts || [])
    .filter((f) => (f.metricKey || f.metric_key) === "payment_method" && f.dimensions?.method)
    .map((f) => ({
      method: String(f.dimensions.method),
      value: Number(f.metricValue ?? f.metric_value),
    }))
    .filter((row) => Number.isFinite(row.value))
    .sort((a, b) => b.value - a.value);
}

export function extractDeliveryPerformance(facts = []) {
  const sales = (facts || [])
    .filter((f) => (f.metricKey || f.metric_key) === "delivery_sales" && f.dimensions?.platform)
    .map((f) => ({
      platform: String(f.dimensions.platform),
      value: Number(f.metricValue ?? f.metric_value),
      kind: "sales",
    }));
  const orders = (facts || [])
    .filter((f) => (f.metricKey || f.metric_key) === "delivery_orders" && f.dimensions?.platform)
    .map((f) => ({
      platform: String(f.dimensions.platform),
      value: Number(f.metricValue ?? f.metric_value),
      kind: "orders",
    }));
  return [...sales, ...orders].filter((row) => Number.isFinite(row.value));
}

export function extractDaypartSales(facts = []) {
  return [
    { label: "Breakfast", key: "breakfast_sales", value: pickMetricValue(facts, "breakfast_sales") },
    { label: "Lunch", key: "lunch_sales", value: pickMetricValue(facts, "lunch_sales") },
    { label: "Dinner", key: "dinner_sales", value: pickMetricValue(facts, "dinner_sales") },
  ].filter((row) => row.value != null);
}

function computeBudgetAchievement(net, target) {
  if (net == null || target == null || !Number(target)) return null;
  const pct = (Number(net) / Number(target)) * 100;
  const gap = Number(net) - Number(target);
  return { pct, gap, met: gap >= 0 };
}

function identifyOperationalRisks(facts = [], { budget, discounts, voids } = {}) {
  const risks = [];
  if (budget && budget.pct < 90) {
    risks.push(`Sales at ${budget.pct.toFixed(1)}% of budget (${formatCurrency(Math.abs(budget.gap))} below target).`);
  }
  if (discounts != null && Number(discounts) > 0) {
    risks.push(`Discounts total ${formatCurrency(discounts)} — review comp/discount policy.`);
  }
  if (voids != null && Number(voids) > 0) {
    risks.push(`Voids total ${formatCurrency(voids)} — check void reasons with MOD.`);
  }
  const guests = pickMetricValue(facts, "guest_count");
  const net = pickMetricValue(facts, "net_sales") ?? pickMetricValue(facts, "total_sales");
  if (guests != null && net != null && Number(guests) > 0) {
    const impliedAvg = Number(net) / Number(guests);
    const reportedAvg = pickMetricValue(facts, "avg_per_guest");
    if (reportedAvg != null && Math.abs(impliedAvg - Number(reportedAvg)) > 5) {
      risks.push("Reported average spend differs from net sales ÷ guests — verify source file.");
    }
  }
  return risks;
}

function buildManagementActions({ budget, paymentMix, delivery, risks, hasReconciliation }) {
  const actions = [];
  if (budget && budget.pct < 95) {
    actions.push("Review daypart mix and staffing against under-performing services.");
  }
  if (paymentMix.length) {
    actions.push("Confirm card/digital mix aligns with bank settlement and CCM totals.");
  }
  if (delivery.length) {
    actions.push("Track delivery platform commission impact on net margin.");
  }
  if (!actions.length && !risks.length) {
    actions.push("Continue monitoring guest count and average spend trend vs. budget.");
  }
  if (hasReconciliation) {
    actions.push("Reconciliation fields present — verify separately if investigating cash control.");
  }
  return actions;
}

export function extendedSalesPerformanceMetrics(facts = []) {
  const rows = [];

  for (const [key, label, unit] of SALES_PERFORMANCE_METRICS) {
    const value = pickAggregateMetricValue(facts, key);
    if (value != null) {
      rows.push({ key, label, value: formatNumber(value), unit });
    }
  }

  if (hasReconciliationData(facts)) {
    for (const [key, label, unit] of RECONCILIATION_METRICS) {
      const value = pickMetricValue(facts, key);
      if (value != null) {
        rows.push({ key, label, value: formatNumber(value), unit, section: "reconciliation" });
      }
    }
  }

  for (const fact of facts) {
    const metricKey = fact.metricKey || fact.metric_key;
    if (metricKey === "payment_method" && fact.dimensions?.method) {
      rows.push({
        key: `payment_${fact.dimensions.method}`,
        label: `Payment · ${fact.dimensions.method}`,
        value: formatNumber(fact.metricValue),
        unit: "SAR",
        section: "payment_mix",
      });
    }
    if (metricKey === "delivery_sales" && fact.dimensions?.platform) {
      rows.push({
        key: `delivery_${fact.dimensions.platform}`,
        label: `Delivery · ${fact.dimensions.platform}`,
        value: formatNumber(fact.metricValue),
        unit: "SAR",
        section: "delivery",
      });
    }
    if (metricKey === "delivery_orders" && fact.dimensions?.platform) {
      rows.push({
        key: `delivery_orders_${fact.dimensions.platform}`,
        label: `Delivery orders · ${fact.dimensions.platform}`,
        value: formatNumber(fact.metricValue),
        unit: "",
        section: "delivery",
      });
    }
  }

  return rows;
}

export function buildSalesPerformanceQueryAnswer(question = "", facts = [], {
  branchLabel = "Network",
  periodLabel = "the period",
} = {}) {
  const focus = scoreSalesPerformanceQueryFocus(question);
  if (!focus) return null;

  const net = pickMetricValue(facts, "net_sales") ?? pickMetricValue(facts, "total_sales");
  const guests = pickMetricValue(facts, "guest_count");
  const avgSpend = pickMetricValue(facts, "avg_per_guest");
  const target = pickMetricValue(facts, "target_sales");
  const paymentMix = extractPaymentMix(facts);
  const delivery = extractDeliveryPerformance(facts);
  const dayparts = extractDaypartSales(facts);
  const budget = computeBudgetAchievement(net, target);

  switch (focus) {
    case "avg_spend":
      if (avgSpend != null) {
        return `${branchLabel} average guest spend on ${periodLabel} was ${formatCurrency(avgSpend)} (${formatNumber(guests) || "?"} guests, ${formatCurrency(net) || "net sales n/a"}).`;
      }
      if (net != null && guests != null && Number(guests) > 0) {
        return `${branchLabel} implied average guest spend on ${periodLabel} was ${formatCurrency(Number(net) / Number(guests))} (computed from net sales ÷ ${formatNumber(guests)} guests).`;
      }
      return `Average guest spend is not available for ${branchLabel} on ${periodLabel} — re-index the sales report or check avg per guest row.`;

    case "guest_count":
      return guests != null
        ? `${branchLabel} recorded ${formatNumber(guests)} guests on ${periodLabel}.`
        : `Guest count is not available for ${branchLabel} on ${periodLabel}.`;

    case "payment_mix":
      if (!paymentMix.length) return `Payment mix is not parsed for ${branchLabel} on ${periodLabel}.`;
      return `Top payment method for ${branchLabel} on ${periodLabel}: ${paymentMix[0].method} at ${formatCurrency(paymentMix[0].value)}${paymentMix[1] ? `, followed by ${paymentMix[1].method} (${formatCurrency(paymentMix[1].value)})` : ""}.`;

    case "payment_mada": {
      const mada = paymentMix.find((p) => /\bmada\b/i.test(p.method));
      return mada
        ? `Mada total for ${branchLabel} on ${periodLabel}: ${formatCurrency(mada.value)}.`
        : `Mada amount not found in payment mix for ${periodLabel}.`;
    }

    case "payment_visa": {
      const visa = paymentMix.find((p) => /\bvisa\b/i.test(p.method));
      return visa
        ? `Visa total for ${branchLabel} on ${periodLabel}: ${formatCurrency(visa.value)}.`
        : `Visa amount not found in payment mix for ${periodLabel}.`;
    }

    case "top_daypart": {
      if (!dayparts.length) return `Daypart sales breakdown not available for ${periodLabel}.`;
      const top = [...dayparts].sort((a, b) => Number(b.value) - Number(a.value))[0];
      return `${top.label} generated the most revenue on ${periodLabel}: ${formatCurrency(top.value)}.`;
    }

    case "budget_gap":
      if (!budget) return `Budget/target not available to compare against net sales for ${periodLabel}.`;
      return budget.met
        ? `${branchLabel} met budget on ${periodLabel}: net sales ${formatCurrency(net)} vs target ${formatCurrency(target)} (${budget.pct.toFixed(1)}%).`
        : `${branchLabel} is ${formatCurrency(Math.abs(budget.gap))} below budget on ${periodLabel} (${budget.pct.toFixed(1)}% of ${formatCurrency(target)} target).`;

    case "daily_avg":
      return net != null
        ? `Daily net sales for ${branchLabel} on ${periodLabel}: ${formatCurrency(net)} (single-day report).`
        : `Net sales not available for ${periodLabel}.`;

    case "delivery": {
      const q = String(question).toLowerCase();
      const platformMatch = q.match(/\b(hungerstation|hunger|jahez|keeta|talabat)\b/);
      if (platformMatch) {
        const needle = platformMatch[1];
        const hit = delivery.find((d) => d.platform.toLowerCase().includes(needle.replace("station", "")));
        if (hit) {
          return `${hit.platform} ${hit.kind === "orders" ? "orders" : "sales"} for ${periodLabel}: ${hit.kind === "orders" ? formatNumber(hit.value) : formatCurrency(hit.value)}.`;
        }
        return `No ${needle} delivery data found for ${periodLabel}.`;
      }
      if (!delivery.length) return `Delivery channel data not parsed for ${periodLabel}.`;
      const top = delivery.sort((a, b) => b.value - a.value)[0];
      return `Top delivery channel on ${periodLabel}: ${top.platform} (${top.kind}) at ${top.kind === "orders" ? formatNumber(top.value) : formatCurrency(top.value)}.`;
    }

    case "reconciliation":
      if (!hasReconciliationData(facts)) {
        return `This sales report does not include cash reconciliation fields for ${periodLabel}. Ask about revenue, guests, or payment mix instead.`;
      }
      break;

    default:
      break;
  }

  return null;
}

export function buildSalesPerformanceExecutiveSummary(facts = [], {
  branchLabel = "Network",
  periodLabel = "the period",
  fileTitle = null,
  question = "",
} = {}) {
  const metrics = extendedSalesPerformanceMetrics(facts);
  const net = pickMetricValue(facts, "net_sales") ?? pickMetricValue(facts, "total_sales");
  const guests = pickMetricValue(facts, "guest_count");
  const avgSpend = pickMetricValue(facts, "avg_per_guest");
  const target = pickMetricValue(facts, "target_sales");
  const discounts = pickMetricValue(facts, "discounts");
  const voids = pickMetricValue(facts, "voids");
  const paymentMix = extractPaymentMix(facts);
  const delivery = extractDeliveryPerformance(facts);
  const dayparts = extractDaypartSales(facts);
  const budget = computeBudgetAchievement(net, target);
  const risks = identifyOperationalRisks(facts, { budget, discounts, voids });
  const reconciliationPresent = hasReconciliationData(facts);

  const focused = buildSalesPerformanceQueryAnswer(question, facts, { branchLabel, periodLabel });

  const headline = [];
  if (net != null) headline.push(`revenue ${formatCurrency(net)}`);
  if (guests != null) headline.push(`${formatNumber(guests)} guests`);
  if (avgSpend != null) headline.push(`avg spend ${formatCurrency(avgSpend)}`);
  else if (net != null && guests != null && Number(guests) > 0) {
    headline.push(`avg spend ${formatCurrency(Number(net) / Number(guests))} (computed)`);
  }
  if (budget) {
    headline.push(`${budget.pct.toFixed(1)}% of budget`);
  }

  const answer = focused
    || (headline.length
      ? `Sales performance for ${branchLabel} on ${periodLabel}: ${headline.join(", ")}.`
      : metrics.length
        ? `Sales performance data for ${branchLabel} on ${periodLabel} includes ${metrics.length} metric(s) below.`
        : `No sales performance facts found for ${branchLabel} on ${periodLabel}.`);

  const managementSections = [];
  if (budget) {
    managementSections.push(
      budget.met
        ? `Budget: achieved ${budget.pct.toFixed(1)}% of target.`
        : `Budget: ${formatCurrency(Math.abs(budget.gap))} below target (${budget.pct.toFixed(1)}%).`,
    );
  }
  if (paymentMix.length) {
    managementSections.push(`Payment mix lead: ${paymentMix[0].method} (${formatCurrency(paymentMix[0].value)}).`);
  }
  if (delivery.length) {
    const topDelivery = [...delivery].sort((a, b) => b.value - a.value)[0];
    managementSections.push(`Delivery: ${topDelivery.platform} ${topDelivery.kind} ${topDelivery.kind === "orders" ? formatNumber(topDelivery.value) : formatCurrency(topDelivery.value)}.`);
  }
  if (dayparts.length) {
    const topDaypart = [...dayparts].sort((a, b) => Number(b.value) - Number(a.value))[0];
    managementSections.push(`Strongest daypart: ${topDaypart.label} (${formatCurrency(topDaypart.value)}).`);
  }
  if (risks.length) {
    managementSections.push(`Risks: ${risks.join(" ")}`);
  }

  const actions = buildManagementActions({ budget, paymentMix, delivery, risks, hasReconciliation: reconciliationPresent });
  let managementNote = managementSections.length
    ? managementSections.join(" ")
    : "Review revenue, guest count, and average spend against budget for the period.";

  if (actions.length) {
    managementNote += ` Actions: ${actions.join(" ")}`;
  }

  const missingFields = [];
  if (net == null) missingFields.push("net/total sales");
  if (guests == null) missingFields.push("guest count");
  if (avgSpend == null && !(net && guests)) missingFields.push("average spend per guest");
  if (target == null && /\bbudget\b/i.test(String(question))) missingFields.push("budget/target");

  let reconciliationNote = null;
  if (reconciliationPresent) {
    const variance = pickMetricValue(facts, "cash_variance");
    if (variance != null) {
      reconciliationNote = `Cash reconciliation (secondary): variance ${formatCurrency(variance)}.`;
    }
  }

  const performanceBreakdown = metrics.filter(
    (m) => m.section === "payment_mix" || m.section === "delivery" || ["breakfast_sales", "lunch_sales", "dinner_sales"].includes(m.key),
  );

  return {
    answer,
    managementNote,
    reconciliationNote,
    source: fileTitle || "Uploaded sales performance report",
    metrics,
    missingFields,
    paymentMix,
    deliveryPerformance: delivery,
    dayparts,
    budget,
    risks,
    actions,
    performanceBreakdown,
    actionRequired: risks.length > 0 || (budget != null && budget.pct < 90),
  };
}

export function buildSalesPerformanceSearchableText(matrix = [], metadata = {}) {
  const lines = [];
  const branch = metadata.branchId || metadata.primary_branch_id || metadata.branch;
  lines.push(`Sales performance report${branch ? ` · ${branch}` : ""}`);

  for (const row of matrix) {
    if (!row?.length) continue;
    const label = String(row[0] || "").trim();
    const value = row[1];
    if (!label) continue;
    if (value == null || value === "") continue;
    lines.push(`${label}: ${value}`);
  }

  return lines.join("\n");
}

export function buildSalesPerformanceFactsAsSyntheticMatches(facts = [], fileTitle = "Sales performance report") {
  const summary = buildSalesPerformanceExecutiveSummary(facts, {
    fileTitle,
    periodLabel: facts[0]?.periodStart || "latest",
  });
  return [{
    fileTitle,
    excerpt: summary.answer,
    chunkText: summary.answer,
    citation: `${fileTitle} · structured sales performance facts`,
    reportType: "cash_up",
    relevanceScore: 90,
  }];
}

function formatAveragePerDay(total, dayCount, unit = "SAR") {
  if (total == null || !dayCount) return null;
  const avg = Number(total) / dayCount;
  const formatted = avg.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return unit ? `${formatted} ${unit}` : formatted;
}

function formatSharePct(value) {
  if (value == null || !Number.isFinite(Number(value))) return null;
  return `${Number(value).toFixed(1)}%`;
}

function formatPlatformBreakdownLine(platformKey, row) {
  const label = formatDeliveryPlatformLabel(platformKey);
  const parts = [];
  if (row.sales != null) parts.push(`${formatCurrency(row.sales)} sales`);
  if (row.orders != null) parts.push(`${formatNumber(row.orders)} orders`);
  if (row.averageOrderValue != null) parts.push(`${formatCurrency(row.averageOrderValue)} avg order value`);
  const shareParts = [];
  if (row.salesShare != null) shareParts.push(`${formatSharePct(row.salesShare)} sales share`);
  if (row.orderShare != null) shareParts.push(`${formatSharePct(row.orderShare)} order share`);
  if (shareParts.length) parts.push(shareParts.join(", "));
  return `${label}: ${parts.join(" · ")}.`;
}

/**
 * Deterministic delivery-platform answer from multi-day aggregation.
 */
export function buildCashUpDeliveryPlatformAnswer(question = "", aggregation, {
  branchLabel = "Network",
  periodLabel = "the period",
} = {}) {
  if (!aggregation?.deliveryPlatformBreakdown) return null;

  const focus = scoreDeliveryPlatformQueryFocus(question);
  if (!focus) return null;

  const breakdown = aggregation.deliveryPlatformBreakdown || {};
  const platformKeys = Object.keys(breakdown).sort();
  if (!platformKeys.length) {
    return `No delivery platform breakdown is available for ${branchLabel} over ${periodLabel}.`;
  }

  const specificPlatform = extractDeliveryPlatformFromQuestion(question);
  const dayCount = aggregation.dayCount || 0;

  if (focus === "platform_specific" && specificPlatform) {
    const row = breakdown[specificPlatform];
    if (!row) {
      return `${formatDeliveryPlatformLabel(specificPlatform)} delivery data is not available for ${branchLabel} over ${periodLabel}.`;
    }
    const wantsOrders = /\borders?\b/.test(String(question).toLowerCase()) && !/\bsales\b/.test(String(question).toLowerCase());
    const wantsSales = /\b(sales|made|revenue)\b/.test(String(question).toLowerCase());
    if (wantsOrders && !wantsSales) {
      return `${formatDeliveryPlatformLabel(specificPlatform)} recorded ${formatNumber(row.orders)} delivery orders for ${branchLabel} over ${periodLabel} (${dayCount} cash-up day(s)${row.orderShare != null ? `, ${formatSharePct(row.orderShare)} of delivery orders` : ""}).`;
    }
    const shareText = row.salesShare != null ? ` (${formatSharePct(row.salesShare)} of delivery sales)` : "";
    const ordersText = row.orders != null ? `, ${formatNumber(row.orders)} orders` : "";
    const aovText = row.averageOrderValue != null ? `, ${formatCurrency(row.averageOrderValue)} average order value` : "";
    return `${formatDeliveryPlatformLabel(specificPlatform)} delivery for ${branchLabel} over ${periodLabel}: ${formatCurrency(row.sales)} sales${ordersText}${aovText}${shareText} across ${dayCount} cash-up day(s).`;
  }

  const lines = [`Delivery platform breakdown for ${branchLabel} — ${periodLabel} (${dayCount} cash-up day(s)):`];
  const ranked = [...platformKeys].sort((a, b) => (breakdown[b]?.sales || 0) - (breakdown[a]?.sales || 0));
  for (const key of ranked) {
    lines.push(formatPlatformBreakdownLine(key, breakdown[key]));
  }

  if (aggregation.totalDeliverySales != null) {
    lines.push(`Total delivery sales: ${formatCurrency(aggregation.totalDeliverySales)}.`);
  }
  if (aggregation.totalDeliveryOrders != null) {
    lines.push(`Total delivery orders: ${formatNumber(aggregation.totalDeliveryOrders)}.`);
  }

  if (focus === "platform_top_orders" || focus === "platform_top" || focus === "platform_breakdown") {
    if (aggregation.topPlatformByOrders) {
      lines.push(`Top platform by orders: ${formatDeliveryPlatformLabel(aggregation.topPlatformByOrders)}.`);
    }
  }
  if (focus === "platform_top_sales" || focus === "platform_top" || focus === "platform_breakdown" || focus === "platform_compare") {
    if (aggregation.topPlatformBySales) {
      lines.push(`Top platform by sales: ${formatDeliveryPlatformLabel(aggregation.topPlatformBySales)}.`);
    }
  }

  if (focus === "platform_aov") {
    const aovLines = ranked
      .filter((key) => breakdown[key]?.averageOrderValue != null)
      .map((key) => `${formatDeliveryPlatformLabel(key)} avg order value: ${formatCurrency(breakdown[key].averageOrderValue)}`);
    if (aovLines.length) lines.push(...aovLines);
  }

  return lines.join("\n");
}

export function buildCashUpDeliveryPlatformMetrics(aggregation, question = "") {
  const breakdown = aggregation?.deliveryPlatformBreakdown || {};
  const focus = scoreDeliveryPlatformQueryFocus(question);
  const specificPlatform = extractDeliveryPlatformFromQuestion(question);
  const metrics = [];

  if (focus === "platform_specific" && specificPlatform && breakdown[specificPlatform]) {
    const row = breakdown[specificPlatform];
    metrics.push(metricEntry(`${formatDeliveryPlatformLabel(specificPlatform)} sales`, formatNumber(row.sales), { unit: "SAR", source: "cash_up" }));
    metrics.push(metricEntry(`${formatDeliveryPlatformLabel(specificPlatform)} orders`, formatNumber(row.orders), { source: "cash_up" }));
    if (row.averageOrderValue != null) {
      metrics.push(metricEntry(`${formatDeliveryPlatformLabel(specificPlatform)} avg order value`, formatNumber(row.averageOrderValue), { unit: "SAR", source: "cash_up" }));
    }
    if (row.salesShare != null) {
      metrics.push(metricEntry(`${formatDeliveryPlatformLabel(specificPlatform)} sales share`, formatSharePct(row.salesShare), { source: "cash_up" }));
    }
    if (row.orderShare != null) {
      metrics.push(metricEntry(`${formatDeliveryPlatformLabel(specificPlatform)} order share`, formatSharePct(row.orderShare), { source: "cash_up" }));
    }
  } else {
    for (const key of Object.keys(breakdown).sort()) {
      const row = breakdown[key];
      const label = formatDeliveryPlatformLabel(key);
      metrics.push(metricEntry(`${label} sales`, formatNumber(row.sales), { unit: "SAR", source: "cash_up" }));
      metrics.push(metricEntry(`${label} orders`, formatNumber(row.orders), { source: "cash_up" }));
      if (row.averageOrderValue != null) {
        metrics.push(metricEntry(`${label} avg order value`, formatNumber(row.averageOrderValue), { unit: "SAR", source: "cash_up" }));
      }
      if (row.salesShare != null) {
        metrics.push(metricEntry(`${label} sales share`, formatSharePct(row.salesShare), { source: "cash_up" }));
      }
    }
    if (aggregation.topPlatformBySales) {
      metrics.push(metricEntry("Top platform by sales", formatDeliveryPlatformLabel(aggregation.topPlatformBySales), { source: "cash_up" }));
    }
    if (aggregation.topPlatformByOrders) {
      metrics.push(metricEntry("Top platform by orders", formatDeliveryPlatformLabel(aggregation.topPlatformByOrders), { source: "cash_up" }));
    }
  }

  if (aggregation.totalDeliverySales != null) {
    metrics.push(metricEntry("Total delivery sales", formatNumber(aggregation.totalDeliverySales), { unit: "SAR", source: "cash_up" }));
  }
  if (aggregation.totalDeliveryOrders != null) {
    metrics.push(metricEntry("Total delivery orders", formatNumber(aggregation.totalDeliveryOrders), { source: "cash_up" }));
  }
  metrics.push(metricEntry("Days included", formatNumber(aggregation.dayCount), { source: "cash_up" }));
  return metrics;
}

function metricEntry(label, value, extras = {}) {
  return { label, value, unit: extras.unit || "", source: extras.source || "", note: extras.note || "" };
}

function formatSignedDelta(value, unit = "SAR") {
  if (value == null || !Number.isFinite(Number(value))) return null;
  const n = Number(value);
  const sign = n >= 0 ? "+" : "-";
  const formatted = Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
  return unit ? `${sign}${formatted} ${unit}` : `${sign}${formatted}`;
}

function formatSignedPct(value) {
  if (value == null || !Number.isFinite(Number(value))) return null;
  const n = Number(value);
  const sign = n >= 0 ? "+" : "-";
  return `${sign}${Math.abs(n).toFixed(1)}%`;
}

export function buildCashUpPeriodCompareAnswer(aggregation, previousAggregation, {
  branchLabel = "Network",
  periodLabel = "the period",
  previousPeriodLabel = "the previous period",
} = {}) {
  if (!aggregation || !previousAggregation) return null;

  const currentSales = aggregation.totalSales;
  const previousSales = previousAggregation.totalSales;
  if (currentSales == null || previousSales == null) {
    return `${branchLabel}: insufficient cash-up data to compare ${periodLabel}.`;
  }

  const salesDelta = Number(currentSales) - Number(previousSales);
  const salesPct = previousSales ? ((salesDelta / Number(previousSales)) * 100) : null;
  const lines = [
    `${branchLabel} sales comparison — ${periodLabel} vs ${previousPeriodLabel}:`,
    `Current: ${formatCurrency(currentSales)} (${aggregation.dayCount} cash-up day(s)).`,
    `Previous: ${formatCurrency(previousSales)} (${previousAggregation.dayCount} cash-up day(s)).`,
    `Sales delta: ${formatSignedDelta(salesDelta)}${salesPct != null ? ` (${formatSignedPct(salesPct)})` : ""}.`,
  ];

  if (aggregation.totalGuests != null && previousAggregation.totalGuests != null) {
    const guestDelta = Number(aggregation.totalGuests) - Number(previousAggregation.totalGuests);
    lines.push(`Guest delta: ${formatSignedDelta(guestDelta, "")}.`);
  }

  if (aggregation.averageSpend != null && previousAggregation.averageSpend != null) {
    const spendDelta = Number(aggregation.averageSpend) - Number(previousAggregation.averageSpend);
    lines.push(`Average spend delta: ${formatSignedDelta(spendDelta)}.`);
  }

  if (aggregation.totalDeliverySales != null && previousAggregation.totalDeliverySales != null) {
    const deliveryDelta = Number(aggregation.totalDeliverySales) - Number(previousAggregation.totalDeliverySales);
    lines.push(`Delivery sales delta: ${formatSignedDelta(deliveryDelta)}.`);
  }

  if (aggregation.totalDeliveryOrders != null && previousAggregation.totalDeliveryOrders != null) {
    const orderDelta = Number(aggregation.totalDeliveryOrders) - Number(previousAggregation.totalDeliveryOrders);
    lines.push(`Delivery orders delta: ${formatSignedDelta(orderDelta, "")}.`);
  }

  if (aggregation.dayCount !== previousAggregation.dayCount) {
    lines.push(`Coverage note: current period includes ${aggregation.dayCount} cash-up day(s) vs ${previousAggregation.dayCount} in the comparison period.`);
  }

  const interpretation = deriveTrafficSpendInterpretation(aggregation, previousAggregation);
  if (interpretation) {
    lines.push(`Interpretation: ${interpretation}`);
    const action = deriveRecommendedAction(interpretation);
    if (action) lines.push(`Recommended action: ${action}`);
  }

  return lines.join("\n");
}

export function appendCoverageToAggregateAnswer(baseAnswer, question, aggregation, requestedPeriod) {
  if (!baseAnswer || !aggregation) return baseAnswer;
  const coverage = assessPeriodCoverage({ requestedPeriod, aggregation });
  const coverageLines = buildCoverageAnswerLines(coverage);
  if (!coverageLines.length) return baseAnswer;

  const forbiddenSilentJune = /\bthis year\b|\bytd\b|\byear.to.date\b/i.test(String(question));
  if (forbiddenSilentJune && requestedPeriod?.periodType === "year_to_date" && aggregation.dayCount > 0) {
    return `${baseAnswer}\n\n${coverageLines.join("\n")}`;
  }
  if (coverage.completeness === "partial" || coverage.completeness === "unavailable") {
    return `${baseAnswer}\n\n${coverageLines.join("\n")}`;
  }
  if (coverage.confidenceExplanation) {
    return `${baseAnswer}\n\n${coverageLines[coverageLines.length - 1]}`;
  }
  return baseAnswer;
}

export function buildCashUpPeriodCompareMetrics(aggregation, previousAggregation) {
  if (!aggregation || !previousAggregation) return [];
  const metrics = [];
  if (aggregation.totalSales != null) {
    metrics.push(metricEntry("Current period sales", formatNumber(aggregation.totalSales), { unit: "SAR", source: "cash_up" }));
  }
  if (previousAggregation.totalSales != null) {
    metrics.push(metricEntry("Comparison period sales", formatNumber(previousAggregation.totalSales), { unit: "SAR", source: "cash_up" }));
  }
  if (aggregation.totalSales != null && previousAggregation.totalSales != null) {
    const delta = Number(aggregation.totalSales) - Number(previousAggregation.totalSales);
    const pct = previousAggregation.totalSales ? ((delta / Number(previousAggregation.totalSales)) * 100) : null;
    metrics.push(metricEntry("Sales delta", formatSignedDelta(delta), { source: "cash_up" }));
    if (pct != null) metrics.push(metricEntry("Sales change", formatSignedPct(pct), { source: "cash_up" }));
  }
  if (aggregation.totalGuests != null && previousAggregation.totalGuests != null) {
    metrics.push(metricEntry("Guest delta", formatSignedDelta(Number(aggregation.totalGuests) - Number(previousAggregation.totalGuests), ""), { source: "cash_up" }));
  }
  if (aggregation.averageSpend != null && previousAggregation.averageSpend != null) {
    metrics.push(metricEntry("Average spend delta", formatSignedDelta(Number(aggregation.averageSpend) - Number(previousAggregation.averageSpend)), { unit: "SAR", source: "cash_up" }));
  }
  if (aggregation.totalDeliverySales != null && previousAggregation.totalDeliverySales != null) {
    metrics.push(metricEntry("Delivery sales delta", formatSignedDelta(Number(aggregation.totalDeliverySales) - Number(previousAggregation.totalDeliverySales)), { unit: "SAR", source: "cash_up" }));
  }
  if (aggregation.totalDeliveryOrders != null && previousAggregation.totalDeliveryOrders != null) {
    metrics.push(metricEntry("Delivery orders delta", formatSignedDelta(Number(aggregation.totalDeliveryOrders) - Number(previousAggregation.totalDeliveryOrders), ""), { source: "cash_up" }));
  }
  metrics.push(metricEntry("Current period days", formatNumber(aggregation.dayCount), { source: "cash_up" }));
  metrics.push(metricEntry("Comparison period days", formatNumber(previousAggregation.dayCount), { source: "cash_up" }));
  return metrics;
}

/**
 * Deterministic multi-day cash-up answer from aggregated structured facts.
 */
export function buildCashUpPeriodAggregateAnswer(question = "", aggregation, {
  branchLabel = "Network",
  periodLabel = "the period",
  previousAggregation = null,
  previousPeriodLabel = null,
} = {}) {
  if (!aggregation) return null;

  if (previousAggregation) {
    const compareAnswer = buildCashUpPeriodCompareAnswer(aggregation, previousAggregation, {
      branchLabel,
      periodLabel,
      previousPeriodLabel: previousPeriodLabel || "the previous period",
    });
    if (compareAnswer) return compareAnswer;
  }

  const focus = scoreSalesPerformanceQueryFocus(question);
  const {
    totalSales,
    totalGuests,
    totalOrders,
    averageSpend,
    totalDeliverySales,
    totalDeliveryOrders,
    dayCount,
  } = aggregation;

  if (focus === "delivery_platform") {
    const platformAnswer = buildCashUpDeliveryPlatformAnswer(question, aggregation, { branchLabel, periodLabel });
    if (platformAnswer) return platformAnswer;
  }

  if (focus === "guest_count" || (/\bguests?\b/.test(String(question).toLowerCase()) && focus !== "delivery_platform")) {
    return totalGuests != null
      ? `${branchLabel} recorded ${formatNumber(totalGuests)} guests for ${periodLabel} (${dayCount} cash-up day(s) included).`
      : `Guest count is not available for ${branchLabel} over ${periodLabel}.`;
  }

  if (focus === "avg_spend" || /\baverage spend\b/.test(String(question).toLowerCase())) {
    if (averageSpend != null) {
      return `${branchLabel} average spend for ${periodLabel} was ${formatCurrency(averageSpend)} (${formatNumber(totalGuests) || "?"} guests, ${formatCurrency(totalSales) || "sales n/a"}, ${dayCount} day(s)).`;
    }
    return `Average spend is not available for ${branchLabel} over ${periodLabel}.`;
  }

  if (/\bdelivery orders?\b/.test(String(question).toLowerCase()) && focus !== "delivery_platform") {
    const avgOrders = formatAveragePerDay(totalDeliveryOrders, dayCount, "");
    return totalDeliveryOrders != null
      ? `${branchLabel} delivery orders for ${periodLabel}: ${formatNumber(totalDeliveryOrders)} total${avgOrders ? ` (${avgOrders} avg/day)` : ""} across ${dayCount} day(s).`
      : `Delivery order count is not available for ${branchLabel} over ${periodLabel}.`;
  }

  if ((/\bdelivery sales\b/.test(String(question).toLowerCase()) || focus === "delivery") && focus !== "delivery_platform") {
    const avgDelivery = formatAveragePerDay(totalDeliverySales, dayCount);
    return totalDeliverySales != null
      ? `${branchLabel} delivery sales for ${periodLabel}: ${formatCurrency(totalDeliverySales)} total${avgDelivery ? ` (${avgDelivery} avg/day)` : ""} across ${dayCount} day(s).`
      : `Delivery sales are not available for ${branchLabel} over ${periodLabel}.`;
  }

  const avgSales = formatAveragePerDay(totalSales, dayCount);
  if (totalSales != null) {
    return `${branchLabel} total sales for ${periodLabel}: ${formatCurrency(totalSales)}${avgSales ? ` (${avgSales} avg/day)` : ""} across ${dayCount} cash-up day(s).`;
  }

  if (totalOrders != null) {
    return `${branchLabel} recorded ${formatNumber(totalOrders)} orders for ${periodLabel} (${dayCount} day(s)).`;
  }

  return dayCount
    ? `${branchLabel} has ${dayCount} cash-up day(s) for ${periodLabel}, but sales totals were not extracted.`
    : `No cash-up sales data found for ${branchLabel} over ${periodLabel}.`;
}
