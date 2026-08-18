import type { SemanticExecResult } from "./execute.ts";
import type { CommerceQueryPlan } from "./plan.ts";

export type ResultValidation = { ok: boolean; warnings: string[] };

export function validateSemanticResult(plan: CommerceQueryPlan, result: SemanticExecResult): ResultValidation {
  const warnings: string[] = [];
  if (!result.ok) return { ok: false, warnings: [result.limitation || "execution_failed"] };
  if (result.numerator != null && result.denominator != null && result.numerator > result.denominator) {
    warnings.push("numerator_exceeds_denominator");
  }
  if (result.value != null && result.unit === "rate" && (result.value < 0 || result.value > 1.0001)) {
    warnings.push("rate_out_of_bounds");
  }
  if (result.denominator === 0) warnings.push("divide_by_zero_protected");
  if (result.comparison && result.comparison.causal !== false) warnings.push("causal_flag_required");
  if (result.debug.branchId && plan.filters.some((f) => f.field === "branch" && f.value && f.value !== result.debug.branchId)) {
    warnings.push("branch_scope_mismatch");
  }
  if (result.ranking && plan.ranking && result.ranking.length > (plan.ranking.limit || 25) + 1) {
    warnings.push("ranking_exceeds_limit");
  }
  return { ok: warnings.filter((w) => w === "numerator_exceeds_denominator" || w === "rate_out_of_bounds").length === 0, warnings };
}
