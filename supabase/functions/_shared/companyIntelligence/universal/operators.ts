/**
 * Deterministic cross-domain operators. No LLM SQL.
 */

import type { UniversalEvidence } from "./plan.ts";

export function overlapPeriod(
  a: { startDate?: string | null; endDate?: string | null } | null | undefined,
  b: { startDate?: string | null; endDate?: string | null } | null | undefined,
): { startDate: string; endDate: string } | null {
  if (!a?.startDate || !a.endDate || !b?.startDate || !b.endDate) return null;
  const start = a.startDate > b.startDate ? a.startDate : b.startDate;
  const end = a.endDate < b.endDate ? a.endDate : b.endDate;
  if (start > end) return null;
  return { startDate: start, endDate: end };
}

export function alignEvidencePeriods(rows: UniversalEvidence[]): {
  overlap: { startDate: string; endDate: string } | null;
  incomplete: DomainIdLike[];
} {
  const dated = rows.filter((r) => r.period?.startDate && r.period.endDate && !r.skipped);
  let overlap: { startDate: string; endDate: string } | null = dated[0]?.period
    ? { startDate: dated[0].period.startDate, endDate: dated[0].period.endDate }
    : null;
  for (const row of dated.slice(1)) {
    overlap = overlapPeriod(overlap, row.period);
    if (!overlap) break;
  }
  const incomplete = rows.filter((r) => !r.skipped && r.period && overlap && overlapPeriod(r.period, overlap) == null)
    .map((r) => r.domain);
  return { overlap, incomplete };
}

type DomainIdLike = UniversalEvidence["domain"];

export function detectSourceConflicts(rows: UniversalEvidence[]): Array<{
  kind: "sales_definition";
  cashUp?: UniversalEvidence;
  commerce?: UniversalEvidence;
  statement: string;
}> {
  const cash = rows.find((r) => r.domain === "cash_up" && r.metric === "net_sales" && typeof r.value === "number");
  const commerceCheck = rows.find((r) => r.domain === "commerce" && /check_total|order_sales|net_sales/.test(r.metric) && typeof r.value === "number");
  const cashDelta = rows.find((r) => r.domain === "cash_up" && r.metric === "delta_pct" && typeof r.value === "number");
  const out: Array<{ kind: "sales_definition"; cashUp?: UniversalEvidence; commerce?: UniversalEvidence; statement: string }> = [];
  if (cash && commerceCheck && Number(cash.value) && Number(commerceCheck.value)) {
    const a = Number(cash.value);
    const b = Number(commerceCheck.value);
    if (a > 0 && Math.abs(a - b) / a > 0.08) {
      out.push({
        kind: "sales_definition",
        cashUp: cash,
        commerce: commerceCheck,
        statement: "Management sales authority (Cash Up) and Foodics check totals differ. They are not averaged. Cash Up remains headline sales; commerce remains basket/order evidence.",
      });
    }
  }
  if (cashDelta && typeof cashDelta.value === "number" && cashDelta.value < -1) {
    const commerceUp = rows.find((r) => r.domain === "commerce" && r.metric === "average_check" && typeof r.value === "number");
    if (commerceUp) {
      out.push({
        kind: "sales_definition",
        cashUp: cashDelta,
        commerce: commerceUp,
        statement: "Cash Up reports weaker management sales while commerce check/basket evidence may move differently. Definitions and scope are not interchangeable.",
      });
    }
  }
  return out;
}

export function decomposeDrivers(rows: UniversalEvidence[]): Array<{ driver: string; evidence: string; direction: string }> {
  const salesDelta = rows.find((r) => r.domain === "cash_up" && r.metric === "delta_pct");
  const covers = rows.find((r) => r.domain === "cash_up" && r.metric === "covers");
  const avg = rows.find((r) => r.domain === "cash_up" && r.metric === "avg_spend")
    || rows.find((r) => r.domain === "commerce" && r.metric === "average_check");
  const drivers: Array<{ driver: string; evidence: string; direction: string }> = [];
  if (salesDelta && typeof salesDelta.value === "number") {
    drivers.push({
      driver: "headline_sales",
      evidence: "cash_up",
      direction: salesDelta.value < 0 ? "down" : salesDelta.value > 0 ? "up" : "flat",
    });
  }
  if (covers && typeof covers.value === "number") {
    drivers.push({ driver: "covers", evidence: "cash_up", direction: "observed" });
  }
  if (avg && typeof avg.value === "number") {
    drivers.push({ driver: "average_spend_or_check", evidence: avg.domain, direction: "observed" });
  }
  const mix = rows.find((r) => r.domain === "commerce" && (r.metric === "diagnostic" || r.text));
  if (mix) drivers.push({ driver: "basket_mix", evidence: "commerce", direction: "associated" });
  return drivers;
}

export function scoreOpportunities(rows: UniversalEvidence[]): Array<{
  title: string;
  rationale: string;
  legs: string[];
  confidence: "directional" | "strong_derived";
}> {
  const out: Array<{ title: string; rationale: string; legs: string[]; confidence: "directional" | "strong_derived" }> = [];
  const dessert = rows.find((r) => /dessert/i.test(String(r.text || r.metric)));
  const salesDelta = rows.find((r) => r.domain === "cash_up" && r.metric === "delta_pct" && typeof r.value === "number");
  const covers = rows.find((r) => r.domain === "cash_up" && r.metric === "covers");
  const reviews = rows.find((r) => r.domain === "reviews" && !r.skipped);
  if (salesDelta && typeof salesDelta.value === "number" && salesDelta.value < 0 && covers) {
    out.push({
      title: "Reconcile volume vs spend",
      rationale: "Evidence suggests covers and headline sales are not moving together; mix and average check are the likely management focus.",
      legs: ["cash_up", "commerce"],
      confidence: "strong_derived",
    });
  }
  if (dessert) {
    out.push({
      title: "Dessert mix / attach",
      rationale: "Commerce evidence associated dessert behavior with check composition. Opportunity appears to be attach and mix, not a proven causal lift.",
      legs: ["commerce"],
      confidence: "directional",
    });
  }
  if (reviews) {
    out.push({
      title: "Guest-feedback overlay",
      rationale: "Review-star volume can be aligned to the same dates as performance. Treat any overlap as association only.",
      legs: ["reviews", "cash_up"],
      confidence: "directional",
    });
  }
  if (!out.length && rows.some((r) => r.domain === "commerce" && !r.skipped)) {
    out.push({
      title: "Basket and high-spend mix",
      rationale: "Canonical commerce shows mix and check-size structure that management can inspect against Cash Up sales.",
      legs: ["commerce", "cash_up"],
      confidence: "directional",
    });
  }
  return out.slice(0, 3);
}

export function weightEvidence(row: UniversalEvidence): number {
  let w = row.domain === "cash_up" && row.metric === "net_sales" ? 5 : 3;
  if (row.quality === "strong_direct") w += 2;
  if (row.quality === "strong_derived") w += 1;
  if (row.quality === "unavailable" || row.skipped) w = 0;
  return w;
}
