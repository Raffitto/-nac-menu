const path = require("path");
const { execFileSync } = require("child_process");

const root = path.resolve(__dirname, "../../../..");
const fabricPath = path.join(root, "supabase/functions/_shared/companyIntelligence/index.ts");

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

const EMPTY_CASH_UP = `{
  capability: req.capability,
  implementationTool: "cash_up_performance",
  ok: true,
  metrics: [],
  textSnippets: ["Cash Up for the requested day is not yet available in the canonical data. The latest completed Cash Up I have is 15 August 2026."],
  coverage: mod.buildCoverageReport({
    domain: "sales",
    range: req.currentPeriod,
    expectedRecords: 1,
    availableRecords: 0,
    freshness: "2026-08-15",
  }),
}`;

describe("reasoning supervisor — single-domain first", () => {
  test("Jan vs Feb sales + guests stays on Cash Up compare, not universal overlap", () => {
    const out = run(`
      const result = await mod.runCompanyIntelligenceOrchestration({
        question: "compare January to February in terms of nb of guests and sales",
        branchHint: "khobar",
        referenceDate: new Date("2026-08-18T12:00:00+03:00"),
        mode: "heuristic",
      });
      return {
        goal: result.state.plan.goal,
        caps: result.state.plan.capabilities,
        tools: result.toolsExecuted,
        answer: result.answerText,
        universal: result.state.cost.requestCategory,
        overlapping: /overlapping evidence/i.test(result.answerText || ""),
        type: result.answerType,
        feasibility: result.state.feasibility?.status,
      };
    `);
    expect(out.overlapping).toBe(false);
    expect(out.universal).not.toBe("universal_management");
    expect(out.caps).toEqual(expect.arrayContaining(["commercial.compare", "commercial.performance"]));
    expect(out.caps).not.toContain("commerce.semantic_query");
  });

  test("knowledge freshness inspects coverage, not last-7-day sales", () => {
    const out = run(`
      const exec = mod.createMockCapabilityExecutor({
        "company.knowledge_state": {
          capability: "company.knowledge_state",
          implementationTool: "knowledge_state",
          ok: true,
          metrics: [],
          textSnippets: [],
          coverage: null,
          raw: { coverage: [
            { reportType: "cash_up", periodEnd: "2026-08-15" },
            { reportType: "google_review_star_summary", periodEnd: "2026-08-10" },
          ] },
        },
      });
      const store = {
        fetchCoverage: async () => ({ branchId: "khobar", startDate: "2026-08-01", endDate: "2026-08-17" }),
        fetchOrders: async () => [],
        fetchItems: async () => [],
      };
      const result = await mod.runCompanyIntelligenceOrchestration({
        question: "what's the last data that you have, which date?",
        branchHint: "khobar",
        referenceDate: new Date("2026-08-18T12:00:00+03:00"),
        mode: "heuristic",
        executor: exec,
        commerceStore: store,
      });
      return {
        answer: result.answerText,
        type: result.answerType,
        caps: result.state.plan.capabilities,
        category: result.state.cost.requestCategory,
      };
    `);
    expect(out.category).toBe("knowledge_state");
    expect(out.answer).toMatch(/Cash Up/i);
    expect(out.answer).toMatch(/15 August 2026|15 Aug/i);
    expect(out.answer).toMatch(/commerce/i);
    expect(out.answer).not.toMatch(/net sales were/i);
  });

  test("August sales / yesterday / July average check / Cookies companions use minimum legs", () => {
    const out = run(`
      const store = {
        fetchCoverage: async () => ({ branchId: "khobar", startDate: "2026-07-01", endDate: "2026-08-17" }),
        fetchOrders: async () => [],
        fetchItems: async () => [],
      };
      const august = await mod.runCompanyIntelligenceOrchestration({
        question: "August sales",
        branchHint: "khobar",
        referenceDate: new Date("2026-08-18T12:00:00+03:00"),
        mode: "heuristic",
      });
      const yesterday = await mod.runCompanyIntelligenceOrchestration({
        question: "what were the sales yesterday?",
        branchHint: "khobar",
        referenceDate: new Date("2026-08-18T12:00:00+03:00"),
        mode: "heuristic",
      });
      const july = await mod.runCompanyIntelligenceOrchestration({
        question: "average check in July",
        branchHint: "khobar",
        referenceDate: new Date("2026-08-18T12:00:00+03:00"),
        mode: "heuristic",
      });
      const cookies = await mod.runCompanyIntelligenceOrchestration({
        question: "Cookies companions",
        branchHint: "khobar",
        referenceDate: new Date("2026-08-18T12:00:00+03:00"),
        mode: "heuristic",
        commerceStore: store,
      });
      const latestCash = mod.classifySupervisorGoal({ question: "latest Cash Up date" });
      const latestCommerce = mod.classifySupervisorGoal({ question: "latest commerce date" });
      return {
        augustUniversal: august.state.cost.requestCategory === "universal_management",
        yesterdayUniversal: yesterday.state.cost.requestCategory === "universal_management",
        julyCaps: july.state.plan.capabilities,
        cookiesCategory: cookies.state.cost.requestCategory,
        cookiesTools: cookies.toolsExecuted,
        latestCash,
        latestCommerce,
        augustCaps: august.state.plan.capabilities.filter((c) => c.startsWith("commercial.") || c.startsWith("commerce.")),
      };
    `);
    expect(out.augustUniversal).toBe(false);
    expect(out.yesterdayUniversal).toBe(false);
    expect(out.augustCaps).toEqual(["commercial.performance"]);
    expect(out.latestCash).toBe("knowledge_freshness");
    expect(out.latestCommerce).toBe("knowledge_freshness");
    expect(out.cookiesCategory).toBe("commerce_semantic");
    expect(out.cookiesTools.length).toBeLessThanOrEqual(2);
  });
});

describe("reasoning supervisor — missing evidence recovery", () => {
  test("yesterday sales uses provisional commerce when Cash Up is missing", () => {
    const out = run(`
      const exec = async (req) => (${EMPTY_CASH_UP});
      const store = {
        fetchCoverage: async () => ({ branchId: "khobar", startDate: "2026-08-01", endDate: "2026-08-17" }),
        fetchOrders: async () => [{ source_order_id: "1", branch_id: "khobar", business_date: "2026-08-17", net_sales: 4200, covers: 18 }],
        fetchItems: async () => [],
      };
      const result = await mod.runCompanyIntelligenceOrchestration({
        question: "so what were the sales yesterday?",
        branchHint: "khobar",
        referenceDate: new Date("2026-08-18T12:00:00+03:00"),
        mode: "heuristic",
        executor: exec,
        commerceStore: store,
      });
      return {
        answer: result.answerText,
        confidence: result.answerConfidence,
        verified: result.state.answer.verified,
        unresolved: result.nextConversation.unresolvedGoal,
        warnings: result.state.warnings,
      };
    `);
    expect(out.answer).toMatch(/Cash Up/i);
    expect(out.answer).toMatch(/provisional/i);
    expect(out.answer).toMatch(/4,200|4200/);
    expect(out.confidence).not.toBe("high");
    expect(out.verified).toBe(false);
    expect(out.unresolved).toBeTruthy();
    expect(out.warnings.join(" ")).not.toMatch(/weekday_composition_differs/);
  });

  test("acquisition follow-up preserves goal, states blocker, and does not repeat the previous answer", () => {
    const out = run(`
      const exec = async (req) => (${EMPTY_CASH_UP});
      const store = {
        fetchCoverage: async () => ({ branchId: "khobar", startDate: "2026-08-01", endDate: "2026-08-17" }),
        fetchOrders: async () => [{ source_order_id: "1", branch_id: "khobar", business_date: "2026-08-17", net_sales: 4200, covers: 18 }],
        fetchItems: async () => [],
      };
      const first = await mod.runCompanyIntelligenceOrchestration({
        question: "so what were the sales yesterday?",
        branchHint: "khobar",
        referenceDate: new Date("2026-08-18T12:00:00+03:00"),
        mode: "heuristic",
        executor: exec,
        commerceStore: store,
      });
      const second = await mod.runCompanyIntelligenceOrchestration({
        question: "ok upload it yourself. and tell me",
        branchHint: "khobar",
        conversation: first.nextConversation,
        referenceDate: new Date("2026-08-18T12:00:00+03:00"),
        mode: "heuristic",
        executor: exec,
        commerceStore: store,
      });
      const blocked = await mod.runCompanyIntelligenceOrchestration({
        question: "ok upload it yourself. and tell me",
        branchHint: "khobar",
        conversation: first.nextConversation,
        referenceDate: new Date("2026-08-18T12:00:00+03:00"),
        mode: "heuristic",
        executor: exec,
      });
      return {
        preserved: second.nextConversation.unresolvedGoal?.question || first.nextConversation.unresolvedGoal?.question,
        secondAnswer: second.answerText,
        firstAnswer: first.answerText,
        blocker: /cannot create a Cash Up workbook from chat|no queued Cash Up file/i.test(second.answerText || ""),
        repeated: second.answerText === first.answerText,
        blockedAnswer: blocked.answerText,
        blockedRepeat: blocked.answerText === first.answerText,
        blockedPrecise: /cannot create a Cash Up workbook from chat/i.test(blocked.answerText || ""),
      };
    `);
    expect(out.preserved).toMatch(/sales yesterday/i);
    expect(out.blocker).toBe(true);
    expect(out.repeated).toBe(false);
    expect(out.secondAnswer).toMatch(/provisional/i);
    expect(out.blockedRepeat).toBe(false);
    expect(out.blockedPrecise).toBe(true);
  });
});
