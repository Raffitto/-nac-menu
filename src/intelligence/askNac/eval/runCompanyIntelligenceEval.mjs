/**
 * Permanent eval harness entry (heuristic/fabric only — no paid model spam).
 * Usage: node src/intelligence/askNac/eval/runCompanyIntelligenceEval.mjs
 */
import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

globalThis.Deno = { env: { get: () => undefined } };

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "../../../..");
const cases = JSON.parse(
  readFileSync(join(__dirname, "companyIntelligenceEvalCases.json"), "utf8"),
);

const fabric = await import(
  join(root, "supabase/functions/_shared/companyIntelligence/index.ts")
);

const REF = new Date("2026-08-10T12:00:00+03:00");
const rows = [];

for (const c of cases.cases) {
  const state = fabric.bootstrapFabricState({
    question: c.question,
    branchHint: /riyadh/i.test(c.question)
      ? "riyadh"
      : /jeddah/i.test(c.question)
        ? "jeddah"
        : "khobar",
    referenceDate: REF,
    deterministicHighConfidence: false,
  });
  const infeasible = fabric.buildInfeasibleComparisonAnswer(state);
  rows.push({
    id: c.id,
    category: c.category,
    question: c.question,
    feasibility: state.feasibility?.status || null,
    comparability: state.comparability?.status || null,
    budgetTier: state.plan.researchBudgetTier,
    branch: state.scope.primaryBranchId,
    infeasible: Boolean(infeasible),
    expect: c.expect_feasibility || null,
    expectOk: c.expect_feasibility
      ? state.feasibility?.status === c.expect_feasibility
      : null,
  });
}

const summary = {
  total: rows.length,
  legacy64: rows.filter((r) => String(r.id).startsWith("nl64_")).length,
  infeasibleBlocks: rows.filter((r) => r.infeasible).length,
  expectChecks: rows.filter((r) => r.expectOk != null),
  expectPass: rows.filter((r) => r.expectOk === true).length,
  byBudget: rows.reduce((acc, r) => {
    acc[r.budgetTier] = (acc[r.budgetTier] || 0) + 1;
    return acc;
  }, {}),
};

const outPath = "/tmp/company-intelligence-eval.json";
writeFileSync(outPath, JSON.stringify({ summary, rows }, null, 2));
console.log(JSON.stringify(summary, null, 2));
console.log("wrote", outPath);
