import {
  routeAskNacIntent,
  ASK_NAC_INTENTS,
} from "../intentRouter";
import {
  resolveWhyVaultCompare,
  isWhyBusinessQuestion,
  detectWhyMetricFocus,
} from "./vaultBusinessReasoningRouting";
import {
  buildInternalSignalsFromAggregations,
} from "./vaultNilSignalCollector";
import { buildVaultBusinessReasoningAnswer } from "./vaultBusinessReasoningAnswer";
import { parseVaultPeriodFromQuestion } from "./vaultPeriodParser";

const REF = new Date("2026-06-21T12:00:00");

describe("why intent routing", () => {
  test("why were sales down last 7 days routes to vault_business_reasoning", () => {
    const route = routeAskNacIntent("why were sales down last 7 days");
    expect(route.intent).toBe(ASK_NAC_INTENTS.VAULT_BUSINESS_REASONING);
    expect(route.whyMetricFocus).toBe("sales");
    expect(route.vaultCompare?.current?.periodType).toBe("last_7_days");
    expect(route.vaultCompare?.previous?.periodType).toBe("previous_7_days");
  });

  test("why custom comparison resolves periods", () => {
    const compare = resolveWhyVaultCompare("why were sales lower June 1-15 vs May 1-15", REF);
    expect(compare?.current?.startDate).toBe("2026-06-01");
    expect(compare?.previous?.startDate).toBe("2026-05-01");
    const route = routeAskNacIntent("why were sales lower June 1-15 vs May 1-15");
    expect(route.intent).toBe(ASK_NAC_INTENTS.VAULT_BUSINESS_REASONING);
    expect(route.vaultCompare?.current?.startDate).toBe("2026-06-01");
  });

  test("why custom range resolves previous equal window", () => {
    const compare = resolveWhyVaultCompare("why was average spend down between June 1 and June 10", REF);
    expect(compare?.current?.startDate).toBe("2026-06-01");
    expect(compare?.current?.endDate).toBe("2026-06-10");
    expect(compare?.previous?.endDate).toBe("2026-05-31");
  });

  test("why guests question routes correctly", () => {
    expect(isWhyBusinessQuestion("why did guests drop last 14 days")).toBe(true);
    const route = routeAskNacIntent("why did guests drop last 14 days");
    expect(route.intent).toBe(ASK_NAC_INTENTS.VAULT_BUSINESS_REASONING);
    expect(detectWhyMetricFocus(route.debug.nlu.normalizedQuestion)).toBe("guests");
    expect(route.vaultCompare?.current?.periodType).toBe("last_14_days");
  });
});

describe("NIL internal signal collection", () => {
  test("builds pct change signals from aggregations", () => {
    const signals = buildInternalSignalsFromAggregations(
      {
        totalSales: 90000,
        totalGuests: 900,
        averageSpend: 100,
        totalDeliverySales: 10000,
        totalDeliveryOrders: 100,
        dayCount: 7,
      },
      {
        totalSales: 100000,
        totalGuests: 1000,
        averageSpend: 100,
        totalDeliverySales: 10000,
        totalDeliveryOrders: 100,
        dayCount: 7,
      },
      { periodLabel: "last 7 days vs previous 7 days", branchLabel: "Khobar" },
    );

    const salesSignal = signals.find((s) => s.metric === "sales_change_pct");
    expect(salesSignal?.value).toBe(-10);
    expect(signals.some((s) => s.metric === "delivery_performance" && s.stable)).toBe(true);
    expect(signals.some((s) => /same direction/i.test(s.label || ""))).toBe(true);
  });
});

describe("business reasoning answer", () => {
  test("separates facts, correlations, hypotheses, recommendations", () => {
    const route = {
      intent: ASK_NAC_INTENTS.VAULT_BUSINESS_REASONING,
      question: "why were sales down last 7 days",
      whyMetricFocus: "sales",
    };
    const tool = {
      branchLabel: "Khobar",
      periodLabel: "last 7 days vs previous 7 days",
      aggregation: {
        totalSales: 90000,
        totalGuests: 900,
        averageSpend: 100,
        totalDeliverySales: 10000,
        totalDeliveryOrders: 100,
        dayCount: 7,
      },
      previousAggregation: {
        totalSales: 100000,
        totalGuests: 1000,
        averageSpend: 100,
        totalDeliverySales: 10000,
        totalDeliveryOrders: 100,
        dayCount: 7,
      },
      sources: [{ name: "ask_nac_structured_facts", detail: "compare aggregation" }],
      warnings: [],
    };

    const answer = buildVaultBusinessReasoningAnswer(route, tool, { status: "ready", canQuery: true });
    expect(answer.directAnswer).toMatch(/Confirmed Facts/);
    expect(answer.directAnswer).toMatch(/Evidence-Based Correlations/);
    expect(answer.directAnswer).toMatch(/Hypotheses/);
    expect(answer.directAnswer).toMatch(/Recommendations/);
    expect(answer.directAnswer).toMatch(/External Context/);
    expect(answer.directAnswer).toMatch(/No external context sources are connected yet/);
    expect(answer.keyMetrics.length).toBeGreaterThan(0);
    expect(answer.warnings).toContain("No external context sources are connected yet.");
  });

  test("does not invent external factors", () => {
    const route = {
      intent: ASK_NAC_INTENTS.VAULT_BUSINESS_REASONING,
      question: "why were sales down last 7 days",
    };
    const tool = {
      branchLabel: "Khobar",
      periodLabel: "last 7 days vs previous 7 days",
      aggregation: {
        totalSales: 90000,
        totalGuests: 900,
        averageSpend: 100,
        totalDeliverySales: 10000,
        totalDeliveryOrders: 100,
        dayCount: 7,
      },
      previousAggregation: {
        totalSales: 100000,
        totalGuests: 1000,
        averageSpend: 100,
        totalDeliverySales: 10000,
        totalDeliveryOrders: 100,
        dayCount: 7,
      },
      sources: [],
      warnings: [],
    };

    const answer = buildVaultBusinessReasoningAnswer(route, tool, { status: "ready", canQuery: true });
    const text = answer.directAnswer.toLowerCase();
    expect(text).not.toMatch(/because humidity/);
    expect(text).not.toMatch(/because competitors/);
    expect(text).not.toMatch(/because weather/);
  });
});

describe("preserved period behavior", () => {
  test("sales last 14 days still routes to vault cash-up summary", () => {
    const route = routeAskNacIntent("show sales last 14 days");
    expect(route.intent).toBe(ASK_NAC_INTENTS.VAULT_CASH_UP_SUMMARY);
  });

  test("latest cash-up path unchanged", () => {
    const period = parseVaultPeriodFromQuestion("show latest cash up on 19 June 2026", REF);
    expect(period?.isSingleDay).toBe(true);
    const route = routeAskNacIntent("show latest cash up");
    expect(route.intent).toBe(ASK_NAC_INTENTS.VAULT_CASH_UP_SUMMARY);
  });

  test("custom range non-why query unchanged", () => {
    const route = routeAskNacIntent("sales from June 1 to June 15");
    expect(route.intent).toBe(ASK_NAC_INTENTS.VAULT_CASH_UP_SUMMARY);
    expect(route.vaultPeriod?.startDate).toBe("2026-06-01");
  });
});
