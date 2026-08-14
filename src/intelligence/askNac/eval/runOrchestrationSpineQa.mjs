/**
 * 64-case orchestration QA via Fabric spine (heuristic/mocked — no paid API spam).
 */
import { readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

globalThis.Deno = { env: { get: (k) => (k === "ASK_NAC_PLANNER_MODE" ? "heuristic" : undefined) } };

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "../../../..");
const cases = JSON.parse(readFileSync(join(__dirname, "companyIntelligenceEvalCases.json"), "utf8"));
const fabric = await import(join(root, "supabase/functions/_shared/companyIntelligence/index.ts"));

const REF = new Date("2026-08-10T12:00:00+03:00");
const FOODICS = /foodics|sales_total|top_items/;

function grade(row) {
  if (row.feasibility === "NOT_ANSWERABLE_AS_REQUESTED") {
    return row.toolsExecuted.length === 0 && row.paid === 0 ? "pass" : "fail";
  }
  if (row.finalIntentLeak && FOODICS.test(row.finalIntentLeak)) return "high";
  if (!row.capabilities.length) return "high";
  if (row.scopeBranch !== "khobar" && /khobar/i.test(row.question) && !/riyadh|jeddah|all branches/i.test(row.question)) {
    return "fail";
  }
  if (row.verifierOk === false && /caused|margin is \d/i.test(row.answer || "")) return "high";
  if (row.stage !== "COMPLETE") return "fail";
  if (row.capabilities.some((c) => c.startsWith("commercial.") || c.startsWith("operations.") || c.startsWith("cost.") || c.startsWith("company."))) {
    return row.periodOk || row.feasibility ? "pass" : "acceptable";
  }
  return "acceptable";
}

const rows = [];
for (const c of cases.cases.filter((x) => x.legacy_set === "mgmt_nl_64_2026_08_10")) {
  const result = await fabric.runCompanyIntelligenceOrchestration({
    question: c.question,
    branchHint: /riyadh/i.test(c.question) && !/khobar/i.test(c.question)
      ? "riyadh"
      : /jeddah/i.test(c.question) && !/khobar/i.test(c.question)
        ? "jeddah"
        : "khobar",
    referenceDate: REF,
    mode: "heuristic",
  });
  const row = {
    q: c.question,
    stage: result.state.stage,
    feasibility: result.state.feasibility?.status || null,
    comparability: result.state.comparability?.status || null,
    capabilities: result.state.plan.capabilities,
    scopeBranch: result.state.scope.primaryBranchId,
    periodOk: Boolean(result.state.periods.current),
    toolsExecuted: result.toolsExecuted,
    paid: result.paidModelCalls,
    verifierOk: result.state.cost.verifierOk,
    answer: result.answerText.slice(0, 180),
    authoritative: true,
  };
  row.grade = grade(row);
  rows.push(row);
}

const summary = {
  total: rows.length,
  pass: rows.filter((r) => r.grade === "pass").length,
  acceptable: rows.filter((r) => r.grade === "acceptable").length,
  fail: rows.filter((r) => r.grade === "fail").length,
  high: rows.filter((r) => r.grade === "high").length,
  zeroPaid: rows.filter((r) => r.paid === 0).length,
};

writeFileSync("/tmp/asknac-spine-qa.json", JSON.stringify({ summary, rows }, null, 2));
console.log(JSON.stringify(summary, null, 2));
const bad = rows.filter((r) => r.grade === "fail" || r.grade === "high");
if (bad.length) {
  console.log("regressions", bad.slice(0, 10).map((r) => ({ q: r.q, grade: r.grade, caps: r.capabilities })));
}
