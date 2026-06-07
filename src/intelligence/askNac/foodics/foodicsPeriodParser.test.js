import {
  detectRankChangeDirection,
  detectRankingBasis,
  detectTopLimit,
  parseFoodicsComparePeriods,
  parseFoodicsPeriodFromQuestion,
} from "./foodicsPeriodParser";

describe("foodicsPeriodParser", () => {
  const ref = new Date("2026-06-06T12:00:00Z");

  test("parses May in reference year", () => {
    const period = parseFoodicsPeriodFromQuestion("What were sales in May?", ref);
    expect(period.startDate).toBe("2026-05-01");
    expect(period.endDate).toBe("2026-05-31");
    expect(period.label).toMatch(/May 2026/);
  });

  test("parses last month", () => {
    const period = parseFoodicsPeriodFromQuestion("top 10 items last month", ref);
    expect(period.startDate).toBe("2026-05-01");
    expect(period.endDate).toBe("2026-05-31");
  });

  test("compare periods default previous month", () => {
    const { current, previous } = parseFoodicsComparePeriods(
      "Which item entered the top 10 compared to last month?",
      ref,
    );
    expect(current.startDate).toBe("2026-05-01");
    expect(previous.startDate).toBe("2026-04-01");
  });

  test("detectRankingBasis defaults to net sales", () => {
    expect(detectRankingBasis("top 10 items last month")).toBe("net_sales");
  });

  test("detectRankingBasis quantity when asked", () => {
    expect(detectRankingBasis("Rank items by quantity instead of sales.")).toBe("quantity");
  });

  test("detectTopLimit from question", () => {
    expect(detectTopLimit("What were the top 10 items last month?")).toBe(10);
  });

  test("detectRankChangeDirection", () => {
    expect(detectRankChangeDirection("Which item dropped from the top 10?")).toBe("dropped");
    expect(detectRankChangeDirection("Which item entered the top 10?")).toBe("entered");
  });
});
