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
          ? {
              intent: "diagnostic",
              question: "prior",
              branchScope: ["khobar"],
              period: c.previousPeriod || { startDate: "2026-08-01", endDate: "2026-08-17", label: "August 2026 (to date)", semantic: "this_month" },
              compare: c.previousCompare || null,
              evidence: c.previousDomains.map((d) => ({
                domain: d,
                capability: d === "commerce" ? "commerce.semantic_query" : "commercial.performance",
                filters: [
                  ...(c.previousWeekend && d !== "cash_up" ? [{ field: "weekend", op: "eq", value: true }] : []),
                  ...((c.previousFilters || []).filter((f) => d !== "cash_up" || !["weekend", "hour", "family", "product"].includes(f.field))),
                ],
                operators: [],
              })),
              alignment: c.previousWeekend ? ["period", "branch", "weekend"] : ["period", "branch"],
              synthesis: "management",
              commerceSnapshot: (c.previousWeekend || c.previousFilters)
                ? {
                  domain: "commerce",
                  entity: "orders",
                  metric: "order_count",
                  dimensions: [],
                  filters: [
                    ...(c.previousWeekend ? [{ field: "weekend", op: "eq", value: true }] : []),
                    ...(c.previousFilters || []),
                  ],
                  period: { startDate: "2026-08-01", endDate: "2026-08-17" },
                  outputIntent: "value",
                  calculation: "none",
                  seedProduct: c.expectSeed || null,
                }
                : null,
              unsupportedFilters: c.previousWeekend ? [{ domain: "cash_up", field: "weekend", reason: "Cash Up has no native weekend slice; headline figures remain the full selected period." }] : [],
            }
          : null;
        const looks = mod.looksLikeUniversalManagementQuestion(c.question, prev);
        if (c.expectNotUniversal) {
          if (looks) fail.push({ id: c.id, reason: "should_not_be_universal" });
          continue;
        }
        const planned = mod.planUniversalManagement({
          question: c.question,
          branchId: "khobar",
          period: c.period || { startDate: "2026-08-11", endDate: "2026-08-17", label: "last 7 days" },
          comparePeriod: c.omitCompare ? null : (c.comparePeriod || { startDate: "2026-08-04", endDate: "2026-08-10" }),
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
        if (c.expectCommerceFilter) {
          const commerce = planned.evidence.find((e) => e.domain === "commerce");
          const hit = (commerce?.filters || []).some((f) => f.field === c.expectCommerceFilter.field && String(f.value) === String(c.expectCommerceFilter.value));
          if (!hit) fail.push({ id: c.id, reason: "missing_commerce_filter", filters: commerce?.filters });
        }
        if (c.expectCashUpNoWeekend) {
          const cash = planned.evidence.find((e) => e.domain === "cash_up");
          if ((cash?.filters || []).some((f) => f.field === "weekend")) fail.push({ id: c.id, reason: "cash_up_should_not_have_weekend" });
        }
        if (c.expectUnsupportedWeekend) {
          const hit = (planned.unsupportedFilters || []).some((u) => u.domain === "cash_up" && u.field === "weekend");
          if (!hit) fail.push({ id: c.id, reason: "missing_unsupported_weekend", unsupported: planned.unsupportedFilters });
        }
        if (c.expectCompare && !planned.compare) fail.push({ id: c.id, reason: "missing_compare_period" });
        if (c.expectHourFilter) {
          const commerce = planned.evidence.find((e) => e.domain === "commerce");
          const hit = (commerce?.filters || []).some((f) => f.field === "hour" && Number(f.value) === c.expectHourFilter);
          if (!hit) fail.push({ id: c.id, reason: "missing_hour_filter", filters: commerce?.filters });
        }
        if (c.expectSeed && planned.commerceSnapshot && planned.commerceSnapshot.seedProduct !== c.expectSeed) {
          fail.push({ id: c.id, reason: "seed_not_preserved", seed: planned.commerceSnapshot?.seedProduct });
        }
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

  test("weekend filter inherits across follow-ups and skips Cash Up", () => {
    const out = run(`
      const first = mod.planUniversalManagement({
        question: "Why were sales weaker this month?",
        branchId: "khobar",
        period: { startDate: "2026-08-01", endDate: "2026-08-17" },
      });
      const weekends = mod.planUniversalManagement({
        question: "Only weekends.",
        branchId: "khobar",
        previousPlan: first,
        weekendOnly: true,
      });
      const july = mod.planUniversalManagement({
        question: "Compare with July.",
        branchId: "khobar",
        previousPlan: weekends,
        period: { startDate: "2026-07-01", endDate: "2026-07-31", label: "July 2026" },
      });
      const dessert = mod.planUniversalManagement({
        question: "Did dessert behavior help or hurt average check?",
        branchId: "khobar",
      });
      const commerce = july.evidence.find((e) => e.domain === "commerce");
      const cash = july.evidence.find((e) => e.domain === "cash_up");
      return {
        alignment: july.alignment,
        commerceWeekend: (commerce.filters || []).some((f) => f.field === "weekend"),
        cashWeekend: (cash.filters || []).some((f) => f.field === "weekend"),
        dessertOps: dessert.evidence.find((e) => e.domain === "commerce")?.operators,
        dessertFamily: (dessert.evidence.find((e) => e.domain === "commerce")?.filters || []).map((f) => f.field + "=" + f.value),
      };
    `);
    expect(out.alignment).toEqual(expect.arrayContaining(["weekend"]));
    expect(out.commerceWeekend).toBe(true);
    expect(out.cashWeekend).toBe(false);
    expect(out.dessertOps).toEqual(expect.arrayContaining(["cohort_compare"]));
    expect(out.dessertFamily.join(" ")).toMatch(/family=dessert/);
  });

  test("follow-up chains preserve filters and only replace period", () => {
    const out = run(`
      const a1 = mod.planSemanticCommerce({
        question: "Compare weekend vs weekday basket size in August",
        branchId: "khobar",
        period: { startDate: "2026-08-01", endDate: "2026-08-17", label: "August" },
      }).plan;
      const a2 = mod.planSemanticCommerce({
        question: "Only after 9pm",
        branchId: "khobar",
        period: { startDate: "2026-08-01", endDate: "2026-08-17", label: "August" },
        previousPlan: a1,
      }).plan;
      const a3 = mod.planSemanticCommerce({
        question: "Same for July",
        branchId: "khobar",
        period: { startDate: "2026-07-01", endDate: "2026-07-31", label: "July 2026" },
        previousPlan: a2,
      }).plan;
      const b1 = mod.planSemanticCommerce({
        question: "What products are most commonly ordered with Cookies?",
        branchId: "khobar",
        period: { startDate: "2026-08-01", endDate: "2026-08-17" },
      }).plan;
      const b2 = mod.planSemanticCommerce({
        question: "Only weekends",
        branchId: "khobar",
        period: { startDate: "2026-08-01", endDate: "2026-08-17" },
        previousPlan: b1,
      }).plan;
      const b3 = mod.planSemanticCommerce({
        question: "Compare with July",
        branchId: "khobar",
        period: { startDate: "2026-07-01", endDate: "2026-07-31", label: "July 2026" },
        previousPlan: b2,
      }).plan;
      const c1 = mod.planUniversalManagement({
        question: "Why were sales weaker this month?",
        branchId: "khobar",
        period: { startDate: "2026-08-01", endDate: "2026-08-17", semantic: "this_month" },
        comparePeriod: null,
      });
      const c2 = mod.planUniversalManagement({
        question: "What about weekends?",
        branchId: "khobar",
        previousPlan: c1,
        period: c1.period,
      });
      const c3 = mod.planUniversalManagement({
        question: "Same for July",
        branchId: "khobar",
        previousPlan: c2,
        period: { startDate: "2026-07-01", endDate: "2026-07-31", label: "July 2026" },
      });
      const d1 = mod.planUniversalManagement({
        question: "How was August operationally?",
        branchId: "khobar",
        period: { startDate: "2026-08-01", endDate: "2026-08-17" },
      });
      const d2 = mod.planUniversalManagement({
        question: "Only desserts",
        branchId: "khobar",
        previousPlan: d1,
        period: d1.period,
      });
      const d3 = mod.planUniversalManagement({
        question: "Same for July",
        branchId: "khobar",
        previousPlan: d2,
        period: { startDate: "2026-07-01", endDate: "2026-07-31", label: "July 2026" },
      });
      return {
        aHour: (a3.filters || []).some((f) => f.field === "hour" && Number(f.value) === 21),
        aWeekend: (a3.filters || []).some((f) => f.field === "weekend") || a3.cohort?.kind === "weekend" || a3.compareCohort?.kind === "weekday",
        aPeriod: a3.period && a3.period.startDate,
        bSeed: b3.seedProduct,
        bWeekend: (b3.filters || []).some((f) => f.field === "weekend"),
        bPeriod: b3.period && b3.period.startDate,
        cCompare: Boolean(c1.compare),
        cWeekend: (c3.evidence.find((e) => e.domain === "commerce")?.filters || []).some((f) => f.field === "weekend"),
        cCashWeekend: (c3.evidence.find((e) => e.domain === "cash_up")?.filters || []).some((f) => f.field === "weekend"),
        cJuly: c3.period && c3.period.startDate,
        cUnsupported: (c3.unsupportedFilters || []).some((u) => u.domain === "cash_up" && u.field === "weekend"),
        dFamily: (d3.evidence.find((e) => e.domain === "commerce")?.filters || []).some((f) => f.field === "family" && f.value === "dessert"),
        dJuly: d3.period && d3.period.startDate,
        dCash: d3.evidence.some((e) => e.domain === "cash_up"),
      };
    `);
    expect(out.aHour).toBe(true);
    expect(out.aWeekend).toBe(true);
    expect(out.aPeriod).toBe("2026-07-01");
    expect(String(out.bSeed).toLowerCase()).toMatch(/cookie/);
    expect(out.bWeekend).toBe(true);
    expect(out.bPeriod).toBe("2026-07-01");
    expect(out.cCompare).toBe(true);
    expect(out.cWeekend).toBe(true);
    expect(out.cCashWeekend).toBe(false);
    expect(out.cJuly).toBe("2026-07-01");
    expect(out.cUnsupported).toBe(true);
    expect(out.dFamily).toBe(true);
    expect(out.dJuly).toBe("2026-07-01");
    expect(out.dCash).toBe(true);
  });

  test("period replacement executes weekend-constrained commerce, not the full month", () => {
    const out = run(`
      const orders = [
        { source_order_id: "w1", branch_id: "khobar", business_date: "2026-07-03", opened_at: "2026-07-03T18:00:00+03:00", closed_at: "2026-07-03T19:00:00+03:00", order_type: "dine_in", covers: 2, subtotal: 80, tax: 12, net_sales: 92, status: "completed" },
        { source_order_id: "w2", branch_id: "khobar", business_date: "2026-07-04", opened_at: "2026-07-04T18:00:00+03:00", closed_at: "2026-07-04T19:00:00+03:00", order_type: "dine_in", covers: 2, subtotal: 80, tax: 12, net_sales: 92, status: "completed" },
        { source_order_id: "d1", branch_id: "khobar", business_date: "2026-07-06", opened_at: "2026-07-06T18:00:00+03:00", closed_at: "2026-07-06T19:00:00+03:00", order_type: "dine_in", covers: 2, subtotal: 80, tax: 12, net_sales: 92, status: "completed" },
        { source_order_id: "d2", branch_id: "khobar", business_date: "2026-07-07", opened_at: "2026-07-07T18:00:00+03:00", closed_at: "2026-07-07T19:00:00+03:00", order_type: "dine_in", covers: 2, subtotal: 80, tax: 12, net_sales: 92, status: "completed" },
      ];
      const items = orders.map((o, i) => ({
        source_order_id: o.source_order_id, source_order_item_id: "i" + i, branch_id: "khobar",
        business_date: o.business_date, product_id: "p", canonical_menu_item_id: "m",
        item_name: "Salad", canonical_category: "food", quantity: 1, net_amount: 92, status: "completed",
      }));
      const store = mod.createMemoryCommerceStore({
        orders, items,
        coverage: { branchId: "khobar", startDate: "2026-07-01", endDate: "2026-08-17" },
      });
      const scope = mod.createIntelligenceScope({
        primaryBranchId: "khobar", branchIds: ["khobar"], allowedBranchIds: ["khobar"], canSeeNetwork: false,
      });
      const first = mod.planUniversalManagement({
        question: "Why were sales weaker this month?",
        branchId: "khobar",
        period: { startDate: "2026-08-01", endDate: "2026-08-17", label: "August 2026 (to date)", semantic: "this_month" },
      });
      first.commerceSnapshot = {
        domain: "commerce", entity: "orders", metric: "order_count", dimensions: [],
        filters: [{ field: "branch", op: "eq", value: "khobar" }],
        period: { startDate: "2026-08-01", endDate: "2026-08-17" },
        outputIntent: "value", calculation: "none",
      };
      const weekends = mod.planUniversalManagement({
        question: "What about weekends?",
        branchId: "khobar",
        previousPlan: first,
        period: first.period,
      });
      const july = mod.planUniversalManagement({
        question: "Same for July",
        branchId: "khobar",
        previousPlan: weekends,
        period: { startDate: "2026-07-01", endDate: "2026-07-31", label: "July 2026" },
      });
      const executed = await mod.executeUniversalPlan({
        plan: july,
        scope,
        executor: mod.createMockCapabilityExecutor(),
        commerceStore: store,
      });
      const commerce = executed.evidence.find((e) => e.domain === "commerce");
      return {
        weekendFilter: (july.commerceSnapshot?.filters || []).some((f) => f.field === "weekend"),
        alignment: july.alignment,
        text: commerce && commerce.text,
        value: commerce && commerce.value,
        snapshotWeekend: (executed.plan.commerceSnapshot?.filters || []).some((f) => f.field === "weekend"),
      };
    `);
    expect(out.weekendFilter).toBe(true);
    expect(out.alignment).toEqual(expect.arrayContaining(["weekend"]));
    expect(out.snapshotWeekend).toBe(true);
    expect(String(out.text || "")).toMatch(/kept 2 of 4 checks/);
    expect(String(out.text || "")).toMatch(/order_count was 2\b/);
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
