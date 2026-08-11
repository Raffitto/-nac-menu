/**
 * Ramadan YoY comparison must resolve both event periods, then apply Business Timeline.
 * Regression: legacy conversation rewrite was destroying Ramadan periods into
 * "Compare net sales for June to previous period" → missing_period.
 */
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.resolve(__dirname, "../../../..");
const fabricPath = path.join(root, "supabase/functions/_shared/companyIntelligence/index.ts");
const convPath = path.join(root, "supabase/functions/_shared/conversationIntelligence.ts");

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

const Q = "Compare last year's Ramadan sales with this year's Ramadan sales for Khobar.";
const REF = "2026-08-11T12:00:00Z";

describe("Ramadan YoY comparison — event resolution + Business Timeline", () => {
  test("1–3. resolves Ramadan 2026 current + Ramadan 2025 comparison + Khobar scope", () => {
    const out = run(`
      const authorized = mod.resolveAuthorizedIntelligenceScope({
        mentionedBranch: "khobar",
        profile: { authenticated: true, allBranches: true, branchScope: null },
      });
      const spine = await mod.runCompanyIntelligenceOrchestration({
        question: ${JSON.stringify(Q)},
        scope: authorized.scope,
        branchHint: "khobar",
        referenceDate: new Date(${JSON.stringify(REF)}),
        mode: "heuristic",
      });
      return {
        current: spine.state.periods.current,
        comparison: spine.state.periods.comparison,
        primary: spine.state.scope.primaryBranchId,
        feasibility: spine.state.feasibility,
        answer: spine.answerText || "",
        answerType: spine.answerType,
        tools: spine.toolsExecuted,
      };
    `);
    expect(out.current.startDate).toBe("2026-02-18");
    expect(out.current.endDate).toBe("2026-03-19");
    expect(out.current.label).toMatch(/Ramadan 2026/i);
    expect(out.comparison).not.toBeNull();
    expect(out.comparison.startDate).toBe("2025-03-01");
    expect(out.comparison.endDate).toBe("2025-03-29");
    expect(out.comparison.label).toMatch(/Ramadan 2025/i);
    expect(out.primary).toBe("khobar");
  });

  test("4–6. Business Timeline opening + NOT OPERATING + NOT_ANSWERABLE_AS_REQUESTED", () => {
    const out = run(`
      const opening = mod.defaultBusinessTimeline.getOpeningDate("khobar");
      const status = mod.defaultBusinessTimeline.getOperatingStatus("khobar", {
        startDate: "2025-03-01",
        endDate: "2025-03-29",
        label: "Ramadan 2025",
      });
      const authorized = mod.resolveAuthorizedIntelligenceScope({
        mentionedBranch: "khobar",
        profile: { authenticated: true, allBranches: false, branchScope: "khobar" },
      });
      const spine = await mod.runCompanyIntelligenceOrchestration({
        question: ${JSON.stringify(Q)},
        scope: authorized.scope,
        branchHint: "khobar",
        referenceDate: new Date(${JSON.stringify(REF)}),
        mode: "heuristic",
      });
      return {
        opening,
        status: status.status,
        feasibility: spine.state.feasibility.status,
        reasons: spine.state.feasibility.reasons,
        detail: (spine.state.feasibility.detail || []).join(" "),
        answer: spine.answerText || "",
        tools: spine.toolsExecuted,
        paid: spine.paidModelCalls,
      };
    `);
    expect(out.opening).toBe("2025-04-27");
    expect(out.status).toBe("not_yet_open");
    expect(out.feasibility).toBe("NOT_ANSWERABLE_AS_REQUESTED");
    expect(out.reasons).toContain("branch_not_operating_in_baseline_period");
    expect(out.reasons).not.toContain("comparison_period_missing");
    expect(out.detail).toMatch(/Ramadan 2025/i);
    expect(out.detail).toMatch(/2025-04-27/);
    expect(out.answer).toMatch(/not operating|not valid/i);
    expect(out.answer).toMatch(/Ramadan 2025/i);
    expect(out.answer).not.toMatch(/comparison period is missing/i);
    expect(out.answer).not.toMatch(/missing_period/i);
    expect(out.tools).toEqual([]);
    expect(out.paid).toBe(0);
  });

  test("7–9. no fabricated 2025 baseline sales; no missing_period wording", () => {
    const out = run(`
      const calls = [];
      const executor = mod.createVaultCapabilityExecutor(async (req) => {
        calls.push(req.request || req);
        return { aggregation: { totalSales: 0, dayCount: 0 } };
      });
      const authorized = mod.resolveAuthorizedIntelligenceScope({
        mentionedBranch: "khobar",
        profile: { authenticated: true, allBranches: true, branchScope: null },
      });
      const spine = await mod.runCompanyIntelligenceOrchestration({
        question: ${JSON.stringify(Q)},
        scope: authorized.scope,
        branchHint: "khobar",
        referenceDate: new Date(${JSON.stringify(REF)}),
        mode: "heuristic",
        executor,
      });
      return {
        calls: calls.length,
        answer: spine.answerText || "",
        reasons: spine.state.feasibility?.reasons || [],
        hasMissingPeriod: (spine.state.comparability?.reasons || []).includes("missing_period")
          && !spine.state.periods.comparison,
      };
    `);
    expect(out.calls).toBe(0);
    expect(out.reasons).toContain("branch_not_operating_in_baseline_period");
    expect(out.hasMissingPeriod).toBe(false);
    expect(out.answer).not.toMatch(/Comparison requested but comparison period is missing/i);
    expect(out.answer).not.toMatch(/\b0 SAR\b|\bzero sales\b/i);
  });

  test("10. legacy conversation rewrite must NOT destroy Ramadan YoY periods", () => {
    const out = run(`
      const context = {
        lastQuestion: "what about June",
        lastResolvedQuestion: "How did June 2026 perform overall?",
        lastIntent: "vault_cash_up_summary",
        lastBranch: "khobar",
        lastPeriod: "June 2026",
        lastMetric: "net_sales",
        activeState: {
          branch: "khobar",
          branchLabel: "Khobar",
          intent: "vault_cash_up_summary",
          metric: "net_sales",
          period: { label: "June 2026", startDate: "2026-06-01", endDate: "2026-06-30" },
          vaultPeriod: { label: "June 2026", startDate: "2026-06-01", endDate: "2026-06-30" },
          resolvedQuestion: "How did June 2026 perform overall?",
          confidence: "high",
          branchHistory: ["khobar"],
          filters: {},
          sources: [],
          dataset: null,
          answerType: null,
          reportType: null,
          metricLabel: "Net sales",
          vaultCompare: null,
          originalQuestion: "what about June",
          version: 1,
          timestamp: null,
        },
      };
      const prepared = mod.prepareAskNacQuestionEdge({
        question: ${JSON.stringify(Q)},
        conversationContext: context,
      });
      return {
        effective: prepared.effectiveQuestion,
        usedContext: prepared.conversationResolution?.usedContext,
        selfContained: mod.isSelfContainedComparisonQuestion(${JSON.stringify(Q)}, new Date(${JSON.stringify(REF)})),
      };
    `, convPath);
    expect(out.selfContained).toBe(true);
    expect(out.effective).toMatch(/Ramadan/i);
    expect(out.effective).toMatch(/last year/i);
    expect(out.effective).not.toMatch(/June 2026 to previous period/i);
    expect(out.usedContext).toBe(false);
  });

  test("11. after June conversation, full Fabric path still reaches timeline infeasibility", () => {
    const out = run(`
      const authorized = mod.resolveAuthorizedIntelligenceScope({
        mentionedBranch: "khobar",
        profile: { authenticated: true, allBranches: true, branchScope: null },
      });
      const executor = mod.createVaultCapabilityExecutor(async () => ({
        aggregation: { totalSales: 602646, totalGuests: 8042, totalOrders: 3628, dayCount: 30 },
      }));
      const july = await mod.runCompanyIntelligenceOrchestration({
        question: "How did July perform overall?",
        scope: authorized.scope,
        referenceDate: new Date(${JSON.stringify(REF)}),
        mode: "heuristic",
        executor,
      });
      const june = await mod.runCompanyIntelligenceOrchestration({
        question: "what about June",
        scope: authorized.scope,
        conversation: july.nextConversation,
        referenceDate: new Date(${JSON.stringify(REF)}),
        mode: "heuristic",
        executor,
      });
      const ramadan = await mod.runCompanyIntelligenceOrchestration({
        question: ${JSON.stringify(Q)},
        scope: authorized.scope,
        branchHint: "khobar",
        conversation: june.nextConversation,
        referenceDate: new Date(${JSON.stringify(REF)}),
        mode: "heuristic",
        executor,
      });
      return {
        current: ramadan.state.periods.current?.label,
        comparison: ramadan.state.periods.comparison?.label,
        feasibility: ramadan.state.feasibility?.status,
        reasons: ramadan.state.feasibility?.reasons || [],
        answer: ramadan.answerText || "",
      };
    `);
    expect(out.current).toMatch(/Ramadan 2026/i);
    expect(out.comparison).toMatch(/Ramadan 2025/i);
    expect(out.feasibility).toBe("NOT_ANSWERABLE_AS_REQUESTED");
    expect(out.reasons).toContain("branch_not_operating_in_baseline_period");
    expect(out.answer).not.toMatch(/comparison period is missing/i);
  });
});
