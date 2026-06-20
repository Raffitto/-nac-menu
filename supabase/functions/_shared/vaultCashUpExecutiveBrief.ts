/**
 * Deterministic Executive Brief for cash-up (vault_cash_up_summary) responses.
 */

import {
  buildSalesPerformanceExecutiveSummary,
  hasReconciliationData,
} from "./vaultSalesPerformanceIntelligence.ts";

function pickMetricValue(facts: Record<string, unknown>[], metricKey: string) {
  const hit = (facts || []).find(
    (f) => (f.metricKey || f.metric_key) === metricKey && (f.metricValue ?? f.metric_value) != null,
  );
  return hit ? (hit.metricValue ?? hit.metric_value) : null;
}

function formatNumber(value: unknown) {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (Number.isFinite(n)) return n.toLocaleString();
  return String(value);
}

function formatCurrency(value: unknown) {
  const formatted = formatNumber(value);
  return formatted != null ? `${formatted} SAR` : null;
}

function resolveBusinessDate(facts: Record<string, unknown>[], businessDate?: string | null) {
  if (businessDate) return String(businessDate);
  const row = facts[0];
  return (row?.periodEnd || row?.period_end) as string | null;
}

function formatCardCashSettlementShare(card: unknown, cash: unknown) {
  const settlementTotal = Number(card) + Number(cash);
  if (!Number.isFinite(settlementTotal) || settlementTotal <= 0) return null;
  const cardShare = ((Number(card) / settlementTotal) * 100).toFixed(1);
  return {
    cardShare,
    keyFinding: `Card sales ${formatCurrency(card)} and cash ${formatCurrency(cash)} — card represented ${cardShare}% of recorded card/cash settlement.`,
    summaryNote: ` Card sales represented ${cardShare}% of recorded card/cash settlement.`,
  };
}

function buildGrossNetKeyFinding(
  gross: unknown,
  net: unknown,
  facts: Record<string, unknown>[],
) {
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

function filterFactSupportedActions(
  actions: string[] = [],
  facts: Record<string, unknown>[] = [],
  executive: Record<string, unknown> = {},
) {
  const target = pickMetricValue(facts, "target_sales");
  const guests = pickMetricValue(facts, "guest_count");
  const avgSpend = pickMetricValue(facts, "avg_per_guest");
  const card = pickMetricValue(facts, "card_sales");
  const cash = pickMetricValue(facts, "cash_sales");
  const paymentMix = executive.paymentMix as unknown[] | undefined;
  const deliveryPerformance = executive.deliveryPerformance as unknown[] | undefined;
  const budget = executive.budget as Record<string, unknown> | null | undefined;
  const hasPaymentMix = Boolean(paymentMix?.length);
  const hasCardCash = card != null && cash != null;
  const hasDelivery = Boolean(deliveryPerformance?.length);
  const hasReconciliation = hasReconciliationData(facts);

  return actions.filter((action) => {
    const lower = String(action || "").toLowerCase();
    if (!lower.trim()) return false;

    if (/\bbudget\b|\btarget\b|\bdaypart\b|\bstaffing\b/.test(lower)) {
      return target != null && budget != null;
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

function buildDataSources({
  fileTitle,
  businessDate,
  vaultSources = [],
  executiveSource,
}: {
  fileTitle?: string | null;
  businessDate?: string | null;
  vaultSources?: Record<string, unknown>[];
  executiveSource?: string;
}) {
  const lines: string[] = [];
  const seen = new Set<string>();

  const push = (line: string) => {
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
    const vsTitle = String(vs?.title || vs?.fileTitle || "");
    if (!vsTitle) continue;
    const period = vs.periodEnd || vs.period_end || businessDate;
    push(`${vsTitle}${period ? ` · ${period}` : ""} · ${vs.reportType || vs.report_type || "cash_up"}`);
  }

  return lines.slice(0, 5);
}

export type CashUpExecutiveBrief = {
  executiveSummary: string;
  keyFindings: string[];
  operationalRisks: string[];
  recommendedActions: string[];
  dataSources: string[];
};

export function buildCashUpExecutiveBrief({
  facts = [],
  branchLabel = "Network",
  periodLabel = "the period",
  businessDate = null,
  fileTitle = null,
  vaultSources = [],
  coverage = [],
  question = "",
}: {
  facts?: Record<string, unknown>[];
  branchLabel?: string;
  periodLabel?: string;
  businessDate?: string | null;
  fileTitle?: string | null;
  vaultSources?: Record<string, unknown>[];
  coverage?: Record<string, unknown>[];
  question?: string;
} = {}): CashUpExecutiveBrief {
  const resolvedDate = resolveBusinessDate(facts, businessDate);
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

  const keyFindings: string[] = [];

  if (net != null) {
    keyFindings.push(`Net sales ${formatCurrency(net)} for ${branchLabel} on ${periodLabel}.`);
  }
  if (gross != null && net != null && Number(gross) !== Number(net)) {
    keyFindings.push(buildGrossNetKeyFinding(gross, net, facts));
  }
  if (settlementShare) {
    keyFindings.push(settlementShare.keyFinding);
  } else if (executive.paymentMix.length) {
    keyFindings.push(
      `Payment mix lead: ${executive.paymentMix[0].method} (${formatCurrency(executive.paymentMix[0].value)}).`,
    );
  }
  if (guests != null) {
    keyFindings.push(`Guest count ${formatNumber(guests)}.`);
  }
  if (executive.budget) {
    keyFindings.push(
      executive.budget.met
        ? `Budget achievement ${executive.budget.pct.toFixed(1)}% of target.`
        : `Budget gap ${formatCurrency(Math.abs(executive.budget.gap))} below target (${executive.budget.pct.toFixed(1)}%).`,
    );
  }
  for (const row of executive.performanceBreakdown.slice(0, 2)) {
    keyFindings.push(`${row.label}: ${row.value}${row.unit ? ` ${row.unit}` : ""}.`);
  }

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

  let executiveSummary: string;
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
    keyFindings: keyFindings.slice(0, 8),
    operationalRisks: operationalRisks.slice(0, 6),
    recommendedActions: recommendedActions.slice(0, 6),
    dataSources,
  };
}
