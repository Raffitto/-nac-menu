const path = require("path");
const { execFileSync } = require("child_process");
const fs = require("fs");

const root = path.resolve(__dirname, "../../../..");
const fabricPath = path.join(root, "supabase/functions/_shared/companyIntelligence/index.ts");
const evalPath = path.join(root, "src/intelligence/askNac/eval/companyIntelligenceEvalCases.json");

function run(body) {
  const script = `
    global.Deno = { env: { get: (k) => {
      if (k === "MODEL_GATEWAY_CLOUD_ENABLED") return process.env.MODEL_GATEWAY_CLOUD_ENABLED;
      if (k === "MODEL_GATEWAY_MAX_PAID_CALLS") return process.env.MODEL_GATEWAY_MAX_PAID_CALLS;
      if (k === "MODEL_GATEWAY_FAST_PROVIDER") return process.env.MODEL_GATEWAY_FAST_PROVIDER;
      if (k === "MODEL_GATEWAY_REASON_PROVIDER") return process.env.MODEL_GATEWAY_REASON_PROVIDER;
      return undefined;
    } } };
    import(${JSON.stringify(fabricPath)}).then(async (mod) => {
      const out = await (async () => { ${body} })();
      process.stdout.write(JSON.stringify(out));
    }).catch((err) => { console.error(err); process.exit(1); });
  `;
  const stdout = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: root,
    encoding: "utf8",
    env: process.env,
  });
  return JSON.parse(stdout.trim());
}

describe("Company Intelligence Fabric foundation", () => {
  test("branch scope remains Khobar when requested", () => {
    const out = run(`
      const scope = mod.createIntelligenceScope({ primaryBranchId: "khobar", branchIds: ["khobar"] });
      return mod.assertBranchScopePreserved(scope, "khobar");
    `);
    expect(out.ok).toBe(true);
  });

  test("company→brand→branch state supported", () => {
    const out = run(`
      const state = mod.createCompanyIntelligenceState({
        originalQuestion: "How was July?",
        scope: { companyId: "nac_hospitality", brandId: "nac", primaryBranchId: "khobar" },
      });
      return {
        company: state.scope.companyId,
        brand: state.scope.brandId,
        branch: state.scope.primaryBranchId,
      };
    `);
    expect(out).toEqual({
      company: "nac_hospitality",
      brand: "nac",
      branch: "khobar",
    });
  });

  test("feasibility returns NOT_ANSWERABLE for Khobar before opening / Ramadan baseline", () => {
    const out = run(`
      const state = mod.bootstrapFabricState({
        question: "Compare last year's Ramadan with this year's Ramadan for Khobar and explain why performance changed.",
        branchHint: "khobar",
        referenceDate: new Date("2026-08-10T12:00:00+03:00"),
      });
      return {
        status: state.feasibility.status,
        reasons: state.feasibility.reasons,
        answer: mod.buildInfeasibleComparisonAnswer(state),
        opening: mod.defaultBusinessTimeline.getOpeningDate("khobar"),
        baselineEnd: state.periods.comparison?.endDate || null,
      };
    `);
    expect(out.opening).toBe("2025-04-27");
    expect(out.status).toBe("NOT_ANSWERABLE_AS_REQUESTED");
    expect(out.reasons).toContain("branch_not_operating_in_baseline_period");
    expect(out.answer).toMatch(/not operating/i);
    expect(out.answer).toMatch(/not valid/i);
  });

  test("comparability engine refuses invalid comparisons", () => {
    const out = run(`
      const timeline = mod.defaultBusinessTimeline;
      const baseline = { startDate: "2025-03-01", endDate: "2025-03-29", label: "Ramadan 2025" };
      const current = { startDate: "2026-02-18", endDate: "2026-03-19", label: "Ramadan 2026" };
      const result = mod.assessComparability({
        current,
        comparison: baseline,
        comparisonOperating: timeline.getOperatingStatus("khobar", baseline),
        currentOperating: timeline.getOperatingStatus("khobar", current),
      });
      return result;
    `);
    expect(out.status).toBe("not_comparable");
    expect(out.recommendedMethod).toBe("none");
  });

  test("partial coverage selects matched/normalized method", () => {
    const out = run(`
      const result = mod.assessComparability({
        current: { startDate: "2026-08-01", endDate: "2026-08-10" },
        comparison: { startDate: "2026-07-01", endDate: "2026-07-10" },
        currentCoverage: mod.buildCoverageReport({
          domain: "sales",
          range: { startDate: "2026-08-01", endDate: "2026-08-10" },
          expectedRecords: 10,
          availableRecords: 7,
        }),
        comparisonCoverage: mod.buildCoverageReport({
          domain: "sales",
          range: { startDate: "2026-07-01", endDate: "2026-07-10" },
          expectedRecords: 10,
          availableRecords: 10,
        }),
      });
      return { status: result.status, method: result.recommendedMethod };
    `);
    expect(out.status).toBe("partially_comparable");
    expect(out.method).toBe("matched_days");
  });

  test("source authority prevents Foodics canonical override", () => {
    const out = run(`
      return {
        canOverride: mod.canSourceOverride("foodics", "cash_up"),
        preferred: mod.preferCanonicalSource(["foodics", "cash_up"]),
        foodicsAuth: mod.getSourceAuthority("foodics").authority,
      };
    `);
    expect(out.canOverride).toBe(false);
    expect(out.preferred).toBe("cash_up");
    expect(out.foodicsAuth).toBe("LEGACY_EXTERNAL_EVIDENCE");
  });

  test("evidence claim references source provenance", () => {
    const out = run(`
      const ev = mod.createEvidence({
        source: "cash_up",
        domain: "INTERNAL_STRUCTURED",
        branchId: "khobar",
        metricOrEvent: "net_sales",
        value: 100,
        textSummary: "Net sales 100",
      });
      const claim = mod.createClaim({
        type: "VERIFIED_FACT",
        statement: "Net sales were 100",
        evidenceIds: [ev.id],
        metricValue: 100,
        branchId: "khobar",
      });
      return {
        auth: ev.sourceAuthority,
        refsOk: mod.claimReferencesEvidence(claim, [ev]),
      };
    `);
    expect(out.auth).toBe("CANONICAL_STRUCTURED");
    expect(out.refsOk).toBe(true);
  });

  test("causal verifier rejects unsupported causal wording", () => {
    const out = run(`
      const causal = mod.assessCausalLanguage("Rain caused the 12% decline.");
      const verified = mod.verifySynthesizedAnswer({
        answerText: "Rain caused the 12% decline.",
        branchId: "khobar",
        evidence: [],
        claims: [],
      });
      return { causalOk: causal.ok, verifierOk: verified.ok, repaired: verified.repairedAnswer };
    `);
    expect(out.causalOk).toBe(false);
    expect(out.verifierOk).toBe(false);
    expect(out.repaired).toMatch(/coincided with/i);
  });

  test("research budget routes simple lookup to Level 0", () => {
    const out = run(`
      return mod.decideResearchBudget({
        question: "How was July?",
        capabilities: ["commercial.performance"],
        deterministicRouteHighConfidence: true,
      });
    `);
    expect(out.tier).toBe(0);
    expect(out.allowPaidModel).toBe(false);
  });

  test("complex investigation routes to Level 2/3", () => {
    const out = run(`
      return mod.decideResearchBudget({
        question: "Compare last year's Ramadan with this year's and explain why with weather context",
        capabilities: ["commercial.compare", "research.external_events"],
        requiresComparison: true,
        requiresExternalResearch: true,
      });
    `);
    expect(out.tier).toBeGreaterThanOrEqual(2);
  });

  test("ModelGateway can swap provider adapter without business-code change", () => {
    const out = run(`
      const local = {
        id: "openai_compatible_local",
        supports: () => true,
        complete: async () => ({
          ok: true,
          provider: "openai_compatible_local",
          model: "lab-model",
          content: JSON.stringify({ intent: "performance_overview" }),
          paid: false,
        }),
      };
      const gateway = mod.createModelGateway(
        { openai_compatible_local: local },
        {
          ...mod.loadModelGatewayConfig(),
          fastProvider: "openai_compatible_local",
          reasonProvider: "openai_compatible_local",
          synthesizeProvider: "openai_compatible_local",
          cloudEnabled: false,
          maxPaidCallsPerAnswer: 0,
        },
      );
      const res = await gateway.plan({ system: "x", user: "y", json: true });
      return { provider: res.provider, paid: res.paid, ok: res.ok };
    `);
    expect(out).toEqual({ provider: "openai_compatible_local", paid: false, ok: true });
  });

  test("local-provider failure can fall back safely when cloud enabled", () => {
    const out = run(`
      const local = {
        id: "openai_compatible_local",
        supports: () => true,
        complete: async () => ({
          ok: false, provider: "openai_compatible_local", model: "x", content: null, paid: false, error: "down",
        }),
      };
      const openai = {
        id: "openai",
        supports: () => true,
        complete: async () => ({
          ok: true, provider: "openai", model: "gpt-4o-mini", content: "{}", paid: true,
        }),
      };
      const gateway = mod.createModelGateway(
        { openai_compatible_local: local, openai },
        {
          ...mod.loadModelGatewayConfig(),
          fastProvider: "openai_compatible_local",
          reasonProvider: "openai",
          synthesizeProvider: "openai",
          cloudEnabled: true,
          maxPaidCallsPerAnswer: 2,
        },
      );
      const res = await gateway.plan({ system: "x", user: "y" });
      return { provider: res.provider, ok: res.ok, paidCalls: gateway.paidCallsUsed };
    `);
    expect(out.ok).toBe(true);
    expect(out.provider).toBe("openai");
    expect(out.paidCalls).toBe(1);
  });

  test("cloud escalation can be disabled", () => {
    const out = run(`
      process.env.MODEL_GATEWAY_CLOUD_ENABLED = "false";
      const local = {
        id: "openai_compatible_local",
        supports: () => true,
        complete: async () => ({
          ok: false, provider: "openai_compatible_local", model: "x", content: null, paid: false, error: "down",
        }),
      };
      const openai = {
        id: "openai",
        supports: () => true,
        complete: async () => ({
          ok: true, provider: "openai", model: "gpt-4o-mini", content: "{}", paid: true,
        }),
      };
      const gateway = mod.createModelGateway(
        { openai_compatible_local: local, openai },
        {
          ...mod.loadModelGatewayConfig(),
          fastProvider: "openai_compatible_local",
          reasonProvider: "openai",
          synthesizeProvider: "openai",
          cloudEnabled: false,
          maxPaidCallsPerAnswer: 2,
        },
      );
      const res = await gateway.plan({ system: "x", user: "y" });
      return { ok: res.ok, error: res.error, paidCalls: gateway.paidCallsUsed };
    `);
    expect(out.ok).toBe(false);
    expect(out.paidCalls).toBe(0);
  });

  test("paid-call budget can be capped", () => {
    const out = run(`
      let calls = 0;
      const openai = {
        id: "openai",
        supports: () => true,
        complete: async () => {
          calls += 1;
          return { ok: true, provider: "openai", model: "gpt-4o-mini", content: "{}", paid: true };
        },
      };
      const gateway = mod.createModelGateway(
        { openai },
        {
          ...mod.loadModelGatewayConfig(),
          fastProvider: "openai",
          reasonProvider: "openai",
          synthesizeProvider: "openai",
          cloudEnabled: true,
          maxPaidCallsPerAnswer: 1,
        },
      );
      const a = await gateway.plan({ system: "x", user: "1" });
      const b = await gateway.plan({ system: "x", user: "2" });
      return { a: a.ok, bOk: b.ok, bErr: b.error, paid: gateway.paidCallsUsed, calls };
    `);
    expect(out.a).toBe(true);
    expect(out.bOk).toBe(false);
    expect(out.bErr).toBe("paid_call_budget_exhausted");
    expect(out.paid).toBe(1);
  });

  test("structured conversation state persists filters", () => {
    const out = run(`
      let state = mod.createEmptyConversationState();
      state = mod.updateConversationState(state, {
        activeBranchId: "khobar",
        filterPatch: { channel: "dine_in" },
      });
      state = mod.resolveFollowUpScope(state, null, true);
      return { branch: state.activeBranchId, filters: state.filters };
    `);
    expect(out.branch).toBe("khobar");
    expect(out.filters.channel).toBe("dine_in");
    expect(out.filters.weekendOnly).toBe(true);
  });

  test("verifier catches wrong branch/date/value issues", () => {
    const out = run(`
      const ev = mod.createEvidence({
        source: "cash_up",
        domain: "INTERNAL_STRUCTURED",
        branchId: "khobar",
        metricOrEvent: "delta_pct",
        value: 9,
        textSummary: "down 9%",
      });
      return mod.verifySynthesizedAnswer({
        answerText: "For Riyadh, sales declined 9%. vault_cash_up_summary debug",
        branchId: "khobar",
        period: { startDate: "2026-08-01", endDate: "2026-08-10" },
        evidence: [ev],
        claims: [mod.createClaim({ type: "VERIFIED_FACT", statement: "down 9%", evidenceIds: [ev.id], metricValue: 9 })],
      });
    `);
    expect(out.ok).toBe(false);
    expect(out.issues.some((i) => i.code === "debug_leak")).toBe(true);
  });

  test("eval harness retains existing natural-language regression cases", () => {
    const data = JSON.parse(fs.readFileSync(evalPath, "utf8"));
    expect(data.cases.length).toBeGreaterThanOrEqual(64);
    const legacy = data.cases.filter((c) => c.legacy_set === "mgmt_nl_64_2026_08_10");
    expect(legacy.length).toBe(64);
    expect(legacy.some((c) => /business been lately/i.test(c.question))).toBe(true);
    expect(data.categories_planned).toContain("impossible_comparisons");
  });

  test("safe analytics does not invent unsupported ops", () => {
    const out = run(`
      return mod.runSafeAnalytics({ op: "percent_change", values: [90], baselineValues: [100] });
    `);
    expect(out.ok).toBe(true);
    expect(out.result).toBe(-10);
  });

  test("sales from 9 to 13 aug does not fall back to last 7 days", () => {
    const out = run(`
      const resolved = mod.defaultTemporalService.resolveFromQuestion(
        "sales from 9 to 13 aug",
        new Date("2026-08-14T16:16:00.000Z"),
      );
      return resolved;
    `);
    expect(out.status).toBe("resolved");
    expect(out.range?.startDate).toBe("2026-08-09");
    expect(out.range?.endDate).toBe("2026-08-13");
    expect(out.range?.semantic).not.toBe("last_7_days");
  });

  test("yesterday on 14 Aug 2026 Asia/Riyadh resolves to 13 Aug", () => {
    const out = run(`
      const resolved = mod.defaultTemporalService.resolveFromQuestion(
        "what was the sales of yesterday",
        new Date("2026-08-14T16:16:00.000Z"),
      );
      return resolved.range;
    `);
    expect(out.startDate).toBe("2026-08-13");
    expect(out.endDate).toBe("2026-08-13");
  });

  test("missing yesterday names the date and may offer latest without substituting sales", () => {
    const out = run(`
      const period = { startDate: "2026-08-13", endDate: "2026-08-13", label: "13 August 2026" };
      const missing = mod.synthesizeDeterministicAnswer({
        question: "what was the sales of yesterday",
        branchId: "khobar",
        period,
        evidence: [],
        claims: [],
        coverage: [mod.buildCoverageReport({
          domain: "sales",
          range: period,
          expectedRecords: 1,
          availableRecords: 0,
          freshness: "2026-08-08",
        })],
      });
      const missingNoLatest = mod.synthesizeDeterministicAnswer({
        question: "what was the sales of yesterday",
        branchId: "khobar",
        period,
        evidence: [],
        claims: [],
        coverage: [mod.buildCoverageReport({
          domain: "sales",
          range: period,
          expectedRecords: 1,
          availableRecords: 0,
        })],
      });
      const exact = mod.synthesizeDeterministicAnswer({
        question: "what was the sales of yesterday",
        branchId: "khobar",
        period,
        evidence: [mod.createEvidence({
          source: "cash_up",
          domain: "INTERNAL_STRUCTURED",
          branchId: "khobar",
          metricOrEvent: "net_sales",
          value: 18100,
          textSummary: "Net sales 18100",
          period,
        })],
        claims: [],
        coverage: [mod.buildCoverageReport({
          domain: "sales",
          range: period,
          expectedRecords: 1,
          availableRecords: 1,
        })],
      });
      return { missing, missingNoLatest, exact };
    `);
    expect(out.missing).toMatch(/13 August 2026/);
    expect(out.missing).toMatch(/not yet available in the canonical data/i);
    expect(out.missing).toMatch(/latest completed Cash Up I have is (2026-08-08|8 Aug 2026)/);
    expect(out.missing).not.toMatch(/0 of the requested 1/);
    expect(out.missing).not.toMatch(/18100/);
    expect(out.missingNoLatest).toMatch(/not yet available in the canonical data/i);
    expect(out.missingNoLatest).not.toMatch(/latest completed/);
    expect(out.exact).toMatch(/18100/);
    expect(out.exact).not.toMatch(/not yet available/);
  });

  test("incomplete week wording uses coverage dates and names the missing day", () => {
    const out = run(`
      const period = {
        startDate: "2026-08-31",
        endDate: "2026-09-06",
        label: "Monday, 31 August – Sunday, 6 September",
      };
      const coverage = [mod.buildCoverageReport({
        domain: "sales",
        range: period,
        expectedRecords: 7,
        availableRecords: 6,
        freshness: "2026-09-05",
      })];
      const evidence = [
        mod.createEvidence({
          source: "cash_up",
          domain: "INTERNAL_STRUCTURED",
          branchId: "khobar",
          metricOrEvent: "net_sales",
          value: 106224.3,
          textSummary: "Net sales 106224.3",
          period: { startDate: "2026-08-31", endDate: "2026-09-05" },
        }),
        mod.createEvidence({
          source: "cash_up",
          domain: "INTERNAL_STRUCTURED",
          branchId: "khobar",
          metricOrEvent: "covers",
          value: 1191,
          period: { startDate: "2026-08-31", endDate: "2026-09-05" },
        }),
        mod.createEvidence({
          source: "cash_up",
          domain: "INTERNAL_STRUCTURED",
          branchId: "khobar",
          metricOrEvent: "day_count",
          value: 6,
        }),
      ];
      const answer = mod.synthesizeDeterministicAnswer({
        question: "what are sales this week",
        branchId: "khobar",
        period,
        evidence,
        claims: [],
        coverage,
      });
      const verified = mod.verifySynthesizedAnswer({
        answerText: "For Khobar in Monday, 31 August – Sunday, 6 September, net sales were SAR 106224.3.",
        branchId: "khobar",
        period,
        evidence,
        coverage,
      });
      return { answer, verified };
    `);
    expect(out.answer).toMatch(/5 Sep 2026/);
    expect(out.answer).toMatch(/106224/);
    expect(out.answer).not.toMatch(/6 of the requested 7/);
    expect(out.answer).not.toMatch(/6 Sep 2026 does not have sales data yet/i);
    expect(out.verified.ok).toBe(false);
    expect(out.verified.issues.some((i) => i.code === "incomplete_range_presented_as_complete")).toBe(true);
    expect(out.verified.repairedAnswer).toMatch(/through 5 Sep 2026/i);
  });

  test("LLM week sentence with US dates is rewritten even if it says partial coverage", () => {
    const out = run(`
      const period = {
        startDate: "2026-08-31",
        endDate: "2026-09-06",
        label: "this week",
      };
      const coverage = [mod.buildCoverageReport({
        domain: "sales",
        range: period,
        expectedRecords: 7,
        availableRecords: 6,
        freshness: "2026-09-05",
      })];
      return mod.verifySynthesizedAnswer({
        answerText: "Sales for this week (August 31, 2026 - September 6, 2026) are as follows: Net sales: 106224.30 SAR. Note that there is partial coverage with 1 missing day.",
        branchId: "khobar",
        period,
        evidence: [],
        coverage,
      });
    `);
    expect(out.ok).toBe(false);
    expect(out.repairedAnswer).toMatch(/through 5 Sep 2026/i);
    expect(out.repairedAnswer).not.toMatch(/September 6, 2026/);
  });
});
