/**
 * Ask NAC knowledge-state: per-domain freshness from existing coverage registries.
 * Does not run commercial performance queries.
 */

import { ksaCalendarIso, latestCompletedBusinessDay } from "./calendarCompletion.ts";
import { formatManagerDate } from "./managementPresentation.ts";

export type DomainFreshness = {
  domain: string;
  label: string;
  through: string | null;
  status: "ready" | "stale" | "unavailable" | "partial";
};

const REPORT_LABEL: Record<string, string> = {
  cash_up: "Cash Up",
  reception_daily_report: "Reception",
  daily_logbook: "Operations logbook",
  ccm_reconciliation: "CCM",
  google_review_star_summary: "Reviews",
  google_reviews: "Reviews",
};

export function latestThroughByReport(
  rows: Array<{ reportType?: string; report_type?: string; periodEnd?: string; period_end?: string }>,
): DomainFreshness[] {
  const map = new Map<string, string>();
  for (const row of rows || []) {
    const type = String(row.reportType || row.report_type || "").trim();
    const end = String(row.periodEnd || row.period_end || "").slice(0, 10);
    if (!type || !/^\d{4}-\d{2}-\d{2}$/.test(end)) continue;
    const prev = map.get(type);
    if (!prev || end > prev) map.set(type, end);
  }
  return [...map.entries()].map(([domain, through]) => ({
    domain,
    label: REPORT_LABEL[domain] || domain.replace(/_/g, " "),
    through,
    status: "ready",
  }));
}

export function formatKnowledgeStateAnswer(input: {
  branchId?: string | null;
  vault: DomainFreshness[];
  commerceThrough?: string | null;
  commerceStart?: string | null;
  referenceDate?: Date;
}): string {
  const today = ksaCalendarIso(input.referenceDate || new Date());
  const yesterday = latestCompletedBusinessDay(input.referenceDate || new Date());
  const branch = input.branchId || "this branch";
  const lines: string[] = [`Ask NAC knowledge for ${branch} (not a sales result):`];
  const cash = input.vault.find((d) => d.domain === "cash_up");
  if (cash?.through) {
    lines.push(`Cash Up (authoritative headline sales) is available through ${formatManagerDate(cash.through)}.`);
  } else {
    lines.push("Cash Up (authoritative headline sales): no completed coverage date is registered.");
  }
  if (input.commerceThrough) {
    const span = input.commerceStart
      ? `${formatManagerDate(input.commerceStart)} to ${formatManagerDate(input.commerceThrough)}`
      : formatManagerDate(input.commerceThrough);
    lines.push(`Canonical commerce (order/basket, not headline sales) is available ${span}.`);
  } else {
    lines.push("Canonical commerce coverage is not registered.");
  }
  for (const row of input.vault.filter((d) => d.domain !== "cash_up")) {
    if (row.through) lines.push(`${row.label} through ${formatManagerDate(row.through)}.`);
  }
  lines.push(
    `${formatManagerDate(today)} may still be incomplete; the latest completed business day is ${formatManagerDate(yesterday)}.`,
  );
  return lines.join(" ");
}
