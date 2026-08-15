/**
 * Manager-facing commerce synthesis. Percentage-point first for mix/conversion.
 * Does not invent guest counts when covers are missing.
 */

import { ARCHETYPE_LABELS } from "./archetypes.ts";
import { averageCheck, itemMix } from "./metrics.ts";
import { dataUsedAnswer, freshnessAnswer, trustAnswer, type EvidenceSummary } from "./lineage.ts";
import type { SalesReconciliation } from "./reconciliation.ts";
import type { CommerceFocus, MixComparison, ServiceMixResult, TableArchetype } from "./types.ts";
import type { CommerceQuality } from "./quality.ts";

export function formatShare(share: number | null): string {
  if (share == null) return "unavailable";
  return `${(share * 100).toFixed(1)}%`;
}

export function formatPp(pp: number | null): string | null {
  if (pp == null) return null;
  const abs = Math.abs(pp).toFixed(1);
  if (Math.abs(pp) < 0.05) return "unchanged in percentage-point terms";
  return pp > 0 ? `up ${abs} percentage points` : `down ${abs} percentage points`;
}

export function mixAnswer(mix: ServiceMixResult, sessionNoun = "dine-in table sessions"): string {
  const guestCaveat = mix.coversAvailable
    ? ""
    : " These figures are table sessions, not guest counts.";
  return (
    `For ${mix.branchId} ${mix.periodStart} to ${mix.periodEnd}, dessert-focused ${sessionNoun} were ${formatShare(mix.dessertFocusedShare)}`
    + ` and food-containing sessions were ${formatShare(mix.foodContainingShare)}.`
    + ` Full-service share was ${formatShare(mix.fullServiceShare)}; dessert conversion was ${formatShare(mix.dessertConversion)}.`
    + ` Source: ${mix.source} through ${mix.completedThrough || mix.periodEnd}.`
    + guestCaveat
  );
}

export function mixComparisonAnswer(cmp: MixComparison): string {
  const pp = formatPp(cmp.dessertFocusedPp);
  const food = formatPp(cmp.foodContainingPp);
  return (
    `Dessert-focused share was ${formatShare(cmp.current.dessertFocusedShare)} versus ${formatShare(cmp.previous.dessertFocusedShare)}`
    + (pp ? ` (${pp})` : "")
    + `. Food-containing share was ${formatShare(cmp.current.foodContainingShare)} versus ${formatShare(cmp.previous.foodContainingShare)}`
    + (food ? ` (${food})` : "")
    + "."
  );
}

export function conversionAnswer(mix: ServiceMixResult): string {
  return `Dessert conversion — food-containing sessions that also ordered dessert — was ${formatShare(mix.dessertConversion)} for ${mix.branchId} ${mix.periodStart} to ${mix.periodEnd}. This is not dessert-focused table share.`;
}

export function checkByTypeAnswer(mix: ServiceMixResult): string {
  const rows = (Object.keys(mix.byArchetype) as TableArchetype[])
    .filter((k) => mix.byArchetype[k].sessions > 0)
    .map((k) => {
      const avg = averageCheck(mix.byArchetype[k]);
      return `${ARCHETYPE_LABELS[k]} SAR ${avg != null ? avg.toFixed(2) : "—"}`;
    });
  return `Average check by table type: ${rows.join("; ")}.`;
}

export function missingSessionEvidenceAnswer(): string {
  return (
    "Canonical dine-in session evidence is not available yet. "
    + "Cash Up remains the headline sales source. "
    + "Current Foodics exports are Sales by Creator and Menu Engineering period aggregates, which cannot reconstruct table baskets or archetypes."
  );
}

export type PublishedCommerce = {
  mix: ServiceMixResult;
  comparison?: MixComparison | null;
  itemMix?: ReturnType<typeof itemMix>;
  evidence?: EvidenceSummary | null;
  health?: {
    dataThrough: string | null;
    lastIngestAt: string | null;
    status: string;
    ordersStatus?: string;
    itemsStatus?: string;
    publicationStatus?: string;
    mappingQuality?: number | null;
    quality?: CommerceQuality | null;
    error?: string | null;
  } | null;
  reconciliation?: SalesReconciliation | null;
};

export function dessertFocusedAnswer(mix: ServiceMixResult): string {
  return (
    `Dessert tables (dessert-focused sessions: dessert-only plus dessert-and-coffee, excluding full-service) were ${formatShare(mix.dessertFocusedShare)} `
    + `of ${mix.totalSessions} completed dine-in sessions for ${mix.branchId} ${mix.periodStart} to ${mix.periodEnd}.`
  );
}

export function foodContainingAnswer(mix: ServiceMixResult): string {
  return (
    `Food tables (food-containing sessions) were ${formatShare(mix.foodContainingShare)} `
    + `of ${mix.totalSessions} completed dine-in sessions for ${mix.branchId} ${mix.periodStart} to ${mix.periodEnd}.`
  );
}

export function dessertAtAllAnswer(mix: ServiceMixResult): string {
  return (
    `Tables that ordered dessert at all — dessert-focused plus full-service — were ${formatShare(mix.dessertAtAllShare)}. `
    + `This is not dessert-focused table share.`
  );
}

export function guestWeightedAnswer(mix: ServiceMixResult): string {
  if (!mix.coversAvailable || mix.guestWeightedDessertFocusedShare == null) {
    return "Guest-weighted mix is unavailable because covers are incomplete.";
  }
  return (
    `${formatShare(mix.guestWeightedDessertFocusedShare)} of dine-in guests were seated in dessert-focused table sessions `
    + `(${mix.totalCovers} covers). This does not mean every guest personally ordered dessert.`
  );
}

export function attentionAnswer(mix: ServiceMixResult, cmp?: MixComparison | null): string {
  const parts = [
    `Dessert-focused share is ${formatShare(mix.dessertFocusedShare)}; food-containing share is ${formatShare(mix.foodContainingShare)}.`,
  ];
  if (cmp) {
    const pp = formatPp(cmp.foodContainingPp);
    if (pp) parts.push(`Food-containing share is ${pp} versus the comparable prior period.`);
  }
  parts.push(
    "The measurable opportunities are food-intent traffic and food-session penetration. "
    + "Areas worth investigating include food-focused acquisition, reception positioning, menu presentation, and staff food upselling. "
    + "This does not claim those caused any sales gap.",
  );
  return parts.join(" ");
}

export function reconciliationAnswer(row: SalesReconciliation | null | undefined): string {
  if (!row || row.coverage === "missing" || row.coverage === "foodics_only") {
    return (
      "Cash Up remains the headline sales authority. Foodics commerce is the order/session/basket authority. "
      + "A paired Cash Up net_sales row was not available for this comparison window."
    );
  }
  if (row.coverage === "cash_up_only") {
    return (
      `Cash Up net sales are ${row.cashUpSales}. Foodics completed-order totals were not paired for ${row.businessDate}. `
      + "These sources are not interchangeable."
    );
  }
  const cash = row.cashUpSales != null ? row.cashUpSales.toFixed(2) : "n/a";
  const foodics = row.foodicsSales != null ? row.foodicsSales.toFixed(2) : "n/a";
  const delta = row.absoluteDifference != null ? row.absoluteDifference.toFixed(2) : "n/a";
  const pct = row.percentageDifference != null ? `${row.percentageDifference.toFixed(2)}%` : "n/a";
  return (
    `Sales differ because they measure different things. Cash Up (headline management authority) is ${cash}. `
    + `Foodics completed-order subtotal (ex-VAT comparison basis) is ${foodics} `
    + `(delta ${delta}, ${pct}). `
    + (row.foodicsIncVat != null ? `Foodics tax-inclusive check total is ${row.foodicsIncVat.toFixed(2)}. ` : "")
    + `${row.note} Health: ${row.health}.`
  );
}

export function answerPublishedCommerce(focus: CommerceFocus, published: PublishedCommerce): string {
  const mix = published.mix;
  if (focus === "data_used" && published.evidence) return dataUsedAnswer(published.evidence);
  if (focus === "trust" && published.evidence) return trustAnswer(published.evidence);
  if (focus === "reconciliation") return reconciliationAnswer(published.reconciliation);
  if ((focus === "health" || focus === "freshness") && published.health) {
    return freshnessAnswer({ ...published.health, quality: published.health.quality || published.evidence?.quality || null });
  }
  if (focus === "full_service") {
    const avg = averageCheck(mix.byArchetype.full_service);
    return (
      `Full-service average check was ${avg != null ? `SAR ${avg.toFixed(2)}` : "unavailable"} `
      + `across ${mix.byArchetype.full_service.sessions} sessions `
      + `(${formatShare(mix.fullServiceShare)} of ${mix.totalSessions} completed dine-in sessions) `
      + `for ${mix.branchId} ${mix.periodStart} to ${mix.periodEnd}.`
    );
  }
  if (focus === "dessert_focused") return dessertFocusedAnswer(mix);
  if (focus === "food_containing") return foodContainingAnswer(mix);
  if (focus === "dessert_conversion") return conversionAnswer(mix);
  if (focus === "basket") return dessertAtAllAnswer(mix);
  if (focus === "guest_weighted") return guestWeightedAnswer(mix);
  if (focus === "attention") return attentionAnswer(mix, published.comparison);
  if (focus === "item_mix" || focus === "rank_items") {
    const rows = (published.itemMix || []).slice(0, 5).map((r) => `${r.name} (${r.family})`);
    return rows.length
      ? `Top items from published commerce sessions: ${rows.join("; ")}.`
      : "Item mix is not published yet.";
  }
  if ((focus === "session_mix" || focus === "full_service" || focus === "coffee_only") && published.comparison) {
    return `${mixAnswer(mix)} ${mixComparisonAnswer(published.comparison)}`;
  }
  return mixAnswer(mix);
}

export function highestCheckAnswer(mix: ServiceMixResult): string {
  const rows = (Object.keys(mix.byArchetype) as TableArchetype[])
    .filter((k) => mix.byArchetype[k].sessions > 0)
    .map((k) => ({ k, avg: averageCheck(mix.byArchetype[k]) }))
    .filter((r) => r.avg != null)
    .sort((a, b) => (b.avg || 0) - (a.avg || 0));
  if (!rows.length) return "Average check by table type is unavailable.";
  return `Highest average check is ${ARCHETYPE_LABELS[rows[0].k]} at SAR ${rows[0].avg!.toFixed(2)}.`;
}
