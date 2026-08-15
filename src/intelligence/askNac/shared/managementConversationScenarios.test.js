/**
 * Multi-turn management conversation scenarios against Fabric turn semantics + spine.
 */
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.resolve(__dirname, "../../../..");
const fabricPath = path.join(root, "supabase/functions/_shared/companyIntelligence/index.ts");
const REF = "new Date('2026-08-14T16:16:00.000Z')";

function run(body) {
  const script = `
    global.Deno = { env: { get: () => undefined } };
    import(${JSON.stringify(fabricPath)}).then(async (mod) => {
      const out = await (async () => { ${body} })();
      process.stdout.write(JSON.stringify(out));
    }).catch((err) => { console.error(err); process.exit(1); });
  `;
  return JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: root,
    encoding: "utf8",
    env: process.env,
  }).trim());
}

describe("management conversation scenarios", () => {
  test("metric, compare, covers, branch, then first-10-days correction", () => {
    const out = run(`
      const ref = ${REF};
      const t1 = mod.resolveTurnSemantics({ question: "How have we performed this month?", branchHint: "khobar", referenceDate: ref });
      const t2 = mod.resolveTurnSemantics({ question: "Compared with last month?", previous: t1.conversation, referenceDate: ref });
      const t3 = mod.resolveTurnSemantics({ question: "What about covers?", previous: t2.conversation, referenceDate: ref });
      const t4 = mod.resolveTurnSemantics({ question: "And Riyadh?", previous: t3.conversation, referenceDate: ref });
      const t5 = mod.resolveTurnSemantics({ question: "Actually the first 10 days only", previous: t4.conversation, referenceDate: ref });
      return {
        t1: { start: t1.period?.startDate, metric: t1.metric, compare: t1.comparisonIntent },
        t2: { start: t2.period?.startDate, compareStart: t2.comparisonPeriod?.startDate, intent: t2.comparisonIntent },
        t3: { metric: t3.metric, start: t3.period?.startDate, compareStart: t3.comparisonPeriod?.startDate },
        t4: { branch: t4.scope.branchId, metric: t4.metric, start: t4.period?.startDate },
        t5: { start: t5.period?.startDate, end: t5.period?.endDate, branch: t5.scope.branchId },
      };
    `);
    expect(out.t1.metric).toBe("commercial");
    expect(out.t1.compare).toBe(false);
    expect(out.t2.intent).toBe(true);
    expect(out.t2.compareStart).toBeTruthy();
    expect(out.t3.metric).toBe("covers");
    expect(out.t3.start).toBe(out.t2.start);
    expect(out.t4.branch).toBe("riyadh");
    expect(out.t4.metric).toBe("covers");
    expect(out.t5.start).toBe("2026-08-01");
    expect(out.t5.end).toBe("2026-08-10");
  });

  test("event comparison remains distinct from missing data", () => {
    const out = run(`
      const result = await mod.runCompanyIntelligenceOrchestration({
        question: "Compare Ramadan this year with last year",
        branchHint: "khobar",
        referenceDate: ${REF},
        mode: "heuristic",
      });
      return { type: result.answerType, status: result.state.feasibility.status, reasons: result.state.feasibility.reasons, text: result.answerText };
    `);
    expect(out.status).toBe("NOT_ANSWERABLE_AS_REQUESTED");
    expect(out.reasons).toContain("branch_not_operating_in_baseline_period");
    expect(out.text).toMatch(/not operating/i);
    expect(out.text).not.toMatch(/not yet available in the canonical data/i);
  });

  test("RBAC: conversational Riyadh follow-up cannot leak into Khobar-only scope", () => {
    const out = run(`
      const scope = mod.createIntelligenceScope({
        primaryBranchId: "khobar",
        branchIds: ["khobar"],
        allowedBranchIds: ["khobar"],
        canSeeNetwork: false,
        role: "branch_manager",
      });
      const t1 = await mod.runCompanyIntelligenceOrchestration({
        question: "How were sales last week?",
        scope,
        branchHint: "khobar",
        referenceDate: ${REF},
        mode: "heuristic",
      });
      const t2 = await mod.runCompanyIntelligenceOrchestration({
        question: "What about Riyadh?",
        conversation: t1.nextConversation,
        scope,
        branchHint: "khobar",
        referenceDate: ${REF},
        mode: "heuristic",
      });
      return {
        t1: t1.state.scope.primaryBranchId,
        t2: t2.state.scope.primaryBranchId,
        allowed: t2.state.scope.access.allowedBranchIds,
      };
    `);
    expect(out.t1).toBe("khobar");
    expect(out.t2).toBe("khobar");
    expect(out.allowed).toEqual(["khobar"]);
  });

  test("ambiguous compare follow-up does not invent a baseline", () => {
    const out = run(`
      const t1 = mod.resolveTurnSemantics({
        question: "How were sales in July?",
        branchHint: "khobar",
        referenceDate: ${REF},
      });
      const t2 = await mod.runCompanyIntelligenceOrchestration({
        question: "Compare June",
        conversation: t1.conversation,
        branchHint: "khobar",
        referenceDate: ${REF},
        mode: "heuristic",
      });
      return {
        type: t2.answerType,
        text: t2.answerText,
        compare: t2.state.periods.comparison,
        current: t2.state.periods.current?.startDate,
      };
    `);
    expect(out.type).toBe("clarification");
    expect(out.text).toMatch(/to what/i);
  });
});
