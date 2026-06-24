/**
 * Build deterministic answers from cached conversation datasets (no re-query).
 */

import { ANSWER_TYPES, CONFIDENCE_LEVELS, createAskNacResponse, metricEntry } from "../askNacContract";
import { FOLLOW_UP_CATEGORIES } from "./conversationFollowUpTaxonomy";

function formatNumber(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (Number.isFinite(n)) return n.toLocaleString();
  return String(value);
}

function formatCurrency(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return `${n.toLocaleString()} SAR`;
}

function buildDailyInsights(dailyBreakdown = []) {
  return dailyBreakdown.map((row) => {
    const sales = row.totalSales ?? row.netSales ?? row.sales;
    return `${row.date}: ${sales != null ? `${formatNumber(sales)} SAR` : "sales n/a"}`;
  });
}

function findWeakestDay(dailyBreakdown = []) {
  const rows = [...dailyBreakdown].filter((r) => r.totalSales != null || r.netSales != null);
  rows.sort((a, b) => Number(a.totalSales ?? a.netSales) - Number(b.totalSales ?? b.netSales));
  return rows[0] || null;
}

/**
 * @returns {import('../askNacContract').AskNacResponse|null}
 */
export function buildAnswerFromConversationDataset({
  followUpCategory,
  state,
  route,
  originalQuestion,
}) {
  const dataset = state?.dataset;
  const aggregation = dataset?.aggregation;
  const dailyBreakdown = dataset?.dailyBreakdown || aggregation?.dailyBreakdown || [];
  if (!dailyBreakdown.length && !aggregation) return null;

  const branchLabel = state.branchLabel || route?.branchMention || "Network";
  const periodLabel = state.period?.label || state.vaultPeriod?.label || "the period";

  if (
    followUpCategory === FOLLOW_UP_CATEGORIES.VISUALIZATION
    || followUpCategory === FOLLOW_UP_CATEGORIES.DRILL_DOWN
  ) {
    const insights = buildDailyInsights(dailyBreakdown);
    const metrics = [];
    if (aggregation?.totalSales != null) {
      metrics.push(metricEntry("Total sales", formatNumber(aggregation.totalSales), { unit: "SAR", source: "cash_up" }));
    }
    if (aggregation?.dayCount != null) {
      metrics.push(metricEntry("Days included", formatNumber(aggregation.dayCount), { source: "cash_up" }));
    }

    return createAskNacResponse({
      answerType: ANSWER_TYPES.METRIC,
      title: `Daily breakdown · ${periodLabel}`,
      directAnswer: `${branchLabel} daily ${state.metricLabel || "sales"} for ${periodLabel} (${dailyBreakdown.length} day(s) from prior answer).`,
      keyMetrics: metrics,
      insights,
      confidence: CONFIDENCE_LEVELS.HIGH,
      intent: state.intent,
      periodLabel,
      branchLabel,
      warnings: ["Reused dataset from the previous answer — no new vault query."],
      conversationDataset: dataset,
      diagnostics: { reusedDataset: true, aggregation },
    });
  }

  if (followUpCategory === FOLLOW_UP_CATEGORIES.EXPLANATION && dailyBreakdown.length) {
    const weakest = findWeakestDay(dailyBreakdown);
    if (!weakest) return null;
    const sales = weakest.totalSales ?? weakest.netSales;
    const rows = [...dailyBreakdown].filter((r) => (r.totalSales ?? r.netSales) != null);
    const avg = rows.reduce((sum, r) => sum + Number(r.totalSales ?? r.netSales), 0) / rows.length;
    const delta = Number(sales) - avg;
    const direction = delta < 0 ? "below" : "above";

    return createAskNacResponse({
      answerType: ANSWER_TYPES.EXECUTIVE,
      title: `Day analysis · ${weakest.date}`,
      directAnswer: `${weakest.date} was the weakest day in the prior ${periodLabel} window (${formatCurrency(sales)} vs ~${formatCurrency(avg)} daily average).`,
      keyMetrics: [
        metricEntry("Weakest day", weakest.date, { source: "conversation_dataset" }),
        metricEntry("Day sales", formatNumber(sales), { unit: "SAR", source: "conversation_dataset" }),
        metricEntry("Period daily average", formatNumber(avg), { unit: "SAR", source: "conversation_dataset" }),
      ],
      insights: [
        `${weakest.date} finished ${formatNumber(Math.abs(delta))} SAR ${direction} the period daily average.`,
        "Known: daily totals from the prior answer dataset.",
        "Inferred: weakness relative to other days in the same window.",
        "Missing: operational drivers (staffing, weather, promos) unless present in uploaded reports.",
      ],
      confidence: CONFIDENCE_LEVELS.MEDIUM,
      intent: state.intent,
      periodLabel,
      branchLabel,
      warnings: ["Explanation uses cached daily breakdown only — no new vault query."],
      conversationDataset: dataset,
      diagnostics: { reusedDataset: true, weakestDay: weakest.date },
    });
  }

  return null;
}

export function attachConversationDatasetToVaultAnswer(answer, tool, route) {
  const aggregation = tool?.aggregation;
  if (!aggregation) return answer;

  return {
    ...answer,
    conversationDataset: {
      kind: "cash_up_aggregation",
      reportType: "cash_up",
      aggregation: {
        totalSales: aggregation.totalSales ?? null,
        totalGuests: aggregation.totalGuests ?? null,
        totalDeliverySales: aggregation.totalDeliverySales ?? null,
        totalDeliveryOrders: aggregation.totalDeliveryOrders ?? null,
        averageSpend: aggregation.averageSpend ?? null,
        dayCount: aggregation.dayCount ?? null,
        dailyBreakdown: aggregation.dailyBreakdown || [],
        deliveryPlatformBreakdown: aggregation.deliveryPlatformBreakdown || null,
      },
      dailyBreakdown: aggregation.dailyBreakdown || [],
      filters: tool?.conversationFilters || {},
    },
    vaultPeriod: route?.vaultPeriod || answer.vaultPeriod || null,
  };
}
