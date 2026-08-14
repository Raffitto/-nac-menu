import {
  parseVaultPeriodFromQuestion,
  parseVaultComparePeriodsFromQuestion,
  parseVaultCustomCompareFromQuestion,
  parseExplicitDateRangeFromText,
  parseHalfMonthPhrase,
  isVaultCashUpAnalyticsPeriod,
  isVaultFlexibleRangePeriod,
  listPeriodDates,
} from "./vaultPeriodParser";
import {
  buildCashUpPeriodAggregateAnswer,
  buildCashUpPeriodCompareMetrics,
  buildMatchedCoverageComparison,
} from "./vaultSalesPerformanceIntelligence";
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

  test("from 9 to 13 aug inherits year and is inclusive of five calendar days", () => {
    const ref = new Date("2026-08-14T16:16:00.000Z");
    const period = parseVaultPeriodFromQuestion("sales from 9 to 13 aug", ref);
    expect(period?.startDate).toBe("2026-08-09");
    expect(period?.endDate).toBe("2026-08-13");
    expect(listPeriodDates(period)).toHaveLength(5);
    expect(period?.periodType).toBe("custom_range");
  });

  test("from 12 to 13 aug is exactly two days", () => {
    const ref = new Date("2026-08-14T16:16:00.000Z");
    const period = parseVaultPeriodFromQuestion("sales from 12 to 13 aug", ref);
    expect(period?.startDate).toBe("2026-08-12");
    expect(period?.endDate).toBe("2026-08-13");
    expect(listPeriodDates(period)).toHaveLength(2);
  });

  test("from 1 to 1 aug is exactly one day", () => {
    const ref = new Date("2026-08-14T16:16:00.000Z");
    const period = parseVaultPeriodFromQuestion("sales from 1 to 1 aug", ref);
    expect(period?.startDate).toBe("2026-08-01");
    expect(period?.endDate).toBe("2026-08-01");
    expect(listPeriodDates(period)).toHaveLength(1);
    expect(period?.isSingleDay).toBe(true);
  });

  test("from 1 aug to 13 aug is exactly 13 days", () => {
    const ref = new Date("2026-08-14T16:16:00.000Z");
    const period = parseVaultPeriodFromQuestion("sales from 1 aug to 13 aug", ref);
    expect(period?.startDate).toBe("2026-08-01");
    expect(period?.endDate).toBe("2026-08-13");
    expect(listPeriodDates(period)).toHaveLength(13);
  });

  test("from 30 july to 2 aug crosses month end inclusively", () => {
    const ref = new Date("2026-08-14T16:16:00.000Z");
    const period = parseVaultPeriodFromQuestion("sales from 30 july to 2 aug", ref);
    expect(period?.startDate).toBe("2026-07-30");
    expect(period?.endDate).toBe("2026-08-02");
    expect(listPeriodDates(period)).toHaveLength(4);
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

  test("unequal observed days without daily rows do not headline-compare totals", () => {
    const current = {
      totalSales: 100000,
      totalGuests: 1000,
      averageSpend: 100,
      totalDeliverySales: 10000,
      totalDeliveryOrders: 100,
      dayCount: 10,
      expectedDayCount: 15,
      requestedStartDate: "2026-06-01",
      requestedEndDate: "2026-06-15",
      dailyBreakdown: [],
    };
    const previous = {
      totalSales: 80000,
      totalGuests: 900,
      averageSpend: 88.89,
      totalDeliverySales: 8000,
      totalDeliveryOrders: 80,
      dayCount: 12,
      expectedDayCount: 15,
      requestedStartDate: "2026-05-01",
      requestedEndDate: "2026-05-15",
      dailyBreakdown: [],
    };

    const comparison = buildMatchedCoverageComparison(current, previous);
    expect(comparison.mode).toBe("unavailable");
    expect(comparison.reason).toBe("missing_daily_breakdown");
    expect(comparison.expectedDayCount).toBe(15);
    expect(comparison.currentObservedDayCount).toBe(10);
    expect(comparison.previousObservedDayCount).toBe(12);
    expect(comparison.missingCurrentDayCount).toBe(5);

    const answer = buildCashUpPeriodAggregateAnswer("compare June 1-15 vs May 1-15", current, {
      branchLabel: "Khobar",
      periodLabel: "1–15 June 2026",
      previousAggregation: previous,
      previousPeriodLabel: "1–15 May 2026",
    });
    expect(answer).toMatch(/not yet like-for-like/i);
    expect(answer).toMatch(/10 of 15 days/);
    expect(answer).toMatch(/Available-day average sales/i);
    expect(answer).not.toMatch(/Sales delta/i);
    expect(answer).not.toMatch(/Guest delta/i);

    const metrics = buildCashUpPeriodCompareMetrics(current, previous);
    expect(metrics.some((m) => m.label === "Comparison status" && m.value === "Not like-for-like")).toBe(true);
    expect(metrics.some((m) => m.label === "Current period days" && Number(m.value) === 10)).toBe(true);
    expect(metrics.some((m) => m.label === "Comparison period days" && Number(m.value) === 12)).toBe(true);
    expect(metrics.some((m) => m.label === "Sales delta")).toBe(false);
  });

  test("like-for-like compare uses matched calendar offsets, not raw observed totals", () => {
    const makeDay = (date, sales, guests = 100) => ({
      date,
      totalSales: sales,
      totalGuests: guests,
      totalOrders: 40,
      totalDeliverySales: 1000,
      totalDeliveryOrders: 10,
    });
    const current = {
      totalSales: 100000,
      totalGuests: 1000,
      dayCount: 10,
      expectedDayCount: 15,
      requestedStartDate: "2026-06-01",
      requestedEndDate: "2026-06-15",
      dailyBreakdown: Array.from({ length: 10 }, (_, i) => makeDay(
        `2026-06-${String(i + 1).padStart(2, "0")}`,
        10000,
      )),
    };
    const previous = {
      totalSales: 120000,
      totalGuests: 1200,
      dayCount: 12,
      expectedDayCount: 15,
      requestedStartDate: "2026-05-01",
      requestedEndDate: "2026-05-15",
      dailyBreakdown: Array.from({ length: 12 }, (_, i) => makeDay(
        `2026-05-${String(i + 1).padStart(2, "0")}`,
        8000,
      )),
    };

    const comparison = buildMatchedCoverageComparison(current, previous);
    expect(comparison.mode).toBe("matched");
    expect(comparison.matchedDayCount).toBe(10);
    expect(comparison.currentMatched.totalSales).toBe(100000);
    expect(comparison.previousMatched.totalSales).toBe(80000);

    const answer = buildCashUpPeriodAggregateAnswer("compare June 1-15 vs May 1-15", current, {
      branchLabel: "Khobar",
      periodLabel: "1–15 June 2026",
      previousAggregation: previous,
      previousPeriodLabel: "1–15 May 2026",
    });
    expect(answer).toMatch(/like-for-like 10-day/i);
    expect(answer).toMatch(/Sales delta/i);
    expect(answer).not.toMatch(/120,000/);
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

  test("this year resolves to year-to-date", () => {
    const period = parseVaultPeriodFromQuestion("delivery apps this year", REF);
    expect(period?.periodType).toBe("year_to_date");
    expect(period?.startDate).toBe("2026-01-01");
    expect(period?.endDate).toBe("2026-06-21");
    expect(isVaultCashUpAnalyticsPeriod(period)).toBe(true);
  });

  test("sales yesterday routes to vault with single day", () => {
    const route = routeAskNacIntent("sales yesterday");
    expect(route.intent).toBe(ASK_NAC_INTENTS.VAULT_CASH_UP_SUMMARY);
    expect(route.vaultPeriod?.isSingleDay).toBe(true);
  });
});
