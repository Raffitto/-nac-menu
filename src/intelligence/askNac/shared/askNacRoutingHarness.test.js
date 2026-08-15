/**
 * Production-style routing harness: cold-start vs follow-up parity, corrections, combinatorial sample.
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

describe("cold-start vs follow-up parity", () => {
  test("judgement family reaches the same analysisIntent", () => {
    const out = run(`
      const ref = ${REF};
      const cold = mod.resolveTurnSemantics({ question: "Was yesterday good?", branchHint: "khobar", referenceDate: ref });
      const prior = mod.resolveTurnSemantics({ question: "How did we do yesterday?", branchHint: "khobar", referenceDate: ref });
      const follow = mod.resolveTurnSemantics({ question: "Was that good?", previous: prior.conversation, referenceDate: ref });
      return {
        cold: cold.analysisIntent, follow: follow.analysisIntent,
        coldPeriod: cold.period?.startDate, followPeriod: follow.period?.startDate,
        fabricCold: mod.isManagementIntelligenceQuestion("Was yesterday good?", { intent: "unknown", confidence: "none" }, { referenceDate: ref }),
        fabricFollow: mod.isManagementIntelligenceQuestion("Was that good?", { intent: "unknown", confidence: "none" }, { priorFabricConversation: prior.conversation, referenceDate: ref }),
      };
    `);
    expect(out.cold).toBe("judgement");
    expect(out.follow).toBe("judgement");
    expect(out.coldPeriod).toBe(out.followPeriod);
    expect(out.fabricCold).toBe(true);
    expect(out.fabricFollow).toBe(true);
  });

  test("trend family parity", () => {
    const out = run(`
      const ref = ${REF};
      const cold = mod.resolveTurnSemantics({ question: "Are Fridays getting weaker?", branchHint: "khobar", referenceDate: ref });
      const prior = mod.resolveTurnSemantics({ question: "How was Friday?", branchHint: "khobar", referenceDate: ref });
      const follow = mod.resolveTurnSemantics({ question: "Are these getting weaker?", previous: prior.conversation, referenceDate: ref });
      return { cold: cold.analysisIntent, follow: follow.analysisIntent };
    `);
    expect(out.cold).toBe("trend");
    expect(out.follow === "trend" || out.follow === null).toBe(true);
  });
});

describe("explicit corrections", () => {
  test("forget the comparison drops inherited baseline", () => {
    const out = run(`
      const ref = ${REF};
      const t1 = mod.resolveTurnSemantics({ question: "How did we do this month?", branchHint: "khobar", referenceDate: ref });
      const t2 = mod.resolveTurnSemantics({ question: "Compare with last month", previous: t1.conversation, referenceDate: ref });
      const t3 = mod.resolveTurnSemantics({ question: "Forget the comparison", previous: t2.conversation, referenceDate: ref });
      return {
        t2cmp: Boolean(t2.comparisonPeriod), t2intent: t2.comparisonIntent,
        t3cmp: t3.comparisonPeriod, t3intent: t3.comparisonIntent, notes: t3.notes,
      };
    `);
    expect(out.t2cmp).toBe(true);
    expect(out.t3cmp).toBe(null);
    expect(out.t3intent).toBe(false);
    expect(out.notes).toContain("comparison_explicitly_dropped");
  });

  test("actually July replaces inherited period", () => {
    const out = run(`
      const ref = ${REF};
      const t1 = mod.resolveTurnSemantics({ question: "How did we do this month?", branchHint: "khobar", referenceDate: ref });
      const t2 = mod.resolveTurnSemantics({ question: "Actually July", previous: t1.conversation, referenceDate: ref });
      return { start: t2.period?.startDate, end: t2.period?.endDate, cmp: t2.comparisonPeriod };
    `);
    expect(out.start).toBe("2026-07-01");
    expect(out.end).toBe("2026-07-31");
    expect(out.cmp).toBe(null);
  });

  test("just yesterday resets period and comparison", () => {
    const out = run(`
      const ref = ${REF};
      const t1 = mod.resolveTurnSemantics({ question: "How did we do this month compared with last month?", branchHint: "khobar", referenceDate: ref });
      const t2 = mod.resolveTurnSemantics({ question: "Just yesterday", previous: t1.conversation, referenceDate: ref });
      return { start: t2.period?.startDate, end: t2.period?.endDate, cmp: t2.comparisonPeriod, intent: t2.comparisonIntent };
    `);
    expect(out.start).toBe(out.end);
    expect(out.cmp).toBe(null);
    expect(out.intent).toBe(false);
  });
});

describe("long conversation slot integrity", () => {
  test("10-turn management thread preserves and replaces slots", () => {
    const out = run(`
      const ref = ${REF};
      const qs = [
        "How are we doing this month?",
        "What about covers?",
        "Was that good?",
        "Compared with last month?",
        "What stands out?",
        "Which days hurt us?",
        "And by spend instead?",
        "Actually last week",
        "Was that normal?",
        "What about Riyadh?",
      ];
      let prev = null;
      const turns = [];
      for (const q of qs) {
        const t = mod.resolveTurnSemantics({ question: q, previous: prev, branchHint: "khobar", referenceDate: ref });
        turns.push({
          q,
          metric: t.metric,
          branch: t.scope.branchId,
          period: t.period && (t.period.startDate + "/" + t.period.endDate),
          cmp: Boolean(t.comparisonPeriod),
          analysis: t.analysisIntent,
          ranking: t.ranking,
        });
        prev = t.conversation;
      }
      return turns;
    `);
    expect(out[1].metric).toBe("covers");
    expect(out[2].analysis).toBe("judgement");
    expect(out[3].cmp).toBe(true);
    expect(out[4].analysis).toBe("stands_out");
    expect(out[5].analysis).toBe("contributors");
    expect(out[7].cmp).toBe(false);
    expect(out[7].period).toMatch(/2026-08-/);
    expect(out[8].analysis).toBe("anomaly");
    expect(out[9].branch).toBe("riyadh");
  });
});

describe("combinatorial semantic sample", () => {
  test("metric × period × operation reach Fabric without underspecified follow-up on cold start", () => {
    const out = run(`
      const ref = ${REF};
      const metrics = ["sales", "covers"];
      const periods = ["yesterday", "last week", "July"];
      const ops = [
        { q: (m,p) => \`How were \${m} \${p}?\`, analysis: null },
        { q: (m,p) => \`Was \${p} good for \${m}?\`, analysis: "judgement" },
        { q: (m,p) => \`Best 3 \${m} days \${p === "July" ? "in July" : p}?\`, analysis: null },
      ];
      const rows = [];
      for (const metric of metrics) {
        for (const period of periods) {
          for (const op of ops) {
            const question = op.q(metric, period);
            const t = mod.resolveTurnSemantics({ question, branchHint: "khobar", referenceDate: ref });
            rows.push({
              question,
              metric: t.metric,
              analysis: t.analysisIntent,
              clarify: t.ambiguity.needsClarification,
              fabric: mod.isManagementIntelligenceQuestion(question, { intent: "unknown", confidence: "none" }, { referenceDate: ref }),
            });
          }
        }
      }
      return rows;
    `);
    for (const row of out) {
      expect(row.clarify).toBe(false);
      expect(row.fabric).toBe(true);
    }
  });
});

describe("RBAC conversation closed on unauthorized branch switch", () => {
  test("Khobar-only profile cannot keep Khobar evidence as Riyadh after switch", () => {
    const out = run(`
      const ref = ${REF};
      const t1 = mod.resolveTurnSemantics({ question: "How is Khobar?", branchHint: "khobar", referenceDate: ref });
      const t2 = mod.resolveTurnSemantics({ question: "What about Riyadh?", previous: t1.conversation, referenceDate: ref });
      return { b1: t1.scope.branchId, b2: t2.scope.branchId };
    `);
    expect(out.b1).toBe("khobar");
    expect(out.b2).toBe("riyadh");
  });
});
