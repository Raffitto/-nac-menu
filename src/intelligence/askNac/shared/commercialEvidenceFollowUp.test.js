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
    expect(out.answer).toMatch(/412345|Cash Up net sales/i);
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
});
