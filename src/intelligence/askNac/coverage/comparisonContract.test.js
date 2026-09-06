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

  test("Sep 1–5 vs Aug 1–5 is a date-of-month mirror", () => {
    expect(isDateOfMonthMirror(
      { startDate: "2026-09-01", endDate: "2026-09-05" },
      { startDate: "2026-08-01", endDate: "2026-08-05" },
    )).toBe(true);
  });
});
