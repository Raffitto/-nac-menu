/**
 * Commerce Ask NAC semantics: dessert tables ≠ tables that ordered dessert.
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

describe("commerce turn semantics", () => {
  test("dessert tables is dessert-focused, not full-service", () => {
    const out = run(`
      return {
        a: mod.extractCommerceFocus("What percentage of our tables were dessert tables this month?"),
        b: mod.extractCommerceFocus("tables that ordered dessert"),
        c: mod.extractCommerceFocus("What percentage of food tables ordered dessert?"),
        d: mod.extractCommerceFocus("Dessert tables vs food tables this month"),
      };
    `);
    expect(out.a).toBe("dessert_focused");
    expect(out.b).toBe("basket");
    expect(out.c).toBe("dessert_conversion");
    expect(out.d).toBe("session_mix");
  });

  test("commerce questions stay on Fabric and do not invent session facts", () => {
    const out = run(`
      const t = mod.resolveTurnSemantics({ question: "What percentage of our tables were dessert tables this month?", branchHint: "khobar", referenceDate: ${REF} });
      const text = mod.synthesizeDeterministicAnswer({
        question: t.resolvedQuestion,
        branchId: "khobar",
        period: t.period,
        evidence: [],
        claims: [],
        coverage: [],
        commerceFocus: t.commerceFocus,
      });
      return { fabric: mod.isFabricManagedTurn("What percentage of our tables were dessert tables this month?"), focus: t.commerceFocus, text };
    `);
    expect(out.fabric).toBe(true);
    expect(out.focus).toBe("dessert_focused");
    expect(out.text).toMatch(/not available yet/i);
    expect(out.text).toMatch(/Cash Up remains the headline/i);
  });

  test("closed-month ranking label is July 2026 not July through 31 July", () => {
    const out = run(`
      return mod.formatThroughPeriod({ startDate: "2026-07-01", endDate: "2026-07-31", label: "July 2026", semantic: "named_month" }, ${REF});
    `);
    expect(out).toBe("July 2026");
  });

  test("cold What should I watch asks for a period", () => {
    const out = run(`
      const t = mod.resolveTurnSemantics({ question: "What should I watch?", branchHint: "khobar", referenceDate: ${REF} });
      return { clarify: t.ambiguity.needsClarification, prompt: t.ambiguity.prompt, intent: t.analysisIntent };
    `);
    expect(out.clarify).toBe(true);
    expect(out.prompt).toMatch(/period/i);
    expect(out.intent).toBe("action");
  });

  test("What about that after Why inherits the diagnostic", () => {
    const out = run(`
      const t1 = mod.resolveTurnSemantics({ question: "How did we do yesterday?", branchHint: "khobar", referenceDate: ${REF} });
      const t2 = mod.resolveTurnSemantics({ question: "Why?", previous: t1.conversation, referenceDate: ${REF} });
      const t3 = mod.resolveTurnSemantics({ question: "What about that?", previous: t2.conversation, referenceDate: ${REF} });
      return { why: t2.analysisIntent, follow: t3.analysisIntent, notes: t3.notes };
    `);
    expect(out.why).toBe("why");
    expect(out.follow).toBe("why");
    expect(out.notes).toContain("pronoun_inherits_diagnostic");
  });

  test("Explain after Why expands the diagnostic subject", () => {
    const out = run(`
      const t1 = mod.resolveTurnSemantics({ question: "How did we do yesterday?", branchHint: "khobar", referenceDate: ${REF} });
      const t2 = mod.resolveTurnSemantics({ question: "Why?", previous: t1.conversation, referenceDate: ${REF} });
      const t3 = mod.resolveTurnSemantics({ question: "Explain", previous: t2.conversation, referenceDate: ${REF} });
      return { mode: t3.responseMode, intent: t3.analysisIntent, notes: t3.notes };
    `);
    expect(out.mode).toBe("detailed_explanation");
    expect(out.intent).toBe("why");
    expect(out.notes).toContain("explain_expands_current_subject");
  });
});
