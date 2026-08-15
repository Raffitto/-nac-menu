/**
 * v83 commercial evidence + temporal follow-up regression.
 * Exercises Fabric orchestrator with canonical Cash Up answer shapes.
 */
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.resolve(__dirname, "../../../..");
const fabricPath = path.join(root, "supabase/functions/_shared/companyIntelligence/index.ts");
const orchPath = path.join(root, "supabase/functions/_shared/askNacOrchestrator.ts");

const CASH_UP_TOOL_JSON = JSON.stringify({
  answerType: "metric",
  directAnswer: "Cash-up aggregation for the requested period.",
  keyMetrics: [
    { label: "Net sales", value: "412,345.50", unit: "SAR", source: "cash_up" },
    { label: "Guest count", value: "8,210", source: "cash_up" },
  ],
  conversationDataset: {
    kind: "cash_up_aggregation",
    reportType: "cash_up",
    metric: "net_sales",
    aggregation: {
      totalSales: 412345.5,
      totalGuests: 8210,
      averageSpend: 50.22,
      dayCount: 28,
      expectedDayCount: 31,
    },
  },
  matchedCoverage: { domain: "sales", expectedDays: 31, availableDays: 28 },
  warnings: [],
});

function run(body, entry = fabricPath) {
  const script = `
    global.Deno = { env: { get: () => undefined } };
    import(${JSON.stringify(entry)}).then(async (mod) => {
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

function clientHint(profile) {
  return {
    authenticated: Boolean(profile.authenticated),
    allBranches: Boolean(profile.allBranches),
    branchScope: profile.branchScope ?? null,
  };
}

const EXECUTOR_HELPER = `
  const calls = [];
  const cashUpTool = ${CASH_UP_TOOL_JSON};
  const executor = mod.createVaultCapabilityExecutor(async ({ request }) => {
    calls.push({
      capability: request.capability,
      branchId: request.branchId,
      start: request.currentPeriod?.startDate || null,
      end: request.currentPeriod?.endDate || null,
    });
    return cashUpTool;
  });
`;

describe("Commercial evidence + temporal follow-up (v83)", () => {
  test("1. developer/network July → commercial capability + exact July period + Cash Up survives normalize", () => {
    const out = run(`
      ${EXECUTOR_HELPER}
      const authorized = mod.resolveAuthorizedIntelligenceScope({
        profile: ${JSON.stringify(clientHint({ authenticated: true, allBranches: true, branchScope: null }))},
      });
      const spine = await mod.runCompanyIntelligenceOrchestration({
        question: "How did July perform overall?",
        scope: authorized.scope,
        referenceDate: new Date("2026-08-11T12:00:00Z"),
        mode: "heuristic",
        executor,
      });
      const perf = calls.find((c) => c.capability === "commercial.performance");
      return {
        calls: calls.map((c) => c.capability),
        perf,
        network: spine.state.scope.access.canSeeNetwork,
        period: spine.state.periods.current,
        reasons: spine.state.feasibility?.reasons || [],
        hasNetSales: (spine.keyMetrics || []).some((m) => Number(m.value) === 412345.5),
        answer: String(spine.answerText || ""),
        unavailable: String(spine.answerText || "").includes("limited or unavailable"),
      };
    `);
    expect(out.calls).toContain("commercial.performance");
    expect(out.perf.start).toBe("2026-07-01");
    expect(out.perf.end).toBe("2026-07-31");
    expect(out.network).toBe(true);
    expect(out.period.startDate).toBe("2026-07-01");
    expect(out.period.endDate).toBe("2026-07-31");
    expect(out.reasons).not.toContain("scope_ambiguous");
    expect(out.hasNetSales).toBe(true);
    expect(out.unavailable).toBe(false);
    expect(out.answer).toMatch(/412,?345|Cash Up net sales/i);
  });

  test("2. Khobar staff July → same capability with Khobar scope", () => {
    const out = run(`
      ${EXECUTOR_HELPER}
      const authorized = mod.resolveAuthorizedIntelligenceScope({
        profile: ${JSON.stringify(clientHint({ authenticated: true, allBranches: false, branchScope: "khobar" }))},
      });
      const spine = await mod.runCompanyIntelligenceOrchestration({
        question: "How did July perform overall?",
        scope: authorized.scope,
        branchHint: authorized.scope.primaryBranchId,
        referenceDate: new Date("2026-08-11T12:00:00Z"),
        mode: "heuristic",
        executor,
      });
      const perf = calls.find((c) => c.capability === "commercial.performance");
      return {
        perf,
        primary: spine.state.scope.primaryBranchId,
        network: spine.state.scope.access.canSeeNetwork,
        unavailable: String(spine.answerText || "").includes("limited or unavailable"),
      };
    `);
    expect(out.perf.capability).toBe("commercial.performance");
    expect(out.perf.branchId).toBe("khobar");
    expect(out.primary).toBe("khobar");
    expect(out.network).toBe(false);
    expect(out.unavailable).toBe(false);
  });

  test("3. follow-up what about June → exact June 2026, inherited commercial, NOT last 7 days", () => {
    const out = run(`
      ${EXECUTOR_HELPER}
      const authorized = mod.resolveAuthorizedIntelligenceScope({
        profile: ${JSON.stringify(clientHint({ authenticated: true, allBranches: true, branchScope: null }))},
      });
      const july = await mod.runCompanyIntelligenceOrchestration({
        question: "How did July perform overall?",
        scope: authorized.scope,
        referenceDate: new Date("2026-08-11T12:00:00Z"),
        mode: "heuristic",
        executor,
      });
      const beforeJune = calls.length;
      const june = await mod.runCompanyIntelligenceOrchestration({
        question: "what about June",
        scope: authorized.scope,
        conversation: july.nextConversation,
        referenceDate: new Date("2026-08-11T12:00:00Z"),
        mode: "heuristic",
        executor,
      });
      const juneCalls = calls.slice(beforeJune);
      return {
        julyPeriod: july.state.periods.current,
        junePeriod: june.state.periods.current,
        normalizedQ: june.state.request.normalizedQuestion,
        juneCaps: juneCalls.map((c) => c.capability),
        junePerf: juneCalls.find((c) => c.capability === "commercial.performance") || null,
        answer: String(june.answerText || ""),
        isLast7: String(june.state.periods.current?.semantic || "").includes("last_7")
          || String(june.state.periods.current?.label || "").toLowerCase().includes("last 7"),
      };
    `);
    expect(out.julyPeriod.startDate).toBe("2026-07-01");
    expect(out.junePeriod.startDate).toBe("2026-06-01");
    expect(out.junePeriod.endDate).toBe("2026-06-30");
    expect(out.isLast7).toBe(false);
    expect(out.normalizedQ.toLowerCase()).toMatch(/june/);
    expect(out.juneCaps.some((c) => String(c).startsWith("commercial."))).toBe(true);
    expect(out.junePerf.start).toBe("2026-06-01");
    expect(out.answer).not.toMatch(/last 7 days/i);
  });

  test("4. follow-up what about jan 2026 → exact Jan 2026, keeps commercial intent", () => {
    const out = run(`
      ${EXECUTOR_HELPER}
      const authorized = mod.resolveAuthorizedIntelligenceScope({
        profile: ${JSON.stringify(clientHint({ authenticated: true, allBranches: true, branchScope: null }))},
      });
      const july = await mod.runCompanyIntelligenceOrchestration({
        question: "How did July perform overall?",
        scope: authorized.scope,
        referenceDate: new Date("2026-08-11T12:00:00Z"),
        mode: "heuristic",
        executor,
      });
      const june = await mod.runCompanyIntelligenceOrchestration({
        question: "what about June",
        scope: authorized.scope,
        conversation: july.nextConversation,
        referenceDate: new Date("2026-08-11T12:00:00Z"),
        mode: "heuristic",
        executor,
      });
      const jan = await mod.runCompanyIntelligenceOrchestration({
        question: "what about jan 2026",
        scope: authorized.scope,
        conversation: june.nextConversation,
        referenceDate: new Date("2026-08-11T12:00:00Z"),
        mode: "heuristic",
        executor,
      });
      return {
        period: jan.state.periods.current,
        normalizedQ: jan.state.request.normalizedQuestion,
        needsClarification: jan.state.plan.needsClarification,
        capabilities: jan.state.plan.capabilities,
        unavailable: String(jan.answerText || "").includes("limited or unavailable"),
        clarificationPrompt: jan.state.plan.clarificationPrompt,
      };
    `);
    expect(out.period.startDate).toBe("2026-01-01");
    expect(out.period.endDate).toBe("2026-01-31");
    expect(out.needsClarification).toBe(false);
    expect(out.capabilities.some((c) => String(c).startsWith("commercial."))).toBe(true);
    expect(out.unavailable).toBe(false);
    expect(String(out.clarificationPrompt || "")).not.toMatch(/clearer metric/i);
  });

  test("5. standalone how did jan perform in 2026 → commercial performance path", () => {
    const out = run(`
      ${EXECUTOR_HELPER}
      const authorized = mod.resolveAuthorizedIntelligenceScope({
        profile: ${JSON.stringify(clientHint({ authenticated: true, allBranches: true, branchScope: null }))},
      });
      const spine = await mod.runCompanyIntelligenceOrchestration({
        question: "how did jan perform in 2026",
        scope: authorized.scope,
        referenceDate: new Date("2026-08-11T12:00:00Z"),
        mode: "heuristic",
        executor,
      });
      const perf = calls.find((c) => c.capability === "commercial.performance");
      return {
        caps: calls.map((c) => c.capability),
        perf,
        unavailable: String(spine.answerText || "").includes("limited or unavailable"),
      };
    `);
    expect(out.caps).toContain("commercial.performance");
    expect(out.perf.start).toBe("2026-01-01");
    expect(out.perf.end).toBe("2026-01-31");
    expect(out.unavailable).toBe(false);
  });

  test("6. NormalizedCapabilityResult keeps Cash Up keyMetrics/aggregation", () => {
    const out = run(`
      const normalized = mod.normalizeCapabilityResult({
        capabilityId: "commercial.performance",
        implementationTool: "cash_up_performance",
        ok: true,
        branchId: null,
        requestedPeriod: { startDate: "2026-07-01", endDate: "2026-07-31", label: "July 2026" },
        raw: ${CASH_UP_TOOL_JSON},
      });
      return {
        keys: (normalized.metrics || []).map((m) => m.metricKey),
        net: (normalized.metrics || []).find((m) => m.metricKey === "net_sales")?.value,
      };
    `);
    expect(out.keys).toContain("net_sales");
    expect(out.net).toBe(412345.5);
  });

  test("7. missing-data wording only when metrics absent", () => {
    const out = run(`
      const emptyExec = mod.createVaultCapabilityExecutor(async () => ({
        answerType: "missing_data",
        directAnswer: "",
        keyMetrics: [],
        conversationDataset: { aggregation: {} },
      }));
      const fullExec = mod.createVaultCapabilityExecutor(async () => (${CASH_UP_TOOL_JSON}));
      const authorized = mod.resolveAuthorizedIntelligenceScope({
        profile: ${JSON.stringify(clientHint({ authenticated: true, allBranches: true, branchScope: null }))},
      });
      const empty = await mod.runCompanyIntelligenceOrchestration({
        question: "How did July perform overall?",
        scope: authorized.scope,
        referenceDate: new Date("2026-08-11T12:00:00Z"),
        mode: "heuristic",
        executor: emptyExec,
      });
      const full = await mod.runCompanyIntelligenceOrchestration({
        question: "How did July perform overall?",
        scope: authorized.scope,
        referenceDate: new Date("2026-08-11T12:00:00Z"),
        mode: "heuristic",
        executor: fullExec,
      });
      return {
        emptyUnavailable: String(empty.answerText || "").includes("limited or unavailable"),
        fullUnavailable: String(full.answerText || "").includes("limited or unavailable"),
      };
    `);
    expect(out.emptyUnavailable).toBe(true);
    expect(out.fullUnavailable).toBe(false);
  });

  test("8. v83 network RBAC preserved", () => {
    const out = run(`
      const a = mod.resolveAuthorizedIntelligenceScope({
        profile: ${JSON.stringify(clientHint({ authenticated: true, allBranches: true, branchScope: null }))},
      });
      const state = mod.createCompanyIntelligenceState({ originalQuestion: "q", scope: a.scope });
      return { network: state.scope.access.canSeeNetwork, primary: state.scope.primaryBranchId };
    `);
    expect(out.network).toBe(true);
    expect(out.primary).toBeNull();
  });

  test("9. unauthorized branch still denied", () => {
    const out = run(`
      const c = mod.resolveAuthorizedIntelligenceScope({
        mentionedBranch: "riyadh",
        profile: ${JSON.stringify(clientHint({ authenticated: true, allBranches: false, branchScope: "khobar" }))},
      });
      return { unauthorized: c.unauthorizedBranch, primary: c.scope.primaryBranchId, network: c.scope.access.canSeeNetwork };
    `);
    expect(out.unauthorized).toBe("riyadh");
    expect(out.primary).toBeNull();
    expect(out.network).toBe(false);
  });

  test("10. routeIntent referenceDate still honored", () => {
    const out = run(`
      const route = mod.routeIntent("How did July perform overall?", {
        referenceDate: new Date("2026-08-11T12:00:00Z"),
      });
      return {
        start: route.vaultPeriod?.startDate || null,
        end: route.vaultPeriod?.endDate || null,
      };
    `, orchPath);
    expect(out.start).toBe("2026-07-01");
    expect(out.end).toBe("2026-07-31");
  });

  test("11. raw tool.aggregation (not conversationDataset) supplies period totals", () => {
    const out = run(`
      const rawTool = {
        aggregation: {
          totalSales: 590126.95,
          totalGuests: 8302,
          totalOrders: 3506,
          dayCount: 31,
          expectedDayCount: 31,
        },
        // First-day facts that previously masqueraded as July
        facts: [
          { metric_key: "total_sales", metric_value: 26020, period_end: "2026-07-16" },
          { metric_key: "net_sales", metric_value: 22626.08696, period_end: "2026-07-16" },
          { metric_key: "guest_count", metric_value: 276, period_end: "2026-07-16" },
          { metric_key: "order_count", metric_value: 124, period_end: "2026-07-16" },
        ],
      };
      const metrics = mod.createVaultCapabilityExecutor(async () => rawTool);
      // exercise extract via normalize
      const normalized = mod.normalizeCapabilityResult({
        capabilityId: "commercial.performance",
        implementationTool: "cash_up_performance",
        ok: true,
        requestedPeriod: { startDate: "2026-07-01", endDate: "2026-07-31", label: "July 2026" },
        raw: rawTool,
      });
      const net = (normalized.metrics || []).find((m) => m.metricKey === "net_sales")?.value;
      const days = (normalized.metrics || []).find((m) => m.metricKey === "day_count")?.value;
      return { net, days, keys: (normalized.metrics || []).map((m) => m.metricKey) };
    `);
    expect(out.net).toBe(590126.95);
    expect(out.days).toBe(31);
    expect(out.net).not.toBe(22626.08696);
  });

  test("12. 16 July facts alone cannot supply unlabeled July period metrics when aggregation present", () => {
    const out = run(`
      const executor = mod.createVaultCapabilityExecutor(async () => ({
        aggregation: {
          totalSales: 590126.95,
          totalGuests: 8302,
          totalOrders: 3506,
          dayCount: 31,
        },
        facts: [
          { metric_key: "net_sales", metric_value: 22626.08696, period_end: "2026-07-16" },
          { metric_key: "guest_count", metric_value: 276, period_end: "2026-07-16" },
        ],
      }));
      const authorized = mod.resolveAuthorizedIntelligenceScope({
        profile: ${JSON.stringify(clientHint({ authenticated: true, allBranches: true, branchScope: null }))},
      });
      const spine = await mod.runCompanyIntelligenceOrchestration({
        question: "How did July perform overall?",
        scope: authorized.scope,
        referenceDate: new Date("2026-08-11T12:00:00Z"),
        mode: "heuristic",
        executor,
      });
      const net = (spine.keyMetrics || []).map((m) => Number(m.value)).find((v) => v > 100000);
      return {
        net,
        answer: String(spine.answerText || ""),
        has16JulyMasquerade: (spine.keyMetrics || []).some((m) => Number(m.value) === 22626.08696),
      };
    `);
    expect(out.net).toBe(590126.95);
    expect(out.has16JulyMasquerade).toBe(false);
  });

  test("13. monthly claim granularity guard rejects single-day evidence for July", () => {
    const out = run(`
      const result = mod.verifySynthesizedAnswer({
        answerText: "July net sales were 22,626 SAR overall.",
        period: { startDate: "2026-07-01", endDate: "2026-07-31", label: "July 2026" },
        evidence: [
          {
            id: "e1",
            source: "cash_up",
            sourceAuthority: "CANONICAL_STRUCTURED",
            domain: "branch_sales",
            metricOrEvent: "net_sales",
            value: 22626.08696,
            textSummary: "16 July net sales",
            period: { startDate: "2026-07-16", endDate: "2026-07-16" },
            confidence: "high",
          },
        ],
        claims: [],
      });
      return {
        ok: result.ok,
        codes: (result.issues || []).map((i) => i.code),
      };
    `);
    expect(out.ok).toBe(false);
    expect(out.codes).toContain("period_granularity_mismatch");
  });

  test("14. what about June replaces period only — no commercial.compare", () => {
    const out = run(`
      ${EXECUTOR_HELPER}
      const authorized = mod.resolveAuthorizedIntelligenceScope({
        profile: ${JSON.stringify(clientHint({ authenticated: true, allBranches: true, branchScope: null }))},
      });
      const july = await mod.runCompanyIntelligenceOrchestration({
        question: "How did July perform overall?",
        scope: authorized.scope,
        referenceDate: new Date("2026-08-11T12:00:00Z"),
        mode: "heuristic",
        executor,
      });
      const before = calls.length;
      const june = await mod.runCompanyIntelligenceOrchestration({
        question: "what about June",
        scope: authorized.scope,
        conversation: july.nextConversation,
        referenceDate: new Date("2026-08-11T12:00:00Z"),
        mode: "heuristic",
        executor,
      });
      const juneCalls = calls.slice(before);
      return {
        period: june.state.periods.current,
        comparison: june.state.periods.comparison,
        caps: juneCalls.map((c) => c.capability),
        notes: june.state.request?.normalizedQuestion || june.state.conversation?.previousIntent,
      };
    `);
    expect(out.period.startDate).toBe("2026-06-01");
    expect(out.period.endDate).toBe("2026-06-30");
    expect(out.comparison).toBeNull();
    expect(out.caps).toContain("commercial.performance");
    expect(out.caps).not.toContain("commercial.compare");
  });

  test("15. compare it with June attaches comparison intent", () => {
    const out = run(`
      ${EXECUTOR_HELPER}
      const authorized = mod.resolveAuthorizedIntelligenceScope({
        profile: ${JSON.stringify(clientHint({ authenticated: true, allBranches: true, branchScope: null }))},
      });
      const july = await mod.runCompanyIntelligenceOrchestration({
        question: "How did July perform overall?",
        scope: authorized.scope,
        referenceDate: new Date("2026-08-11T12:00:00Z"),
        mode: "heuristic",
        executor,
      });
      const before = calls.length;
      const cmp = await mod.runCompanyIntelligenceOrchestration({
        question: "compare it with June",
        scope: authorized.scope,
        conversation: july.nextConversation,
        referenceDate: new Date("2026-08-11T12:00:00Z"),
        mode: "heuristic",
        executor,
      });
      const cmpCalls = calls.slice(before);
      return {
        current: cmp.state.periods.current,
        comparison: cmp.state.periods.comparison,
        caps: cmpCalls.map((c) => c.capability),
      };
    `);
    expect(out.current.startDate).toBe("2026-07-01");
    expect(out.comparison.startDate).toBe("2026-06-01");
    expect(out.caps).toContain("commercial.compare");
  });

  test("16. Fabric gate: month+year follow-ups enter Fabric (not legacy clarification)", () => {
    const out = run(`
      const ref = new Date("2026-08-11T12:00:00Z");
      const prior = {
        activeMetricFamily: "commercial",
        previousIntent: "performance_overview",
        activeCapabilities: ["commercial.performance"],
        activePeriods: {
          current: { startDate: "2026-07-01", endDate: "2026-07-31", label: "July 2026", semantic: "named_month" },
          comparison: null,
        },
      };
      const legacy = { intent: "unknown", confidence: "none" };
      const cases = [
        "what about June",
        "what about June 2026",
        "what about jan 2026",
        "what about January 2026",
        "and February?",
        "how about April?",
        "compare it with June",
      ];
      return cases.map((q) => ({
        q,
        fabric: mod.isManagementIntelligenceQuestion(q, legacy, {
          priorFabricConversation: prior,
          referenceDate: ref,
        }),
        periodOnly: mod.isPeriodOnlyFollowUpTurn(q, ref),
      }));
    `);
    for (const row of out) {
      expect(row.fabric).toBe(true);
      expect(row.periodOnly).toBe(true);
    }
  });

  test("17. July → June 2026 / Jan 2026 / January 2026 / and February? period replacement", () => {
    const out = run(`
      ${EXECUTOR_HELPER}
      const authorized = mod.resolveAuthorizedIntelligenceScope({
        profile: ${JSON.stringify(clientHint({ authenticated: true, allBranches: true, branchScope: null }))},
      });
      const ref = new Date("2026-08-11T12:00:00Z");
      const july = await mod.runCompanyIntelligenceOrchestration({
        question: "How did July perform overall?",
        scope: authorized.scope,
        referenceDate: ref,
        mode: "heuristic",
        executor,
      });
      async function follow(q, conv) {
        const before = calls.length;
        const spine = await mod.runCompanyIntelligenceOrchestration({
          question: q,
          scope: authorized.scope,
          conversation: conv,
          referenceDate: ref,
          mode: "heuristic",
          executor,
        });
        const turnCalls = calls.slice(before);
        return {
          start: spine.state.periods.current?.startDate || null,
          end: spine.state.periods.current?.endDate || null,
          comparison: spine.state.periods.comparison,
          caps: turnCalls.map((c) => c.capability),
          needsClarification: spine.state.plan.needsClarification,
          answer: String(spine.answerText || ""),
          conv: spine.nextConversation,
        };
      }
      const juneNamed = await follow("what about June 2026", july.nextConversation);
      const jan = await follow("what about jan 2026", juneNamed.conv);
      const january = await follow("what about January 2026", jan.conv);
      const feb = await follow("and February?", january.conv);
      return { juneNamed, jan, january, feb };
    `);
    expect(out.juneNamed.start).toBe("2026-06-01");
    expect(out.juneNamed.comparison).toBeNull();
    expect(out.juneNamed.caps).toContain("commercial.performance");
    expect(out.juneNamed.caps).not.toContain("commercial.compare");

    expect(out.jan.start).toBe("2026-01-01");
    expect(out.jan.end).toBe("2026-01-31");
    expect(out.jan.needsClarification).toBe(false);
    expect(out.jan.caps).toContain("commercial.performance");
    expect(out.jan.answer).not.toMatch(/clearer metric/i);

    expect(out.january.start).toBe("2026-01-01");
    expect(out.january.needsClarification).toBe(false);

    expect(out.feb.start).toBe("2026-02-01");
    expect(out.feb.end).toBe("2026-02-28");
    expect(out.feb.comparison).toBeNull();
    expect(out.feb.caps).toContain("commercial.performance");
  });

  test("18. July aggregation shape unchanged (590126.96 / 8302 / 3506 / 31)", () => {
    const out = run(`
      const executor = mod.createVaultCapabilityExecutor(async () => ({
        aggregation: {
          totalSales: 590126.96,
          totalGuests: 8302,
          totalOrders: 3506,
          dayCount: 31,
          expectedDayCount: 31,
          missingDayCount: 0,
        },
      }));
      const authorized = mod.resolveAuthorizedIntelligenceScope({
        profile: ${JSON.stringify(clientHint({ authenticated: true, allBranches: true, branchScope: null }))},
      });
      const spine = await mod.runCompanyIntelligenceOrchestration({
        question: "How did July perform overall?",
        scope: authorized.scope,
        referenceDate: new Date("2026-08-11T12:00:00Z"),
        mode: "heuristic",
        executor,
      });
      const nums = (spine.keyMetrics || []).map((m) => Number(m.value));
      return {
        hasNet: nums.includes(590126.96),
        hasGuests: nums.includes(8302),
        hasOrders: nums.includes(3506),
        hasDays: nums.includes(31),
        unavailable: String(spine.answerText || "").includes("limited or unavailable"),
      };
    `);
    expect(out.hasNet).toBe(true);
    expect(out.hasGuests).toBe(true);
    expect(out.hasOrders).toBe(true);
    expect(out.hasDays).toBe(true);
    expect(out.unavailable).toBe(false);
  });
});
