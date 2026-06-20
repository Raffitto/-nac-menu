/**
 * Deterministic Executive Brief for cash-up (vault_cash_up_summary) responses.
 * Additive contract layer — does not replace directAnswer / keyMetrics.
 */

import {
  buildSalesPerformanceExecutiveSummary,
  hasReconciliationData,
} from "./vaultSalesPerformanceIntelligence";

function pickMetricValue(facts, metricKey) {
  const hit = (facts || []).find(
    (f) => (f.metricKey || f.metric_key) === metricKey && (f.metricValue ?? f.metric_value) != null,
  );
  return hit ? (hit.metricValue ?? hit.metric_value) : null;
}

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

function resolveBusinessDate(facts = [], tool = {}) {
  const fromTool = tool?.startDate || tool?.periodEnd || tool?.businessDate;
  if (fromTool) return String(fromTool);
  const row = facts[0];
  return row?.periodEnd || row?.period_end || null;
}

function formatCardCashSettlementShare(card, cash) {
  const settlementTotal = Number(card) + Number(cash);
  if (!Number.isFinite(settlementTotal) || settlementTotal <= 0) return null;
  const cardShare = ((Number(card) / settlementTotal) * 100).toFixed(1);
  return {
    cardShare,
    settlementTotal,
    keyFinding: `Electronic payments ${formatCurrency(card)} and cash ${formatCurrency(cash)} — electronic payments represented ${cardShare}% of recorded card/cash settlement.`,
    summaryNote: ` Electronic payments represented ${cardShare}% of recorded card/cash settlement.`,
  };
}

const KEY_FINDING_PRIORITY = Object.freeze({
  revenue_concentration: 10,
  payment_mix: 20,
  budget: 30,
  delivery: 40,
  guest_count: 50,
  net_sales: 60,
  gross_net: 70,
  performance_breakdown: 80,
});

function rankKeyFindings(entries = []) {
  return entries
    .filter((entry) => String(entry.text || "").trim())
    .sort((a, b) => a.priority - b.priority || String(a.text).localeCompare(String(b.text)))
    .map((entry) => entry.text)
    .slice(0, 8);
}

function buildRevenueConcentrationFinding(gross, dayparts = []) {
  if (gross == null || !dayparts.length) return null;
  const top = [...dayparts].sort((a, b) => Number(b.value) - Number(a.value))[0];
  if (!top?.value) return null;
  const pct = ((Number(top.value) / Number(gross)) * 100).toFixed(0);
  return `${top.label} generated ${formatCurrency(top.value)} and contributed ${pct}% of gross sales.`;
}

function buildGrossNetKeyFinding(gross, net, facts) {
  const discounts = pickMetricValue(facts, "discounts");
  const voids = pickMetricValue(facts, "voids");
  const parts = [`Gross sales were ${formatCurrency(gross)} and net sales were ${formatCurrency(net)}.`];

  if (discounts != null) {
    parts.push(`Recorded discounts: ${formatCurrency(discounts)}.`);
  }
  if (voids != null) {
    parts.push(`Recorded voids: ${formatCurrency(voids)}.`);
  }

  return parts.join(" ");
}

function filterFactSupportedActions(actions = [], facts = [], executive = {}) {
  const target = pickMetricValue(facts, "target_sales");
  const guests = pickMetricValue(facts, "guest_count");
  const avgSpend = pickMetricValue(facts, "avg_per_guest");
  const card = pickMetricValue(facts, "card_sales");
  const cash = pickMetricValue(facts, "cash_sales");
  const hasPaymentMix = Boolean(executive.paymentMix?.length);
  const hasCardCash = card != null && cash != null;
  const hasDelivery = Boolean(executive.deliveryPerformance?.length);
  const hasReconciliation = hasReconciliationData(facts);

  return actions.filter((action) => {
    const lower = String(action || "").toLowerCase();
    if (!lower.trim()) return false;

    if (/\bbudget\b|\btarget\b|\bdaypart\b|\bstaffing\b/.test(lower)) {
      return target != null && executive.budget != null;
    }
    if (/\bguest count\b|\baverage spend\b|\bavg spend\b/.test(lower)) {
      return guests != null || avgSpend != null;
    }
    if (/\bcard\/digital mix\b|\bbank settlement\b|\bccm\b/.test(lower)) {
      return hasPaymentMix || hasCardCash;
    }
    if (/\bdelivery\b|\bcommission\b/.test(lower)) {
      return hasDelivery;
    }
    if (/\breconciliation\b/.test(lower)) {
      return hasReconciliation;
    }
    if (/\bmonitoring\b|\bcontinue\b/.test(lower)) {
      return false;
    }
    return false;
  });
}

function buildDataSources({ fileTitle, businessDate, vaultSources = [], executiveSource }) {
  const lines = [];
  const seen = new Set();

  const push = (line) => {
    const text = String(line || "").trim();
    if (!text || seen.has(text)) return;
    seen.add(text);
    lines.push(text);
  };

  const title = fileTitle || executiveSource;
  if (title) {
    push(`${title}${businessDate ? ` · ${businessDate}` : ""} · cash_up`);
  }

  for (const vs of vaultSources) {
    const vsTitle = vs?.title || vs?.fileTitle;
    if (!vsTitle) continue;
    const period = vs.periodEnd || vs.period_end || businessDate;
    push(`${vsTitle}${period ? ` · ${period}` : ""} · ${vs.reportType || vs.report_type || "cash_up"}`);
  }

  return lines.slice(0, 5);
}

/**
 * @param {object} input
 * @param {object[]} input.facts Verified cash-up structured facts only
 * @param {string} [input.branchLabel]
 * @param {string} [input.periodLabel]
 * @param {string} [input.businessDate]
 * @param {string|null} [input.fileTitle]
 * @param {object[]} [input.vaultSources]
 * @param {object[]} [input.coverage]
 * @param {string} [input.question]
 * @returns {{ executiveSummary: string, keyFindings: string[], operationalRisks: string[], recommendedActions: string[], dataSources: string[] }}
 */
export function buildCashUpExecutiveBrief({
  facts = [],
  branchLabel = "Network",
  periodLabel = "the period",
  businessDate = null,
  fileTitle = null,
  vaultSources = [],
  coverage = [],
  question = "",
} = {}) {
  const resolvedDate = businessDate || resolveBusinessDate(facts, { startDate: businessDate });
  const executive = buildSalesPerformanceExecutiveSummary(facts, {
    branchLabel,
    periodLabel,
    fileTitle,
    question,
  });

  const gross = pickMetricValue(facts, "gross_sales") ?? pickMetricValue(facts, "total_sales");
  const net = pickMetricValue(facts, "net_sales") ?? pickMetricValue(facts, "total_sales");
  const cash = pickMetricValue(facts, "cash_sales");
  const card = pickMetricValue(facts, "card_sales");
  const guests = pickMetricValue(facts, "guest_count");
  const settlementShare = card != null && cash != null ? formatCardCashSettlementShare(card, cash) : null;

  const rankedFindings = [];

  const revenueConcentration = buildRevenueConcentrationFinding(gross, executive.dayparts);
  if (revenueConcentration) {
    rankedFindings.push({ priority: KEY_FINDING_PRIORITY.revenue_concentration, text: revenueConcentration });
  }

  if (settlementShare) {
    rankedFindings.push({ priority: KEY_FINDING_PRIORITY.payment_mix, text: settlementShare.keyFinding });
  } else if (executive.paymentMix.length) {
    rankedFindings.push({
      priority: KEY_FINDING_PRIORITY.payment_mix,
      text: `Payment mix lead: ${executive.paymentMix[0].method} (${formatCurrency(executive.paymentMix[0].value)}).`,
    });
  }

  if (executive.budget) {
    rankedFindings.push({
      priority: KEY_FINDING_PRIORITY.budget,
      text: executive.budget.met
        ? `Budget achievement ${executive.budget.pct.toFixed(1)}% of target.`
        : `Budget gap ${formatCurrency(Math.abs(executive.budget.gap))} below target (${executive.budget.pct.toFixed(1)}%).`,
    });
  }

  for (const row of executive.performanceBreakdown.filter((item) => item.section === "delivery").slice(0, 1)) {
    rankedFindings.push({
      priority: KEY_FINDING_PRIORITY.delivery,
      text: `${row.label}: ${row.value}${row.unit ? ` ${row.unit}` : ""}.`,
    });
  }

  if (net != null) {
    rankedFindings.push({
      priority: KEY_FINDING_PRIORITY.net_sales,
      text: `Net sales ${formatCurrency(net)} for ${branchLabel} on ${periodLabel}.`,
    });
  }

  if (gross != null && net != null && Number(gross) !== Number(net)) {
    rankedFindings.push({
      priority: KEY_FINDING_PRIORITY.gross_net,
      text: buildGrossNetKeyFinding(gross, net, facts),
    });
  }

  if (guests != null) {
    rankedFindings.push({
      priority: KEY_FINDING_PRIORITY.guest_count,
      text: `Guest count ${formatNumber(guests)}.`,
    });
  }

  for (const row of executive.performanceBreakdown
    .filter((item) => item.section !== "delivery")
    .slice(0, 1)) {
    rankedFindings.push({
      priority: KEY_FINDING_PRIORITY.performance_breakdown,
      text: `${row.label}: ${row.value}${row.unit ? ` ${row.unit}` : ""}.`,
    });
  }

  const keyFindings = rankKeyFindings(rankedFindings);

  const operationalRisks = [...(executive.risks || [])];
  const partialCoverage = (coverage || []).some(
    (row) => row.readinessStatus === "partial" || row.readiness_status === "partial",
  );
  if (partialCoverage) {
    operationalRisks.push("Coverage marked partial — treat as uploaded-file snapshot, not final close.");
  }
  if (executive.missingFields.length) {
    operationalRisks.push(`Missing parsed fields: ${executive.missingFields.join(", ")}.`);
  }

  const recommendedActions = filterFactSupportedActions(executive.actions || [], facts, executive);

  const dataSources = buildDataSources({
    fileTitle,
    businessDate: resolvedDate,
    vaultSources,
    executiveSource: executive.source,
  });

  let executiveSummary;
  if (net != null) {
    const datePhrase = resolvedDate || periodLabel;
    const settlementNote = settlementShare?.summaryNote || "";
    executiveSummary =
      `${branchLabel} cash-up for ${datePhrase} shows net sales of ${formatCurrency(net)}` +
      (gross != null && Number(gross) !== Number(net)
        ? ` (gross ${formatCurrency(gross)}).`
        : ".") +
      settlementNote;
  } else {
    executiveSummary = executive.answer;
  }

  return {
    executiveSummary: executiveSummary.trim(),
    keyFindings,
    operationalRisks: operationalRisks.slice(0, 6),
    recommendedActions: recommendedActions.slice(0, 6),
    dataSources,
  };
}
