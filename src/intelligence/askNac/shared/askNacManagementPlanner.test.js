const path = require("path");
const { execFileSync } = require("child_process");

const root = path.resolve(__dirname, "../../../..");
const plannerPath = path.join(root, "supabase/functions/_shared/askNacManagementPlanner.ts");
const orchestratorPath = path.join(root, "supabase/functions/_shared/askNacOrchestrator.ts");

function runPlannerScript(body) {
  const script = `
    global.Deno = { env: { get: (k) => (k === "ASK_NAC_PLANNER_MODE" ? "heuristic" : undefined) } };
    import(${JSON.stringify(plannerPath)}).then(async (mod) => {
      const out = await (async () => { ${body} })();
      process.stdout.write(JSON.stringify(out));
    }).catch((err) => {
      console.error(err);
      process.exit(1);
    });
  `;
  const stdout = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: root,
    encoding: "utf8",
  });
  return JSON.parse(stdout.trim());
}

function routeThenPlan(question) {
  const script = `
    global.Deno = { env: { get: (k) => (k === "ASK_NAC_PLANNER_MODE" ? "heuristic" : undefined) } };
    Promise.all([
      import(${JSON.stringify(orchestratorPath)}),
      import(${JSON.stringify(plannerPath)}),
    ]).then(async ([orch, planner]) => {
      const route = orch.routeIntent(${JSON.stringify(question)});
      const should = planner.shouldInvokeManagementPlanner(route, ${JSON.stringify(question)});
      const enriched = await planner.enrichRouteWithManagementPlanner(route, ${JSON.stringify(question)}, {
        mode: "heuristic",
        referenceDate: new Date("2026-08-10T12:00:00+03:00"),
        filters: { branch: "khobar" },
        branchHint: "khobar",
      });
      process.stdout.write(JSON.stringify({
        originalIntent: route.intent,
        originalConfidence: route.confidence,
        shouldInvoke: should,
        plannerUsed: enriched.plannerUsed,
        applied: enriched.applied,
        planIntent: enriched.plan?.intent || null,
        finalIntent: enriched.route?.intent || route.intent,
        queryFocus: enriched.route?.queryFocus || null,
        periodType: enriched.route?.vaultPeriod?.periodType || null,
        hasCompare: Boolean(enriched.route?.vaultCompare),
        foodicsCleared: enriched.applied ? enriched.route?.foodicsPeriod == null : null,
      }));
    }).catch((err) => {
      console.error(err);
      process.exit(1);
    });
  `;
  const stdout = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: root,
    encoding: "utf8",
  });
  return JSON.parse(stdout.trim());
}

describe("Ask NAC management planner", () => {
  test("validateManagementPlan rejects unknown tools and intents", () => {
    const out = runPlannerScript(`
      return {
        ok: mod.validateManagementPlan({
          intent: "performance_overview",
          scope: { branch: "khobar" },
          time: { expression: "last_week" },
          metric_family: "commercial",
          operations: [{ tool: "cash_up_performance", purpose: "primary" }],
          comparison: { requested: true, type: "previous_equivalent_period" },
          needs_clarification: false,
        }),
        badIntent: mod.validateManagementPlan({ intent: "not_real", scope: {}, time: {}, metric_family: "commercial", operations: [], comparison: {}, needs_clarification: false }),
        stripsSqlTool: mod.validateManagementPlan({
          intent: "performance_overview",
          scope: { branch: "khobar" },
          time: { expression: "last_week" },
          metric_family: "commercial",
          operations: [{ tool: "run_raw_sql", purpose: "hack" }, { tool: "cash_up_performance", purpose: "ok" }],
          comparison: { requested: false, type: null },
          needs_clarification: false,
        }),
      };
    `);
    expect(out.ok?.intent).toBe("performance_overview");
    expect(out.badIntent).toBeNull();
    expect(out.stripsSqlTool.operations.map((o) => o.tool)).toEqual(["cash_up_performance"]);
  });

  test("heuristic understands informal management language", () => {
    const cases = [
      ["How's business been lately?", "performance_overview"],
      ["Are we doing better than the week before?", "period_compare"],
      ["How's August looking so far?", "performance_overview"],
      ["Compare July with June.", "period_compare"],
      ["Why was last week shit?", "issue_detection"],
      ["What's going wrong?", "issue_detection"],
      ["Anything I need to act on?", "briefing_summary"],
      ["Give me the top 3 and bottom 3 days this month.", "day_ranking"],
      ["What went wrong operationally this week?", "operational_review"],
      ["Is Khobar doing better than Riyadh?", "branch_compare"],
    ];
    for (const [question, intent] of cases) {
      const out = runPlannerScript(`
        const plan = mod.planManagementQuestionHeuristic(${JSON.stringify(question)}, { branchHint: "khobar" });
        return { intent: plan.intent, needs: plan.needs_clarification };
      `);
      expect({ question, ...out }).toEqual({
        question,
        intent,
        needs: false,
      });
    }
  });

  test("planner rewrites unknown/Foodics-hijacked management routes to Cash Up tools", () => {
    const samples = [
      "How's business been lately?",
      "How's August looking so far?",
      "Are sales improving or getting worse?",
      "Anything worrying right now?",
    ];
    for (const question of samples) {
      const out = routeThenPlan(question);
      expect(out.shouldInvoke).toBe(true);
      expect(out.applied).toBe(true);
      expect(out.finalIntent).toMatch(/^vault_|executive_analysis/);
      expect(out.finalIntent).not.toMatch(/sales_total|top_items|unknown/);
    }
  });

  test("explicit month compare can stay on high-confidence deterministic cash-up", () => {
    const out = routeThenPlan("Compare July with June.");
    expect(out.finalIntent).toBe("vault_cash_up_summary");
    expect(out.originalIntent === "vault_cash_up_summary" || out.applied).toBe(true);
  });

  test("deterministic high-confidence cash-up route skips planner", () => {
    const out = routeThenPlan("How was July?");
    // July overview may already be high-confidence cash-up; planner should not be required.
    if (!out.shouldInvoke) {
      expect(out.plannerUsed).toBe(false);
      expect(out.originalIntent).toMatch(/vault_cash_up|unknown/);
    } else {
      // If invoked, still must land on cash-up safely.
      expect(out.finalIntent).toBe("vault_cash_up_summary");
    }
  });

  test("applyManagementPlan resolves named months and compare via deterministic parser", () => {
    const out = runPlannerScript(`
      const plan = mod.planManagementQuestionHeuristic("Compare July with June.", { branchHint: "khobar" });
      const applied = mod.applyManagementPlanToRoute(
        { intent: "unknown", confidence: "none", debug: {} },
        plan,
        { question: "Compare July with June.", referenceDate: new Date("2026-08-10T12:00:00+03:00"), filters: { branch: "khobar" } },
      );
      return {
        applied: applied.applied,
        intent: applied.route.intent,
        hasCompare: Boolean(applied.route.vaultCompare),
        currentType: applied.route.vaultPeriod?.periodType || null,
        branch: applied.route.branchMention,
      };
    `);
    expect(out.applied).toBe(true);
    expect(out.intent).toBe("vault_cash_up_summary");
    expect(out.hasCompare).toBe(true);
    expect(out.branch).toBe("khobar");
  });

  test("resolvable relative-day questions are management-commercial without sales keywords", () => {
    const out = runPlannerScript(`
      return {
        ago: mod.looksLikeManagementCommercialQuestion("what about 2 days ago?"),
        yesterday: mod.looksLikeManagementCommercialQuestion("the day before today"),
      };
    `);
    expect(out.ago).toBe(true);
    expect(out.yesterday).toBe(true);
  });
});
