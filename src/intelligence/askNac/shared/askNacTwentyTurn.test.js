/**
 * 20-turn management conversation: slot integrity without stale leakage.
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

describe("20-turn conversation torture", () => {
  test("slots stay coherent across 20 management turns", () => {
    const out = run(`
      const ref = ${REF};
      const qs = [
        "How are we doing this month?",
        "What about covers?",
        "Good?",
        "Why?",
        "What stands out?",
        "Which days?",
        "Just the numbers.",
        "Explain.",
        "Compare last month.",
        "Was that broad weakness?",
        "What should I watch?",
        "Actually July.",
        "Covers instead.",
        "Best 3 days.",
        "Worst?",
        "Same for Riyadh.",
        "Why?",
        "Back to Khobar.",
        "Forget the comparison.",
        "Just yesterday.",
      ];
      let prev = null;
      const turns = [];
      for (const q of qs) {
        const t = mod.resolveTurnSemantics({ question: q, previous: prev, branchHint: "khobar", referenceDate: ref });
        turns.push({
          q,
          branch: t.scope.branchId,
          metric: t.metric,
          start: t.period && t.period.startDate,
          end: t.period && t.period.endDate,
          cmp: Boolean(t.comparisonPeriod),
          mode: t.responseMode,
          analysis: t.analysisIntent,
          ranking: t.ranking,
          clarify: t.ambiguity.needsClarification,
          fabric: mod.isManagementIntelligenceQuestion(q, { intent: "unknown", confidence: "none" }, { priorFabricConversation: prev, referenceDate: ref }),
        });
        prev = t.conversation;
      }
      return turns;
    `);
    for (const t of out) {
      expect(t.fabric).toBe(true);
      expect(t.clarify).toBe(false);
    }
    expect(out[0].mode).toBe("fact");
    expect(out[1].metric).toBe("covers");
    expect(out[2].analysis).toBe("judgement");
    expect(out[3].analysis).toBe("why");
    expect(out[4].analysis).toBe("stands_out");
    expect(out[5].analysis).toBe("contributors");
    expect(out[6].mode).toBe("numbers_only");
    expect(out[6].metric).toBe("covers");
    expect(out[7].mode).toBe("detailed_explanation");
    expect(out[8].cmp).toBe(true);
    expect(out[9].analysis).toBe("breadth");
    expect(out[10].analysis).toBe("action");
    expect(out[11].start).toBe("2026-07-01");
    expect(out[11].end).toBe("2026-07-31");
    expect(out[12].metric).toBe("covers");
    expect(out[13].ranking).toBe("top");
    expect(out[14].ranking).toBe("bottom");
    expect(out[15].branch).toBe("riyadh");
    expect(out[15].ranking).toBe("bottom");
    expect(out[16].analysis).toBe("why");
    expect(out[16].branch).toBe("riyadh");
    expect(out[17].branch).toBe("khobar");
    expect(out[18].cmp).toBe(false);
    expect(out[19].start).toBe("2026-08-14");
    expect(out[19].end).toBe("2026-08-14");
    expect(out[19].cmp).toBe(false);
  });
});
