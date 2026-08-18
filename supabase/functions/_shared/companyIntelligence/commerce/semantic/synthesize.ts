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

  if (plan.calculation === "cooccurrence" && plan.seedProduct) {
    const lead = topNames(result.ranking, 3);
    const first = result.ranking?.[0] as { name?: string; lift?: number | null; cohortPenetration?: number | null } | undefined;
    const lift = first?.lift != null ? ` ${first.name} had the strongest lift versus its normal baseline (${first.lift.toFixed(2)}×).` : "";
    return (
      `${plan.seedProduct} appeared on ${result.cohortSize || 0} qualifying ${branch} checks (${period}). `
      + (lead ? `The products most often ordered alongside it were ${lead}.` : "No companion products were found.")
      + lift
      + " This is co-occurrence, not a causal effect."
      + map
    );
  }

  if (plan.calculation === "lift") {
    const lead = topNames(result.ranking, 3);
    return (
      `Among ${result.cohortSize || 0} high-value ${branch} checks (${period}), the products most associated versus baseline were ${lead || "none"}. `
      + "Association is not a causal effect."
      + map
    );
  }

  if (plan.calculation === "attach_rate" && result.unit === "rate") {
    return (
      `Dessert attach rate on food-containing ${branch} checks (${period}) was ${pct(result.value)} `
      + `(${result.numerator} of ${result.denominator}). This is association within food-containing checks, not a causal effect.`
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
