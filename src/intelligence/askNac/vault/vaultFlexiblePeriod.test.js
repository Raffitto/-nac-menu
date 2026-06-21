import {
  parseVaultPeriodFromQuestion,
  parseVaultComparePeriodsFromQuestion,
  parseVaultCustomCompareFromQuestion,
  parseExplicitDateRangeFromText,
  parseHalfMonthPhrase,
  isVaultCashUpAnalyticsPeriod,
  isVaultFlexibleRangePeriod,
} from "./vaultPeriodParser";
import { buildCashUpPeriodAggregateAnswer, buildCashUpPeriodCompareMetrics } from "./vaultSalesPerformanceIntelligence";
import { routeAskNacIntent, ASK_NAC_INTENTS } from "../intentRouter";

const REF = new Date("2026-06-21T12:00:00");

describe("flexible explicit date ranges", () => {
  test("June 1 to June 15", () => {
    const period = parseVaultPeriodFromQuestion("sales from June 1 to June 15", REF);
    expect(period?.startDate).toBe("2026-06-01");
    expect(period?.endDate).toBe("2026-06-15");
    expect(period?.periodType).toBe("custom_range");
    expect(isVaultCashUpAnalyticsPeriod(period)).toBe(true);
  });

  test("1 June to 15 June", () => {
    const period = parseExplicitDateRangeFromText("1 June to 15 June", REF);
    expect(period?.startDate).toBe("2026-06-01");
    expect(period?.endDate).toBe("2026-06-15");
  });

  test("June 1-15", () => {
    const period = parseExplicitDateRangeFromText("June 1-15", REF);
    expect(period?.startDate).toBe("2026-06-01");
    expect(period?.endDate).toBe("2026-06-15");
  });

  test("between June 5 and June 20", () => {
    const period = parseExplicitDateRangeFromText("delivery sales between June 5 and June 20", REF);
    expect(period?.startDate).toBe("2026-06-05");
    expect(period?.endDate).toBe("2026-06-20");
  });

  test("01/06 to 15/06", () => {
    const period = parseExplicitDateRangeFromText("01/06 to 15/06", REF);
    expect(period?.startDate).toBe("2026-06-01");
    expect(period?.endDate).toBe("2026-06-15");
  });

  test("ISO range", () => {
    const period = parseExplicitDateRangeFromText("2026-06-01 to 2026-06-15", REF);
    expect(period?.startDate).toBe("2026-06-01");
    expect(period?.endDate).toBe("2026-06-15");
  });

  test("from June 1 until June 18", () => {
    const period = parseVaultPeriodFromQuestion("guests from June 1 until June 18", REF);
    expect(period?.startDate).toBe("2026-06-01");
    expect(period?.endDate).toBe("2026-06-18");
  });
});

describe("half-month phrases", () => {
  test("first half of June", () => {
    const period = parseHalfMonthPhrase("first half of June", REF);
    expect(period?.startDate).toBe("2026-06-01");
    expect(period?.endDate).toBe("2026-06-15");
    expect(period?.periodType).toBe("first_half");
    expect(isVaultFlexibleRangePeriod(period)).toBe(true);
  });

  test("second half of June caps at reference date in current month", () => {
    const period = parseHalfMonthPhrase("second half of June", REF);
    expect(period?.startDate).toBe("2026-06-16");
    expect(period?.endDate).toBe("2026-06-21");
  });

  test("first half this month", () => {
    const period = parseHalfMonthPhrase("first half this month", REF);
    expect(period?.startDate).toBe("2026-06-01");
    expect(period?.endDate).toBe("2026-06-15");
  });

  test("second half this month", () => {
    const period = parseHalfMonthPhrase("second half this month", REF);
    expect(period?.startDate).toBe("2026-06-16");
    expect(period?.endDate).toBe("2026-06-21");
  });
});

describe("custom compare periods", () => {
  test("compare June 1-15 vs May 1-15", () => {
    const compare = parseVaultComparePeriodsFromQuestion("compare June 1-15 vs May 1-15", REF);
    expect(compare?.current.startDate).toBe("2026-06-01");
    expect(compare?.current.endDate).toBe("2026-06-15");
    expect(compare?.previous.startDate).toBe("2026-05-01");
    expect(compare?.previous.endDate).toBe("2026-05-15");
    expect(compare?.periodType).toBe("custom_compare");
  });

  test("compare first half of June vs second half of June", () => {
    const compare = parseVaultComparePeriodsFromQuestion("compare first half of June vs second half of June", REF);
    expect(compare?.current.startDate).toBe("2026-06-01");
    expect(compare?.current.endDate).toBe("2026-06-15");
    expect(compare?.previous.startDate).toBe("2026-06-16");
    expect(compare?.previous.endDate).toBe("2026-06-21");
  });

  test("parseVaultCustomCompareFromQuestion normalized structure", () => {
    const normalized = parseVaultCustomCompareFromQuestion("compare June 1-15 vs May 1-15", REF);
    expect(normalized?.periodType).toBe("custom_compare");
    expect(normalized?.isComparison).toBe(true);
    expect(normalized?.currentPeriod.startDate).toBe("2026-06-01");
    expect(normalized?.comparisonPeriod.startDate).toBe("2026-05-01");
  });

  test("compare answer includes sales, guest, and delivery deltas", () => {
    const current = {
      totalSales: 100000,
      totalGuests: 1000,
      averageSpend: 100,
      totalDeliverySales: 10000,
      totalDeliveryOrders: 100,
      dayCount: 10,
    };
    const previous = {
      totalSales: 80000,
      totalGuests: 900,
      averageSpend: 88.89,
      totalDeliverySales: 8000,
      totalDeliveryOrders: 80,
      dayCount: 12,
    };
    const answer = buildCashUpPeriodAggregateAnswer("compare June 1-15 vs May 1-15", current, {
      branchLabel: "Khobar",
      periodLabel: "1–15 June 2026",
      previousAggregation: previous,
      previousPeriodLabel: "1–15 May 2026",
    });
    expect(answer).toMatch(/Sales delta/i);
    expect(answer).toMatch(/Guest delta/i);
    expect(answer).toMatch(/Delivery sales delta/i);
    expect(answer).toMatch(/Coverage note/i);

    const metrics = buildCashUpPeriodCompareMetrics(current, previous);
    expect(metrics.some((m) => m.label === "Sales delta")).toBe(true);
    expect(metrics.some((m) => m.label === "Guest delta")).toBe(true);
    expect(metrics.some((m) => m.label === "Delivery orders delta")).toBe(true);
  });
});

describe("routing and preserved behavior", () => {
  test("custom range routes to vault cash-up summary", () => {
    const route = routeAskNacIntent("sales from June 1 to June 15");
    expect(route.intent).toBe(ASK_NAC_INTENTS.VAULT_CASH_UP_SUMMARY);
    expect(route.vaultPeriod?.startDate).toBe("2026-06-01");
  });

  test("compare sets vaultCompare on route", () => {
    const route = routeAskNacIntent("compare June 1-15 vs May 1-15");
    expect(route.intent).toBe(ASK_NAC_INTENTS.VAULT_CASH_UP_SUMMARY);
    expect(route.vaultCompare?.current.startDate).toBe("2026-06-01");
    expect(route.vaultCompare?.previous.startDate).toBe("2026-05-01");
  });

  test("single-day latest path unchanged", () => {
    const period = parseVaultPeriodFromQuestion("show latest cash up on 19 June 2026", REF);
    expect(period?.isSingleDay).toBe(true);
    expect(period?.startDate).toBe("2026-06-19");
  });

  test("last 14 days preset unchanged", () => {
    const period = parseVaultPeriodFromQuestion("delivery mix last 14 days", REF);
    expect(period?.periodType).toBe("last_14_days");
  });
});
