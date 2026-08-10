import {
  buildSalesPerformanceExecutiveSummary,
  buildSalesPerformanceQueryAnswer,
  buildPerformanceOverviewAnswer,
  buildCashUpPeriodAggregateAnswer,
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
      dailyBreakdown: [
        { date: "2026-07-01", totalSales: 9000 },
        { date: "2026-07-02", totalSales: 14000 },
        { date: "2026-07-03", totalSales: 11000 },
        { date: "2026-07-04", totalSales: 8000 },
      ],
    };
    const previous = {
      totalSales: 90000,
      totalGuests: 1100,
      averageSpend: 90000 / 1100,
      dayCount: 8,
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
    expect(answer).toMatch(/Key KPIs/i);
    expect(answer).toMatch(/Strongest day/i);
    expect(answer).toMatch(/Weakest day/i);
    expect(answer).toMatch(/8 of 10/);
    expect(answer).not.toMatch(/clearer metric/i);
    expect(String(buildSpecificUnknownMessage())).toMatch(/./);

    const partial = buildCashUpPeriodAggregateAnswer(
      "How are we doing this month?",
      { totalSales: null, totalGuests: 400, dayCount: 5, expectedDayCount: 10, missingDayCount: 5, dailyBreakdown: [] },
      { branchLabel: "Khobar", periodLabel: "this month" },
    );
    expect(partial).toMatch(/400 guests|guests/);
    expect(partial).not.toMatch(/Need a clearer metric question/i);
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
