/**
 * General commerce semantic engine — plans, operators, follow-ups, limitations, RBAC.
 * Not phrase-handler tests: cases share the same planner/executor.
 */
const path = require("path");
const { execFileSync } = require("child_process");
const fs = require("fs");

const root = path.resolve(__dirname, "../../../..");
const fabricPath = path.join(root, "supabase/functions/_shared/companyIntelligence/index.ts");
const evalPath = path.join(root, "src/intelligence/askNac/eval/commerceSemanticEvalCases.json");

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

const PERIOD = { startDate: "2026-08-13", endDate: "2026-08-15", label: "13-15 Aug" };

function fixtureBody() {
  return `
    const orders = [
      { source_order_id: "o1", branch_id: "khobar", business_date: "2026-08-14", opened_at: "2026-08-14T21:30:00+00:00", closed_at: "2026-08-14T22:00:00+00:00", order_type: "dine_in", covers: 4, subtotal: 365, tax: 55, net_sales: 420, status: "completed" },
      { source_order_id: "o2", branch_id: "khobar", business_date: "2026-08-15", opened_at: "2026-08-15T23:00:00+00:00", closed_at: "2026-08-15T23:20:00+00:00", order_type: "dine_in", covers: 1, subtotal: 35, tax: 5, net_sales: 40, status: "completed" },
      { source_order_id: "o3", branch_id: "khobar", business_date: "2026-08-15", opened_at: "2026-08-15T12:00:00+00:00", closed_at: "2026-08-15T12:40:00+00:00", order_type: "dine_in", covers: 2, subtotal: 70, tax: 10, net_sales: 80, status: "completed" },
      { source_order_id: "o4", branch_id: "khobar", business_date: "2026-08-13", opened_at: "2026-08-13T18:00:00+00:00", closed_at: "2026-08-13T18:30:00+00:00", order_type: "dine_in", covers: 2, subtotal: 48, tax: 7, net_sales: 55, status: "completed" },
      { source_order_id: "o5", branch_id: "khobar", business_date: "2026-08-13", opened_at: "2026-08-13T19:00:00+00:00", closed_at: "2026-08-13T19:40:00+00:00", order_type: "dine_in", covers: 3, subtotal: 78, tax: 12, net_sales: 90, status: "completed" },
      { source_order_id: "o6", branch_id: "khobar", business_date: "2026-08-14", opened_at: "2026-08-14T22:10:00+00:00", closed_at: "2026-08-14T22:50:00+00:00", order_type: "dine_in", covers: 5, subtotal: 270, tax: 40, net_sales: 310, status: "completed" },
      { source_order_id: "o7", branch_id: "khobar", business_date: "2026-08-15", opened_at: "2026-08-15T11:00:00+00:00", closed_at: null, order_type: "dine_in", covers: 2, subtotal: 0, tax: 0, net_sales: 0, status: "open" },
      { source_order_id: "o8", branch_id: "khobar", business_date: "2026-08-14", opened_at: "2026-08-14T20:00:00+00:00", closed_at: "2026-08-14T20:25:00+00:00", order_type: "dine_in", covers: 2, subtotal: 61, tax: 9, net_sales: 70, status: "completed" },
    ];
    const items = [
      { source_order_id: "o1", source_order_item_id: "i1a", branch_id: "khobar", business_date: "2026-08-14", product_id: "p-rig", canonical_menu_item_id: "m-rig", item_name: "Rigatoni", canonical_category: "food", quantity: 1, net_amount: 280, status: "completed" },
      { source_order_id: "o1", source_order_item_id: "i1b", branch_id: "khobar", business_date: "2026-08-14", product_id: "p-ck", canonical_menu_item_id: "m-ck", item_name: "Cookies", canonical_category: "dessert", quantity: 1, net_amount: 80, status: "completed" },
      { source_order_id: "o1", source_order_item_id: "i1c", branch_id: "khobar", business_date: "2026-08-14", product_id: "p-sal", canonical_menu_item_id: "m-sal", item_name: "Salad", canonical_category: "food", quantity: 1, net_amount: 60, status: "completed" },
      { source_order_id: "o2", source_order_item_id: "i2", branch_id: "khobar", business_date: "2026-08-15", product_id: "p-ck", canonical_menu_item_id: "m-ck", item_name: "Cookies", canonical_category: "dessert", quantity: 1, net_amount: 40, status: "completed" },
      { source_order_id: "o3", source_order_item_id: "i3", branch_id: "khobar", business_date: "2026-08-15", product_id: "p-rig", canonical_menu_item_id: "m-rig", item_name: "Rigatoni", canonical_category: "food", quantity: 1, net_amount: 80, status: "completed" },
      { source_order_id: "o4", source_order_item_id: "i4", branch_id: "khobar", business_date: "2026-08-13", product_id: "p-br", canonical_menu_item_id: "m-br", item_name: "Brownie", canonical_category: "dessert", quantity: 1, net_amount: 55, status: "completed" },
      { source_order_id: "o5", source_order_item_id: "i5", branch_id: "khobar", business_date: "2026-08-13", product_id: "p-sal", canonical_menu_item_id: "m-sal", item_name: "Salad", canonical_category: "food", quantity: 2, net_amount: 90, status: "completed" },
      { source_order_id: "o6", source_order_item_id: "i6a", branch_id: "khobar", business_date: "2026-08-14", product_id: "p-rig", canonical_menu_item_id: "m-rig", item_name: "Rigatoni", canonical_category: "food", quantity: 1, net_amount: 220, status: "completed" },
      { source_order_id: "o6", source_order_item_id: "i6b", branch_id: "khobar", business_date: "2026-08-14", product_id: "p-tir", canonical_menu_item_id: "m-tir", item_name: "Tiramisu", canonical_category: "dessert", quantity: 1, net_amount: 90, status: "completed" },
      { source_order_id: "o7", source_order_item_id: "i7", branch_id: "khobar", business_date: "2026-08-15", product_id: "p-esp", canonical_menu_item_id: "m-esp", item_name: "Espresso", canonical_category: "coffee", quantity: 1, net_amount: 0, status: "completed" },
      { source_order_id: "o8", source_order_item_id: "i8a", branch_id: "khobar", business_date: "2026-08-14", product_id: "p-esp", canonical_menu_item_id: "m-esp", item_name: "Espresso", canonical_category: "coffee", quantity: 1, net_amount: 18, status: "completed" },
      { source_order_id: "o8", source_order_item_id: "i8b", branch_id: "khobar", business_date: "2026-08-14", product_id: "p-ck", canonical_menu_item_id: "m-ck", item_name: "Cookies", canonical_category: "dessert", quantity: 1, net_amount: 52, status: "completed" },
    ];
    const store = mod.createMemoryCommerceStore({
      orders, items,
      coverage: { branchId: "khobar", startDate: "2026-08-13", endDate: "2026-08-15" },
    });
    const scope = mod.createIntelligenceScope({
      primaryBranchId: "khobar",
      branchIds: ["khobar"],
      allowedBranchIds: ["khobar"],
      canSeeNetwork: false,
    });
    const period = ${JSON.stringify(PERIOD)};
  `;
}

function execQuestion() { return null; }
void execQuestion;

describe("commerce semantic registry and planner", () => {
  test("physical table is unavailable and does not invent a field", () => {
    const out = run(`
      const planned = mod.planSemanticCommerce({ question: "Which physical table number ordered the most Rigatoni?", branchId: "khobar", period: ${JSON.stringify(PERIOD)} });
      return { ok: planned.ok, field: planned.field, intent: planned.plan && planned.plan.outputIntent };
    `);
    expect(out.ok).toBe(false);
    expect(out.field).toBe("physical_table_number");
    expect(out.intent).toBe("limitation");
  });

  test("unknown metric fails closed", () => {
    const out = run(`
      const planned = mod.validateCommercePlan({
        domain: "commerce", entity: "orders", metric: "made_up_kpi",
        dimensions: [], filters: [], period: ${JSON.stringify(PERIOD)}, outputIntent: "value",
      });
      return planned;
    `);
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/Unknown metric/);
  });

  test("Cookies co-occurrence plans a general cooccurrence operator", () => {
    const out = run(`
      const planned = mod.planSemanticCommerce({
        question: "What products are most commonly ordered with Cookies?",
        branchId: "khobar", period: ${JSON.stringify(PERIOD)},
      });
      return { ok: planned.ok, calc: planned.plan.calculation, seed: planned.plan.seedProduct, intent: planned.plan.outputIntent };
    `);
    expect(out.ok).toBe(true);
    expect(out.calc).toBe("cooccurrence");
    expect(out.seed).toMatch(/Cookies/i);
    expect(out.intent).toBe("ranking");
  });
});

describe("commerce semantic executor on fixture", () => {
  test("acceptance-style questions return bounded evidence", () => {
    const out = run(`
      ${fixtureBody()}
      async function ask(question, previousPlan) {
        const planned = mod.planSemanticCommerce({ question, branchId: "khobar", period, previousPlan });
        if (!planned.ok && planned.plan && planned.plan.outputIntent === "limitation") {
          return { limitation: planned.reason, plan: planned.plan };
        }
        const exec = await mod.executeCommercePlan({ plan: planned.plan, store, scope });
        const validation = mod.validateSemanticResult(planned.plan, exec);
        const text = mod.synthesizeSemanticCommerce({ question, plan: planned.plan, result: exec, validation });
        return { ok: planned.ok && exec.ok && validation.ok, plan: planned.plan, exec, text };
      }
      const cookies = await ask("What products are most commonly ordered with Cookies?");
      const rigAvg = await ask("What is the average check when Rigatoni is ordered?");
      const high = await ask("Which products are most associated with checks above 300 SAR?");
      const one = await ask("What percentage of checks had only one product?");
      const biggest = await ask("What are the 10 biggest checks in August?");
      const guests = await ask("Which products are ordered most often on checks with 4+ guests?");
      const dessertNoFood = await ask("How many completed dine-in checks had dessert but no food?");
      const attach = await ask("What is the dessert attach rate on food-containing sessions?");
      const weekend = await ask("Compare weekend basket size to weekdays.");
      const table = await ask("Which physical table number ordered the most Rigatoni?");
      const open = await ask("How many open/Joined orders existed?");
      const after = await ask("Only after 9pm.", cookies.plan);
      return {
        cookiesNames: (cookies.exec.ranking || []).map((r) => r.name),
        cookiesCohort: cookies.exec.cohortSize,
        rigAvg: rigAvg.exec.value,
        highLead: (high.exec.ranking || []).map((r) => r.name).slice(0, 3),
        onePct: one.exec.value,
        oneNum: one.exec.numerator,
        oneDen: one.exec.denominator,
        biggest: (biggest.exec.ranking || []).map((r) => r.net_sales),
        guestLead: (guests.exec.ranking || [])[0] && guests.exec.ranking[0].name,
        dessertNoFood: dessertNoFood.exec.value,
        attach: attach.exec.value,
        weekendA: weekend.exec.comparison && weekend.exec.comparison.aValue,
        weekendB: weekend.exec.comparison && weekend.exec.comparison.bValue,
        causal: weekend.exec.comparison && weekend.exec.comparison.causal,
        tableLimit: table.limitation || table.plan.unavailable.reason,
        openN: open.exec.value,
        afterHour: (after.plan.filters || []).some((f) => f.field === "hour" && f.value >= 21),
        cookiesText: cookies.text,
      };
    `);
    expect(out.cookiesCohort).toBe(3);
    expect(out.cookiesNames.join(" ")).toMatch(/Salad|Espresso/i);
    expect(out.rigAvg).toBeCloseTo((420 + 80 + 310) / 3, 5);
        expect(out.oneNum).toBe(5);
        expect(out.oneDen).toBe(8);
        expect(out.biggest[0]).toBe(420);
        expect(out.guestLead).toBe("Rigatoni");
        expect(out.dessertNoFood).toBe(3);
    expect(out.attach).toBeCloseTo(2 / 4, 5);
    expect(out.causal).toBe(false);
    expect(out.tableLimit).toMatch(/[Tt]able/);
    expect(out.openN).toBe(1);
    expect(out.afterHour).toBe(true);
    expect(out.cookiesText).not.toMatch(/Need a clearer metric question/i);
  });

  test("RBAC blocks another branch", () => {
    const out = run(`
      ${fixtureBody()}
      const denied = mod.createIntelligenceScope({
        primaryBranchId: "riyadh",
        branchIds: ["riyadh"],
        allowedBranchIds: ["khobar"],
        canSeeNetwork: false,
      });
      const planned = mod.planSemanticCommerce({
        question: "What are the 10 biggest checks in August?",
        branchId: "riyadh", period,
      });
      const exec = await mod.executeCommercePlan({ plan: planned.plan, store, scope: denied });
      return { ok: exec.ok, limitation: exec.limitation };
    `);
    expect(out.ok).toBe(false);
    expect(out.limitation).toMatch(/access|RBAC|include/i);
  });
});

describe("commerce semantic eval suite", () => {
  test("eval cases have expected plan fields", () => {
    const cases = JSON.parse(fs.readFileSync(evalPath, "utf8"));
    expect(cases.length).toBeGreaterThanOrEqual(100);
    const out = run(`
      const cases = ${JSON.stringify(cases)};
      const results = cases.map((c) => {
        const planned = mod.planSemanticCommerce({
          question: c.question,
          branchId: "khobar",
          period: c.period || ${JSON.stringify(PERIOD)},
          previousPlan: c.previousPlan || null,
        });
        const ok = c.expectLimitation
          ? planned.ok === false || planned.plan.outputIntent === "limitation"
          : planned.ok === true;
        const calcOk = !c.calculation || (planned.plan && planned.plan.calculation === c.calculation);
        const fieldOk = !c.unavailableField || planned.field === c.unavailableField || (planned.plan && planned.plan.unavailable && planned.plan.unavailable.field === c.unavailableField);
        return { id: c.id, ok, calcOk, fieldOk, calc: planned.plan && planned.plan.calculation, reason: planned.reason };
      });
      return { n: results.length, fail: results.filter((r) => !r.ok || !r.calcOk || !r.fieldOk) };
    `);
    expect(out.fail).toEqual([]);
    expect(out.n).toBeGreaterThanOrEqual(100);
  });

  test("named month beats last-7 default and clamp stays inclusive", () => {
    const out = run(`
      const ref = new Date("2026-08-18T12:00:00+03:00");
      const forms = ["August", "Aug", "in August", "this August", "August 2026", "for August", "during August", "the month of August", "share of August checks"];
      const periods = {};
      for (const q of forms) {
        const r = mod.resolveCommercePeriod({ question: q, referenceDate: ref });
        periods[q] = r.range && r.range.startDate + "/" + r.range.endDate + "/" + r.precedence;
      }
      const july = mod.resolveCommercePeriod({ question: "Same for July", referenceDate: ref });
      const clamp = mod.clampInclusiveCompleted({
        startDate: "2026-07-01",
        endDate: "2026-07-31",
        coverageStart: "2026-07-01",
        coverageEnd: "2026-08-17",
        referenceDate: ref,
      });
      const noShift = mod.clampInclusiveCompleted({
        startDate: "2026-07-01",
        endDate: "2026-08-17",
        coverageStart: "2026-07-01",
        coverageEnd: "2026-08-17",
        referenceDate: ref,
      });
      const today = mod.clampInclusiveCompleted({
        startDate: "2026-08-01",
        endDate: "2026-08-18",
        coverageStart: "2026-07-01",
        coverageEnd: "2026-08-17",
        referenceDate: ref,
      });
      const before = mod.clampInclusiveCompleted({
        startDate: "2026-06-01",
        endDate: "2026-06-30",
        coverageStart: "2026-07-01",
        coverageEnd: "2026-08-17",
        referenceDate: ref,
      });
      return { periods, july: july.range, clamp, noShift, today, before, prec: july.precedence };
    `);
    for (const v of Object.values(out.periods)) {
      expect(String(v)).toMatch(/^2026-08-01\/2026-08-31\/named/);
    }
    expect(out.july.startDate).toBe("2026-07-01");
    expect(out.july.endDate).toBe("2026-07-31");
    expect(out.clamp.startDate).toBe("2026-07-01");
    expect(out.clamp.endDate).toBe("2026-07-31");
    expect(out.noShift.startDate).toBe("2026-07-01");
    expect(out.today.endDate).toBe("2026-08-17");
    expect(out.today.excludedToday).toBe(true);
    expect(out.before.beforeCoverage).toBe(true);
    expect(out.before.startDate).toBe("2026-06-01");
    expect(out.before.endDate).toBe("2026-06-30");
  });
});
