/**
 * Realistic multi-turn management analyst conversations.
 */
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.resolve(__dirname, "../../../..");
const fabricPath = path.join(root, "supabase/functions/_shared/companyIntelligence/index.ts");
const REF = "new Date('2026-08-15T12:00:00.000Z')";

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

describe("Scenario 1: yesterday → good → why → unusual", () => {
  test("fact then benchmark then driver then anomaly", () => {
    const out = run(`
      const ref = ${REF};
      const t1 = mod.resolveTurnSemantics({ question: "How did we do yesterday?", branchHint: "khobar", referenceDate: ref });
      const t2 = mod.resolveTurnSemantics({ question: "Was that good?", previous: t1.conversation, referenceDate: ref });
      const t3 = mod.resolveTurnSemantics({ question: "Why?", previous: t2.conversation, referenceDate: ref });
      const t4 = mod.resolveTurnSemantics({ question: "Anything unusual?", previous: t3.conversation, referenceDate: ref });
      return {
        p: [t1.period?.startDate, t2.period?.startDate, t3.period?.startDate, t4.period?.startDate],
        intents: [t2.analysisIntent, t3.analysisIntent, t4.analysisIntent],
        clarify: [t2.ambiguity.needsClarification, t3.ambiguity.needsClarification, t4.ambiguity.needsClarification],
      };
    `);
    expect(new Set(out.p).size).toBe(1);
    expect(out.p[0]).toBe("2026-08-14");
    expect(out.intents).toEqual(["judgement", "why", "stands_out"]);
    expect(out.clarify).toEqual([false, false, false]);
  });
});

describe("Scenario 2: month diagnostic chain", () => {
  test("stands out and dragging keep MTD", () => {
    const out = run(`
      const ref = ${REF};
      const t1 = mod.resolveTurnSemantics({ question: "How are we doing this month?", branchHint: "khobar", referenceDate: ref });
      const t2 = mod.resolveTurnSemantics({ question: "What stands out?", previous: t1.conversation, referenceDate: ref });
      const t3 = mod.resolveTurnSemantics({ question: "What is dragging us down?", previous: t2.conversation, referenceDate: ref });
      const t4 = mod.resolveTurnSemantics({ question: "Is it covers or spend?", previous: t3.conversation, referenceDate: ref });
      return {
        start: t1.period?.startDate,
        same: t2.period?.startDate === t1.period?.startDate && t3.period?.startDate === t1.period?.startDate,
        intents: [t2.analysisIntent, t3.analysisIntent],
        metric: t4.metric,
      };
    `);
    expect(out.start).toBe("2026-08-01");
    expect(out.same).toBe(true);
    expect(out.intents[0]).toBe("stands_out");
    expect(out.intents[1]).toBe("contributors");
  });
});

describe("Scenario 3: Friday normal + trend", () => {
  test("Friday follow-ups stay on Fabric", () => {
    const out = run(`
      const ref = ${REF};
      const t1 = mod.resolveTurnSemantics({ question: "How was Friday?", branchHint: "khobar", referenceDate: ref });
      const t2 = mod.resolveTurnSemantics({ question: "Was it normal for a Friday?", previous: t1.conversation, referenceDate: ref });
      const t3 = mod.resolveTurnSemantics({ question: "Are Fridays getting weaker?", previous: t2.conversation, referenceDate: ref });
      return {
        a2: t2.analysisIntent,
        a3: t3.analysisIntent,
        fabric: mod.isManagementIntelligenceQuestion("Are Fridays getting weaker?", { intent: "unknown" }, { priorFabricConversation: t2.conversation, referenceDate: ref }),
      };
    `);
    expect(out.a2).toBe("anomaly");
    expect(out.a3).toBe("trend");
    expect(out.fabric).toBe(true);
  });
});

describe("Scenario 4: last 10 why / one day / contributors", () => {
  test("comparison survives diagnostic follow-ups", () => {
    const out = run(`
      const ref = ${REF};
      const t1 = mod.resolveTurnSemantics({ question: "Last 10 days vs previous 10", branchHint: "khobar", referenceDate: ref });
      const t2 = mod.resolveTurnSemantics({ question: "Why are we down?", previous: t1.conversation, referenceDate: ref });
      const t3 = mod.resolveTurnSemantics({ question: "Was it one bad day?", previous: t2.conversation, referenceDate: ref });
      const t4 = mod.resolveTurnSemantics({ question: "Which days hurt most?", previous: t3.conversation, referenceDate: ref });
      return {
        compare: [t1.comparisonIntent, t2.comparisonIntent, t3.comparisonIntent, t4.comparisonIntent],
        intents: [t2.analysisIntent, t3.analysisIntent, t4.analysisIntent],
      };
    `);
    expect(out.compare[0]).toBe(true);
    expect(out.intents).toEqual(["why", "breadth", "contributors"]);
  });
});

describe("Scenario 5: July strong month", () => {
  test("July judgement does not force an unspecified compare clarification", () => {
    const out = run(`
      const ref = ${REF};
      const t1 = mod.resolveTurnSemantics({ question: "How was July?", branchHint: "khobar", referenceDate: ref });
      const t2 = mod.resolveTurnSemantics({ question: "Was that a strong month?", previous: t1.conversation, referenceDate: ref });
      return { start: t1.period?.startDate, intent: t2.analysisIntent, clarify: t2.ambiguity.needsClarification };
    `);
    expect(out.start).toBe("2026-07-01");
    expect(out.intent).toBe("judgement");
    expect(out.clarify).toBe(false);
  });
});

describe("Scenario 6: branch change isolation", () => {
  test("Riyadh follow-up cannot leak Khobar when unauthorized", () => {
    const out = run(`
      const scope = mod.createIntelligenceScope({
        primaryBranchId: "khobar", branchIds: ["khobar"], allowedBranchIds: ["khobar"],
        canSeeNetwork: false, role: "branch_manager",
      });
      const t1 = await mod.runCompanyIntelligenceOrchestration({
        question: "How is Khobar this month?", scope, branchHint: "khobar",
        referenceDate: ${REF}, mode: "heuristic",
      });
      const t2 = await mod.runCompanyIntelligenceOrchestration({
        question: "What about Riyadh?", conversation: t1.nextConversation,
        scope, branchHint: "khobar", referenceDate: ${REF}, mode: "heuristic",
      });
      return { b1: t1.state.scope.primaryBranchId, b2: t2.state.scope.primaryBranchId };
    `);
    expect(out.b1).toBe("khobar");
    expect(out.b2).toBe("khobar");
  });
});

describe("Scenario 7: Ramadan infeasibility", () => {
  test("Khobar YoY Ramadan remains not answerable", () => {
    const out = run(`
      const result = await mod.runCompanyIntelligenceOrchestration({
        question: "Was Ramadan strong vs last year?",
        branchHint: "khobar",
        referenceDate: ${REF},
        mode: "heuristic",
      });
      return { status: result.state.feasibility.status, text: result.answerText };
    `);
    expect(out.status).toBe("NOT_ANSWERABLE_AS_REQUESTED");
    expect(out.text).toMatch(/not operating/i);
  });
});

describe("Adversarial routing: original question reaches Fabric semantics", () => {
  test("why / unusual / trend / ranking follow-ups are not underspecified", () => {
    const out = run(`
      const ref = ${REF};
      const base = mod.resolveTurnSemantics({ question: "How did we do yesterday?", branchHint: "khobar", referenceDate: ref });
      const qs = ["Was that good?", "Why?", "Was yesterday unusual?", "Are sales trending down?", "Best 3 sales days this month", "What about covers?", "What about last week?"];
      return qs.map((q) => {
        const t = mod.resolveTurnSemantics({ question: q, previous: base.conversation, referenceDate: ref });
        return { q, clarify: t.ambiguity.needsClarification, kind: t.ambiguity.kind, analysis: t.analysisIntent, metric: t.metric, resolved: t.resolvedQuestion };
      });
    `);
    const byQ = Object.fromEntries(out.map((r) => [r.q, r]));
    expect(byQ["Was that good?"].clarify).toBe(false);
    expect(byQ["Why?"].clarify).toBe(false);
    expect(byQ["Was yesterday unusual?"].clarify).toBe(false);
    expect(byQ["Are sales trending down?"].clarify).toBe(false);
    expect(byQ["What about covers?"].metric).toBe("covers");
    expect(byQ["Was that good?"].resolved).toMatch(/good/i);
  });
});
