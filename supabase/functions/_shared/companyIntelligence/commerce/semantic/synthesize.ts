/**
 * Manager-facing synthesis from executed semantic commerce evidence.
 */

import type { CommerceQueryPlan } from "./plan.ts";
import type { SemanticExecResult } from "./execute.ts";
import type { ResultValidation } from "./validate.ts";

function pct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "unavailable";
  return `${(v * 100).toFixed(1)}%`;
}

function sar(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "unavailable";
  return `SAR ${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function topNames(ranking: Array<Record<string, unknown>> | undefined, n = 3): string {
  return (ranking || []).slice(0, n).map((r) => String(r.name || r.source_order_id || "")).filter(Boolean).join(", ");
}

export function synthesizeSemanticCommerce(input: {
  question: string;
  plan: CommerceQueryPlan;
  result: SemanticExecResult;
  validation: ResultValidation;
}): string {
  const { plan, result, validation } = input;
  if (!validation.ok && result.ok) {
    return "I could not validate this commerce result confidently, so I am not answering from it. " + validation.warnings.join("; ") + ".";
  }
  if (!result.ok) {
    return result.limitation || "This commerce question cannot be answered from canonical data as requested.";
  }
  const period = result.debug.period
    ? `${result.debug.period.startDate} to ${result.debug.period.endDate}`
    : "the selected period";
  const branch = result.debug.branchId;
  const map = result.mappingNote ? ` ${result.mappingNote}` : "";
  const strength = result.evidenceStrength === "directional"
    ? " Directional only: mapping or cohort size is limited."
    : result.evidenceStrength === "strong_derived"
      ? " Derived from order/item composition, not a causal claim."
      : "";

  if (plan.outputIntent === "diagnostic" && result.diagnostic) {
    const d = result.diagnostic as Record<string, unknown>;
    const movers = Array.isArray(d.movers)
      ? (d.movers as Array<{ name?: string }>).slice(0, 3).map((m) => m.name).filter(Boolean).join(", ")
      : "";
    const buckets = Array.isArray(d.buckets)
      ? (d.buckets as Array<{ name: string; share: number | null }>).map((b) => `${b.name} ${pct(b.share)}`).join("; ")
      : "";
    return (
      `Operational commerce for ${branch} (${period}): ${d.orders} checks, average check ${sar(d.averageCheck as number)}, `
      + `median ${sar(d.medianCheck as number)}, basket ${d.basketSize != null ? Number(d.basketSize).toFixed(2) : "n/a"} items, `
      + `${d.covers} covers. High-spend share ${pct(d.highSpendShare as number)}. `
      + `Dessert-containing ${pct(d.dessertShare as number)}; food-containing ${pct(d.foodShare as number)}. `
      + (buckets ? `Check-size mix: ${buckets}. ` : "")
      + (movers ? `Notable movers/over-index: ${movers}. ` : "")
      + "Headline sales remain Cash Up; this is order/basket evidence only."
      + strength
      + map
    );
  }

  if (plan.calculation === "cooccurrence" && plan.seedProduct) {
    const lead = topNames(result.ranking, 3);
    const first = result.ranking?.[0] as { name?: string; lift?: number | null; cohortPenetration?: number | null } | undefined;
    const lift = first?.lift != null ? ` ${first.name} had the strongest lift versus its normal baseline (${first.lift.toFixed(2)}×).` : "";
    return (
      `${plan.seedProduct} appeared on ${result.cohortSize || 0} qualifying ${branch} checks (${period}). `
      + (lead ? `The products most often ordered alongside it were ${lead}.` : "No companion products were found.")
      + lift
      + " This is co-occurrence, not a causal effect."
      + strength
      + map
    );
  }

  if (plan.calculation === "lift") {
    const lead = topNames(result.ranking, 3);
    return (
      `Among ${result.cohortSize || 0} high-value ${branch} checks (${period}), the products most associated versus baseline were ${lead || "none"}. `
      + "Association is not a causal effect."
      + strength
      + map
    );
  }

  if (plan.calculation === "share_change") {
    const top = (result.ranking || []).slice(0, 3).map((r) => {
      const d = Number(r.deltaShare);
      const sign = d >= 0 ? "+" : "";
      return `${r.name} (${sign}${(d * 100).toFixed(1)} pp)`;
    }).join("; ");
    return `Largest product-share changes for ${branch} (${period}): ${top || "none"}. Association only, not a causal effect.${strength}${map}`;
  }

  if (plan.calculation === "contribution") {
    const lead = topNames(result.ranking, 3);
    return `Products contributing most to the contrast for ${branch} (${period}): ${lead || "none"}. This is association, not a causal effect.${strength}${map}`;
  }

  if (plan.calculation === "spend_buckets") {
    const parts = (result.ranking || []).map((r) => `${r.name} ${pct(Number(r.share))}`).join("; ");
    return `Check-size distribution for ${branch} (${period}): ${parts || "none"}.${strength}${map}`;
  }

  if (plan.calculation === "percentile") {
    const med = result.ranking?.find((r) => r.name === "median");
    const p90 = result.ranking?.find((r) => r.name === "p90");
    return `For ${branch} (${period}), median check was ${sar(Number(med?.net_sales))} and 90th percentile was ${sar(Number(p90?.net_sales))} (${result.cohortSize} checks).${strength}${map}`;
  }

  if (plan.calculation === "pairs") {
    const lead = (result.ranking || []).slice(0, 3).map((r) => `${r.name}`).join("; ");
    return `Strongest product pairs for ${branch} (${period}): ${lead || "none"}. Lift is versus independent baseline frequency, not causation.${strength}${map}`;
  }

  if (plan.calculation === "attach_rate" && result.unit === "rate") {
    return (
      `Dessert attach rate on food-containing ${branch} checks (${period}) was ${pct(result.value)} `
      + `(${result.numerator} of ${result.denominator}). This is association within food-containing checks, not a causal effect.`
      + strength
      + map
    );
  }

  if (plan.calculation === "penetration" && result.unit === "rate") {
    return `${pct(result.value)} of ${result.denominator} ${branch} checks (${period}) matched the requested cohort (${result.numerator} checks).${map}`;
  }

  if (result.comparison) {
    const c = result.comparison;
    return (
      `${c.aLabel} ${formatValue(plan.metric, c.aValue)} versus ${c.bLabel} ${formatValue(plan.metric, c.bValue)} `
      + `for ${branch} (${period}; ${result.cohortSize} vs ${result.baselineSize} checks). `
      + "This is an association, not a causal effect."
      + map
    );
  }

  if (plan.outputIntent === "ranking" && plan.entity === "orders") {
    const top = (result.ranking || []).slice(0, 5).map((r) => `${r.business_date} ${sar(Number(r.net_sales))}`).join("; ");
    return `Largest ${branch} checks (${period}): ${top || "none"}.${map}`;
  }

  if (plan.outputIntent === "ranking") {
    const lead = (result.ranking || []).slice(0, 5)
      .map((r) => `${r.name} (${r.quantity != null ? r.quantity : r.orders})`)
      .join("; ");
    return `Top products for ${branch} (${period}): ${lead || "none"}.${map}`;
  }

  if (plan.cohort?.kind === "has_family" && plan.compareCohort?.kind === "not_has_family") {
    return `${result.value} ${branch} completed checks (${period}) had ${plan.cohort.value} but no ${plan.compareCohort.value}.${map}`;
  }
  if (result.unit === "rate") return `${pct(result.value)} for ${branch} ${period}.${map}`;
  if (result.unit === "SAR") return `${sar(result.value)} average/check metric for ${branch} ${period} (${result.cohortSize} checks).${map}`;
  return `${result.label || plan.metric} was ${result.value} for ${branch} ${period} (${result.cohortSize} qualifying checks).${map}`;
}

function formatValue(metric: string, value: number | null): string {
  if (/check|sales|revenue|spend/.test(metric) || metric === "basket_item_count") {
    if (metric === "basket_item_count") return value == null ? "unavailable" : `${value.toFixed(2)} items`;
    return sar(value);
  }
  if (/rate|share|penetration|attach/.test(metric)) return pct(value);
  return value == null ? "unavailable" : String(Number(value.toFixed(2)));
}
