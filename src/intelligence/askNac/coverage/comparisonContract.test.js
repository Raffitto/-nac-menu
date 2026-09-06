import { buildComparisonStatement, percentChange, isDateOfMonthMirror } from "./comparisonContract";

describe("comparison contract", () => {
  test("prints both values, absolute change, and percent", () => {
    const statement = buildComparisonStatement({
      currentLabel: "1–5 Sep 2026",
      currentValue: 95450,
      previousLabel: "1–5 Aug 2026",
      previousValue: 80000,
    });
    expect(statement.absoluteChange).toBe(15450);
    expect(statement.percentChange).toBeCloseTo(19.3125);
    expect(statement.text).toMatch(/1–5 Sep 2026: 95450 SAR/);
    expect(statement.text).toMatch(/1–5 Aug 2026: 80000 SAR/);
    expect(statement.text).toMatch(/Change:/);
  });

  test("zero prior period does not invent a percentage", () => {
    expect(percentChange(100, 0).reason).toBe("zero_denominator");
    const statement = buildComparisonStatement({
      currentLabel: "today",
      currentValue: 100,
      previousLabel: "yesterday",
      previousValue: 0,
    });
    expect(statement.percentChange).toBeNull();
    expect(statement.text).toMatch(/verified zero/);
  });

  test("NO_DATA current still prints the prior value and no percentage", () => {
    const statement = buildComparisonStatement({
      currentLabel: "This week (6–12 Sep)",
      currentValue: null,
      previousLabel: "Last week (30 Aug–5 Sep)",
      previousValue: 113870.39,
      currentCoverageStatus: "NO_DATA",
    });
    expect(statement.text).toMatch(/no completed Cash Up day yet/i);
    expect(statement.text).toMatch(/113870.39 SAR/);
    expect(statement.percentChange).toBeNull();
    expect(statement.absoluteChange).toBeNull();
  });

  test("VALUE vs NO_DATA prints both sides without a percentage", () => {
    const statement = buildComparisonStatement({
      currentLabel: "This week",
      currentValue: 100,
      previousLabel: "Last week",
      previousValue: null,
      previousCoverageStatus: "NO_DATA",
    });
    expect(statement.text).toMatch(/This week: 100 SAR/);
    expect(statement.text).toMatch(/unavailable/);
    expect(statement.percentChange).toBeNull();
  });

  test("verified zero current still prints a percentage against a prior value", () => {
    const statement = buildComparisonStatement({
      currentLabel: "Today",
      currentValue: 0,
      previousLabel: "Yesterday",
      previousValue: 100,
    });
    expect(statement.currentValue).toBe(0);
    expect(statement.percentChange).toBe(-100);
  });

  test("Sep 1–5 vs Aug 1–5 is a date-of-month mirror", () => {
    expect(isDateOfMonthMirror(
      { startDate: "2026-09-01", endDate: "2026-09-05" },
      { startDate: "2026-08-01", endDate: "2026-08-05" },
    )).toBe(true);
  });
});
