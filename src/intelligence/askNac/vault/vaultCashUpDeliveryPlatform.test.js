import {
  aggregateCashUpFactsOverRange,
  aggregateDeliveryPlatformBreakdown,
  groupCashUpFactsByBusinessDate,
} from "./vaultCashUpAggregation";
import {
  buildCashUpDeliveryPlatformAnswer,
  buildCashUpPeriodAggregateAnswer,
  scoreDeliveryPlatformQueryFocus,
  extractDeliveryPlatformFromQuestion,
} from "./vaultSalesPerformanceIntelligence";
import { routeAskNacIntent, ASK_NAC_INTENTS } from "../intentRouter";
import { buildVaultAnswer } from "./vaultAnswerBuilder";
import { READINESS } from "../readinessEngine";

function dayFact(date, metricKey, metricValue, extras = {}) {
  return {
    id: `${date}-${metricKey}-${extras.dimensions?.platform || "agg"}`,
    file_id: "file-1",
    branch_id: "khobar",
    report_type: "cash_up",
    metric_key: metricKey,
    metric_value: metricValue,
    dimensions: extras.dimensions || {},
    period_start: date,
    period_end: date,
  };
}

function buildPlatformRangeFacts() {
  const facts = [];
  for (let i = 0; i < 3; i += 1) {
    const d = new Date("2026-06-20T12:00:00Z");
    d.setUTCDate(d.getUTCDate() - i);
    const iso = d.toISOString().slice(0, 10);
    facts.push(
      dayFact(iso, "delivery_sales", 100, { dimensions: { platform: "hunger" } }),
      dayFact(iso, "delivery_orders", 10, { dimensions: { platform: "hunger" } }),
      dayFact(iso, "delivery_sales", 200, { dimensions: { platform: "chefz" } }),
      dayFact(iso, "delivery_orders", 20, { dimensions: { platform: "chefz" } }),
      dayFact(iso, "delivery_sales", 150, { dimensions: { platform: "jahez" } }),
      dayFact(iso, "delivery_orders", 15, { dimensions: { platform: "jahez" } }),
      dayFact(iso, "net_sales", 10000),
    );
  }
  return facts;
}

describe("delivery platform aggregation", () => {
  test("groups platform sales and orders from dimensions.platform", () => {
    const factsByDate = groupCashUpFactsByBusinessDate(buildPlatformRangeFacts());
    const platformAgg = aggregateDeliveryPlatformBreakdown(factsByDate, "2026-06-18", "2026-06-20");

    expect(platformAgg.deliveryPlatformBreakdown.hunger.sales).toBe(300);
    expect(platformAgg.deliveryPlatformBreakdown.hunger.orders).toBe(30);
    expect(platformAgg.deliveryPlatformBreakdown.chefz.sales).toBe(600);
    expect(platformAgg.deliveryPlatformBreakdown.chefz.orders).toBe(60);
    expect(platformAgg.topPlatformBySales).toBe("chefz");
    expect(platformAgg.topPlatformByOrders).toBe("chefz");
  });

  test("calculates average order value and delivery shares", () => {
    const factsByDate = groupCashUpFactsByBusinessDate(buildPlatformRangeFacts());
    const agg = aggregateCashUpFactsOverRange({
      startDate: "2026-06-18",
      endDate: "2026-06-20",
      branchId: "khobar",
      factsByDate,
    });

    expect(agg.totalDeliverySales).toBe(1350);
    expect(agg.totalDeliveryOrders).toBe(135);
    expect(agg.deliveryPlatformBreakdown.hunger.averageOrderValue).toBe(10);
    expect(agg.deliveryPlatformBreakdown.hunger.salesShare).toBeCloseTo(22.2, 0);
    expect(agg.deliveryPlatformBreakdown.hunger.orderShare).toBeCloseTo(22.2, 0);
  });
});

describe("delivery platform query detection", () => {
  test("detects platform breakdown and specific platform queries", () => {
    expect(scoreDeliveryPlatformQueryFocus("which delivery platform generated most sales last 14 days")).toBe("platform_top_sales");
    expect(scoreDeliveryPlatformQueryFocus("delivery mix last 14 days")).toBe("platform_breakdown");
    expect(scoreDeliveryPlatformQueryFocus("how much did Hunger make last 14 days")).toBe("platform_specific");
    expect(extractDeliveryPlatformFromQuestion("how many Chefz orders this month")).toBe("chefz");
  });
});

describe("delivery platform period answers", () => {
  test("top platform by sales answer includes comparison and totals", () => {
    const agg = aggregateCashUpFactsOverRange({
      startDate: "2026-06-18",
      endDate: "2026-06-20",
      branchId: "khobar",
      factsByDate: groupCashUpFactsByBusinessDate(buildPlatformRangeFacts()),
    });

    const answer = buildCashUpDeliveryPlatformAnswer(
      "which delivery platform generated most sales last 14 days",
      agg,
      { branchLabel: "Khobar", periodLabel: "last 14 days" },
    );

    expect(answer).toMatch(/Top platform by sales: Chefz/i);
    expect(answer).toMatch(/Hunger/i);
    expect(answer).toMatch(/Total delivery sales/i);
  });

  test("specific Hunger query returns sales, orders, and share", () => {
    const agg = aggregateCashUpFactsOverRange({
      startDate: "2026-06-18",
      endDate: "2026-06-20",
      branchId: "khobar",
      factsByDate: groupCashUpFactsByBusinessDate(buildPlatformRangeFacts()),
    });

    const answer = buildCashUpPeriodAggregateAnswer("how much did Hunger make last 14 days", agg, {
      branchLabel: "Khobar",
      periodLabel: "last 14 days",
    });

    expect(answer).toMatch(/Hunger/i);
    expect(answer).toMatch(/300 SAR sales/i);
    expect(answer).toMatch(/30 orders/i);
    expect(answer).toMatch(/22\.2% of delivery sales/i);
  });

  test("existing delivery total query unchanged", () => {
    const agg = aggregateCashUpFactsOverRange({
      startDate: "2026-06-18",
      endDate: "2026-06-20",
      branchId: "khobar",
      factsByDate: groupCashUpFactsByBusinessDate(buildPlatformRangeFacts()),
    });

    const answer = buildCashUpPeriodAggregateAnswer("show delivery sales last 14 days", agg, {
      branchLabel: "Khobar",
      periodLabel: "last 14 days",
    });

    expect(answer).toMatch(/Khobar delivery sales/i);
    expect(answer).toMatch(/1,350 SAR/i);
    expect(answer).not.toMatch(/Top platform by sales/i);
  });

  test("routes delivery platform period query to vault cash-up summary", () => {
    const route = routeAskNacIntent("delivery mix last 14 days");
    expect(route.intent).toBe(ASK_NAC_INTENTS.VAULT_CASH_UP_SUMMARY);

    const agg = aggregateCashUpFactsOverRange({
      startDate: "2026-06-18",
      endDate: "2026-06-20",
      branchId: "khobar",
      factsByDate: groupCashUpFactsByBusinessDate(buildPlatformRangeFacts()),
    });

    const answer = buildVaultAnswer(route, {
      branchLabel: "Khobar",
      periodLabel: "last 14 days",
      facts: buildPlatformRangeFacts(),
      aggregation: agg,
      vaultSources: [{ fileId: "file-1", title: "Cash up 2026.xlsx" }],
    }, { status: READINESS.READY, canQuery: true });

    expect(answer.title).toMatch(/Delivery platform breakdown/i);
    expect(answer.keyMetrics.some((m) => m.label === "Top platform by sales")).toBe(true);
    expect(answer.keyMetrics.some((m) => m.label === "Chefz sales")).toBe(true);
  });
});
