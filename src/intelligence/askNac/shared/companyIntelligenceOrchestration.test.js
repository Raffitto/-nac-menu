const path = require("path");
const { execFileSync } = require("child_process");
const fs = require("fs");

const root = path.resolve(__dirname, "../../../..");
const fabricPath = path.join(root, "supabase/functions/_shared/companyIntelligence/index.ts");
const evalPath = path.join(root, "src/intelligence/askNac/eval/companyIntelligenceEvalCases.json");

function run(body, env = {}) {
  const script = `
    global.Deno = { env: { get: (k) => {
      const map = ${JSON.stringify(env)};
      if (k in map) return map[k];
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
    env: { ...process.env, ...env },
  });
  return JSON.parse(stdout.trim());
}

describe("Company Intelligence orchestration spine", () => {
  test("Ramadan impossible comparison short-circuits with zero tools and zero paid calls", () => {
    const out = run(`
      const result = await mod.runCompanyIntelligenceOrchestration({
        question: "Compare last year's Ramadan sales with this year's Ramadan sales for Khobar.",
        branchHint: "khobar",
        referenceDate: new Date("2026-08-10T12:00:00+03:00"),
        mode: "heuristic",
      });
      return {
        stage: result.state.stage,
        feasibility: result.state.feasibility.status,
        comparability: result.state.comparability?.status || null,
        tools: result.toolsExecuted,
        paid: result.paidModelCalls,
        answer: result.answerText,
        hasSalesTool: result.toolsExecuted.some((t) => /cash_up|sales/.test(t)),
      };
    `);
    expect(out.feasibility).toBe("NOT_ANSWERABLE_AS_REQUESTED");
    expect(out.comparability).toBe("not_comparable");
    expect(out.paid).toBe(0);
    expect(out.hasSalesTool).toBe(false);
    expect(out.tools).toEqual([]);
    expect(out.answer).toMatch(/not operating/i);
    expect(out.answer).toMatch(/not valid/i);
  });

  test("partial 8/10 coverage recommends matched comparison, not raw total delta", () => {
    const out = run(`
      const result = mod.assessComparability({
        current: { startDate: "2026-08-01", endDate: "2026-08-10" },
        comparison: { startDate: "2026-07-22", endDate: "2026-07-31" },
        currentCoverage: mod.buildCoverageReport({
          domain: "sales",
          range: { startDate: "2026-08-01", endDate: "2026-08-10" },
          expectedRecords: 10,
          availableRecords: 8,
        }),
        comparisonCoverage: mod.buildCoverageReport({
          domain: "sales",
          range: { startDate: "2026-07-22", endDate: "2026-07-31" },
          expectedRecords: 10,
          availableRecords: 10,
        }),
      });
      return { status: result.status, method: result.recommendedMethod };
    `);
    expect(out.status).toBe("partially_comparable");
    expect(out.method).toBe("matched_days");
  });

  test("temporary closure adjusts comparability", () => {
    const out = run(`
      const timeline = mod.createStaticBusinessTimeline([
        ...mod.TRUSTED_TIMELINE_EVENTS,
        {
          id: "khobar-closure",
          companyId: "nac_hospitality",
          brandId: "nac",
          branchId: "khobar",
          type: "temporary_closure",
          effectiveDate: "2026-08-05",
          endDate: "2026-08-07",
          source: "test",
        },
      ]);
      const range = { startDate: "2026-08-01", endDate: "2026-08-10" };
      const op = timeline.getOperatingStatus("khobar", range);
      const cmp = mod.assessComparability({
        current: range,
        comparison: { startDate: "2026-07-01", endDate: "2026-07-10" },
        currentOperating: op,
        comparisonOperating: timeline.getOperatingStatus("khobar", { startDate: "2026-07-01", endDate: "2026-07-10" }),
        currentCoverage: mod.buildCoverageReport({ domain: "sales", range, expectedRecords: 10, availableRecords: 7 }),
        comparisonCoverage: mod.buildCoverageReport({
          domain: "sales",
          range: { startDate: "2026-07-01", endDate: "2026-07-10" },
          expectedRecords: 10,
          availableRecords: 10,
        }),
      });
      return { op: op.status, status: cmp.status, method: cmp.recommendedMethod, structural: cmp.structuralDifferences };
    `);
    expect(out.op).toBe("temporary_closure");
    expect(["partially_comparable", "not_comparable"]).toContain(out.status);
  });

  test("Cash Up wins over Foodics on source authority", () => {
    const out = run(`
      return {
        override: mod.canSourceOverride("foodics", "cash_up"),
        preferred: mod.preferCanonicalSource(["foodics", "cash_up"]),
      };
    `);
    expect(out.override).toBe(false);
    expect(out.preferred).toBe("cash_up");
  });

  test("weather + sales decline cannot claim causation", () => {
    const out = run(`
      const sales = mod.createEvidence({
        source: "cash_up", domain: "INTERNAL_STRUCTURED", metricOrEvent: "delta_pct", value: -12,
        textSummary: "sales -12%", branchId: "khobar",
      });
      const weather = mod.createEvidence({
        source: "historical_weather", domain: "EXTERNAL", metricOrEvent: "rain", value: null,
        textSummary: "heavy rain", branchId: "khobar",
      });
      const claims = [
        mod.createClaim({ type: "DERIVED_METRIC", statement: "sales declined 12%", evidenceIds: [sales.id], metricValue: -12 }),
        mod.createClaim({ type: "VERIFIED_FACT", statement: "heavy rain occurred", evidenceIds: [weather.id] }),
        mod.createClaim({ type: "PLAUSIBLE_HYPOTHESIS", statement: "weather may have contributed", evidenceIds: [sales.id, weather.id] }),
      ];
      return mod.verifySynthesizedAnswer({
        answerText: "Rain caused the 12% decline.",
        branchId: "khobar",
        evidence: [sales, weather],
        claims,
      });
    `);
    expect(out.ok).toBe(false);
    expect(out.issues.some((i) => i.code === "unsupported_causal_wording")).toBe(true);
  });

  test("cost question does not fabricate margin", () => {
    const out = run(`
      const result = await mod.runCompanyIntelligenceOrchestration({
        question: "Where are we losing money?",
        branchHint: "khobar",
        referenceDate: new Date("2026-08-10T12:00:00+03:00"),
        mode: "heuristic",
      });
      return {
        caps: result.state.plan.capabilities,
        answer: result.answerText,
        hasFakeMargin: /margin (is|was|at)\\s+\\d/i.test(result.answerText),
      };
    `);
    expect(out.caps).toContain("cost.margin_analysis");
    expect(out.hasFakeMargin).toBe(false);
    expect(out.answer).toMatch(/unavailable|cannot|not available/i);
  });

  test("follow-up And June retains Khobar scope", () => {
    const out = run(`
      const first = await mod.runCompanyIntelligenceOrchestration({
        question: "How was July?",
        branchHint: "khobar",
        referenceDate: new Date("2026-08-10T12:00:00+03:00"),
        mode: "heuristic",
      });
      const second = await mod.runCompanyIntelligenceOrchestration({
        question: "And June?",
        branchHint: null,
        conversation: first.nextConversation,
        referenceDate: new Date("2026-08-10T12:00:00+03:00"),
        mode: "heuristic",
      });
      const third = await mod.runCompanyIntelligenceOrchestration({
        question: "Why the difference?",
        conversation: second.nextConversation,
        referenceDate: new Date("2026-08-10T12:00:00+03:00"),
        mode: "heuristic",
      });
      return {
        b1: first.state.scope.primaryBranchId,
        b2: second.state.scope.primaryBranchId,
        b3: third.state.scope.primaryBranchId,
        june: second.state.periods.current?.semantic || second.state.periods.current?.label || null,
        whyCaps: third.state.plan.capabilities,
        whyCompare: Boolean(third.state.periods.comparison || third.state.comparability),
      };
    `);
    expect(out.b1).toBe("khobar");
    expect(out.b2).toBe("khobar");
    expect(out.b3).toBe("khobar");
    expect(out.whyCompare).toBe(true);
  });

  test("cloud-off still retrieves verified data for management questions", () => {
    const out = run(`
      const result = await mod.runCompanyIntelligenceOrchestration({
        question: "How's business been lately?",
        branchHint: "khobar",
        referenceDate: new Date("2026-08-10T12:00:00+03:00"),
        mode: "offline",
      });
      return {
        paid: result.paidModelCalls,
        tools: result.toolsExecuted,
        hasSales: result.state.evidence.some((e) => e.metricOrEvent === "net_sales"),
        answer: result.answerText,
        offlineNote: /offline mode/i.test(result.answerText),
      };
    `, { MODEL_GATEWAY_CLOUD_ENABLED: "false" });
    expect(out.paid).toBe(0);
    expect(out.hasSales).toBe(true);
    expect(out.answer.length).toBeGreaterThan(20);
  });

  test("provider failure degrades safely", () => {
    const out = run(`
      const failing = {
        id: "openai",
        supports: () => true,
        complete: async () => ({ ok: false, provider: "openai", model: null, content: null, paid: true, error: "down" }),
      };
      const gateway = mod.createModelGateway(
        { openai: failing },
        { ...mod.loadModelGatewayConfig(), cloudEnabled: true, fastProvider: "openai", reasonProvider: "openai", synthesizeProvider: "openai", maxPaidCallsPerAnswer: 2 },
      );
      const result = await mod.runCompanyIntelligenceOrchestration({
        question: "How's business been lately?",
        branchHint: "khobar",
        referenceDate: new Date("2026-08-10T12:00:00+03:00"),
        mode: "auto",
        gateway,
      });
      return {
        stage: result.state.stage,
        answer: result.answerText,
        hasSales: result.state.evidence.some((e) => e.metricOrEvent === "net_sales"),
      };
    `);
    expect(out.stage).toBe("COMPLETE");
    expect(out.hasSales).toBe(true);
    expect(out.answer).toBeTruthy();
  });

  test("planner emits semantic capabilities not SQL", () => {
    const out = run(`
      const result = await mod.runCompanyIntelligenceOrchestration({
        question: "Why was last week shit?",
        branchHint: "khobar",
        referenceDate: new Date("2026-08-10T12:00:00+03:00"),
        mode: "heuristic",
      });
      const caps = result.state.plan.capabilities;
      return {
        caps,
        hasSql: JSON.stringify(caps).toLowerCase().includes("select "),
        hasCommercial: caps.includes("commercial.performance") || caps.includes("commercial.compare"),
        hasOps: caps.includes("operations.review"),
      };
    `);
    expect(out.hasCommercial).toBe(true);
    expect(out.hasOps).toBe(true);
    expect(out.hasSql).toBe(false);
  });

  test("fast path sales yesterday uses zero paid calls", () => {
    const out = run(`
      const result = await mod.runCompanyIntelligenceOrchestration({
        question: "sales yesterday",
        branchHint: "khobar",
        referenceDate: new Date("2026-08-10T12:00:00+03:00"),
        mode: "heuristic",
        legacyRoute: { intent: "vault_cash_up_summary", confidence: "high" },
      });
      return {
        paid: result.paidModelCalls,
        deterministic: result.state.cost.deterministicRouteUsed,
        caps: result.state.plan.capabilities,
      };
    `);
    expect(out.paid).toBe(0);
    expect(out.deterministic).toBe(true);
  });

  test("paid-call ceiling max 2 and feasibility rejection stays at 0", () => {
    const out = run(`
      let calls = 0;
      const openai = {
        id: "openai",
        supports: () => true,
        complete: async () => {
          calls += 1;
          return {
            ok: true,
            provider: "openai",
            model: "gpt-4o-mini",
            content: JSON.stringify({ directAnswer: "Sales were stable." }),
            paid: true,
          };
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
          maxPaidCallsPerAnswer: 2,
        },
      );
      const ordinary = await mod.runCompanyIntelligenceOrchestration({
        question: "How's business been lately?",
        branchHint: "khobar",
        referenceDate: new Date("2026-08-10T12:00:00+03:00"),
        mode: "auto",
        gateway,
        maxPaidCalls: 2,
      });
      const blocked = await mod.runCompanyIntelligenceOrchestration({
        question: "Compare last year's Ramadan sales with this year's for Khobar.",
        branchHint: "khobar",
        referenceDate: new Date("2026-08-10T12:00:00+03:00"),
        mode: "auto",
        gateway,
        maxPaidCalls: 2,
      });
      return {
        ordinaryPaid: ordinary.paidModelCalls,
        blockedPaid: blocked.paidModelCalls,
        blockedTools: blocked.toolsExecuted,
        ceiling: ordinary.state.cost.maxPaidCallsPerAnswer,
      };
    `);
    expect(out.ordinaryPaid).toBeLessThanOrEqual(2);
    expect(out.blockedPaid).toBe(0);
    expect(out.blockedTools).toEqual([]);
  });

  test("multi-turn July→June→difference→weekends retains scope/filters", () => {
    const out = run(`
      const t1 = await mod.runCompanyIntelligenceOrchestration({
        question: "How was July?",
        branchHint: "khobar",
        referenceDate: new Date("2026-08-10T12:00:00+03:00"),
        mode: "heuristic",
      });
      const t2 = await mod.runCompanyIntelligenceOrchestration({
        question: "And June?",
        conversation: t1.nextConversation,
        referenceDate: new Date("2026-08-10T12:00:00+03:00"),
        mode: "heuristic",
      });
      const t3 = await mod.runCompanyIntelligenceOrchestration({
        question: "Why the difference?",
        conversation: t2.nextConversation,
        referenceDate: new Date("2026-08-10T12:00:00+03:00"),
        mode: "heuristic",
      });
      const t4 = mod.resolveFabricFollowUp({
        question: "What about weekends only?",
        previous: t3.nextConversation,
        referenceDate: new Date("2026-08-10T12:00:00+03:00"),
      });
      return {
        branches: [t1, t2, t3].map((t) => t.state.scope.primaryBranchId),
        t2HasPeriod: Boolean(t2.state.periods.current),
        t3Compare: Boolean(t3.state.periods.comparison || t3.state.comparability),
        weekend: t4.conversation.filters.weekendOnly === true,
        weekendBranch: t4.branchId,
      };
    `);
    expect(out.branches).toEqual(["khobar", "khobar", "khobar"]);
    expect(out.t2HasPeriod).toBe(true);
    expect(out.t3Compare).toBe(true);
    expect(out.weekend).toBe(true);
    expect(out.weekendBranch).toBe("khobar");
  });

  test("eval harness still has 64 legacy NL cases plus architecture cases", () => {
    const data = JSON.parse(fs.readFileSync(evalPath, "utf8"));
    const legacy = data.cases.filter((c) => c.legacy_set === "mgmt_nl_64_2026_08_10");
    expect(legacy.length).toBe(64);
  });
});
