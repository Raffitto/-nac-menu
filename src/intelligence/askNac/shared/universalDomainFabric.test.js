/**
 * Universal multi-domain fabric — discovery, authority, RBAC, conflicts.
 */
const path = require("path");
const { execFileSync } = require("child_process");
const fs = require("fs");

const root = path.resolve(__dirname, "../../../..");
const fabricPath = path.join(root, "supabase/functions/_shared/companyIntelligence/index.ts");
const evalPath = path.join(root, "src/intelligence/askNac/eval/universalDomainEvalCases.json");

function run(body) {
  const script = `
    global.Deno = { env: { get: () => undefined } };
    import(${JSON.stringify(fabricPath)}).then(async (mod) => {
      const out = await (async () => { ${body} })();
      process.stdout.write(JSON.stringify(out));
    }).catch((err) => { console.error(String(err && err.stack || err)); process.exit(1); });
  `;
  return JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  }).trim());
}

describe("universal domain registry", () => {
  test("registers only real ingested domains and keeps Cash Up sales authority", () => {
    const out = run(`
      const ids = mod.listRegisteredDomains();
      return {
        ids,
        sales: mod.authorityForMetric("net_sales"),
        basket: mod.authorityForMetric("attach_rate"),
        seven: Boolean(mod.getDomain("seven_rooms")),
        cashNotes: mod.DOMAIN_REGISTRY.cash_up.notAuthoritativeFor,
        commerceNot: mod.DOMAIN_REGISTRY.commerce.notAuthoritativeFor,
      };
    `);
    expect(out.ids).toEqual(expect.arrayContaining(["cash_up", "commerce", "reviews", "reception", "operations", "vault", "menu", "timeline", "calendar_events"]));
    expect(out.ids).not.toContain("seven_rooms");
    expect(out.sales).toBe("cash_up");
    expect(out.basket).toBe("commerce");
    expect(out.seven).toBe(false);
    expect(out.cashNotes.join(" ")).toMatch(/basket/i);
    expect(out.commerceNot.join(" ")).toMatch(/headline/i);
  });
});

describe("universal planner eval", () => {
  test("eval cases have expected domains/limitations", () => {
    const cases = JSON.parse(fs.readFileSync(evalPath, "utf8"));
    expect(cases.length).toBeGreaterThanOrEqual(80);
    const out = run(`
      const cases = ${JSON.stringify(cases)};
      const fail = [];
      for (const c of cases) {
        const prev = c.previousDomains
          ? { intent: "diagnostic", question: "prior", branchScope: ["khobar"], period: null, compare: null, evidence: c.previousDomains.map((d) => ({ domain: d, capability: "commercial.performance" })), alignment: ["period"], synthesis: "management" }
          : null;
        const looks = mod.looksLikeUniversalManagementQuestion(c.question, prev);
        if (c.expectNotUniversal) {
          if (looks) fail.push({ id: c.id, reason: "should_not_be_universal" });
          continue;
        }
        const planned = mod.planUniversalManagement({
          question: c.question,
          branchId: "khobar",
          period: { startDate: "2026-08-11", endDate: "2026-08-17", label: "last 7 days" },
          comparePeriod: { startDate: "2026-08-04", endDate: "2026-08-10" },
          previousPlan: prev,
          weekendOnly: Boolean(c.weekend),
        });
        if (c.expectLimitation) {
          const field = planned.unavailable && planned.unavailable.field;
          if (field !== c.unavailableField) fail.push({ id: c.id, field, expected: c.unavailableField });
          continue;
        }
        if (c.expectEventUnresolved) {
          if (planned.event && planned.event.resolved) fail.push({ id: c.id, reason: "event_should_be_unresolved" });
          continue;
        }
        const got = planned.evidence.map((e) => e.domain);
        const missing = (c.expectedDomains || []).filter((d) => !got.includes(d));
        if (!looks && !got.length && !planned.unavailable) fail.push({ id: c.id, reason: "not_detected", got });
        else if (missing.length) fail.push({ id: c.id, missing, got, intent: planned.intent });
      }
      return { n: cases.length, fail };
    `);
    expect(out.fail).toEqual([]);
    expect(out.n).toBeGreaterThanOrEqual(80);
  });
});

describe("universal RBAC and conflicts", () => {
  test("each evidence leg is blocked when branch is out of scope", () => {
    const out = run(`
      const plan = mod.planUniversalManagement({
        question: "Why were sales weaker this month?",
        branchId: "khobar",
        period: { startDate: "2026-08-01", endDate: "2026-08-17" },
      });
      const scope = mod.createIntelligenceScope({
        primaryBranchId: "khobar",
        branchIds: ["khobar"],
        allowedBranchIds: ["jeddah"],
        canSeeNetwork: false,
      });
      const executed = await mod.executeUniversalPlan({
        plan,
        scope,
        executor: mod.createMockCapabilityExecutor(),
        commerceStore: null,
      });
      return {
        skipped: executed.evidence.every((e) => e.skipped),
        reasons: executed.evidence.map((e) => e.skipReason),
      };
    `);
    expect(out.skipped).toBe(true);
    expect(out.reasons.join(" ")).toMatch(/access|RBAC|include/i);
  });

  test("Cash Up and commerce check totals are not averaged", () => {
    const out = run(`
      const conflicts = mod.detectSourceConflicts([
        { domain: "cash_up", authority: "headline_management_sales", metric: "net_sales", value: 100000, period: null, branchScope: ["khobar"], quality: "strong_direct", provenance: "cash_up", warnings: [] },
        { domain: "commerce", authority: "canonical_order_basket", metric: "net_sales", value: 140000, period: null, branchScope: ["khobar"], quality: "strong_derived", provenance: "commerce", warnings: [] },
      ]);
      return { n: conflicts.length, text: conflicts[0] && conflicts[0].statement };
    `);
    expect(out.n).toBeGreaterThan(0);
    expect(out.text).toMatch(/not averaged/i);
    expect(out.text).toMatch(/Cash Up/i);
  });
});
