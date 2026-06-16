import {
  buildSalesPerformanceExecutiveSummary,
  buildSalesPerformanceQueryAnswer,
  extendedSalesPerformanceMetrics,
  hasReconciliationData,
  scoreSalesPerformanceQueryFocus,
} from "./vaultSalesPerformanceIntelligence";
import { routeAskNacIntent, ASK_NAC_INTENTS } from "../intentRouter";

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

  test("extended metrics exclude reconciliation unless present", () => {
    const metrics = extendedSalesPerformanceMetrics(SALES_FACTS);
    expect(metrics.some((m) => m.key === "net_sales")).toBe(true);
    expect(metrics.some((m) => m.key === "cash_variance")).toBe(false);
    expect(metrics.some((m) => m.key === "payment_Mada")).toBe(true);
  });
});
