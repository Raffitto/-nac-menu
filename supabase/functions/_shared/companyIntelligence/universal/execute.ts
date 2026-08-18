/**
 * Execute universal evidence legs via existing capabilities. Parallel where independent.
 */

import type { CapabilityExecutor } from "../capabilityResolver.ts";
import { executeBuiltinCapability } from "../capabilityResolver.ts";
import { executeCommercePlan, type CommerceStore } from "../commerce/semantic/execute.ts";
import type { CommerceQueryPlan } from "../commerce/semantic/plan.ts";
import { planSemanticCommerce } from "../commerce/semantic/planner.ts";
import { synthesizeSemanticCommerce } from "../commerce/semantic/synthesize.ts";
import { validateSemanticResult } from "../commerce/semantic/validate.ts";
import { createCompanyIntelligenceState } from "../intelligenceState.ts";
import { assertBranchScopePreserved, type IntelligenceScope } from "../scope.ts";
import type { DateRange } from "../types.ts";
import { DOMAIN_REGISTRY, type DomainId } from "./domainRegistry.ts";
import { detectSourceConflicts, decomposeDrivers, scoreOpportunities } from "./operators.ts";
import type { UniversalEvidence, UniversalEvidenceLeg, UniversalQueryPlan } from "./plan.ts";

function metricFrom(result: { metrics?: Array<{ key: string; value: number | string; unit?: string }> } | null, key: string) {
  return (result?.metrics || []).find((m) => m.key === key) || null;
}

function applyUniversalCommerceOperators(commercePlan: CommerceQueryPlan, leg: UniversalEvidenceLeg) {
  const ops = new Set(leg.operators || []);
  const family = (leg.filters || []).find((f) => f.field === "family");
  const weekend = (leg.filters || []).some((f) => f.field === "weekend");
  if ((ops.has("cohort_compare") || family) && family) {
    const value = String(family.value);
    commercePlan.cohort = { kind: "has_family", value };
    commercePlan.compareCohort = { kind: "not_has_family", value };
    commercePlan.calculation = "cohort_compare";
    commercePlan.outputIntent = "comparison";
    commercePlan.targetFamily = value === "dessert" || value === "food" || value === "coffee" ? value : commercePlan.targetFamily;
  } else if (weekend) {
    commercePlan.cohort = { kind: "weekend" };
  }
  if (weekend && !(commercePlan.filters || []).some((f) => f.field === "weekend")) {
    commercePlan.filters = [...(commercePlan.filters || []), { field: "weekend", op: "eq", value: true }];
  }
}

function qualityFrom(ok: boolean, skipped?: boolean): UniversalEvidence["quality"] {
  if (skipped || !ok) return "unavailable";
  return "strong_direct";
}

async function runCapability(
  executor: CapabilityExecutor | null | undefined,
  capability: "commercial.performance" | "commercial.compare" | "guest.feedback" | "operations.review" | "company.branch_timeline" | "calendar.resolve_period" | "menu.performance",
  branchId: string | null,
  period: DateRange | null,
  compare: DateRange | null,
  question: string,
) {
  const req = {
    capability,
    branchId,
    currentPeriod: period,
    comparisonPeriod: compare,
    comparabilityMethod: null,
    question,
  };
  const state = createCompanyIntelligenceState({
    originalQuestion: question,
    scope: { primaryBranchId: branchId, branchIds: branchId ? [branchId] : [] },
  });
  const builtin = await executeBuiltinCapability(req, state);
  if (builtin) return builtin;
  if (!executor) {
    return {
      capability,
      implementationTool: capability,
      ok: false,
      skipped: true,
      skipReason: "no_executor",
      metrics: [],
      textSnippets: [],
    };
  }
  return executor(req);
}

function toEvidence(input: {
  domain: DomainId;
  metric: string;
  value: number | string | null;
  unit?: string | null;
  period: DateRange | null;
  branchId: string | null;
  provenance: string;
  ok: boolean;
  skipped?: boolean;
  skipReason?: string | null;
  text?: string | null;
  warnings?: string[];
}): UniversalEvidence {
  const def = DOMAIN_REGISTRY[input.domain];
  return {
    domain: input.domain,
    authority: def.authority,
    metric: input.metric,
    value: input.value,
    unit: input.unit || null,
    period: input.period,
    branchScope: input.branchId ? [input.branchId] : [],
    coverage: input.period,
    quality: qualityFrom(input.ok, input.skipped),
    provenance: input.provenance,
    warnings: input.warnings || (input.skipReason ? [input.skipReason] : []),
    text: input.text || null,
    skipped: input.skipped,
    skipReason: input.skipReason || null,
  };
}

async function executeLeg(input: {
  leg: UniversalEvidenceLeg;
  plan: UniversalQueryPlan;
  scope: IntelligenceScope;
  executor?: CapabilityExecutor | null;
  commerceStore?: CommerceStore | null;
}): Promise<UniversalEvidence[]> {
  const branchId = input.scope.primaryBranchId;
  const rbac = assertBranchScopePreserved(input.scope, branchId);
  if (!rbac.ok) {
    return [toEvidence({
      domain: input.leg.domain,
      metric: input.leg.metric || "scope",
      value: null,
      period: input.plan.period,
      branchId,
      provenance: "rbac",
      ok: false,
      skipped: true,
      skipReason: `RBAC blocked ${input.leg.domain}: ${rbac.reason}`,
    })];
  }
  if (branchId && !input.scope.access.canSeeNetwork && !input.scope.access.allowedBranchIds.includes(branchId)) {
    return [toEvidence({
      domain: input.leg.domain,
      metric: input.leg.metric || "scope",
      value: null,
      period: input.plan.period,
      branchId,
      provenance: "rbac",
      ok: false,
      skipped: true,
      skipReason: "Your access does not include this branch.",
    })];
  }

  if (input.leg.domain === "cash_up") {
    const perf = await runCapability(input.executor, "commercial.performance", branchId, input.plan.period, input.plan.compare, input.plan.question);
    const rows: UniversalEvidence[] = [];
    const sales = metricFrom(perf, "net_sales");
    const covers = metricFrom(perf, "covers");
    const avg = metricFrom(perf, "avg_spend");
    const orders = metricFrom(perf, "orders");
    if (sales) {
      rows.push(toEvidence({
        domain: "cash_up",
        metric: "net_sales",
        value: sales.value,
        unit: sales.unit || "SAR",
        period: input.plan.period,
        branchId,
        provenance: perf.implementationTool,
        ok: perf.ok,
        text: (perf.textSnippets || [])[0] || null,
      }));
    }
    if (covers) {
      rows.push(toEvidence({
        domain: "cash_up",
        metric: "covers",
        value: covers.value,
        period: input.plan.period,
        branchId,
        provenance: perf.implementationTool,
        ok: perf.ok,
      }));
    }
    if (avg) {
      rows.push(toEvidence({
        domain: "cash_up",
        metric: "avg_spend",
        value: avg.value,
        unit: avg.unit || "SAR",
        period: input.plan.period,
        branchId,
        provenance: perf.implementationTool,
        ok: perf.ok,
      }));
    }
    if (orders) {
      rows.push(toEvidence({
        domain: "cash_up",
        metric: "orders",
        value: orders.value,
        period: input.plan.period,
        branchId,
        provenance: perf.implementationTool,
        ok: perf.ok,
      }));
    }
    if (input.plan.compare) {
      const cmp = await runCapability(input.executor, "commercial.compare", branchId, input.plan.period, input.plan.compare, input.plan.question);
      const delta = metricFrom(cmp, "delta_pct");
      if (delta) {
        rows.push(toEvidence({
          domain: "cash_up",
          metric: "delta_pct",
          value: delta.value,
          unit: "%",
          period: input.plan.period,
          branchId,
          provenance: cmp.implementationTool,
          ok: cmp.ok,
        }));
      }
    }
    if (!rows.length) {
      rows.push(toEvidence({
        domain: "cash_up",
        metric: "net_sales",
        value: null,
        period: input.plan.period,
        branchId,
        provenance: perf.implementationTool,
        ok: false,
        skipped: true,
        skipReason: perf.skipReason || perf.error || "Cash Up evidence unavailable for this scope/period.",
        text: (perf.textSnippets || [])[0] || null,
      }));
    }
    return rows;
  }

  if (input.leg.domain === "commerce") {
    if (!input.commerceStore) {
      return [toEvidence({
        domain: "commerce",
        metric: "average_check",
        value: null,
        period: input.plan.period,
        branchId,
        provenance: "commerce.semantic_query",
        ok: false,
        skipped: true,
        skipReason: "Commerce store not attached.",
      })];
    }
    const planned = planSemanticCommerce({
      question: input.plan.question,
      branchId,
      period: input.plan.period,
      comparePeriod: input.plan.compare,
    });
    const commercePlan = planned.ok && planned.plan && planned.plan.outputIntent !== "limitation"
      ? planned.plan
      : planSemanticCommerce({
        question: "How was this period operationally?",
        branchId,
        period: input.plan.period,
        comparePeriod: input.plan.compare,
      }).plan;
    if (!commercePlan) {
      return [toEvidence({
        domain: "commerce",
        metric: "average_check",
        value: null,
        period: input.plan.period,
        branchId,
        provenance: "commerce.semantic_query",
        ok: false,
        skipped: true,
        skipReason: planned.reason || "Commerce plan unavailable.",
      })];
    }
    applyUniversalCommerceOperators(commercePlan, input.leg);
    const exec = await executeCommercePlan({ plan: commercePlan, store: input.commerceStore, scope: input.scope });
    const validation = validateSemanticResult(commercePlan, exec);
    const text = synthesizeSemanticCommerce({
      question: input.plan.question,
      plan: commercePlan,
      result: exec,
      validation: exec.ok ? validation : { ok: true, warnings: validation.warnings },
    });
    const diagnostic = exec.diagnostic as { averageCheck?: number; orders?: number } | undefined;
    return [toEvidence({
      domain: "commerce",
      metric: diagnostic?.averageCheck != null ? "average_check" : (commercePlan.metric || "diagnostic"),
      value: diagnostic?.averageCheck ?? exec.value ?? null,
      unit: diagnostic?.averageCheck != null ? "SAR" : exec.unit || null,
      period: exec.debug?.period || input.plan.period,
      branchId,
      provenance: "commerce.semantic_query",
      ok: exec.ok,
      skipped: !exec.ok,
      skipReason: exec.ok ? null : exec.limitation,
      text,
      warnings: exec.mappingNote ? [exec.mappingNote] : [],
    })];
  }

  if (input.leg.domain === "reviews") {
    const result = await runCapability(input.executor, "guest.feedback", branchId, input.plan.period, input.plan.compare, input.plan.question);
    return [toEvidence({
      domain: "reviews",
      metric: "review_volume",
      value: metricFrom(result, "review_volume")?.value
        ?? metricFrom(result, "google_review_5")?.value
        ?? null,
      period: input.plan.period,
      branchId,
      provenance: result.implementationTool,
      ok: result.ok && !result.skipped,
      skipped: Boolean(result.skipped) || !result.ok,
      skipReason: result.skipReason || result.error || (result.ok ? null : "Review facts were not returned for this period."),
      text: (result.textSnippets || []).join(" ") || null,
    })];
  }

  if (input.leg.domain === "operations" || input.leg.domain === "reception" || input.leg.domain === "vault") {
    const result = await runCapability(input.executor, "operations.review", branchId, input.plan.period, input.plan.compare, input.plan.question);
    return [toEvidence({
      domain: input.leg.domain,
      metric: input.leg.metric || "issue_mentions",
      value: metricFrom(result, "covers")?.value ?? null,
      period: input.plan.period,
      branchId,
      provenance: result.implementationTool,
      ok: result.ok && !result.skipped,
      skipped: Boolean(result.skipped) || !result.ok,
      skipReason: result.skipReason || result.error,
      text: (result.textSnippets || []).join(" ") || null,
    })];
  }

  if (input.leg.domain === "timeline") {
    const result = await runCapability(input.executor, "company.branch_timeline", branchId, input.plan.period, input.plan.compare, input.plan.question);
    return [toEvidence({
      domain: "timeline",
      metric: "opening_date",
      value: (result.textSnippets || [])[0] || null,
      period: input.plan.period,
      branchId,
      provenance: result.implementationTool,
      ok: result.ok,
      text: (result.textSnippets || []).join(" "),
    })];
  }

  if (input.leg.domain === "menu" || input.leg.domain === "calendar_events") {
    return [toEvidence({
      domain: input.leg.domain,
      metric: "event_date",
      value: input.plan.event?.date || null,
      period: input.plan.period,
      branchId,
      provenance: input.leg.domain,
      ok: Boolean(input.plan.event?.resolved && input.plan.event.date),
      skipped: !input.plan.event?.resolved,
      skipReason: input.plan.event?.resolved
        ? null
        : "No trusted event/launch date is registered for this question.",
    })];
  }

  return [toEvidence({
    domain: input.leg.domain,
    metric: input.leg.metric || "unknown",
    value: null,
    period: input.plan.period,
    branchId,
    provenance: input.leg.capability,
    ok: false,
    skipped: true,
    skipReason: `No executor mapping for ${input.leg.domain}.`,
  })];
}

export type UniversalExecution = {
  plan: UniversalQueryPlan;
  evidence: UniversalEvidence[];
  conflicts: ReturnType<typeof detectSourceConflicts>;
  drivers: ReturnType<typeof decomposeDrivers>;
  opportunities: ReturnType<typeof scoreOpportunities>;
  tools: string[];
};

export async function executeUniversalPlan(input: {
  plan: UniversalQueryPlan;
  scope: IntelligenceScope;
  executor?: CapabilityExecutor | null;
  commerceStore?: CommerceStore | null;
}): Promise<UniversalExecution> {
  const started = Date.now();
  void started;
  const groups = await Promise.all(
    input.plan.evidence.map((leg) => executeLeg({
      leg,
      plan: input.plan,
      scope: input.scope,
      executor: input.executor,
      commerceStore: input.commerceStore,
    })),
  );
  const evidence = groups.flat();
  return {
    plan: input.plan,
    evidence,
    conflicts: detectSourceConflicts(evidence),
    drivers: decomposeDrivers(evidence),
    opportunities: input.plan.intent === "opportunity" || input.plan.intent === "diagnostic" || input.plan.intent === "follow_up"
      ? scoreOpportunities(evidence)
      : [],
    tools: [...new Set(evidence.map((e) => e.provenance).filter(Boolean))],
  };
}
