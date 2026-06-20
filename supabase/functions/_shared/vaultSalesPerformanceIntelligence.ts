/**
 * Sales performance intelligence from NAC cash-up uploads (operational sales reports).
 * These files track revenue, guests, payment mix, delivery, and dayparts — not cash reconciliation.
 */

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
  if (/\b(average guest spend|avg spend|spend per guest|average spend per guest)\b/.test(q)) return "avg_spend";
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
    if (fact.metricKey === "payment_method" && fact.dimensions?.method) {
      rows.push({
        key: `payment_${fact.dimensions.method}`,
        label: `Payment · ${fact.dimensions.method}`,
        value: formatNumber(fact.metricValue),
        unit: "SAR",
        section: "payment_mix",
      });
    }
    if (fact.metricKey === "delivery_sales" && fact.dimensions?.platform) {
      rows.push({
        key: `delivery_${fact.dimensions.platform}`,
        label: `Delivery · ${fact.dimensions.platform}`,
        value: formatNumber(fact.metricValue),
        unit: "SAR",
        section: "delivery",
      });
    }
    if (fact.metricKey === "delivery_orders" && fact.dimensions?.platform) {
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
  const orders = pickMetricValue(facts, "order_count");
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
    periodLabel: facts[0]?.periodStart || facts[0]?.period_start || "latest",
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

export function formatManagerStyleAnswer({
  answer,
  managementNote = null,
  source = null,
  relatedFindings = [],
  confidence = "medium",
}: {
  answer?: string | null;
  managementNote?: string | null;
  source?: string | null;
  relatedFindings?: { fileTitle?: string; excerpt?: string }[];
  confidence?: string;
}) {
  const sections: string[] = [];
  if (answer) sections.push(`Answer:\n${answer}`);
  if (managementNote) sections.push(`Management note:\n${managementNote}`);
  if (source) sections.push(`Source:\n${source}`);
  if (relatedFindings.length) {
    const lines = relatedFindings.slice(0, 4).map((item) => {
      const prefix = item.fileTitle ? `${item.fileTitle}: ` : "";
      return `- ${prefix}${item.excerpt?.slice(0, 120) || item.fileTitle || ""}`;
    });
    sections.push(`Related findings:\n${lines.join("\n")}`);
  }
  sections.push(`Confidence:\n${String(confidence).charAt(0).toUpperCase()}${String(confidence).slice(1)}`);
  return sections.join("\n\n");
}
