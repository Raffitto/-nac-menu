import {
  buildSalesPerformanceExecutiveSummary,
  buildSalesPerformanceQueryAnswer,
  buildPerformanceOverviewAnswer,
  buildCashUpPeriodAggregateAnswer,
  buildMatchedCoverageComparison,
  buildCashUpPeriodCompareAnswer,
  extendedSalesPerformanceMetrics,
  hasReconciliationData,
  isPerformanceOverviewQuery,
  scoreSalesPerformanceQueryFocus,
} from "./vaultSalesPerformanceIntelligence";
import { routeAskNacIntent, ASK_NAC_INTENTS } from "../intentRouter";
import { buildSpecificUnknownMessage } from "../conversation/missingDataMessages";

const SALES_FACTS = [
  { metricKey: "net_sales", metricValue: 35912.17 },
  { metricKey: "guest_count", metricValue: 444 },
  { metricKey: "order_count", metricValue: 480 },
  { metricKey: "avg_per_guest", metricValue: 80.88 },
  { metricKey: "target_sales", metricValue: 42000 },
  { metricKey: "breakfast_sales", metricValue: 9000 },
  { metricKey: "lunch_sales", metricValue: 16000 },
  { metricKey: "dinner_sales", metricValue: 16359 },
  { metricKey: "discounts", metricValue: 890 },
  { metricKey: "voids", metricValue: 120 },
  { metricKey: "payment_method", metricValue: 22000, dimensions: { method: "Mada" } },
  { metricKey: "payment_method", metricValue: 9000, dimensions: { method: "Visa" } },
  { metricKey: "delivery_sales", metricValue: 3100, dimensions: { platform: "Talabat" } },
  { metricKey: "delivery_orders", metricValue: 42, dimensions: { platform: "Jahez" } },
];

describe("vaultSalesPerformanceIntelligence", () => {
  test("executive summary focuses on revenue, guests, and budget — not cash variance", () => {
    const summary = buildSalesPerformanceExecutiveSummary(SALES_FACTS, {
      branchLabel: "Khobar",
      periodLabel: "5 June 2026",
      fileTitle: "Khobar Sales 05-06-2026.xlsx",
    });

    expect(summary.answer).toMatch(/35,912.17/);
    expect(summary.answer).toMatch(/444 guests/);
    expect(summary.answer).toMatch(/80.88|avg spend/i);
    expect(summary.answer).toMatch(/budget|85\.5/i);
    expect(summary.answer).not.toMatch(/cash variance/i);
    expect(summary.managementNote).toMatch(/Payment mix|Budget|daypart/i);
    expect(hasReconciliationData(SALES_FACTS)).toBe(false);
    expect(summary.reconciliationNote).toBeNull();
  });

  test("reconciliation note only when document contains reconciliation fields", () => {
    const withReconciliation = [
      ...SALES_FACTS,
      { metricKey: "cash_expected", metricValue: 1000 },
      { metricKey: "cash_counted", metricValue: 980 },
      { metricKey: "cash_variance", metricValue: -20 },
    ];
    expect(hasReconciliationData(withReconciliation)).toBe(true);
    const summary = buildSalesPerformanceExecutiveSummary(withReconciliation, {
      branchLabel: "Khobar",
      periodLabel: "5 June 2026",
    });
    expect(summary.answer).toMatch(/35,912.17/);
    expect(summary.reconciliationNote).toMatch(/reconciliation/i);
  });

  test("targeted answers for sales performance questions", () => {
    expect(buildSalesPerformanceQueryAnswer("What is our average guest spend?", SALES_FACTS, {
      branchLabel: "Khobar",
      periodLabel: "5 June 2026",
    })).toMatch(/80.88/);

    expect(buildSalesPerformanceQueryAnswer("How many guests this month?", SALES_FACTS, {
      branchLabel: "Khobar",
      periodLabel: "June 2026",
    })).toMatch(/444 guests/);

    expect(buildSalesPerformanceQueryAnswer("Which payment method is most used?", SALES_FACTS, {
      periodLabel: "5 June 2026",
    })).toMatch(/Mada/);

    expect(buildSalesPerformanceQueryAnswer("How much came from Mada?", SALES_FACTS, {
      periodLabel: "5 June 2026",
    })).toMatch(/22,000/);

    expect(buildSalesPerformanceQueryAnswer("Which meal period generates most revenue?", SALES_FACTS, {
      periodLabel: "5 June 2026",
    })).toMatch(/Dinner/);

    expect(buildSalesPerformanceQueryAnswer("How far are we from budget?", SALES_FACTS, {
      branchLabel: "Khobar",
      periodLabel: "5 June 2026",
    })).toMatch(/below budget/i);
  });

  test("cash variance query without reconciliation data explains document type", () => {
    const answer = buildSalesPerformanceQueryAnswer("What was the cash variance?", SALES_FACTS, {
      periodLabel: "5 June 2026",
    });
    expect(answer).toMatch(/does not include cash reconciliation/i);
  });

  test("sales performance queries route to vault cash_up_summary over missing-data intents", () => {
    expect(scoreSalesPerformanceQueryFocus("What is our average guest spend?")).toBe("avg_spend");
    expect(routeAskNacIntent("What is our average guest spend for June?").intent).toBe(
      ASK_NAC_INTENTS.VAULT_CASH_UP_SUMMARY,
    );
    expect(routeAskNacIntent("How many guests this month?").intent).toBe(
      ASK_NAC_INTENTS.VAULT_CASH_UP_SUMMARY,
    );
  });

  test("performance overview questions route with resolvable temporal windows", () => {
    const tenDay = routeAskNacIntent("How did NAC Khobar perform over the last 10 days?");
    expect(tenDay.intent).toBe(ASK_NAC_INTENTS.VAULT_CASH_UP_SUMMARY);
    expect(tenDay.performanceOverview).toBe(true);
    expect(tenDay.confidence).not.toBe("none");
    expect(["high", "medium"]).toContain(tenDay.confidence);
    expect(tenDay.vaultPeriod?.expectedDayCount).toBe(10);
    expect(tenDay.vaultCompare?.previous?.startDate).toBeTruthy();
    expect(tenDay.vaultCompare?.autoAttached).toBe(true);

    const mtd = routeAskNacIntent("How are we doing this month?");
    expect(mtd.intent).toBe(ASK_NAC_INTENTS.VAULT_CASH_UP_SUMMARY);
    expect(mtd.performanceOverview).toBe(true);
    expect(mtd.vaultPeriod?.periodType).toBe("this_month");

    const lastMonth = routeAskNacIntent("How was business last month?");
    expect(lastMonth.intent).toBe(ASK_NAC_INTENTS.VAULT_CASH_UP_SUMMARY);
    expect(lastMonth.performanceOverview).toBe(true);
    expect(lastMonth.vaultPeriod?.periodType).toBe("named_month");

    expect(routeAskNacIntent("What color is the sky?").intent).toBe(ASK_NAC_INTENTS.UNKNOWN);
    expect(isPerformanceOverviewQuery("What color is the sky?")).toBe(false);
    expect(scoreSalesPerformanceQueryFocus("Which waiter performed best today?")).toBeNull();
  });

  test("performance overview answers with available KPIs and partial coverage", () => {
    const aggregation = {
      totalSales: 100000,
      totalGuests: 1200,
      totalOrders: null,
      averageSpend: 100000 / 1200,
      dayCount: 8,
      expectedDayCount: 10,
      missingDayCount: 2,
      requestedStartDate: "2026-07-01",
      dailyBreakdown: [
        { date: "2026-07-01", totalSales: 9000, totalGuests: 100 },
        { date: "2026-07-02", totalSales: 14000, totalGuests: 140 },
        { date: "2026-07-03", totalSales: 11000, totalGuests: 120 },
        { date: "2026-07-04", totalSales: 8000, totalGuests: 90 },
        { date: "2026-07-05", totalSales: 12000, totalGuests: 130 },
        { date: "2026-07-06", totalSales: 15000, totalGuests: 160 },
        { date: "2026-07-07", totalSales: 10000, totalGuests: 110 },
        { date: "2026-07-08", totalSales: 21000, totalGuests: 350 },
      ],
    };
    const previous = {
      totalSales: 90000,
      totalGuests: 1100,
      averageSpend: 90000 / 1100,
      dayCount: 8,
      expectedDayCount: 10,
      requestedStartDate: "2026-06-21",
      dailyBreakdown: [
        { date: "2026-06-21", totalSales: 8000, totalGuests: 95 },
        { date: "2026-06-22", totalSales: 12000, totalGuests: 130 },
        { date: "2026-06-23", totalSales: 10000, totalGuests: 110 },
        { date: "2026-06-24", totalSales: 9000, totalGuests: 100 },
        { date: "2026-06-25", totalSales: 11000, totalGuests: 125 },
        { date: "2026-06-26", totalSales: 13000, totalGuests: 140 },
        { date: "2026-06-27", totalSales: 9000, totalGuests: 105 },
        { date: "2026-06-28", totalSales: 18000, totalGuests: 295 },
      ],
    };
    const answer = buildPerformanceOverviewAnswer(
      "How did NAC Khobar perform over the last 10 days?",
      aggregation,
      {
        branchLabel: "Khobar",
        periodLabel: "last 10 days",
        previousAggregation: previous,
        previousPeriodLabel: "previous 10 days",
      },
    );
    expect(answer).toMatch(/100,000 SAR|100000 SAR/);
    expect(answer).toMatch(/8 available days of the requested 10-day window/i);
    expect(answer).toMatch(/like-for-like 8-day basis/i);
    expect(answer).toMatch(/Key KPIs/i);
    expect(answer).toMatch(/Strongest day/i);
    expect(answer).toMatch(/Weakest day/i);
    expect(answer).toMatch(/not yet available/i);
    expect(answer).not.toMatch(/clearer metric/i);
    expect(answer).not.toMatch(/\bdown 8\.4%/i);
    expect(String(buildSpecificUnknownMessage())).toMatch(/./);

    const partial = buildCashUpPeriodAggregateAnswer(
      "How are we doing this month?",
      { totalSales: null, totalGuests: 400, dayCount: 5, expectedDayCount: 10, missingDayCount: 5, dailyBreakdown: [] },
      { branchLabel: "Khobar", periodLabel: "this month" },
    );
    expect(partial).toMatch(/400 guests|guests/);
    expect(partial).not.toMatch(/Need a clearer metric question/i);
  });

  test("partial-period comparisons stay like-for-like and never invent zeros", () => {
    const makeDay = (date, sales, guests, orders) => ({
      date,
      totalSales: sales,
      totalGuests: guests,
      totalOrders: orders,
    });

    const completeCurrent = {
      totalSales: 100000,
      totalGuests: 1000,
      totalOrders: 500,
      averageSpend: 100,
      dayCount: 10,
      expectedDayCount: 10,
      missingDayCount: 0,
      requestedStartDate: "2026-08-01",
      dailyBreakdown: Array.from({ length: 10 }, (_, i) => makeDay(
        `2026-08-${String(i + 1).padStart(2, "0")}`,
        10000,
        100,
        50,
      )),
    };
    const completePrevious = {
      totalSales: 90000,
      totalGuests: 900,
      totalOrders: 450,
      averageSpend: 100,
      dayCount: 10,
      expectedDayCount: 10,
      requestedStartDate: "2026-07-22",
      dailyBreakdown: Array.from({ length: 10 }, (_, i) => {
        const day = 22 + i;
        const month = day <= 31 ? "07" : "08";
        const d = day <= 31 ? day : day - 31;
        return makeDay(`2026-${month}-${String(d).padStart(2, "0")}`, 9000, 90, 45);
      }),
    };
    const full = buildMatchedCoverageComparison(completeCurrent, completePrevious);
    expect(full.mode).toBe("full");
    const fullAnswer = buildPerformanceOverviewAnswer("How did we perform over the last 10 days?", completeCurrent, {
      branchLabel: "Khobar",
      periodLabel: "last 10 days",
      previousAggregation: completePrevious,
      previousPeriodLabel: "previous 10 days",
    });
    expect(fullAnswer).toMatch(/Compared with previous 10 days: up 11\.1%/i);

    // Production-like: current 8/10 vs previous full 10 — must not use 8-vs-10 total headline %.
    const current8 = {
      totalSales: 147254.783,
      totalGuests: 2191,
      totalOrders: 879,
      averageSpend: 67.209,
      dayCount: 8,
      expectedDayCount: 10,
      missingDayCount: 2,
      requestedStartDate: "2026-07-31",
      dailyBreakdown: [
        makeDay("2026-08-01", 18000, 270, 110),
        makeDay("2026-08-02", 19000, 280, 112),
        makeDay("2026-08-03", 18500, 275, 111),
        makeDay("2026-08-04", 17000, 260, 105),
        makeDay("2026-08-05", 20000, 300, 120),
        makeDay("2026-08-06", 19500, 290, 115),
        makeDay("2026-08-07", 17254.783, 256, 103),
        makeDay("2026-08-08", 18000, 260, 103),
      ],
    };
    const previous10 = {
      totalSales: 160691.304,
      totalGuests: 2300,
      totalOrders: 920,
      averageSpend: 69.866,
      dayCount: 10,
      expectedDayCount: 10,
      requestedStartDate: "2026-07-21",
      dailyBreakdown: [
        makeDay("2026-07-21", 16000, 230, 90),
        makeDay("2026-07-22", 16000, 230, 92),
        makeDay("2026-07-23", 16100, 231, 93),
        makeDay("2026-07-24", 16000, 230, 91),
        makeDay("2026-07-25", 16200, 232, 94),
        makeDay("2026-07-26", 16000, 230, 92),
        makeDay("2026-07-27", 16100, 231, 93),
        makeDay("2026-07-28", 16091.304, 228, 91),
        makeDay("2026-07-29", 16100, 234, 92),
        makeDay("2026-07-30", 16100, 234, 92),
      ],
    };

    const rawPct = ((147254.783 - 160691.304) / 160691.304) * 100;
    expect(rawPct).toBeCloseTo(-8.4, 1);

    const matched = buildMatchedCoverageComparison(current8, previous10);
    expect(matched.mode).toBe("matched");
    expect(matched.matchedDayCount).toBe(8);
    expect(matched.currentMatched.dayCount).toBe(8);
    expect(matched.previousMatched.dayCount).toBe(8);
    expect(matched.previousMatched.totalSales).toBeLessThan(previous10.totalSales);
    // Missing current days are omitted, never zero-filled into totals.
    expect(matched.currentMatched.totalSales).toBeCloseTo(147254.783, 3);
    expect(matched.currentMatched.averageSpend).toBeCloseTo(147254.783 / 2191, 3);

    const answer = buildPerformanceOverviewAnswer(
      "How did NAC Khobar perform over the last 10 days?",
      current8,
      {
        branchLabel: "Khobar",
        periodLabel: "last 10 days",
        previousAggregation: previous10,
        previousPeriodLabel: "previous 10 days",
      },
    );
    expect(answer).toMatch(/8 available days of the requested 10-day window/i);
    expect(answer).toMatch(/like-for-like 8-day basis/i);
    expect(answer).toMatch(/2 current-period days are not yet available/i);
    expect(answer).not.toMatch(/\bdown 8\.4%/i);
    expect(answer).not.toMatch(/Compared with previous 10 days: down/i);

    const unavailable = buildMatchedCoverageComparison(
      { ...current8, dailyBreakdown: [], requestedStartDate: "2026-07-31" },
      { ...previous10, dailyBreakdown: [] },
    );
    expect(unavailable.mode).toBe("unavailable");
    const unavailableAnswer = buildPerformanceOverviewAnswer(
      "How did NAC Khobar perform over the last 10 days?",
      { ...current8, dailyBreakdown: [] },
      {
        branchLabel: "Khobar",
        periodLabel: "last 10 days",
        previousAggregation: { ...previous10, dailyBreakdown: [] },
        previousPeriodLabel: "previous 10 days",
      },
    );
    expect(unavailableAnswer).toMatch(/not yet like-for-like/i);
    expect(unavailableAnswer).toMatch(/Available-day average sales/i);
    expect(unavailableAnswer).not.toMatch(/\bdown 8\.4%/i);

    const compareAnswer = buildCashUpPeriodCompareAnswer(current8, previous10, {
      branchLabel: "Khobar",
      periodLabel: "last 10 days",
      previousPeriodLabel: "previous 10 days",
    });
    expect(compareAnswer).toMatch(/like-for-like 8-day/i);
    expect(compareAnswer).not.toMatch(/-8\.4%/);
  });

  test("explicit previous-period compare still routes for overview language", () => {
    const route = routeAskNacIntent(
      "How did we perform last week compared with the previous week?",
    );
    expect(route.intent).toBe(ASK_NAC_INTENTS.VAULT_CASH_UP_SUMMARY);
    expect(route.vaultCompare?.previous).toBeTruthy();
  });

  test("extended metrics exclude reconciliation unless present", () => {
    const metrics = extendedSalesPerformanceMetrics(SALES_FACTS);
    expect(metrics.some((m) => m.key === "net_sales")).toBe(true);
    expect(metrics.some((m) => m.key === "cash_variance")).toBe(false);
    expect(metrics.some((m) => m.key === "payment_Mada")).toBe(true);
  });

  test("headline delivery sales sums platform rows when aggregate row is absent", () => {
    const metrics = extendedSalesPerformanceMetrics([
      { metricKey: "delivery_sales", metricValue: 0, dimensions: { platform: "jahez" } },
      { metricKey: "delivery_sales", metricValue: 328, dimensions: { platform: "chefz" } },
      { metricKey: "delivery_sales", metricValue: 124, dimensions: { platform: "keeta" } },
      { metricKey: "delivery_sales", metricValue: 307, dimensions: { platform: "hunger" } },
    ]);

    expect(metrics.find((row) => row.key === "delivery_sales")?.value).toBe("759");
  });

  test("uses Electronic payments label for card_sales headline metric", () => {
    const metrics = extendedSalesPerformanceMetrics([
      { metricKey: "card_sales", metricValue: 19046 },
    ]);
    expect(metrics.find((row) => row.key === "card_sales")?.label).toBe("Electronic payments");
  });
});
