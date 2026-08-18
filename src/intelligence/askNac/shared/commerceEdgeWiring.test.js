/**
 * NAC-COMMERCE-0002 — Edge/Fabric commerce-store wiring & canonical-store fallback probes.
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.resolve(__dirname, "../../../..");
const fabricPath = path.join(root, "supabase/functions/_shared/companyIntelligence/index.ts");
const orchestratorPath = path.join(root, "supabase/functions/_shared/askNacOrchestrator.ts");
const edgeHandlerPath = path.join(root, "supabase/functions/ask-nac/index.ts");
const storePath = path.join(root, "supabase/functions/_shared/companyIntelligence/commerce/semantic/store.ts");

const orchestratorSource = fs.readFileSync(orchestratorPath, "utf8");
const edgeHandlerSource = fs.readFileSync(edgeHandlerPath, "utf8");
const storeSource = fs.readFileSync(storePath, "utf8");

const REF = "new Date('2026-08-18T12:00:00+03:00')";

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
    maxBuffer: 16 * 1024 * 1024,
  }).trim());
}

const MEMORY_STORE_FIXTURE = `
  const store = mod.createMemoryCommerceStore({
    orders: [
      { source_order_id: "j1", branch_id: "khobar", business_date: "2026-07-10", opened_at: null, closed_at: null, order_type: "dine_in", covers: 2, subtotal: 40, tax: 0, net_sales: 40, status: "completed" },
      { source_order_id: "j2", branch_id: "khobar", business_date: "2026-07-12", opened_at: null, closed_at: null, order_type: "dine_in", covers: 2, subtotal: 180, tax: 0, net_sales: 180, status: "completed" },
      { source_order_id: "a1", branch_id: "khobar", business_date: "2026-08-05", opened_at: null, closed_at: null, order_type: "dine_in", covers: 2, subtotal: 35, tax: 0, net_sales: 35, status: "completed" },
      { source_order_id: "a2", branch_id: "khobar", business_date: "2026-08-08", opened_at: null, closed_at: null, order_type: "dine_in", covers: 2, subtotal: 200, tax: 0, net_sales: 200, status: "completed" },
    ],
    items: [
      { source_order_id: "j1", source_order_item_id: "ji1", branch_id: "khobar", business_date: "2026-07-10", product_id: "p1", canonical_menu_item_id: "m1", item_name: "Brownie", canonical_category: "dessert", quantity: 1, net_amount: 40, status: "completed" },
      { source_order_id: "j2", source_order_item_id: "ji2", branch_id: "khobar", business_date: "2026-07-12", product_id: "p2", canonical_menu_item_id: "m2", item_name: "Big NAC", canonical_category: "food", quantity: 1, net_amount: 180, status: "completed" },
      { source_order_id: "a1", source_order_item_id: "ai1", branch_id: "khobar", business_date: "2026-08-05", product_id: "p3", canonical_menu_item_id: "m3", item_name: "Pavlova", canonical_category: "dessert", quantity: 1, net_amount: 35, status: "completed" },
      { source_order_id: "a2", source_order_item_id: "ai2", branch_id: "khobar", business_date: "2026-08-08", product_id: "p4", canonical_menu_item_id: "m4", item_name: "Big NAC", canonical_category: "food", quantity: 1, net_amount: 200, status: "completed" },
    ],
    coverage: { branchId: "khobar", startDate: "2026-07-01", endDate: "2026-08-17" },
  });
  const scope = mod.createIntelligenceScope({
    primaryBranchId: "khobar",
    branchIds: ["khobar"],
    allowedBranchIds: ["khobar"],
    canSeeNetwork: false,
  });
`;

describe("Edge entry path → Fabric commerce store wiring", () => {
  test("ask-nac Edge handler delegates to processAskNacOnEdge with auth-scoped Supabase client", () => {
    expect(edgeHandlerSource).toMatch(/import\s+\{\s*processAskNacOnEdge\s*\}/);
    expect(edgeHandlerSource).toMatch(/processAskNacOnEdge\(supabase/);
    expect(edgeHandlerSource).toMatch(/ask_nac_vault_branch_allowed/);
    expect(edgeHandlerSource).toMatch(/global:\s*\{\s*headers:\s*\{\s*Authorization:\s*authHeader\s*\}/);
  });

  test("processAskNacOnEdge constructs Supabase commerce store for Fabric spine turns", () => {
    expect(orchestratorSource).toMatch(/createSupabaseCommerceStore\(supabase\)/);
    expect(orchestratorSource).toMatch(/commerceStore:\s*createSupabaseCommerceStore\(supabase\)/);
    expect(orchestratorSource).toMatch(/runCompanyIntelligenceOrchestration\(\{/);
    const spineBlock = orchestratorSource.slice(
      orchestratorSource.indexOf("if (useFabricSpine)"),
      orchestratorSource.indexOf("// Legacy non-management path"),
    );
    expect(spineBlock).toMatch(/createSupabaseCommerceStore\(supabase\)/);
    expect(spineBlock).toMatch(/commerceStore:\s*createSupabaseCommerceStore\(supabase\)/);
  });

  test("createSupabaseCommerceStore scopes every fetch by branch_id (no cross-branch widening)", () => {
    expect(storeSource).toMatch(/\.eq\("branch_id",\s*branchId\)/);
    expect(storeSource.match(/\.eq\("branch_id",\s*branchId\)/g).length).toBeGreaterThanOrEqual(3);
    expect(storeSource).not.toMatch(/\.in\("branch_id"/);
  });

  test("dessert table-mix questions route to Fabric spine (management intelligence gate)", () => {
    const out = run(`
      const q = "What percentage of our tables were dessert tables in July?";
      return {
        fabric: mod.isManagementIntelligenceQuestion(q, { intent: "unknown", confidence: "none" }, { referenceDate: ${REF} }),
        semantic: mod.looksLikeSemanticCommerceQuestion(q),
        focus: mod.extractCommerceFocus(q),
      };
    `);
    expect(out.fabric).toBe(true);
    expect(out.semantic).toBe(true);
    expect(out.focus).toBe("dessert_focused");
  });
});

describe("Fabric orchestration — canonical store fallback (no published snapshot)", () => {
  test("commerce session question answers from store when publishedCommerce is absent", () => {
    const out = run(`
      ${MEMORY_STORE_FIXTURE}
      const result = await mod.runCompanyIntelligenceOrchestration({
        question: "What percentage of our tables were dessert tables in July?",
        branchHint: "khobar",
        scope,
        referenceDate: ${REF},
        mode: "heuristic",
        publishedCommerce: null,
        commerceStore: store,
      });
      return {
        type: result.answerType,
        category: result.state.cost.requestCategory,
        caps: result.state.plan.capabilities,
        text: result.answerText,
        period: result.state.periods.current?.startDate,
        branch: result.state.scope.primaryBranchId,
        deterministic: result.state.cost.deterministicRouteUsed,
      };
    `);
    expect(out.type).toBe("commerce");
    expect(out.category).toBe("commerce_session");
    expect(out.caps).toContain("commerce.session_mix");
    expect(out.text).toMatch(/50\.0%/);
    expect(out.text).toMatch(/dessert-focused/i);
    expect(out.period).toBe("2026-07-01");
    expect(out.branch).toBe("khobar");
    expect(out.deterministic).toBe(true);
  });

  test("explicit comparison computes both periods through store-backed table-mix", () => {
    const out = run(`
      ${MEMORY_STORE_FIXTURE}
      const result = await mod.runCompanyIntelligenceOrchestration({
        question: "Compare dessert table mix July vs August",
        branchHint: "khobar",
        scope,
        referenceDate: ${REF},
        mode: "heuristic",
        publishedCommerce: null,
        commerceStore: store,
      });
      return {
        caps: result.state.plan.capabilities,
        text: result.answerText,
        compareStart: result.state.periods.comparison?.startDate,
        currentStart: result.state.periods.current?.startDate,
      };
    `);
    expect(out.caps).toContain("commerce.compare_mix");
    expect([out.currentStart, out.compareStart].sort()).toEqual(["2026-07-01", "2026-08-01"]);
    expect(out.text).toMatch(/percentage-point/i);
  });

  test("period-only follow-up preserves commerce focus, branch, and store path", () => {
    const out = run(`
      ${MEMORY_STORE_FIXTURE}
      const first = await mod.runCompanyIntelligenceOrchestration({
        question: "What percentage of our tables were dessert tables in July?",
        branchHint: "khobar",
        scope,
        referenceDate: ${REF},
        mode: "heuristic",
        publishedCommerce: null,
        commerceStore: store,
      });
      const follow = await mod.runCompanyIntelligenceOrchestration({
        question: "What about August?",
        branchHint: "khobar",
        scope,
        conversation: first.nextConversation,
        referenceDate: ${REF},
        mode: "heuristic",
        publishedCommerce: null,
        commerceStore: store,
      });
      return {
        firstFocus: first.nextConversation.filters?.commerceFocus || first.nextConversation.semantics?.commerceFocus,
        followFocus: follow.nextConversation.filters?.commerceFocus || follow.state.conversation?.filters?.commerceFocus,
        followPeriod: follow.state.periods.current?.startDate,
        followBranch: follow.state.scope.primaryBranchId,
        followType: follow.answerType,
        followText: follow.answerText,
        fabricGate: mod.isManagementIntelligenceQuestion("What about August?", { intent: "unknown", confidence: "none" }, { priorFabricConversation: first.nextConversation, referenceDate: ${REF} }),
      };
    `);
    expect(out.fabricGate).toBe(true);
    expect(out.firstFocus).toBe("dessert_focused");
    expect(out.followFocus).toBe("dessert_focused");
    expect(out.followPeriod).toBe("2026-08-01");
    expect(out.followBranch).toBe("khobar");
    expect(out.followType).toBe("commerce");
    expect(out.followText).toMatch(/dessert-focused/i);
  });

  test("RBAC blocks unauthorized branch at store compute boundary", () => {
    const out = run(`
      const store = mod.createMemoryCommerceStore({
        orders: [{ source_order_id: "o1", branch_id: "jeddah", business_date: "2026-07-10", opened_at: null, closed_at: null, order_type: "dine_in", covers: 2, subtotal: 40, tax: 0, net_sales: 40, status: "completed" }],
        items: [{ source_order_id: "o1", source_order_item_id: "i1", branch_id: "jeddah", business_date: "2026-07-10", product_id: "p1", canonical_menu_item_id: "m1", item_name: "Brownie", canonical_category: "dessert", quantity: 1, net_amount: 40, status: "completed" }],
        coverage: { branchId: "jeddah", startDate: "2026-07-01", endDate: "2026-07-31" },
      });
      const scope = mod.createIntelligenceScope({
        primaryBranchId: "jeddah",
        branchIds: ["jeddah"],
        allowedBranchIds: ["khobar"],
        canSeeNetwork: false,
      });
      const result = await mod.runCompanyIntelligenceOrchestration({
        question: "What percentage of our tables were dessert tables in July?",
        branchHint: "jeddah",
        scope,
        referenceDate: ${REF},
        mode: "heuristic",
        publishedCommerce: null,
        commerceStore: store,
      });
      return { text: result.answerText, type: result.answerType };
    `);
    expect(out.text).toMatch(/access does not include/i);
    expect(out.type).toBe("commerce_unavailable");
  });

  test("coverage diagnostics survive store-backed Edge path", () => {
    const out = run(`
      const store = mod.createMemoryCommerceStore({
        orders: [{ source_order_id: "u1", branch_id: "khobar", business_date: "2026-07-10", opened_at: null, closed_at: null, order_type: "dine_in", covers: 2, subtotal: 15, tax: 0, net_sales: 15, status: "completed" }],
        items: [{ source_order_id: "u1", source_order_item_id: "i1", branch_id: "khobar", business_date: "2026-07-10", product_id: "p1", canonical_menu_item_id: null, item_name: "Mystery", canonical_category: "unclassified", quantity: 1, net_amount: 15, status: "completed" }],
        coverage: { branchId: "khobar", startDate: "2026-07-01", endDate: "2026-07-31" },
      });
      const scope = mod.createIntelligenceScope({
        primaryBranchId: "khobar", branchIds: ["khobar"], allowedBranchIds: ["khobar"], canSeeNetwork: false,
      });
      const computed = await mod.computeTableMixFromStore({
        store, scope, period: { startDate: "2026-07-01", endDate: "2026-07-31" },
      });
      return {
        ok: computed.ok,
        unclassified: computed.result?.mix.byArchetype.unclassified.sessions,
        limitation: computed.result?.diagnostics.limitation,
        coverageComplete: computed.result?.diagnostics.coverageComplete,
      };
    `);
    expect(out.ok).toBe(true);
    expect(out.unclassified).toBe(1);
    expect(out.coverageComplete).toBe(false);
    expect(out.limitation).toBeTruthy();
  });

  test("Cash Up remains headline sales authority on commerce turns", () => {
    const out = run(`
      return {
        headline: mod.selectSourceAuthority({ commercialMetric: "net_sales" }),
        session: mod.selectSourceAuthority({ commerceFocus: "dessert_focused" }),
      };
    `);
    expect(out.headline).toBe("cash_up");
    expect(out.session).toBe("canonical_commerce_sessions");
  });
});
