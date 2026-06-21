import {
  parseVaultPeriodFromQuestion,
  parseVaultComparePeriodsFromQuestion,
  isVaultRangePeriod,
} from "./vaultPeriodParser";
import {
  aggregateCashUpFactsOverRange,
  groupCashUpFactsByBusinessDate,
  buildCashUpRangeQueryLimit,
} from "./vaultCashUpAggregation";
import { CASH_UP_PERIOD_AGGREGATION_METRIC_KEYS } from "./vaultSalesPerformanceIntelligence";
import { buildCashUpPeriodAggregateAnswer } from "./vaultSalesPerformanceIntelligence";
import { routeAskNacIntent, ASK_NAC_INTENTS } from "../intentRouter";
import { buildVaultAnswer } from "./vaultAnswerBuilder";
import { READINESS } from "../readinessEngine";
import { runVaultQueryTool } from "./vaultQueryTools";

const REF = new Date("2026-06-20T12:00:00");

function dayFact(date, metricKey, metricValue, extras = {}) {
  return {
    id: `${date}-${metricKey}`,
    file_id: "file-1",
    branch_id: "khobar",
    report_type: "cash_up",
    metric_key: metricKey,
    metric_value: metricValue,
    dimensions: {},
    period_start: date,
    period_end: date,
    file: { id: "file-1", title: "Cash up 2026.xlsx", original_filename: "Cash up 2026.xlsx" },
    ...extras,
  };
}

function buildRangeFacts() {
  const days = [];
  for (let i = 0; i < 14; i += 1) {
    const d = new Date("2026-06-20T12:00:00Z");
    d.setUTCDate(d.getUTCDate() - i);
    const iso = d.toISOString().slice(0, 10);
    days.push(
      dayFact(iso, "net_sales", 10000 + i * 100),
      dayFact(iso, "guest_count", 100 + i),
      dayFact(iso, "delivery_sales", 1000 + i * 10),
      dayFact(iso, "delivery_orders", 20 + i),
    );
  }
  return days;
}

describe("vaultPeriodParser rolling periods", () => {
  test("parses last 14 days", () => {
    const period = parseVaultPeriodFromQuestion("show sales last 14 days", REF);
    expect(period?.periodType).toBe("last_14_days");
    expect(period?.startDate).toBe("2026-06-07");
    expect(period?.endDate).toBe("2026-06-20");
    expect(isVaultRangePeriod(period)).toBe(true);
  });

  test("parses last 7 days and past 7 days", () => {
    const last7 = parseVaultPeriodFromQuestion("sales last 7 days", REF);
    const past7 = parseVaultPeriodFromQuestion("sales past 7 days", REF);
    expect(last7?.periodType).toBe("last_7_days");
    expect(past7?.periodType).toBe("last_7_days");
    expect(last7?.startDate).toBe("2026-06-14");
  });

  test("parses this month as month-to-date", () => {
    const period = parseVaultPeriodFromQuestion("guests this month", REF);
    expect(period?.periodType).toBe("this_month");
    expect(period?.startDate).toBe("2026-06-01");
    expect(period?.endDate).toBe("2026-06-20");
  });

  test("parses compare last 7 vs previous 7", () => {
    const compare = parseVaultComparePeriodsFromQuestion("compare last 7 days vs previous 7 days", REF);
    expect(compare?.current.periodType).toBe("last_7_days");
    expect(compare?.previous.periodType).toBe("previous_7_days");
    expect(compare?.previous.endDate).toBe("2026-06-13");
  });
});

describe("aggregateCashUpFactsOverRange", () => {
  test("aggregates sales, guests, and delivery across days", () => {
    const facts = buildRangeFacts();
    const factsByDate = groupCashUpFactsByBusinessDate(facts);
    const agg = aggregateCashUpFactsOverRange({
      startDate: "2026-06-07",
      endDate: "2026-06-20",
      branchId: "khobar",
      factsByDate,
    });

    expect(agg.dayCount).toBe(14);
    expect(agg.totalSales).toBeGreaterThan(0);
    expect(agg.totalGuests).toBeGreaterThan(0);
    expect(agg.totalDeliverySales).toBeGreaterThan(0);
    expect(agg.totalDeliveryOrders).toBeGreaterThan(0);
    expect(agg.dailyBreakdown).toHaveLength(14);
  });

  test("ignores unrelated facts such as payment_method", () => {
    const facts = [
      ...buildRangeFacts().slice(0, 4),
      dayFact("2026-06-20", "payment_method", 9999, { dimensions: { method: "mada" } }),
    ];
    const agg = aggregateCashUpFactsOverRange({
      startDate: "2026-06-20",
      endDate: "2026-06-20",
      branchId: "khobar",
      factsByDate: groupCashUpFactsByBusinessDate(facts),
    });
    expect(agg.totalSales).toBe(10000);
    expect(agg.dayCount).toBe(1);
  });

  test("compare mode skips daily breakdown but keeps totals", () => {
    const facts = buildRangeFacts();
    const agg = aggregateCashUpFactsOverRange({
      startDate: "2026-06-14",
      endDate: "2026-06-20",
      branchId: "khobar",
      factsByDate: groupCashUpFactsByBusinessDate(facts),
      includeDailyBreakdown: false,
    });
    expect(agg.dailyBreakdown).toHaveLength(0);
    expect(agg.dayCount).toBe(7);
    expect(agg.totalSales).toBeGreaterThan(0);
  });

  test("range query limit scales modestly with span", () => {
    expect(buildCashUpRangeQueryLimit("2026-06-14", "2026-06-20")).toBe(140);
    expect(buildCashUpRangeQueryLimit("2026-06-01", "2026-06-20")).toBeLessThanOrEqual(800);
  });

  test("aggregation metric keys exclude reconciliation and payment mix", () => {
    expect(CASH_UP_PERIOD_AGGREGATION_METRIC_KEYS).toContain("net_sales");
    expect(CASH_UP_PERIOD_AGGREGATION_METRIC_KEYS).toContain("delivery_sales");
    expect(CASH_UP_PERIOD_AGGREGATION_METRIC_KEYS).not.toContain("cash_variance");
    expect(CASH_UP_PERIOD_AGGREGATION_METRIC_KEYS).not.toContain("payment_method");
  });
});

describe("period cash-up answers", () => {
  test("show sales last 14 days returns total, average, and days included", () => {
    const facts = buildRangeFacts();
    const factsByDate = groupCashUpFactsByBusinessDate(facts);
    const aggregation = aggregateCashUpFactsOverRange({
      startDate: "2026-06-07",
      endDate: "2026-06-20",
      branchId: "khobar",
      factsByDate,
    });

    const directAnswer = buildCashUpPeriodAggregateAnswer("show sales last 14 days", aggregation, {
      branchLabel: "Khobar",
      periodLabel: "last 14 days",
    });

    expect(directAnswer).toMatch(/total sales/i);
    expect(directAnswer).toMatch(/avg\/day/i);
    expect(directAnswer).toMatch(/14 cash-up day/i);

    const route = routeAskNacIntent("show sales last 14 days");
    expect(route.intent).toBe(ASK_NAC_INTENTS.VAULT_CASH_UP_SUMMARY);

    const answer = buildVaultAnswer(
      route,
      {
        branchLabel: "Khobar",
        periodLabel: "last 14 days",
        facts,
        aggregation,
        vaultSources: [{ fileId: "file-1", title: "Cash up 2026.xlsx", reportType: "cash_up" }],
      },
      { status: READINESS.READY, canQuery: true },
    );

    expect(answer.keyMetrics.some((m) => m.label === "Total sales")).toBe(true);
    expect(answer.keyMetrics.some((m) => m.label === "Average sales per day")).toBe(true);
    expect(answer.keyMetrics.some((m) => m.label === "Days included" && m.value === "14")).toBe(true);
  });

  test("show delivery sales last 14 days returns delivery totals and average", () => {
    const facts = buildRangeFacts();
    const aggregation = aggregateCashUpFactsOverRange({
      startDate: "2026-06-07",
      endDate: "2026-06-20",
      branchId: "khobar",
      factsByDate: groupCashUpFactsByBusinessDate(facts),
    });

    const directAnswer = buildCashUpPeriodAggregateAnswer("show delivery sales last 14 days", aggregation, {
      branchLabel: "Khobar",
      periodLabel: "last 14 days",
    });

    expect(directAnswer).toMatch(/delivery sales/i);
    expect(directAnswer).toMatch(/avg\/day/i);

    const route = routeAskNacIntent("show delivery sales last 14 days");
    expect(route.intent).toBe(ASK_NAC_INTENTS.VAULT_CASH_UP_SUMMARY);

    const answer = buildVaultAnswer(route, {
      branchLabel: "Khobar",
      periodLabel: "last 14 days",
      facts,
      aggregation,
      vaultSources: [{ fileId: "file-1", title: "Cash up 2026.xlsx" }],
    }, { status: READINESS.READY, canQuery: true });

    expect(answer.keyMetrics.some((m) => m.label === "Total delivery sales")).toBe(true);
    expect(answer.keyMetrics.some((m) => m.label === "Average delivery sales per day")).toBe(true);
  });

  test("guests this month returns aggregated guest count", () => {
    const facts = buildRangeFacts();
    const aggregation = aggregateCashUpFactsOverRange({
      startDate: "2026-06-01",
      endDate: "2026-06-20",
      branchId: "khobar",
      factsByDate: groupCashUpFactsByBusinessDate(facts),
    });

    const directAnswer = buildCashUpPeriodAggregateAnswer("guests this month", aggregation, {
      branchLabel: "Khobar",
      periodLabel: "June 2026 (to date)",
    });

    expect(directAnswer).toMatch(/recorded .* guests/i);

    const route = routeAskNacIntent("guests this month");
    expect(route.intent).toBe(ASK_NAC_INTENTS.VAULT_CASH_UP_SUMMARY);
  });
});

describe("runVaultQueryTool range path", () => {
  test("uses slim range retrieval for last 14 days", async () => {
    const factsQueryLog = [];
    const supabase = {
      from(table) {
        const state = { filters: {}, lte: {}, gte: {}, inFilter: null, limitN: null, neqs: {}, selectCols: null };
        const chain = {
          select(cols) { state.selectCols = cols; return chain; },
          eq(col, val) { state.filters[col] = val; return chain; },
          neq(col, val) { state.neqs[col] = val; return chain; },
          in(col, vals) { state.inFilter = { col, vals }; return chain; },
          lte(col, val) { state.lte[col] = val; return chain; },
          gte(col, val) { state.gte[col] = val; return chain; },
          order() { return chain; },
          limit(n) { state.limitN = n; return chain; },
          not() { return chain; },
        };
        chain.then = (onFulfilled, onRejected) => {
          if (table === "ask_nac_structured_facts") {
            factsQueryLog.push(state);
            return Promise.resolve({ data: buildRangeFacts(), error: null }).then(onFulfilled, onRejected);
          }
          if (table === "ask_nac_data_coverage") {
            return Promise.resolve({ data: [], error: null }).then(onFulfilled, onRejected);
          }
          return Promise.resolve({ data: [], error: null }).then(onFulfilled, onRejected);
        };
        return chain;
      },
    };

    const period = parseVaultPeriodFromQuestion("show sales last 14 days", REF);
    const result = await runVaultQueryTool(supabase, "vault_cash_up_summary", {
      question: "show sales last 14 days",
      vaultPeriod: period,
      filters: { branch: "khobar" },
    });

    expect(factsQueryLog.length).toBe(1);
    expect(String(factsQueryLog[0].selectCols)).not.toMatch(/ask_nac_files/);
    expect(factsQueryLog[0].inFilter.vals).toEqual(CASH_UP_PERIOD_AGGREGATION_METRIC_KEYS);
    expect(factsQueryLog[0].lte.period_start).toBe("2026-06-20");
    expect(factsQueryLog[0].gte.period_end).toBe("2026-06-07");
    expect(factsQueryLog[0].limitN).toBeLessThanOrEqual(800);
    expect(result.aggregation?.dayCount).toBe(14);
    expect(result.aggregation?.totalSales).toBeGreaterThan(0);
  });

  test("compare mode fetches ranges sequentially without merging facts", async () => {
    const callLog = [];
    const supabase = {
      from(table) {
        const state = { filters: {}, lte: {}, gte: {}, inFilter: null, limitN: null, neqs: {} };
        const chain = {
          select() { return chain; },
          eq(col, val) { state.filters[col] = val; return chain; },
          neq(col, val) { state.neqs[col] = val; return chain; },
          in(col, vals) { state.inFilter = { col, vals }; return chain; },
          lte(col, val) { state.lte[col] = val; return chain; },
          gte(col, val) { state.gte[col] = val; return chain; },
          order() { return chain; },
          limit(n) { state.limitN = n; return chain; },
          not() { return chain; },
        };
        chain.then = (onFulfilled, onRejected) => {
          if (table === "ask_nac_structured_facts") {
            callLog.push({ table, gte: state.gte.period_end, lte: state.lte.period_start });
            const start = state.gte.period_end;
            const facts = buildRangeFacts().filter((row) => row.period_end >= start);
            return Promise.resolve({ data: facts, error: null }).then(onFulfilled, onRejected);
          }
          return Promise.resolve({ data: [], error: null }).then(onFulfilled, onRejected);
        };
        return chain;
      },
    };

    const result = await runVaultQueryTool(supabase, "vault_cash_up_summary", {
      question: "compare last 7 days vs previous 7 days",
      vaultPeriod: parseVaultPeriodFromQuestion("compare last 7 days vs previous 7 days", REF),
      filters: { branch: "khobar" },
    });

    expect(callLog.filter((entry) => entry.table === "ask_nac_structured_facts")).toHaveLength(2);
    expect(result.facts).toEqual([]);
    expect(result.aggregation?.totalSales).toBeGreaterThan(0);
    expect(result.previousAggregation?.totalSales).toBeGreaterThan(0);
    expect(result.aggregation?.dailyBreakdown).toEqual([]);
  });
});
