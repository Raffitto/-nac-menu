/**
 * Pre-release production-mirror: 20-turn semantics + cold-start ambiguity.
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

describe("pre-release production mirror", () => {
  test("20-turn live-style thread stays on Fabric", () => {
    const out = run(`
      const ref = ${REF};
      const qs = [
        "How did we do yesterday?",
        "Good?",
        "Why?",
        "What about that?",
        "Covers?",
        "Normal?",
        "Compare last month",
        "Which days?",
        "What should I watch?",
        "Just the numbers",
        "Explain",
        "Actually July",
        "Best 3",
        "Same for Riyadh",
        "Back to Khobar",
        "Forget comparison",
        "Just yesterday",
        "Today",
        "This month",
        "Trend?",
      ];
      let prev = null;
      return qs.map((q) => {
        const t = mod.resolveTurnSemantics({ question: q, previous: prev, branchHint: "khobar", referenceDate: ref });
        const row = {
          q,
          fabric: mod.isManagementIntelligenceQuestion(q, { intent: "unknown", confidence: "none" }, { priorFabricConversation: prev, referenceDate: ref }),
          clarify: t.ambiguity.needsClarification,
          kind: t.ambiguity.kind,
          branch: t.scope.branchId,
          metric: t.metric,
          start: t.period && t.period.startDate,
          cmp: Boolean(t.comparisonPeriod),
          mode: t.responseMode,
          analysis: t.analysisIntent,
        };
        prev = t.conversation;
        return row;
      });
    `);
    for (const t of out) {
      expect(t.fabric).toBe(true);
    }
    expect(out[0].start).toBe("2026-08-14");
    expect(out[1].analysis).toBe("judgement");
    expect(out[3].clarify).toBe(false);
    expect(out[4].metric).toBe("covers");
    expect(out[6].cmp).toBe(true);
    expect(out[8].analysis).toBe("action");
    expect(out[9].mode).toBe("numbers_only");
    expect(out[10].mode).toBe("detailed_explanation");
    expect(out[11].start).toBe("2026-07-01");
    expect(out[13].branch).toBe("riyadh");
    expect(out[14].branch).toBe("khobar");
    expect(out[16].start).toBe("2026-08-14");
    expect(out[16].cmp).toBe(false);
    expect(out[17].start).toBe("2026-08-15");
    expect(out[19].analysis).toBe("trend");
  });

  test("cold-start ambiguity never invents a commercial subject", () => {
    const out = run(`
      const ref = ${REF};
      return [
        "What about that?",
        "Was that good?",
        "Which days?",
        "Today",
        "Normal Fridays",
        "What should I watch?",
      ].map((q) => {
        const t = mod.resolveTurnSemantics({ question: q, branchHint: "khobar", referenceDate: ref });
        return {
          q,
          fabric: mod.isManagementIntelligenceQuestion(q, { intent: "unknown", confidence: "none" }, { referenceDate: ref }),
          clarify: t.ambiguity.needsClarification,
          kind: t.ambiguity.kind,
          analysis: t.analysisIntent,
          period: t.period && t.period.startDate,
        };
      });
    `);
    expect(out[0].clarify).toBe(true);
    expect(out[0].kind).toBe("missing_referent");
    expect(out[1].clarify).toBe(true);
    expect(out[2].clarify).toBe(true);
    expect(out[3].clarify).toBe(false);
    expect(out[3].period).toBe("2026-08-15");
    expect(out[4].analysis).toBe("anomaly");
    expect(out[5].analysis).toBe("action");
    for (const t of out) expect(t.fabric).toBe(true);
  });
});
